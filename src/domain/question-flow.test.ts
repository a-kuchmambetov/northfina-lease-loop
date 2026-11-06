import { beforeAll, describe, expect, it } from 'vitest';
import { loadQuestions } from '@/data/load';
import type { Question, QuestionsFile } from '@/data/schemas';
import {
  currentQuestion,
  dropStaleAnswers,
  effectiveCustomerType,
  isQuestionApplicable,
  isValidAnswerFormat,
  nextQuestion,
  previousAnsweredQuestion,
  questionProgress,
  type DealContext,
} from './question-flow';

let questions: readonly Question[];
beforeAll(async () => {
  const file: QuestionsFile = await loadQuestions();
  questions = file.questions;
});

function question(id: string): Question {
  const found = questions.find((q) => q.id === id);
  if (!found) throw new Error(`setup: no question ${id} in the data pack`);
  return found;
}

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

describe('effectiveCustomerType', () => {
  it('falls back when q_customer_type has not been answered yet', () => {
    expect(effectiveCustomerType({}, 'consumer')).toBe('consumer');
  });

  it("uses the applicant's own answer once given, even if it contradicts the fallback", () => {
    expect(effectiveCustomerType({ q_customer_type: 'company' }, 'consumer')).toBe('company');
  });

  it('falls back on a nonsense answer instead of accepting it', () => {
    expect(effectiveCustomerType({ q_customer_type: 'not-a-type' }, 'consumer')).toBe('consumer');
  });
});

describe('isValidAnswerFormat', () => {
  it('accepts a choice that is one of its own options', () => {
    expect(isValidAnswerFormat(question('q_customer_type'), 'company')).toBe(true);
  });

  it('rejects a choice that is not one of its own options', () => {
    expect(isValidAnswerFormat(question('q_customer_type'), 'not-a-type')).toBe(false);
  });

  it('accepts a real-looking ISO date and rejects a malformed one', () => {
    expect(isValidAnswerFormat(question('q_birth_date'), '1997-04-12')).toBe(true);
    expect(isValidAnswerFormat(question('q_birth_date'), '12/04/1997')).toBe(false);
  });

  it('accepts a real-looking email and rejects a plain string', () => {
    expect(isValidAnswerFormat(question('q_email'), 'aino@example.com')).toBe(true);
    expect(isValidAnswerFormat(question('q_email'), 'not an email')).toBe(false);
  });

  it('accepts a nonnegative integer for money and rejects a float or a negative', () => {
    expect(isValidAnswerFormat(question('q_monthly_income'), 250_000)).toBe(true);
    expect(isValidAnswerFormat(question('q_monthly_income'), 250_000.5)).toBe(false);
    expect(isValidAnswerFormat(question('q_monthly_income'), -1)).toBe(false);
  });

  it('accepts an array of strings for a list question', () => {
    expect(isValidAnswerFormat(question('q_beneficial_owners'), ['Owner A'])).toBe(true);
    expect(isValidAnswerFormat(question('q_beneficial_owners'), 'Owner A')).toBe(false);
  });

  it('accepts a nonempty string for a plain text question', () => {
    expect(isValidAnswerFormat(question('q_company_name'), 'Kettu Koodi Oy')).toBe(true);
    expect(isValidAnswerFormat(question('q_company_name'), '')).toBe(false);
  });

  it('accepts a business ID shaped like one, even with the wrong check digit', () => {
    // 1234567-8 is data/DATA.md's deliberately wrong-check-digit trap: it IS shaped like a
    // real business ID, so format validation passes it through — resolveEligibility's own
    // `business_id` rule is what actually catches the wrong check digit.
    expect(isValidAnswerFormat(question('q_business_id'), '1234567-8')).toBe(true);
    expect(isValidAnswerFormat(question('q_business_id'), 'not-a-business-id')).toBe(false);
  });
});

describe('currentQuestion', () => {
  const answers = { q_customer_type: 'consumer', q_full_name: 'Aino Virtanen' };

  it('is the next unanswered question when nothing is requested', () => {
    expect(currentQuestion(questions, consumerContext, answers)?.id).toBe('q_birth_date');
  });

  it('reopens an answered question', () => {
    expect(currentQuestion(questions, consumerContext, answers, 'q_full_name')?.id).toBe(
      'q_full_name'
    );
  });

  it('does not let a link skip ahead to an unanswered question', () => {
    expect(currentQuestion(questions, consumerContext, answers, 'q_pep')?.id).toBe('q_birth_date');
  });

  it('ignores an id that is not a question', () => {
    expect(currentQuestion(questions, consumerContext, answers, 'nope')?.id).toBe('q_birth_date');
  });

  it('does not reopen an answer that no longer applies', () => {
    const stale = { ...answers, q_business_id: '1234567-8' };
    expect(currentQuestion(questions, consumerContext, stale, 'q_business_id')?.id).toBe(
      'q_birth_date'
    );
  });
});

describe('previousAnsweredQuestion', () => {
  it('is undefined at the first question', () => {
    expect(previousAnsweredQuestion(questions, {}, 'q_customer_type')).toBeUndefined();
  });

  it('skips questions that were never asked', () => {
    const answers = { q_customer_type: 'consumer', q_email: 'a@example.com' };
    expect(previousAnsweredQuestion(questions, answers, 'q_country')?.id).toBe('q_email');
    expect(previousAnsweredQuestion(questions, answers, 'q_email')?.id).toBe('q_customer_type');
  });

  it('is undefined for an unknown question', () => {
    expect(
      previousAnsweredQuestion(questions, { q_customer_type: 'consumer' }, 'nope')
    ).toBeUndefined();
  });
});

describe('questionProgress', () => {
  it('counts only what applies to this deal', () => {
    const { answered, total } = questionProgress(questions, consumerContext, {});
    expect(answered).toBe(0);
    expect(total).toBeLessThan(questions.length);
  });

  it('counts an answer once it is given', () => {
    const answers = { q_customer_type: 'consumer' };
    expect(questionProgress(questions, consumerContext, answers).answered).toBe(1);
  });

  it('grows when an answer opens a follow-up question', () => {
    const companyContext: DealContext = { ...consumerContext, customerType: 'company' };
    const before = questionProgress(questions, companyContext, {});
    const after = questionProgress(questions, companyContext, { q_can_sign: 'no' });
    expect(after.total).toBe(before.total + 1);
  });
});
