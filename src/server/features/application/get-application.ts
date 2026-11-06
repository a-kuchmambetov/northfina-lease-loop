// Orchestration for reading one application's current state: its answers so far and its
// decision, if it has one yet. No business rules live here.
import type { Answers } from '@/domain/question-flow';
import type { PrismaClient } from '@/generated/prisma/client';

export type ApplicationView = {
  id: string;
  customerId: string;
  assetId: string;
  termMonths: number;
  financedAmountCents: number;
  monthlyRentWithVatCents: number;
  answers: Answers;
  decision: string;
  decisionReason: string | null;
  createdAt: string;
  decidedAt: string | null;
};

export type GetApplicationResult =
  { ok: true; application: ApplicationView } | { ok: false; reason: 'unknown_application' };

export async function getApplication(
  db: PrismaClient,
  applicationId: string
): Promise<GetApplicationResult> {
  const application = await db.application.findUnique({ where: { id: applicationId } });
  if (!application) return { ok: false, reason: 'unknown_application' };

  return {
    ok: true,
    application: {
      id: application.id,
      customerId: application.customer_id,
      assetId: application.asset_id,
      termMonths: application.term_months,
      financedAmountCents: application.financed_amount_cents,
      monthlyRentWithVatCents: application.monthly_rent_with_vat_cents,
      answers: JSON.parse(application.answers_json),
      decision: application.decision,
      decisionReason: application.decision_reason,
      createdAt: application.created_at.toISOString(),
      decidedAt: application.decided_at?.toISOString() ?? null,
    },
  };
}
