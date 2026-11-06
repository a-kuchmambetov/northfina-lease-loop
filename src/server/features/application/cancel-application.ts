// Orchestration for a customer cancelling their application. Whether it can be cancelled is
// decided by src/domain/application-cancellation.ts. Cancelling only closes the application:
// starting one reserves nothing, so there is no asset to release, and a contract is not
// linked to the application it came from, so a signed lease is untouched.
import {
  CANCELLED,
  canCancelApplication,
  cancellableDecisions,
} from '@/domain/application-cancellation';
import type { PrismaClient } from '@/generated/prisma/client';
import { withAudit } from '@/server/audit';

export type CancelApplicationInput = {
  applicationId: string;
  /** Only this customer's application can be cancelled. */
  customerId: string;
  /** Who is cancelling, for the audit log. */
  actor: string;
};

export type CancelApplicationResult =
  { ok: true } | { ok: false; reason: 'unknown_application' | 'not_cancellable' };

/** Rolls the transaction back, so no audit row claims a cancellation that didn't happen. */
class DecisionChanged extends Error {}

export async function cancelApplication(
  db: PrismaClient,
  input: CancelApplicationInput
): Promise<CancelApplicationResult> {
  const application = await db.application.findUnique({ where: { id: input.applicationId } });
  // Someone else's application reads the same as one that doesn't exist.
  if (application?.customer_id !== input.customerId) {
    return { ok: false, reason: 'unknown_application' };
  }
  if (!canCancelApplication(application.decision)) return { ok: false, reason: 'not_cancellable' };

  try {
    await withAudit(
      db,
      {
        actor: input.actor,
        action: 'application.cancelled',
        entityType: 'application',
        entityId: application.id,
        details: { from: application.decision },
      },
      async (tx) => {
        // Conditional, so a decision that lands after the read above is never overwritten.
        const { count } = await tx.application.updateMany({
          where: { id: application.id, decision: { in: cancellableDecisions() } },
          data: {
            decision: CANCELLED.decision,
            decision_reason: CANCELLED.reason,
            decided_at: new Date(),
          },
        });
        if (count === 0) throw new DecisionChanged();
      }
    );
  } catch (error) {
    if (error instanceof DecisionChanged) return { ok: false, reason: 'not_cancellable' };
    throw error;
  }
  return { ok: true };
}
