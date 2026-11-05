// Which VAT rate applies on a given day. The rate itself is never locked by a contract,
// only the net rent is: see src/domain/pricing.ts and RULES.md problem 1.
import type { VatRates } from '@/data/schemas';

export type VatRateOnResult =
  { ok: true; ratePercent: number } | { ok: false; reason: 'no_vat_rate_on_date' };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns the general VAT rate (percent) in effect on `isoDate` (`YYYY-MM-DD`).
 * A rate applies from `valid_from` to `valid_to`, both days included; `valid_to: null`
 * means it has no end yet.
 */
export function vatRateOn(vatRates: VatRates, isoDate: string): VatRateOnResult {
  if (!ISO_DATE.test(isoDate)) {
    throw new RangeError(`isoDate must look like YYYY-MM-DD, got "${isoDate}"`);
  }

  const rate = vatRates.rates.find(
    (r) => r.valid_from <= isoDate && (r.valid_to === null || isoDate <= r.valid_to)
  );
  if (!rate) return { ok: false, reason: 'no_vat_rate_on_date' };

  return { ok: true, ratePercent: rate.rate_percent };
}
