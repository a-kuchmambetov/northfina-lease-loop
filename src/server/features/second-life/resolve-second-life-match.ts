// Orchestration for committing a second-life match (CHALLENGE.md Spine #7 / Smart
// Problem #3): runs compute-second-life-match.ts, then writes the asset's new condition,
// usage and status (always `'available'` once resolved — ready for its next lease either
// way) in one audited transaction. Does not sign a contract for the winner: see this
// feature's README for why.
import { withAudit } from '@/server/audit';
import {
  computeSecondLifeMatch,
  type ComputeSecondLifeMatchResult,
} from './compute-second-life-match';
import type { PrismaClient } from '@/generated/prisma/client';

const AUDIT_ACTION: Record<string, string> = {
  refurbish: 'second_life.refurbished',
  as_is: 'second_life.matched_as_is',
  no_match: 'second_life.no_match',
};

export type ResolveSecondLifeMatchResult =
  | { ok: true; computation: Extract<ComputeSecondLifeMatchResult, { ok: true }>['computation'] }
  | { ok: false; reason: Extract<ComputeSecondLifeMatchResult, { ok: false }>['reason'] };

export async function resolveSecondLifeMatch(
  db: PrismaClient,
  assetId: string,
  asOfDate: string
): Promise<ResolveSecondLifeMatchResult> {
  const result = await computeSecondLifeMatch(db, assetId, asOfDate);
  if (!result.ok) return result;

  const { computation } = result;

  await withAudit(
    db,
    {
      actor: 'system',
      action: AUDIT_ACTION[computation.outcome]!,
      entityType: 'asset',
      entityId: assetId,
      details: {
        outcome: computation.outcome,
        winner: computation.winner?.request.id ?? null,
        rentCents: computation.winner?.rentCents ?? null,
        refurbishCostCents: computation.refurbishPlan?.totalCostCents ?? 0,
        mandatoryCostCents: computation.mandatoryCostCents,
      },
    },
    (tx) =>
      tx.asset.update({
        where: { id: assetId },
        data: {
          condition: computation.conditionAfter,
          usage_value: computation.usageValueAfter,
          status: 'available',
        },
      })
  );

  return { ok: true, computation };
}
