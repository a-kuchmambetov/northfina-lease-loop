// Orchestration for starting an application (CHALLENGE.md Spine #3): looks up the
// customer and asset, quotes the deal to get a financed amount and monthly rent, locks
// that quote onto the new application row, and returns the first question to ask
// (src/domain/question-flow.ts). A signed-up applicant's profile answers what it already
// knows (src/domain/profile-answers.ts), so those questions are never asked: the application
// starts with them answered, and may even be decided on the spot (a profile under 18, or
// one that leaves nothing else to ask). No business rules live here.
import { randomUUID } from 'node:crypto';
import { loadAssets, loadCoefficientTable, loadQuestions } from '@/data/load';
import type { Customer } from '@/data/schemas';
import { earlyRejectionReason, type EligibilityResult } from '@/domain/eligibility';
import {
  dropStaleAnswers,
  effectiveCustomerType,
  nextQuestion,
  type DealContext,
} from '@/domain/question-flow';
import { getPriceQuote, type GetPriceQuoteResult } from '@/server/features/pricing/get-quote';
import { withAudit } from '@/server/audit';
import type { PrismaClient } from '@/generated/prisma/client';
import { decideApplication, persistDecision } from './application-decision';
import { profileAnswersFor } from './profile-answers';

export type StartApplicationInput = {
  customerId: string;
  assetId: string;
  termMonths: number;
  downPaymentCents: number;
  /** `YYYY-MM-DD`. The caller decides what "today" is (see src/server/today.ts). */
  applicationDate: string;
};

type QuoteFailureReason = Extract<GetPriceQuoteResult, { ok: false }>['reason'];

export type StartApplicationResult =
  | {
      ok: true;
      applicationId: string;
      nextQuestion: ReturnType<typeof nextQuestion>;
      /** Set when the profile's answers alone already decided the application. */
      decision: EligibilityResult | null;
    }
  | { ok: false; reason: 'unknown_customer' | QuoteFailureReason };

export async function startApplication(
  db: PrismaClient,
  input: StartApplicationInput
): Promise<StartApplicationResult> {
  const [customer, assets, questionsFile, coefficientTable] = await Promise.all([
    db.customer.findUnique({ where: { id: input.customerId } }),
    loadAssets(),
    loadQuestions(),
    loadCoefficientTable(),
  ]);
  if (!customer) return { ok: false, reason: 'unknown_customer' };

  const asset = assets.find((a) => a.id === input.assetId);
  if (!asset) return { ok: false, reason: 'unknown_asset' };

  const quoteResult = await getPriceQuote({
    assetId: input.assetId,
    termMonths: input.termMonths,
    downPaymentCents: input.downPaymentCents,
    quoteDate: input.applicationDate,
  });
  if (!quoteResult.ok) return quoteResult;

  // Without a profile no answers exist yet, so the customer's own type is the only sensible
  // starting default; it is the first question asked regardless (`q_customer_type` has no
  // `ask_when`), and from the next answer on, the applicant's own answer takes over
  // (src/domain/question-flow.ts's `effectiveCustomerType`). With a profile, its type is
  // already the `q_customer_type` answer.
  const { questions } = questionsFile;
  const profileAnswers = profileAnswersFor(customer, questions);
  const context: DealContext = {
    customerType: effectiveCustomerType(profileAnswers, customer.type as Customer['type']),
    category: asset.category,
    financedAmountCents: quoteResult.quote.financedCents,
    termMonths: input.termMonths,
  };
  const answers = dropStaleAnswers(questions, context, profileAnswers);
  const firstQuestion = nextQuestion(questions, context, answers);

  // A profile answer can rule the applicant out on its own, exactly like typing it would.
  let decision: EligibilityResult | null = null;
  for (const q of questions) {
    const answer = answers[q.id];
    const reason =
      answer === undefined ? undefined : earlyRejectionReason(q, answer, input.applicationDate);
    if (reason) {
      decision = { decision: 'rejected', reason };
      break;
    }
  }
  if (!decision && !firstQuestion) {
    decision = decideApplication({
      customerType: context.customerType,
      answers,
      coefficientTable,
      decisionDate: input.applicationDate,
      financedAmountCents: context.financedAmountCents,
      termMonths: input.termMonths,
      monthlyRentWithVatCents: quoteResult.quote.monthlyRentWithVatCents,
    });
  }

  const id = randomUUID();
  await withAudit(
    db,
    { actor: 'customer', action: 'application.started', entityType: 'application', entityId: id },
    (tx) =>
      tx.application.create({
        data: {
          id,
          customer_id: customer.id,
          asset_id: asset.id,
          term_months: input.termMonths,
          financed_amount_cents: quoteResult.quote.financedCents,
          monthly_rent_with_vat_cents: quoteResult.quote.monthlyRentWithVatCents,
          price_list_version: quoteResult.quote.priceListVersion,
          answers_json: JSON.stringify(answers),
          decision: 'pending',
        },
      })
  );
  if (decision) await persistDecision(db, id, answers, decision);

  return {
    ok: true,
    applicationId: id,
    nextQuestion: decision ? undefined : firstQuestion,
    decision,
  };
}
