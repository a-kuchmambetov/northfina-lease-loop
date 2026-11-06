// Orchestration for answering one application question (CHALLENGE.md Spine #3 / Smart
// Problem #4): records the answer, drops whatever earlier answers no longer apply
// (src/domain/question-flow.ts), and either asks the next question or resolves the final
// eligibility decision (src/domain/eligibility.ts) once nothing is left to ask.
import { loadAssets, loadCoefficientTable, loadCustomers, loadQuestions } from '@/data/load';
import type { Answer, Answers } from '@/domain/question-flow';
import {
  dropStaleAnswers,
  isQuestionApplicable,
  nextQuestion,
  type DealContext,
} from '@/domain/question-flow';
import { resolveEligibility, type EligibilityResult } from '@/domain/eligibility';
import { withAudit } from '@/server/audit';
import type { PrismaClient } from '@/generated/prisma/client';

export type AnswerApplicationQuestionInput = {
  applicationId: string;
  questionId: string;
  answer: Answer;
  /** `YYYY-MM-DD`, used as the eligibility `min_age` check's reference date if this answer
   *  is the one that completes the application. */
  answerDate: string;
};

export type AnswerApplicationQuestionResult =
  | { ok: true; status: 'in_progress'; nextQuestion: ReturnType<typeof nextQuestion> }
  | { ok: true; status: 'decided'; decision: EligibilityResult }
  | {
      ok: false;
      reason:
        'unknown_application' | 'already_decided' | 'unknown_question' | 'question_not_applicable';
    };

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

  const context: DealContext = {
    customerType: customer.type,
    category: asset.category,
    financedAmountCents: application.financed_amount_cents,
    termMonths: application.term_months,
  };
  const currentAnswers: Answers = JSON.parse(application.answers_json);

  if (!isQuestionApplicable(question, context, currentAnswers)) {
    return { ok: false, reason: 'question_not_applicable' };
  }

  const mergedAnswers: Answers = { ...currentAnswers, [input.questionId]: input.answer };
  const answers = dropStaleAnswers(questionsFile.questions, context, mergedAnswers);
  const next = nextQuestion(questionsFile.questions, context, answers);

  if (next) {
    await withAudit(
      db,
      {
        actor: customer.id,
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
    customer,
    coefficientTable,
    contractStartDate: input.answerDate,
    financedAmountCents: application.financed_amount_cents,
    termMonths: application.term_months,
    monthlyRentWithVatCents: application.monthly_rent_with_vat_cents,
  });

  await withAudit(
    db,
    {
      actor: customer.id,
      action: 'application.decided',
      entityType: 'application',
      entityId: application.id,
      details: decision,
    },
    (tx) =>
      tx.application.update({
        where: { id: application.id },
        data: {
          answers_json: JSON.stringify(answers),
          decision: decision.decision,
          decision_reason: 'reason' in decision ? decision.reason : null,
          decided_at: new Date(),
        },
      })
  );

  return { ok: true, status: 'decided', decision };
}
