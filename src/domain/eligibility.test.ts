import { beforeAll, describe, expect, it } from 'vitest';
import { loadCoefficientTable, loadCustomers } from '@/data/load';
import type { CoefficientTable, Customer } from '@/data/schemas';
import { resolveEligibility } from './eligibility';

let coefficientTable: CoefficientTable;
let customers: readonly Customer[];
beforeAll(async () => {
  coefficientTable = await loadCoefficientTable();
  customers = await loadCustomers();
});

function customer(id: string): Customer {
  const found = customers.find((c) => c.id === id);
  if (!found) throw new Error(`setup: no customer ${id} in the data pack`);
  return found;
}

describe('resolveEligibility', () => {
  it('approves the happy path (cust-aino)', () => {
    const result = resolveEligibility({
      customer: customer('cust-aino'),
      coefficientTable,
      contractStartDate: '2026-11-05',
      financedAmountCents: 389_000,
      termMonths: 36,
    });
    expect(result).toEqual({ decision: 'approved' });
  });

  it('rejects an under-18 applicant (cust-mikko, 17)', () => {
    const result = resolveEligibility({
      customer: customer('cust-mikko'),
      coefficientTable,
      contractStartDate: '2026-11-05',
      financedAmountCents: 289_000,
      termMonths: 24,
    });
    expect(result).toEqual({ decision: 'rejected', reason: 'min_age' });
  });

  it('approves a resident of Estonia (cust-lena)', () => {
    const result = resolveEligibility({
      customer: customer('cust-lena'),
      coefficientTable,
      contractStartDate: '2026-11-05',
      financedAmountCents: 189_900,
      termMonths: 24,
    });
    expect(result).toEqual({ decision: 'approved' });
  });

  it('rejects a non-FI/SE/EE resident', () => {
    const germanConsumer: Customer = { ...customer('cust-aino'), country: 'DE' };
    const result = resolveEligibility({
      customer: germanConsumer,
      coefficientTable,
      contractStartDate: '2026-11-05',
      financedAmountCents: 189_900,
      termMonths: 24,
    });
    expect(result).toEqual({ decision: 'rejected', reason: 'residency' });
  });

  it('rejects the deliberately broken business ID (cust-broken-id)', () => {
    const result = resolveEligibility({
      customer: customer('cust-broken-id'),
      coefficientTable,
      contractStartDate: '2026-11-05',
      financedAmountCents: 1_200_000,
      termMonths: 36,
    });
    expect(result).toEqual({ decision: 'rejected', reason: 'business_id' });
  });

  it('approves a sole trader with a valid business ID (cust-pekka)', () => {
    const result = resolveEligibility({
      customer: customer('cust-pekka'),
      coefficientTable,
      contractStartDate: '2026-11-05',
      financedAmountCents: 289_000,
      termMonths: 24,
    });
    expect(result).toEqual({ decision: 'approved' });
  });

  it('sends a politically exposed person to manual review, not auto-reject (cust-haapala)', () => {
    const result = resolveEligibility({
      customer: customer('cust-haapala'),
      coefficientTable,
      contractStartDate: '2026-11-05',
      financedAmountCents: 12_500_000, // 145000 EUR - 20000 EUR down payment
      termMonths: 48,
    });
    expect(result).toEqual({ decision: 'manual_review', reason: 'pep_manual_review' });
  });

  it('can afford it after all (cust-sanna, the question her own story asks)', () => {
    // 5490 EUR cargo e-bike, 36 months, no down payment: monthly rent incl. VAT is 19006
    // cents; 30% of her 90000-cent income is 27000 — well within budget.
    const result = resolveEligibility({
      customer: customer('cust-sanna'),
      coefficientTable,
      contractStartDate: '2026-11-05',
      financedAmountCents: 549_000,
      termMonths: 36,
      monthlyRentWithVatCents: 19_006,
    });
    expect(result).toEqual({ decision: 'approved' });
  });

  it('rejects a consumer whose rent would exceed 30% of income', () => {
    const result = resolveEligibility({
      customer: customer('cust-sanna'),
      coefficientTable,
      contractStartDate: '2026-11-05',
      financedAmountCents: 549_000,
      termMonths: 36,
      monthlyRentWithVatCents: 30_000, // > 30% of 90000
    });
    expect(result).toEqual({ decision: 'rejected', reason: 'affordability' });
  });

  it('skips the affordability check when no quote is given yet', () => {
    const result = resolveEligibility({
      customer: customer('cust-sanna'),
      coefficientTable,
      contractStartDate: '2026-11-05',
      financedAmountCents: 50_000,
      termMonths: 12,
    });
    expect(result).toEqual({ decision: 'approved' });
  });

  it('rejects a financed amount below the coefficient table minimum', () => {
    const result = resolveEligibility({
      customer: customer('cust-aino'),
      coefficientTable,
      contractStartDate: '2026-11-05',
      financedAmountCents: 10_000,
      termMonths: 36,
    });
    expect(result).toEqual({ decision: 'rejected', reason: 'financed_limits' });
  });

  it('rejects a financed amount above the coefficient table maximum', () => {
    const result = resolveEligibility({
      customer: customer('cust-kettukoodi'),
      coefficientTable,
      contractStartDate: '2026-11-05',
      financedAmountCents: 30_000_000,
      termMonths: 36,
    });
    expect(result).toEqual({ decision: 'rejected', reason: 'financed_limits' });
  });

  it('approves a company with no PEP and a valid business ID (cust-kettukoodi)', () => {
    const result = resolveEligibility({
      customer: customer('cust-kettukoodi'),
      coefficientTable,
      contractStartDate: '2026-11-05',
      financedAmountCents: 1_200_000,
      termMonths: 36,
    });
    expect(result).toEqual({ decision: 'approved' });
  });
});
