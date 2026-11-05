// The catalogue price step: a chosen term and down payment become a monthly rent.
// monthly net rent = financed amount x coefficient factor (see coefficient.ts); VAT and the
// end-of-term buyout are added on top. Nothing here is locked yet: that happens when a
// contract is signed (see RULES.md problem 1 — a contract locks the net rent, not the VAT).
import type { CoefficientTable, VatRates } from '@/data/schemas';
import { monthlyFactorFor } from './coefficient';
import { vatRateOn } from './vat';

export type PriceQuoteInput = {
  listPriceCents: number;
  downPaymentCents: number;
  termMonths: number;
  /** VAT is the rate on this day (`YYYY-MM-DD`); it is not locked before signing. */
  quoteDate: string;
};

export type PriceQuote = {
  listPriceCents: number;
  downPaymentCents: number;
  financedCents: number;
  band: string;
  monthlyFactor: number;
  monthlyNetRentCents: number;
  vatRatePercent: number;
  monthlyRentWithVatCents: number;
  buyoutCents: number;
};

export type PriceQuoteResult =
  | { ok: true; quote: PriceQuote }
  | {
      ok: false;
      reason:
        | 'down_payment_negative'
        | 'down_payment_exceeds_list_price'
        | 'below_minimum'
        | 'above_maximum'
        | 'unknown_term'
        | 'no_vat_rate_on_date';
    };

/**
 * Quotes the monthly rent for a term and down payment on `listPriceCents`.
 *
 * Rounding: every money line (net rent, rent with VAT, buyout) is rounded to the nearest
 * cent on its own, half a cent rounding up — the same rule the worked example in
 * data/DATA.md uses. Rounding each line separately, not the total, is the deliberate choice.
 */
export function quoteMonthlyRent(
  coefficientTable: CoefficientTable,
  vatRates: VatRates,
  input: PriceQuoteInput
): PriceQuoteResult {
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

  const vatResult = vatRateOn(vatRates, input.quoteDate);
  if (!vatResult.ok) return vatResult;

  const monthlyNetRentCents = Math.round(financedCents * factorResult.factor);
  const monthlyRentWithVatCents = Math.round(
    monthlyNetRentCents * (1 + vatResult.ratePercent / 100)
  );
  const buyoutPercent =
    coefficientTable.end_of_term_buyout_percent_of_financed[String(input.termMonths)] ?? 0;
  const buyoutCents = Math.round((financedCents * buyoutPercent) / 100);

  return {
    ok: true,
    quote: {
      listPriceCents: input.listPriceCents,
      downPaymentCents: input.downPaymentCents,
      financedCents,
      band: factorResult.band.band,
      monthlyFactor: factorResult.factor,
      monthlyNetRentCents,
      vatRatePercent: vatResult.ratePercent,
      monthlyRentWithVatCents,
      buyoutCents,
    },
  };
}
