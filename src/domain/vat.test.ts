import { beforeAll, describe, expect, it } from 'vitest';
import { loadVatRates } from '@/data/load';
import type { VatRates } from '@/data/schemas';
import { vatRateOn } from './vat';

// Tests run against the real data pack, so they also catch a changed data file.
let vatRates: VatRates;
beforeAll(async () => {
  vatRates = await loadVatRates();
});

describe('vatRateOn', () => {
  it('is 25.5 % on the last day before the fictional 2027 change', () => {
    expect(vatRateOn(vatRates, '2026-12-31')).toEqual({ ok: true, ratePercent: 25.5 });
  });

  it('is 26 % from 1 Jan 2027', () => {
    expect(vatRateOn(vatRates, '2027-01-01')).toEqual({ ok: true, ratePercent: 26.0 });
  });

  it('was 24 % before 1 Sep 2024', () => {
    expect(vatRateOn(vatRates, '2024-08-31')).toEqual({ ok: true, ratePercent: 24.0 });
  });

  it('has no rate before the data pack starts', () => {
    expect(vatRateOn(vatRates, '2000-01-01')).toEqual({ ok: false, reason: 'no_vat_rate_on_date' });
  });

  it('works without any vat rates', () => {
    expect(vatRateOn({ ...vatRates, rates: [] }, '2026-11-05')).toEqual({
      ok: false,
      reason: 'no_vat_rate_on_date',
    });
  });

  it('throws on a date that is not YYYY-MM-DD, because that is a bug in the caller', () => {
    expect(() => vatRateOn(vatRates, '5.11.2026')).toThrow(RangeError);
  });
});
