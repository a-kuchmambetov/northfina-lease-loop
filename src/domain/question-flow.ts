// The application question flow (CHALLENGE.md Spine #3 / Smart Problem #4, "the smart
// question flow"): which question to ask next, from data/questions.json's `ask_when`
// rules, and what happens to an earlier answer once the condition that required it no
// longer holds.
import type { AskWhenCondition, Customer, Question } from '@/data/schemas';

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
