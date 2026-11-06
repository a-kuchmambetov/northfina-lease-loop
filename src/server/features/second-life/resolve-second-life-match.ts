// Orchestration for committing a second-life match (CHALLENGE.md Spine #7 / Smart
// Problem #3): runs compute-second-life-match.ts, then writes the asset's new condition,
// usage and status (always `'available'` once resolved — ready for its next lease either
// way) in one audited transaction. Does not sign a contract for the winner: see this
// feature's README for why.
import { AssetStatusConflictError } from '@/server/assets';
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
  | {
      ok: false;
      reason:
        | Extract<ComputeSecondLifeMatchResult, { ok: false }>['reason']
        // The asset left 'returned' (e.g. it was leased again) after the computation read it.
        | 'asset_status_conflict';
    };

export async function resolveSecondLifeMatch(
  db: PrismaClient,
  assetId: string,
  asOfDate: string
): Promise<ResolveSecondLifeMatchResult> {
  const result = await computeSecondLifeMatch(db, assetId, asOfDate);
  if (!result.ok) return result;

  const { computation } = result;

  try {
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
      async (tx) => {
        // Compare-and-swap on 'returned': the computation above read the asset earlier, so
        // by now it may have been resolved by someone else or leased again. Writing
        // 'available' unconditionally would reopen an asset that is out on a lease.
        const { count } = await tx.asset.updateMany({
          where: { id: assetId, status: 'returned' },
          data: {
            condition: computation.conditionAfter,
            // Only the since-last-reset counter: a resets_usage refurbishment zeroes it, but
            // lifetime_usage_value is deliberately left alone (KNOWN_ISSUES.md item 5).
            usage_value: computation.usageValueAfter,
            status: 'available',
          },
        });
        if (count !== 1) throw new AssetStatusConflictError(assetId);
      }
    );
  } catch (error) {
    if (error instanceof AssetStatusConflictError) {
      return { ok: false, reason: 'asset_status_conflict' };
    }
    throw error;
  }

  return { ok: true, computation };
}
