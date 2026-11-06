import { beforeAll, describe, expect, it } from 'vitest';
import { loadCoefficientTable, loadCustomers, loadQuestions } from '@/data/load';
import type { CoefficientTable, Customer, Question } from '@/data/schemas';
import { applicantFromAnswers, earlyRejectionReason, resolveEligibility } from './eligibility';

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

  it('rejects a typed, format-valid business ID answer with a wrong check digit at decision time', () => {
    // The answer-time format check (question-flow.test.ts) accepts 1234567-8; this is the
    // decision-time half: the applicant built from the collected answers is rejected with
    // the clear `business_id` reason, for companies and sole traders alike.
    for (const customerType of ['company', 'sole_trader'] as const) {
      const applicant = applicantFromAnswers(customerType, {
        q_business_id: '1234567-8',
        q_birth_date: '1985-06-01',
        q_country: 'FI',
      });
      expect(
        resolveEligibility({
          customer: applicant,
          coefficientTable,
          contractStartDate: '2026-11-05',
          financedAmountCents: 1_200_000,
          termMonths: 36,
        })
      ).toEqual({ decision: 'rejected', reason: 'business_id' });
    }
    // Same number with the correct check digit passes this rule.
    const fixed = applicantFromAnswers('company', { q_business_id: '1234567-1' });
    expect(
      resolveEligibility({
        customer: fixed,
        coefficientTable,
        contractStartDate: '2026-11-05',
        financedAmountCents: 1_200_000,
        termMonths: 36,
      }).decision
    ).not.toBe('rejected');
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

describe('applicantFromAnswers', () => {
  it('builds a consumer from the typed answers, income included when it was asked', () => {
    expect(
      applicantFromAnswers('consumer', {
        q_birth_date: '1997-04-12',
        q_country: 'FI',
        q_monthly_income: 300_000,
        q_pep: 'no',
      })
    ).toEqual({
      type: 'consumer',
      birth_date: '1997-04-12',
      country: 'FI',
      monthly_net_income_cents: 300_000,
      is_pep: false,
    });
  });

  it('defaults income to 0 and is_pep to false when those questions were never asked', () => {
    expect(
      applicantFromAnswers('consumer', { q_birth_date: '1997-04-12', q_country: 'FI' })
    ).toEqual({
      type: 'consumer',
      birth_date: '1997-04-12',
      country: 'FI',
      monthly_net_income_cents: 0,
      is_pep: false,
    });
  });

  it('builds a company from just business_id and is_pep', () => {
    expect(applicantFromAnswers('company', { q_business_id: '1234567-1', q_pep: 'yes' })).toEqual({
      type: 'company',
      business_id: '1234567-1',
      is_pep: true,
    });
  });

  it('builds a sole trader with both birth_date and business_id', () => {
    expect(
      applicantFromAnswers('sole_trader', {
        q_birth_date: '1985-06-01',
        q_country: 'SE',
        q_business_id: '3012456-5',
      })
    ).toEqual({
      type: 'sole_trader',
      birth_date: '1985-06-01',
      country: 'SE',
      business_id: '3012456-5',
      is_pep: false,
    });
  });
});

describe('earlyRejectionReason', () => {
  let questions: readonly Question[];
  beforeAll(async () => {
    questions = (await loadQuestions()).questions;
  });

  function question(id: string): Question {
    const found = questions.find((q) => q.id === id);
    if (!found) throw new Error(`setup: no question ${id} in the data pack`);
    return found;
  }

  it('flags min_age for an under-18 birth date', () => {
    expect(earlyRejectionReason(question('q_birth_date'), '2009-03-10', '2026-11-05')).toBe(
      'min_age'
    );
  });

  it('does not flag an adult birth date', () => {
    expect(
      earlyRejectionReason(question('q_birth_date'), '1997-04-12', '2026-11-05')
    ).toBeUndefined();
  });

  it('flags residency for a non-FI/SE/EE country answer', () => {
    expect(earlyRejectionReason(question('q_country'), 'other', '2026-11-05')).toBe('residency');
  });

  it('does not flag an allowed country', () => {
    expect(earlyRejectionReason(question('q_country'), 'FI', '2026-11-05')).toBeUndefined();
  });

  it('never flags a question with no blocks_application_when', () => {
    expect(
      earlyRejectionReason(question('q_email'), 'aino@example.com', '2026-11-05')
    ).toBeUndefined();
  });
});
