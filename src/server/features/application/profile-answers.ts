// Which of an application's questions its applicant's profile already answers. Only a
// profile a signed-up account created (`user_id` set) counts: the 10 data-pack personas have
// no account, they are demo applicants a tester types answers for. No business rules live
// here — the mapping itself is src/domain/profile-answers.ts.
import type { Question } from '@/data/schemas';
import { answersFromProfile } from '@/domain/profile-answers';
import type { Answers } from '@/domain/question-flow';
import type { Customer } from '@/generated/prisma/client';

function parseOwners(json: string | null): string[] {
  if (!json) return [];
  try {
    const owners: unknown = JSON.parse(json);
    return Array.isArray(owners) ? owners.filter((o): o is string => typeof o === 'string') : [];
  } catch {
    return [];
  }
}

/** The answers the customer's profile supplies, or none if it is not an account's profile. */
export function profileAnswersFor(
  customer: Customer | null,
  questions: readonly Question[]
): Answers {
  if (!customer?.user_id) return {};
  return answersFromProfile(
    {
      type: customer.type as 'consumer' | 'sole_trader' | 'company',
      name: customer.name,
      country: customer.country,
      email: customer.email,
      birth_date: customer.birth_date,
      employment: customer.employment,
      monthly_net_income_cents: customer.monthly_net_income_cents,
      business_id: customer.business_id,
      vat_registered: customer.vat_registered,
      annual_revenue_cents: customer.annual_revenue_cents,
      applicant_can_sign: customer.applicant_can_sign,
      beneficial_owners: parseOwners(customer.beneficial_owners_json),
    },
    questions
  );
}

/**
 * The questions the applicant actually sees: those their profile did not already answer.
 * The profile's answers stay in the application's `answers`, so `ask_when` rules that read
 * them (`answers.q_can_sign`, ...) still work — the questions are only hidden, not unanswered.
 */
export function visibleQuestions(
  questions: readonly Question[],
  customer: Customer | null,
  answers: Answers
): Question[] {
  const fromProfile = profileAnswersFor(customer, questions);
  return questions.filter((question) => !(question.id in fromProfile && question.id in answers));
}
