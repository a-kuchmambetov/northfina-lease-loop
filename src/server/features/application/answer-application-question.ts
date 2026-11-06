// Orchestration for answering one application question (CHALLENGE.md Spine #3 / Smart
// Problem #4): records the answer, drops whatever earlier answers no longer apply, and
// either asks the next question or resolves the final eligibility decision once nothing
// is left to ask — or stops right there if the answer just given already rules the
// application out (src/domain/eligibility.ts's `earlyRejectionReason`).
//
// The decision is built entirely from the application's own answers (src/domain/
// eligibility.ts's `applicantFromAnswers`), not from the data pack's customer record —
// see that file's header for why. The customer record is only read here for its `type` as
// the context's starting default (before `q_customer_type` is answered) and to confirm
// `customerId` refers to something real.
import { loadAssets, loadCoefficientTable, loadQuestions } from '@/data/load';
import type { Customer } from '@/data/schemas';
import type { Answer, Answers } from '@/domain/question-flow';
import {
  dropStaleAnswers,
  effectiveCustomerType,
  isQuestionApplicable,
  isValidAnswerFormat,
  nextQuestion,
  type DealContext,
} from '@/domain/question-flow';
import { earlyRejectionReason, type EligibilityResult } from '@/domain/eligibility';
import { withAudit } from '@/server/audit';
import type { PrismaClient } from '@/generated/prisma/client';
import { decideApplication, persistDecision } from './application-decision';
import { visibleQuestions } from './profile-answers';

export type AnswerApplicationQuestionInput = {
  applicationId: string;
  questionId: string;
  answer: Answer;
  /** `YYYY-MM-DD`. Used as the eligibility `min_age` check's reference date, whether that
   *  check runs right now (an early rejection) or only once the whole flow completes. */
  answerDate: string;
};

export type AnswerApplicationQuestionResult =
  | { ok: true; status: 'in_progress'; nextQuestion: ReturnType<typeof nextQuestion> }
  | { ok: true; status: 'decided'; decision: EligibilityResult }
  | {
      ok: false;
      reason:
        'unknown_application' | 'already_decided' | 'unknown_question' | 'question_not_applicable';
    }
  | { ok: false; reason: 'invalid_answer_format'; hint?: string };

export async function answerApplicationQuestion(
  db: PrismaClient,
  input: AnswerApplicationQuestionInput
): Promise<AnswerApplicationQuestionResult> {
  const application = await db.application.findUnique({ where: { id: input.applicationId } });
  if (!application) return { ok: false, reason: 'unknown_application' };
  if (application.decision !== 'pending') return { ok: false, reason: 'already_decided' };

  const [customer, assets, questionsFile, coefficientTable] = await Promise.all([
    db.customer.findUnique({ where: { id: application.customer_id } }),
    loadAssets(),
    loadQuestions(),
    loadCoefficientTable(),
  ]);

  const asset = assets.find((a) => a.id === application.asset_id);
  if (!customer || !asset) return { ok: false, reason: 'unknown_application' };

  const question = questionsFile.questions.find((q) => q.id === input.questionId);
  if (!question) return { ok: false, reason: 'unknown_question' };

  const fallbackCustomerType = customer.type as Customer['type'];
  const currentAnswers: Answers = JSON.parse(application.answers_json);
  // A question the applicant's profile already answered is never asked, so it can't be answered.
  const asked = visibleQuestions(questionsFile.questions, customer, currentAnswers);
  if (!asked.some((q) => q.id === question.id)) {
    return { ok: false, reason: 'question_not_applicable' };
  }
  const contextBefore: DealContext = {
    customerType: effectiveCustomerType(currentAnswers, fallbackCustomerType),
    category: asset.category,
    financedAmountCents: application.financed_amount_cents,
    termMonths: application.term_months,
  };

  if (!isQuestionApplicable(question, contextBefore, currentAnswers)) {
    return { ok: false, reason: 'question_not_applicable' };
  }
  if (!isValidAnswerFormat(question, input.answer)) {
    return { ok: false, reason: 'invalid_answer_format', hint: question.validation?.hint };
  }

  const mergedAnswers: Answers = { ...currentAnswers, [input.questionId]: input.answer };
  const contextAfter: DealContext = {
    ...contextBefore,
    customerType: effectiveCustomerType(mergedAnswers, fallbackCustomerType),
  };
  const answers = dropStaleAnswers(questionsFile.questions, contextAfter, mergedAnswers);

  const earlyReason = earlyRejectionReason(question, input.answer, input.answerDate);
  if (earlyReason) {
    const decision: EligibilityResult = { decision: 'rejected', reason: earlyReason };
    await persistDecision(db, application.id, answers, decision);
    return { ok: true, status: 'decided', decision };
  }

  const next = nextQuestion(questionsFile.questions, contextAfter, answers);
  if (next) {
    await withAudit(
      db,
      {
        actor: 'customer',
        action: 'application.answered',
        entityType: 'application',
        entityId: application.id,
        details: { questionId: input.questionId },
      },
      (tx) =>
        tx.application.update({
          where: { id: application.id },
          data: { answers_json: JSON.stringify(answers) },
        })
    );
    return { ok: true, status: 'in_progress', nextQuestion: next };
  }

  const decision = decideApplication({
    customerType: contextAfter.customerType,
    answers,
    coefficientTable,
    decisionDate: input.answerDate,
    financedAmountCents: application.financed_amount_cents,
    termMonths: application.term_months,
    monthlyRentWithVatCents: application.monthly_rent_with_vat_cents,
  });
  await persistDecision(db, application.id, answers, decision);
  return { ok: true, status: 'decided', decision };
}
