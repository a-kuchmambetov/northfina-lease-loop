import { beforeAll, describe, expect, it } from 'vitest';
import { loadCoefficientTable } from '@/data/load';
import type { CoefficientTable } from '@/data/schemas';
import { lockContract } from './contract';

let coefficientTable: CoefficientTable;
beforeAll(async () => {
  coefficientTable = await loadCoefficientTable();
});

describe('lockContract', () => {
  it('locks the net rent and buyout from the worked example in data/DATA.md', () => {
    const result = lockContract(coefficientTable, {
      assetId: 'ebike-003',
      customerId: 'cust-aino',
      startDate: '2026-11-05',
      termMonths: 36,
      downPaymentCents: 0,
      listPriceCents: 389_000,
      priceListVersion: 1,
    });

    expect(result).toEqual({
      ok: true,
      contract: {
        assetId: 'ebike-003',
        customerId: 'cust-aino',
        startDate: '2026-11-05',
        termMonths: 36,
        priceListVersion: 1,
        listPriceCents: 389_000,
        downPaymentCents: 0,
        financedCents: 389_000,
        monthlyNetRentCents: 10_730,
        buyoutCents: 58_350,
      },
    });
  });

  it('carries the price-list version it was given, not the latest one', () => {
    const result = lockContract(coefficientTable, {
      assetId: 'laptop-004',
      customerId: 'cust-aino',
      startDate: '2026-11-06',
      termMonths: 24,
      downPaymentCents: 0,
      listPriceCents: 199_900,
      priceListVersion: 2,
    });
    expect(result).toMatchObject({ ok: true, contract: { priceListVersion: 2 } });
  });

  it('passes through a net-rent failure, e.g. a term outside the coefficient table', () => {
    const result = lockContract(coefficientTable, {
      assetId: 'ebike-003',
      customerId: 'cust-aino',
      startDate: '2026-11-05',
      termMonths: 18,
      downPaymentCents: 0,
      listPriceCents: 389_000,
      priceListVersion: 1,
    });
    expect(result).toEqual({ ok: false, reason: 'unknown_term' });
  });

  it('rejects a malformed start date', () => {
    expect(() =>
      lockContract(coefficientTable, {
        assetId: 'ebike-003',
        customerId: 'cust-aino',
        startDate: '05-11-2026',
        termMonths: 36,
        downPaymentCents: 0,
        listPriceCents: 389_000,
        priceListVersion: 1,
      })
    ).toThrow(RangeError);
  });
});
