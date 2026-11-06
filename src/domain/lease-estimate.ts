import type { CoefficientTable } from '@/data/schemas';
import { monthlyFactorFor } from './coefficient';

export type LeaseEstimate =
  | {
      ok: true;
      financedCents: number;
      monthlyNetCents: number;
      buyoutNetCents: number;
      totalRentNetCents: number;
      factor: number;
    }
  | {
      ok: false;
      reason: 'invalid_down_payment' | 'below_minimum' | 'above_maximum' | 'unknown_term';
    };

/** The term an estimate uses until the customer picks one. */
export const DEFAULT_TERM_MONTHS = 36;

/** Down payments are capped at 40% (rounded down to cents), while keeping the
 * financed amount within the coefficient table whenever possible. */
export function downPaymentRange(table: CoefficientTable, priceCents: number) {
  const minimumFinanced = Math.min(...table.bands.map((band) => band.min_financed_cents));
  const maximumFinanced = Math.max(...table.bands.map((band) => band.max_financed_cents));
  const max = Math.max(
    0,
    Math.min(Math.floor((priceCents * 40) / 100), priceCents - minimumFinanced)
  );
  return { min: Math.min(max, Math.max(0, priceCents - maximumFinanced)), max };
}

/** Estimates are net, with no price lock. Round rent and buyout once to the nearest cent,
 * half up. Total rent is the rounded monthly rent × term, plus the down payment. */
export function estimateLease(
  table: CoefficientTable,
  priceCents: number,
  termMonths = DEFAULT_TERM_MONTHS,
  downPaymentCents = 0
): LeaseEstimate {
  if (!Number.isSafeInteger(priceCents) || !Number.isSafeInteger(downPaymentCents)) {
    throw new RangeError('Amounts must be safe integer cents');
  }
  if (priceCents < 0 || downPaymentCents < 0 || downPaymentCents > priceCents) {
    return { ok: false, reason: 'invalid_down_payment' };
  }
  const financedCents = priceCents - downPaymentCents;
  const result = monthlyFactorFor(table, financedCents, termMonths);
  if (!result.ok) return result;
  const buyoutPercent = table.end_of_term_buyout_percent_of_financed[String(termMonths)];
  if (buyoutPercent === undefined) return { ok: false, reason: 'unknown_term' };
  const monthlyNetCents = Math.round(financedCents * result.factor);
  return {
    ok: true,
    financedCents,
    monthlyNetCents,
    buyoutNetCents: Math.round((financedCents * buyoutPercent) / 100),
    totalRentNetCents: monthlyNetCents * termMonths + downPaymentCents,
    factor: result.factor,
  };
}
