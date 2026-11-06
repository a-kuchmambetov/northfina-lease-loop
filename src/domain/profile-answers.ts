// Which application questions a customer profile already answers. An applicant who has
// filled in their profile (name, birth date, business ID, ...) must not be asked the same
// thing again in the question flow (src/domain/question-flow.ts): the profile's value is
// used as the answer instead. Pure mapping only — the server layer decides whose profile
// counts and stores the result (src/server/features/application/profile-answers.ts).
import type { Question } from '@/data/schemas';
import { isValidAnswerFormat, type Answer, type Answers } from './question-flow';

/**
 * The profile fields that overlap with a question. Deliberately narrower than the full
 * customer shape; both a data-pack `Customer` and a database row mapped to snake_case satisfy
 * it. A field the customer type does not have is `undefined`/`null`.
 */
export type ProfileFacts = {
  type: 'consumer' | 'sole_trader' | 'company';
  name: string;
  country: string;
  email: string;
  birth_date?: string | null;
  employment?: string | null;
  monthly_net_income_cents?: number | null;
  business_id?: string | null;
  vat_registered?: boolean | null;
  annual_revenue_cents?: number | null;
  applicant_can_sign?: boolean | null;
  beneficial_owners?: readonly string[];
};

const SUPPORTED_COUNTRIES = ['FI', 'SE', 'EE'];

const yesNo = (value: boolean | null | undefined): Answer | undefined =>
  value === null || value === undefined ? undefined : value ? 'yes' : 'no';

/**
 * Questions deliberately NOT answered from the profile:
 * - `q_pep`/`q_pep_details`: a self-declaration made for each lease (the profile never
 *   stores it — see customer-input-schema.ts).
 * - `q_signatory_email`: about a different person than the applicant.
 * - `q_usage_purpose`/`q_farm_registry`: about the item being leased, not the customer.
 */
function candidateAnswers(profile: ProfileFacts): Record<string, Answer | null | undefined> {
  const isPerson = profile.type !== 'company';
  return {
    q_customer_type: profile.type,
    q_full_name: isPerson ? profile.name : undefined,
    q_company_name: profile.type === 'company' ? profile.name : undefined,
    q_email: profile.email,
    q_birth_date: profile.birth_date,
    // A country outside FI/SE/EE is a real, answerable "other" — not a missing value.
    q_country: SUPPORTED_COUNTRIES.includes(profile.country) ? profile.country : 'other',
    q_employment: profile.employment,
    q_monthly_income: profile.monthly_net_income_cents,
    q_business_id: profile.business_id,
    q_can_sign: yesNo(profile.applicant_can_sign),
    q_vat_registered: yesNo(profile.vat_registered),
    q_annual_revenue: profile.annual_revenue_cents,
    // An empty list means "not filled in", so the applicant is still asked.
    q_beneficial_owners: profile.beneficial_owners?.length ? profile.beneficial_owners : undefined,
  };
}

/**
 * The answers the profile supplies, keyed by question id. A value that is missing, or not a
 * valid answer to its question (for example a business ID that is not shaped `1234567-8`),
 * is left out so the applicant is simply asked. Whether an answer applies to this deal
 * (`ask_when`) is not decided here; `dropStaleAnswers` takes care of that afterwards.
 */
export function answersFromProfile(profile: ProfileFacts, questions: readonly Question[]): Answers {
  const candidates = candidateAnswers(profile);
  const answers: Answers = {};
  for (const question of questions) {
    const candidate = candidates[question.id];
    if (candidate !== null && candidate !== undefined && isValidAnswerFormat(question, candidate)) {
      answers[question.id] = candidate;
    }
  }
  return answers;
}
