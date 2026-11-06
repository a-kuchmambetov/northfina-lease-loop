// Orchestration for starting an application (CHALLENGE.md Spine #3): looks up the
// customer and asset, quotes the deal to get a financed amount and monthly rent, locks
// that quote onto the new application row, and returns the first question to ask
// (src/domain/question-flow.ts). No business rules live here.
import { randomUUID } from 'node:crypto';
import { loadAssets, loadQuestions } from '@/data/load';
import type { Customer } from '@/data/schemas';
import { nextQuestion, type DealContext } from '@/domain/question-flow';
import { getPriceQuote, type GetPriceQuoteResult } from '@/server/features/pricing/get-quote';
import { withAudit } from '@/server/audit';
import type { PrismaClient } from '@/generated/prisma/client';

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
  | { ok: true; applicationId: string; nextQuestion: ReturnType<typeof nextQuestion> }
  | { ok: false; reason: 'unknown_customer' | QuoteFailureReason };

export async function startApplication(
  db: PrismaClient,
  input: StartApplicationInput
): Promise<StartApplicationResult> {
  const [customer, assets, questionsFile] = await Promise.all([
    db.customer.findUnique({ where: { id: input.customerId } }),
    loadAssets(),
    loadQuestions(),
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

  // No answers exist yet, so the customer's own type is the only sensible starting
  // default; it is the first question asked regardless (`q_customer_type` has no
  // `ask_when`), and from the next answer on, the applicant's own answer takes over
  // (src/domain/question-flow.ts's `effectiveCustomerType`).
  const context: DealContext = {
    customerType: customer.type as Customer['type'],
    category: asset.category,
    financedAmountCents: quoteResult.quote.financedCents,
    termMonths: input.termMonths,
  };
  const firstQuestion = nextQuestion(questionsFile.questions, context, {});

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
          answers_json: '{}',
          decision: 'pending',
        },
      })
  );

  return { ok: true, applicationId: id, nextQuestion: firstQuestion };
}
