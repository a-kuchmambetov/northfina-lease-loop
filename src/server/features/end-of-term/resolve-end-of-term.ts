// Orchestration for ending a contract's term (CHALLENGE.md Spine #6): loads the locked
// contract, asks src/domain/end-of-term.ts what buying or returning means for it, then
// persists the outcome. No business rules live here — see src/domain/end-of-term.ts.
import {
  resolveEndOfTerm,
  type EndOfTermAction,
  type EndOfTermOutcome,
} from '@/domain/end-of-term';
import { changeAssetStatus } from '@/server/assets';
import { withAudit } from '@/server/audit';
import type { PrismaClient } from '@/generated/prisma/client';

export type ResolveEndOfTermInput = {
  contractId: string;
  action: EndOfTermAction;
  /** `YYYY-MM-DD`, the day the customer is making this choice. */
  asOfDate: string;
};

type OutcomeFailureReason = Extract<EndOfTermOutcome, { ok: false }>['reason'];

export type ResolveEndOfTermResult =
  | { ok: true; outcome: 'bought'; amountCents: number }
  | { ok: true; outcome: 'returned' }
  | { ok: false; reason: 'contract_not_found' | 'contract_already_settled' | OutcomeFailureReason };

export async function resolveContractEndOfTerm(
  db: PrismaClient,
  input: ResolveEndOfTermInput
): Promise<ResolveEndOfTermResult> {
  const contract = await db.contract.findUnique({ where: { id: input.contractId } });
  if (!contract) return { ok: false, reason: 'contract_not_found' };
  if (contract.status !== 'active') return { ok: false, reason: 'contract_already_settled' };

  const outcome = resolveEndOfTerm({
    startDate: contract.start_date,
    termMonths: contract.term_months,
    buyoutCents: contract.buyout_cents,
    action: input.action,
    asOfDate: input.asOfDate,
  });
  if (!outcome.ok) return outcome;

  if (outcome.outcome === 'bought') {
    await withAudit(
      db,
      {
        actor: 'customer',
        action: 'contract.bought',
        entityType: 'contract',
        entityId: input.contractId,
        details: { amountCents: outcome.amountCents },
      },
      (tx) => tx.contract.update({ where: { id: input.contractId }, data: { status: 'bought' } })
    );
    return outcome;
  }

  await withAudit(
    db,
    {
      actor: 'customer',
      action: 'contract.returned',
      entityType: 'contract',
      entityId: input.contractId,
    },
    (tx) => tx.contract.update({ where: { id: input.contractId }, data: { status: 'returned' } })
  );
  // The item goes back into the pool, so it can be passed on to its next life
  // (CHALLENGE.md Spine #7, not built yet).
  await changeAssetStatus(db, { id: contract.asset_id, status: 'returned', actor: 'customer' });
  return outcome;
}
