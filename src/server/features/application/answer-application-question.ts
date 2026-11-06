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
import { loadAssets, loadCoefficientTable, loadCustomers, loadQuestions } from '@/data/load';
import type { Answer, Answers } from '@/domain/question-flow';
import {
  dropStaleAnswers,
  effectiveCustomerType,
  isQuestionApplicable,
  isValidAnswerFormat,
  nextQuestion,
  type DealContext,
} from '@/domain/question-flow';
import {
  applicantFromAnswers,
  earlyRejectionReason,
  resolveEligibility,
  type EligibilityResult,
} from '@/domain/eligibility';
import { withAudit } from '@/server/audit';
import type { PrismaClient } from '@/generated/prisma/client';

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

  const [customers, assets, questionsFile, coefficientTable] = await Promise.all([
    loadCustomers(),
    loadAssets(),
    loadQuestions(),
    loadCoefficientTable(),
  ]);

  const customer = customers.find((c) => c.id === application.customer_id);
  const asset = assets.find((a) => a.id === application.asset_id);
  if (!customer || !asset) return { ok: false, reason: 'unknown_application' };

  const question = questionsFile.questions.find((q) => q.id === input.questionId);
  if (!question) return { ok: false, reason: 'unknown_question' };

  const currentAnswers: Answers = JSON.parse(application.answers_json);
  const contextBefore: DealContext = {
    customerType: effectiveCustomerType(currentAnswers, customer.type),
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
    customerType: effectiveCustomerType(mergedAnswers, customer.type),
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

  const decision = resolveEligibility({
    customer: applicantFromAnswers(contextAfter.customerType, answers),
    coefficientTable,
    contractStartDate: input.answerDate,
    financedAmountCents: application.financed_amount_cents,
    termMonths: application.term_months,
    monthlyRentWithVatCents:
      'q_monthly_income' in answers ? application.monthly_rent_with_vat_cents : undefined,
  });
  await persistDecision(db, application.id, answers, decision);
  return { ok: true, status: 'decided', decision };
}

async function persistDecision(
  db: PrismaClient,
  applicationId: string,
  answers: Answers,
  decision: EligibilityResult
): Promise<void> {
  await withAudit(
    db,
    {
      actor: 'customer',
      action: 'application.decided',
      entityType: 'application',
      entityId: applicationId,
      details: decision,
    },
    (tx) =>
      tx.application.update({
        where: { id: applicationId },
        data: {
          answers_json: JSON.stringify(answers),
          decision: decision.decision,
          decision_reason: 'reason' in decision ? decision.reason : null,
          decided_at: new Date(),
        },
      })
  );
}
