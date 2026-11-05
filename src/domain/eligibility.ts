// The application's yes/no/manual-review decision (CHALLENGE.md Spine #3): runs the six
// rules data/questions.json's `eligibility_rules` describe, in the order a hard
// disqualification should be checked before a softer "needs a human" one.
import type { CoefficientTable, Customer } from '@/data/schemas';
import { ageInYearsOn } from './calendar';
import { isValidFinnishBusinessId } from './business-id';
import { monthlyFactorFor } from './coefficient';

const RESIDENCY_COUNTRIES = ['FI', 'SE', 'EE'];
/** `data/questions.json`'s `affordability` rule: "at most 30 % of monthly net income". */
const MAX_RENT_PERCENT_OF_INCOME = 30;
const MIN_AGE = 18;

export type EligibilityInput = {
  customer: Customer;
  coefficientTable: CoefficientTable;
  /** `YYYY-MM-DD`, for the `min_age` check — the data pack's own wording is "18 or older
   *  on the contract start date", not today. */
  contractStartDate: string;
  financedAmountCents: number;
  termMonths: number;
  /** Required to check `affordability`; a consumer deal with no quote yet simply skips it. */
  monthlyRentWithVatCents?: number;
};

export type EligibilityReason =
  'financed_limits' | 'min_age' | 'residency' | 'business_id' | 'affordability';

export type EligibilityResult =
  | { decision: 'approved' }
  | { decision: 'manual_review'; reason: 'pep_manual_review' }
  | { decision: 'rejected'; reason: EligibilityReason };

/**
 * Hard rules (financed amount in range, old enough, resident of FI/SE/EE, a real business
 * ID) are checked first and reject outright — there is nothing for a person to review,
 * the data itself doesn't qualify. `pep_manual_review` is checked last, and only reached
 * if nothing else already rejected the deal: a politically exposed person is never
 * auto-approved, but they are not auto-rejected either — a person decides.
 */
export function resolveEligibility(input: EligibilityInput): EligibilityResult {
  const band = monthlyFactorFor(
    input.coefficientTable,
    input.financedAmountCents,
    input.termMonths
  );
  if (!band.ok && (band.reason === 'below_minimum' || band.reason === 'above_maximum')) {
    return { decision: 'rejected', reason: 'financed_limits' };
  }

  if (input.customer.type === 'consumer' || input.customer.type === 'sole_trader') {
    if (ageInYearsOn(input.customer.birth_date, input.contractStartDate) < MIN_AGE) {
      return { decision: 'rejected', reason: 'min_age' };
    }
    if (!RESIDENCY_COUNTRIES.includes(input.customer.country)) {
      return { decision: 'rejected', reason: 'residency' };
    }
  }

  if (input.customer.type === 'sole_trader' || input.customer.type === 'company') {
    if (!isValidFinnishBusinessId(input.customer.business_id)) {
      return { decision: 'rejected', reason: 'business_id' };
    }
  }

  if (input.customer.type === 'consumer' && input.monthlyRentWithVatCents !== undefined) {
    const maxAffordableCents = Math.floor(
      (input.customer.monthly_net_income_cents * MAX_RENT_PERCENT_OF_INCOME) / 100
    );
    if (input.monthlyRentWithVatCents > maxAffordableCents) {
      return { decision: 'rejected', reason: 'affordability' };
    }
  }

  if (input.customer.is_pep) {
    return { decision: 'manual_review', reason: 'pep_manual_review' };
  }

  return { decision: 'approved' };
}
