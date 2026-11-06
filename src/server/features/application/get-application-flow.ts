// Orchestration for the application question page: the application, its asset, and the
// question to show now, worked out by src/domain/question-flow.ts. No business rules live here.
import { loadAssets, loadCustomers, loadQuestions } from '@/data/load';
import type { Asset, Customer, Question } from '@/data/schemas';
import {
  currentQuestion,
  effectiveCustomerType,
  previousAnsweredQuestion,
  questionProgress,
  type DealContext,
} from '@/domain/question-flow';
import type { PrismaClient } from '@/generated/prisma/client';
import { getApplication, type ApplicationView } from './get-application';
import { visibleQuestions } from './profile-answers';

export type ApplicationFlow = {
  application: ApplicationView;
  asset: Pick<Asset, 'make' | 'model' | 'category'>;
  /** `null` once the application has a decision. */
  question: Question | null;
  previousQuestionId: string | null;
  progress: { answered: number; total: number };
};

export type GetApplicationFlowResult =
  { ok: true; flow: ApplicationFlow } | { ok: false; reason: 'unknown_application' };

export async function getApplicationFlow(
  db: PrismaClient,
  applicationId: string,
  requestedQuestionId?: string
): Promise<GetApplicationFlowResult> {
  const result = await getApplication(db, applicationId);
  if (!result.ok) return result;
  const { application } = result;

  const [customers, assets, questionsFile] = await Promise.all([
    loadCustomers(),
    loadAssets(),
    loadQuestions(),
  ]);
  // A customer is a data-pack persona or a profile a signed-up user created in the database.
  const row = await db.customer.findUnique({ where: { id: application.customerId } });
  const customer = customers.find((c) => c.id === application.customerId) ?? row;
  const asset = assets.find((a) => a.id === application.assetId);
  if (!customer || !asset) return { ok: false, reason: 'unknown_application' };

  const { answers } = application;
  // What the applicant's profile already answered is neither asked, counted nor "went back" to.
  const questions = visibleQuestions(questionsFile.questions, row, answers);
  const context: DealContext = {
    customerType: effectiveCustomerType(answers, customer.type as Customer['type']),
    category: asset.category,
    financedAmountCents: application.financedAmountCents,
    termMonths: application.termMonths,
  };
  const question =
    application.decision === 'pending'
      ? (currentQuestion(questions, context, answers, requestedQuestionId) ?? null)
      : null;

  return {
    ok: true,
    flow: {
      application,
      asset: { make: asset.make, model: asset.model, category: asset.category },
      question,
      previousQuestionId: question
        ? (previousAnsweredQuestion(questions, answers, question.id)?.id ?? null)
        : null,
      progress: questionProgress(questions, context, answers),
    },
  };
}
