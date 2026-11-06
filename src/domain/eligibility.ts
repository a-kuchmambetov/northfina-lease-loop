// The application's yes/no/manual-review decision (CHALLENGE.md Spine #3): runs the six
// rules data/questions.json's `eligibility_rules` describe, in the order a hard
// disqualification should be checked before a softer "needs a human" one.
//
// Every field this reads — birth date, country, business ID, income, PEP status — comes
// from the application's OWN answers, not from a pre-existing customer record: each
// question's own `why_we_ask` in data/questions.json says exactly which rule it feeds
// ("You must be 18 or older to sign a lease", "Required by AML law for leases of 10,000
// EUR or more", ...), and `data/customers.json`'s personas exist to give a demo operator
// something true to type into the form, not to be read directly by this function.
import type { CoefficientTable, Customer, Question } from '@/data/schemas';
import { ageInYearsOn } from './calendar';
import { isValidFinnishBusinessId } from './business-id';
import { monthlyFactorFor } from './coefficient';
import type { Answer, Answers } from './question-flow';

const RESIDENCY_COUNTRIES = ['FI', 'SE', 'EE'];
/** `data/questions.json`'s `affordability` rule: "at most 30 % of monthly net income". */
const MAX_RENT_PERCENT_OF_INCOME = 30;
const MIN_AGE = 18;

/**
 * The subset of a customer's declared data this function actually needs — deliberately
 * narrower than the full `Customer` shape in `@/data/schemas` (which also carries fields
 * like `city` or `story` that no question even asks for, and that have nothing to do with
 * the decision). A full `Customer` object still satisfies this type structurally, which is
 * why this file's own tests can pass real `data/customers.json` personas straight in.
 */
export type EligibilityApplicant =
  | {
      type: 'consumer';
      birth_date: string;
      country: string;
      monthly_net_income_cents: number;
      is_pep: boolean;
    }
  | {
      type: 'sole_trader';
      birth_date: string;
      country: string;
      business_id: string;
      is_pep: boolean;
    }
  | { type: 'company'; business_id: string; is_pep: boolean };

export type EligibilityInput = {
  customer: EligibilityApplicant;
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

function stringAnswer(value: Answer | undefined): string {
  return typeof value === 'string' ? value : '';
}

function numberAnswer(value: Answer | undefined): number {
  return typeof value === 'number' ? value : 0;
}

/**
 * Builds the applicant `resolveEligibility` needs from the application's own collected
 * answers. A field that was never asked (for example `q_monthly_income` below the
 * 200000-cent threshold, or `q_pep` below the 1,000,000-cent one) comes back as an empty
 * string / 0 / `false` here — harmless, since `resolveEligibility` only reads
 * `monthly_net_income_cents` when its caller also passes a `monthlyRentWithVatCents`, which
 * the caller should likewise only do once `q_monthly_income` was actually answered.
 */
export function applicantFromAnswers(
  customerType: Customer['type'],
  answers: Answers
): EligibilityApplicant {
  const isPep = answers['q_pep'] === 'yes';

  if (customerType === 'company') {
    return { type: 'company', business_id: stringAnswer(answers['q_business_id']), is_pep: isPep };
  }
  if (customerType === 'sole_trader') {
    return {
      type: 'sole_trader',
      birth_date: stringAnswer(answers['q_birth_date']),
      country: stringAnswer(answers['q_country']),
      business_id: stringAnswer(answers['q_business_id']),
      is_pep: isPep,
    };
  }
  return {
    type: 'consumer',
    birth_date: stringAnswer(answers['q_birth_date']),
    country: stringAnswer(answers['q_country']),
    monthly_net_income_cents: numberAnswer(answers['q_monthly_income']),
    is_pep: isPep,
  };
}

/** Which rule a question's own `blocks_application_when` (`@/data/schemas`) maps to — both
 *  of the rule types in `data/questions.json` happen to appear on exactly one question
 *  each, so this is a direct, honest 1:1 table rather than a generic inference. */
const EARLY_REJECTION_REASON: Record<string, EligibilityReason> = {
  q_birth_date: 'min_age',
  q_country: 'residency',
};

/**
 * Whether `answer` to `question` already rules the application out on its own, per
 * `data/questions.json`'s `blocks_application_when` — so the interview can stop right
 * there instead of asking everything else first. This is CHALLENGE.md scenario card 5's
 * "Be kind and clear": Mikko (17) finds out he can't lease right after his birth date,
 * not after filling in his e-mail, country, employment and income too.
 */
export function earlyRejectionReason(
  question: Question,
  answer: Answer,
  contractStartDate: string
): EligibilityReason | undefined {
  if (!question.blocks_application_when || typeof answer !== 'string') return undefined;

  const triggered = question.blocks_application_when.some((rule) =>
    rule.rule === 'age_under'
      ? ageInYearsOn(answer, contractStartDate) < rule.value
      : rule.value.includes(answer)
  );
  return triggered ? EARLY_REJECTION_REASON[question.id] : undefined;
}
