// The catalogue price step: a chosen term and down payment become a monthly rent.
// monthly net rent = financed amount x coefficient factor (see coefficient.ts); VAT and the
// end-of-term buyout are added on top. Nothing here is locked yet: that happens when a
// contract is signed (see RULES.md problem 1 — a contract locks the net rent, not the VAT).
import type { CoefficientTable, VatRates } from '@/data/schemas';
import { monthlyFactorFor } from './coefficient';
import { vatRateOn } from './vat';

export type NetRentInput = {
  listPriceCents: number;
  downPaymentCents: number;
  termMonths: number;
};

export type NetRent = {
  listPriceCents: number;
  downPaymentCents: number;
  financedCents: number;
  band: string;
  monthlyFactor: number;
  monthlyNetRentCents: number;
  buyoutCents: number;
};

export type NetRentFailureReason =
  | 'down_payment_negative'
  | 'down_payment_exceeds_list_price'
  | 'below_minimum'
  | 'above_maximum'
  | 'unknown_term';

export type NetRentResult =
  { ok: true; netRent: NetRent } | { ok: false; reason: NetRentFailureReason };

/**
 * The part of a quote that gets locked at signing (see src/domain/contract.ts): the net
 * rent and the end-of-term buyout. VAT is deliberately not part of this — it is never
 * locked, see `quoteMonthlyRent` below and src/domain/invoicing.ts.
 *
 * Rounding: every money line (net rent, buyout) is rounded to the nearest cent on its own,
 * half a cent rounding up — the same rule the worked example in data/DATA.md uses. Rounding
 * each line separately, not the total, is the deliberate choice.
 */
export function quoteNetRent(
  coefficientTable: CoefficientTable,
  input: NetRentInput
): NetRentResult {
  if (!Number.isInteger(input.listPriceCents) || !Number.isInteger(input.downPaymentCents)) {
    // A fraction of a cent here is a programming error: money is always whole cents.
    throw new RangeError('listPriceCents and downPaymentCents must be whole cents');
  }

  if (input.downPaymentCents < 0) return { ok: false, reason: 'down_payment_negative' };
  if (input.downPaymentCents > input.listPriceCents) {
    return { ok: false, reason: 'down_payment_exceeds_list_price' };
  }

  const financedCents = input.listPriceCents - input.downPaymentCents;

  const factorResult = monthlyFactorFor(coefficientTable, financedCents, input.termMonths);
  if (!factorResult.ok) return factorResult;

  const monthlyNetRentCents = Math.round(financedCents * factorResult.factor);
  const buyoutPercent =
    coefficientTable.end_of_term_buyout_percent_of_financed[String(input.termMonths)] ?? 0;
  const buyoutCents = Math.round((financedCents * buyoutPercent) / 100);

  return {
    ok: true,
    netRent: {
      listPriceCents: input.listPriceCents,
      downPaymentCents: input.downPaymentCents,
      financedCents,
      band: factorResult.band.band,
      monthlyFactor: factorResult.factor,
      monthlyNetRentCents,
      buyoutCents,
    },
  };
}

export type PriceQuoteInput = NetRentInput & {
  /** VAT is the rate on this day (`YYYY-MM-DD`); it is not locked before signing. */
  quoteDate: string;
};

export type PriceQuote = NetRent & {
  vatRatePercent: number;
  monthlyRentWithVatCents: number;
  /** CHALLENGE.md Smart Problem #6 ("Explain my price"): the lease's total cost — the down
   *  payment plus every monthly payment, VAT included. Deliberately excludes the end-of-
   *  term buyout, which is a separate, optional choice, not part of what leasing itself
   *  costs; shown as its own line (`buyoutCents`) instead. */
  totalCostWithVatCents: number;
};

export type PriceQuoteResult =
  | { ok: true; quote: PriceQuote }
  | { ok: false; reason: NetRentFailureReason | 'no_vat_rate_on_date' };

/** Quotes the monthly rent for a term and down payment on `listPriceCents`, VAT included. */
export function quoteMonthlyRent(
  coefficientTable: CoefficientTable,
  vatRates: VatRates,
  input: PriceQuoteInput
): PriceQuoteResult {
  const netRentResult = quoteNetRent(coefficientTable, input);
  if (!netRentResult.ok) return netRentResult;

  const vatResult = vatRateOn(vatRates, input.quoteDate);
  if (!vatResult.ok) return vatResult;

  const { netRent } = netRentResult;
  // Round the VAT line once, then add it to net rent, exactly as invoicing.ts does.
  // Multiplying by (1 + rate / 100) can round a half-cent down due to binary precision.
  const vatCents = Math.round((netRent.monthlyNetRentCents * vatResult.ratePercent) / 100);
  const monthlyRentWithVatCents = netRent.monthlyNetRentCents + vatCents;
  const totalCostWithVatCents =
    netRent.downPaymentCents + monthlyRentWithVatCents * input.termMonths;

  return {
    ok: true,
    quote: {
      ...netRent,
      vatRatePercent: vatResult.ratePercent,
      monthlyRentWithVatCents,
      totalCostWithVatCents,
    },
  };
}
