import { beforeAll, describe, expect, it } from 'vitest';
import { loadQuestions } from '@/data/load';
import type { Question, QuestionsFile } from '@/data/schemas';
import {
  dropStaleAnswers,
  isQuestionApplicable,
  nextQuestion,
  type DealContext,
} from './question-flow';

let questions: readonly Question[];
beforeAll(async () => {
  const file: QuestionsFile = await loadQuestions();
  questions = file.questions;
});

const consumerContext: DealContext = {
  customerType: 'consumer',
  category: 'e_bike',
  financedAmountCents: 389_000,
  termMonths: 36,
};

describe('isQuestionApplicable', () => {
  it('always applies a question with an empty ask_when', () => {
    const q = questions.find((q) => q.id === 'q_customer_type')!;
    expect(isQuestionApplicable(q, consumerContext, {})).toBe(true);
  });

  it('only applies company-only questions to a company', () => {
    const q = questions.find((q) => q.id === 'q_company_name')!;
    expect(isQuestionApplicable(q, consumerContext, {})).toBe(false);
    expect(isQuestionApplicable(q, { ...consumerContext, customerType: 'company' }, {})).toBe(true);
  });

  it('chains on an earlier answer via answers.<id>', () => {
    const q = questions.find((q) => q.id === 'q_signatory_email')!;
    const companyContext: DealContext = { ...consumerContext, customerType: 'company' };
    expect(isQuestionApplicable(q, companyContext, { q_can_sign: 'yes' })).toBe(false);
    expect(isQuestionApplicable(q, companyContext, { q_can_sign: 'no' })).toBe(true);
  });

  it('respects a gte threshold on financed_amount_cents', () => {
    const q = questions.find((q) => q.id === 'q_monthly_income')!;
    expect(isQuestionApplicable(q, { ...consumerContext, financedAmountCents: 100_000 }, {})).toBe(
      false
    );
    expect(isQuestionApplicable(q, { ...consumerContext, financedAmountCents: 200_000 }, {})).toBe(
      true
    );
  });
});

describe('nextQuestion', () => {
  it('asks customer type first, with no answers yet', () => {
    expect(nextQuestion(questions, consumerContext, {})?.id).toBe('q_customer_type');
  });

  it('skips already-answered questions', () => {
    const result = nextQuestion(questions, consumerContext, { q_customer_type: 'consumer' });
    expect(result?.id).not.toBe('q_customer_type');
  });

  it('returns undefined once every applicable question is answered', () => {
    // A minimal consumer deal below every amount threshold: only the always-asked and
    // customer-type-gated questions apply.
    const smallContext: DealContext = { ...consumerContext, financedAmountCents: 50_000 };
    const answers = {
      q_customer_type: 'consumer',
      q_full_name: 'Aino Virtanen',
      q_birth_date: '1997-04-12',
      q_email: 'aino@example.com',
      q_country: 'FI',
      q_employment: 'employed',
      q_usage_purpose: 'commuting',
    };
    expect(nextQuestion(questions, smallContext, answers)).toBeUndefined();
  });
});

describe('dropStaleAnswers', () => {
  it('drops a company-only answer once the customer type changes away from company', () => {
    const answers = { q_customer_type: 'company', q_company_name: 'Kettu Koodi Oy' };
    const result = dropStaleAnswers(
      questions,
      { ...consumerContext, customerType: 'consumer' },
      answers
    );
    expect(result).toEqual({ q_customer_type: 'company' });
  });

  it('cascades through a chain: q_can_sign -> q_signatory_email', () => {
    const companyContext: DealContext = { ...consumerContext, customerType: 'company' };
    const answers = {
      q_can_sign: 'no',
      q_signatory_email: 'someone@example.com',
    };
    // q_can_sign flips to 'yes': q_signatory_email's condition (answers.q_can_sign in [no]) no longer holds.
    const result = dropStaleAnswers(questions, companyContext, { ...answers, q_can_sign: 'yes' });
    expect(result).toEqual({ q_can_sign: 'yes' });
  });

  it('keeps answers that are still applicable', () => {
    const answers = { q_customer_type: 'consumer', q_full_name: 'Aino' };
    expect(dropStaleAnswers(questions, consumerContext, answers)).toEqual(answers);
  });
});
