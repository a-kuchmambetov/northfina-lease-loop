// Orchestration for starting an application (CHALLENGE.md Spine #3): looks up the
// customer and asset, quotes the deal to get a financed amount and monthly rent, locks
// that quote onto the new application row, and returns the first question to ask
// (src/domain/question-flow.ts). No business rules live here.
import { randomUUID } from 'node:crypto';
import { loadAssets, loadCustomers, loadQuestions } from '@/data/load';
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
  const [customers, assets, questionsFile] = await Promise.all([
    loadCustomers(),
    loadAssets(),
    loadQuestions(),
  ]);

  const customer = customers.find((c) => c.id === input.customerId);
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

  const context: DealContext = {
    customerType: customer.type,
    category: asset.category,
    financedAmountCents: quoteResult.quote.financedCents,
    termMonths: input.termMonths,
  };
  const firstQuestion = nextQuestion(questionsFile.questions, context, {});

  const id = randomUUID();
  await withAudit(
    db,
    { actor: customer.id, action: 'application.started', entityType: 'application', entityId: id },
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
