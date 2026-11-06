// The application question flow (CHALLENGE.md Spine #3 / Smart Problem #4, "the smart
// question flow"): which question to ask next, from data/questions.json's `ask_when`
// rules, and what happens to an earlier answer once the condition that required it no
// longer holds.
import type { AskWhenCondition, Customer, Question } from '@/data/schemas';
import { BUSINESS_ID_FORMAT } from './business-id';

export type DealContext = {
  customerType: Customer['type'];
  category: string;
  financedAmountCents: number;
  termMonths: number;
};

/** One applicant's answer: `choice`/`text`/`date`/`email` are strings, `money` a number of
 *  cents, `list` an array of strings (`data/schemas.ts`'s `questionTypeSchema`). */
export type Answer = string | number | readonly string[];
export type Answers = Record<string, Answer>;

function fieldValue(
  field: AskWhenCondition['field'],
  context: DealContext,
  answers: Answers
): Answer | undefined {
  if (field === 'customer_type') return context.customerType;
  if (field === 'category') return context.category;
  if (field === 'financed_amount_cents') return context.financedAmountCents;
  if (field === 'term_months') return context.termMonths;
  return answers[field.slice('answers.'.length)];
}

function conditionHolds(
  condition: AskWhenCondition,
  context: DealContext,
  answers: Answers
): boolean {
  const value = fieldValue(condition.field, context, answers);
  if (condition.op === 'in') return typeof value === 'string' && condition.value.includes(value);
  if (condition.op === 'gte') return typeof value === 'number' && value >= condition.value;
  return typeof value === 'number' && value <= condition.value;
}

/** Whether every one of `question`'s `ask_when` conditions holds — an empty list always does. */
export function isQuestionApplicable(
  question: Question,
  context: DealContext,
  answers: Answers
): boolean {
  return question.ask_when.every((condition) => conditionHolds(condition, context, answers));
}

/**
 * The next question to ask: the first one, in `data/questions.json`'s own order, that
 * doesn't have an answer yet and is applicable right now. `undefined` once there is
 * nothing left to ask.
 */
export function nextQuestion(
  questions: readonly Question[],
  context: DealContext,
  answers: Answers
): Question | undefined {
  return questions.find(
    (question) => !(question.id in answers) && isQuestionApplicable(question, context, answers)
  );
}

/**
 * The question to show: the one the applicant went back to, if `requestedId` names a question
 * they have answered and that still applies, otherwise the next unanswered one. Going back
 * can only reach answered questions, so a hand-edited link can't skip ahead in the flow.
 */
export function currentQuestion(
  questions: readonly Question[],
  context: DealContext,
  answers: Answers,
  requestedId?: string
): Question | undefined {
  const requested = questions.find((question) => question.id === requestedId);
  if (requested && requested.id in answers && isQuestionApplicable(requested, context, answers)) {
    return requested;
  }
  return nextQuestion(questions, context, answers);
}

/** The closest answered question before `questionId` in file order: where "back" goes. */
export function previousAnsweredQuestion(
  questions: readonly Question[],
  answers: Answers,
  questionId: string
): Question | undefined {
  const index = questions.findIndex((question) => question.id === questionId);
  return questions.slice(0, Math.max(index, 0)).findLast((question) => question.id in answers);
}

/**
 * How far along the applicant is. `total` counts what applies given the answers so far, so
 * it can move as they answer: `q_can_sign: no` adds `q_signatory_email`, for example.
 */
export function questionProgress(
  questions: readonly Question[],
  context: DealContext,
  answers: Answers
): { answered: number; total: number } {
  const applicable = questions.filter((question) =>
    isQuestionApplicable(question, context, answers)
  );
  return {
    answered: applicable.filter((question) => question.id in answers).length,
    total: applicable.length,
  };
}

/**
 * Drops any answer whose question is no longer applicable — the customer went back and
 * changed an earlier answer, so a later one's premise stopped holding (`data/questions.json`'s
 * own `how_to_use`: "If an earlier answer changes, conditions can flip: decide what happens
 * to answers that no longer apply."). Our decision: it's discarded, not kept around stale,
 * since the question would no longer even be shown to ask it again. Runs to a fixed point,
 * so a chain of dependent questions (e.g. `q_can_sign` → `q_signatory_email`) drops all the
 * way through, not just one level.
 */
export function dropStaleAnswers(
  questions: readonly Question[],
  context: DealContext,
  answers: Answers
): Answers {
  let current = answers;
  let changed = true;

  while (changed) {
    changed = false;
    for (const question of questions) {
      if (question.id in current && !isQuestionApplicable(question, context, current)) {
        const next = { ...current };
        delete next[question.id];
        current = next;
        changed = true;
      }
    }
  }

  return current;
}

const CUSTOMER_TYPES: readonly Customer['type'][] = ['consumer', 'sole_trader', 'company'];

/**
 * The customer type that drives the rest of the flow: the applicant's own answer to
 * `q_customer_type` once they've given one, or `fallback` before that. `q_customer_type`
 * has an empty `ask_when`, so it is always the very first question asked — there is
 * always a defined type by the time anything else is checked, and once it is answered,
 * later `customer_type`-gated questions react to what was actually said, not to anything
 * else (CHALLENGE.md Smart Problem #4: "handles a customer who goes back and changes an
 * answer").
 */
export function effectiveCustomerType(
  answers: Answers,
  fallback: Customer['type']
): Customer['type'] {
  const answer = answers['q_customer_type'];
  return typeof answer === 'string' && CUSTOMER_TYPES.includes(answer as Customer['type'])
    ? (answer as Customer['type'])
    : fallback;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Whether `answer` is even shaped like a valid answer to `question` — a date that looks
 * like a date, a choice that is one of its own listed options, and so on. This is format
 * validation, not a business decision: `data/questions.json`'s `q_business_id` carries its
 * own `validation.format`/`hint` for exactly this — but a business ID that *looks* right
 * with the *wrong* check digit still passes here. Whether it's actually valid is
 * `src/domain/eligibility.ts`'s `business_id` rule to decide, not this one's.
 */
export function isValidAnswerFormat(question: Question, answer: Answer): boolean {
  switch (question.type) {
    case 'choice':
      return typeof answer === 'string' && (question.options ?? []).includes(answer);
    case 'date':
      return typeof answer === 'string' && ISO_DATE.test(answer);
    case 'email':
      return typeof answer === 'string' && EMAIL.test(answer);
    case 'money':
      return typeof answer === 'number' && Number.isInteger(answer) && answer >= 0;
    case 'list':
      return Array.isArray(answer) && answer.every((item) => typeof item === 'string');
    case 'text':
      if (question.validation?.format === 'finnish_business_id') {
        return typeof answer === 'string' && BUSINESS_ID_FORMAT.test(answer);
      }
      return typeof answer === 'string' && answer.trim().length > 0;
  }
}
