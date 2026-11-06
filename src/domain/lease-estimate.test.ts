import { beforeAll, describe, expect, it } from 'vitest';
import { loadCoefficientTable } from '@/data/load';
import type { CoefficientTable } from '@/data/schemas';
import { downPaymentRange, estimateLease } from './lease-estimate';

let table: CoefficientTable;
beforeAll(async () => {
  table = await loadCoefficientTable();
});

describe('downPaymentRange', () => {
  it('caps down payments at 40%, rounded down to cents', () => {
    expect(downPaymentRange(table, 14500001)).toEqual({ min: 0, max: 5800000 });
  });
  it('preserves the minimum financed amount for low prices', () => {
    expect(downPaymentRange(table, 30300)).toEqual({ min: 0, max: 300 });
    expect(downPaymentRange(table, 29999)).toEqual({ min: 0, max: 0 });
  });
  it('starts at the minimum down payment needed for an expensive item', () => {
    expect(downPaymentRange(table, 26000000)).toEqual({ min: 1000000, max: 10400000 });
  });
});

describe('estimateLease', () => {
  it('reproduces the worked example in integer cents and separates the optional buyout', () => {
    expect(estimateLease(table, 389000)).toMatchObject({
      ok: true,
      financedCents: 389000,
      monthlyNetCents: 10730,
      totalRentNetCents: 386280,
      buyoutNetCents: 58350,
      factor: 0.027584,
    });
  });
  it('subtracts the down payment before finding the coefficient band', () => {
    expect(estimateLease(table, 200000, 24, 1)).toMatchObject({
      ok: true,
      financedCents: 199999,
      factor: 0.036637,
    });
    expect(estimateLease(table, 200000, 24, 0)).toMatchObject({
      ok: true,
      financedCents: 200000,
      factor: 0.035532,
    });
  });
  it('includes the down payment exactly once in total rent', () => {
    const result = estimateLease(table, 389000, 48, 20000);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.totalRentNetCents).toBe(result.monthlyNetCents * 48 + 20000);
  });
  it('rounds half a cent up only at the final rent and buyout boundaries', () => {
    const custom = {
      ...table,
      bands: [{ ...table.bands[0]!, monthly_factor_by_term: { '36': 0.000015 } }],
    };
    expect(estimateLease(custom, 100000)).toMatchObject({ ok: true, monthlyNetCents: 2 });
    expect(estimateLease(table, 30010)).toMatchObject({ ok: true, buyoutNetCents: 4502 });
  });
  it.each([-1, 100001])('rejects invalid down payment %i', (down) => {
    expect(estimateLease(table, 100000, 36, down)).toEqual({
      ok: false,
      reason: 'invalid_down_payment',
    });
  });
  it('rejects negative prices and unsafe/fractional cents', () => {
    expect(estimateLease(table, -1)).toEqual({ ok: false, reason: 'invalid_down_payment' });
    for (const value of [1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => estimateLease(table, value)).toThrow(RangeError);
      expect(() => estimateLease(table, 100000, 36, value)).toThrow(RangeError);
    }
  });
  it('handles the minimum, maximum, full down payment and unavailable terms', () => {
    expect(estimateLease(table, 30000)).toMatchObject({ ok: true });
    expect(estimateLease(table, 25000000)).toMatchObject({ ok: true });
    expect(estimateLease(table, 29999)).toEqual({ ok: false, reason: 'below_minimum' });
    expect(estimateLease(table, 25000001)).toEqual({ ok: false, reason: 'above_maximum' });
    expect(estimateLease(table, 100000, 36, 100000)).toEqual({
      ok: false,
      reason: 'below_minimum',
    });
    expect(estimateLease(table, 100000, 18)).toEqual({ ok: false, reason: 'unknown_term' });
    expect(estimateLease({ ...table, end_of_term_buyout_percent_of_financed: {} }, 100000)).toEqual(
      { ok: false, reason: 'unknown_term' }
    );
  });
});
