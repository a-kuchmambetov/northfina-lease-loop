// Orchestration for ending a contract before its term is over (CHALLENGE.md Smart Problem
// #2, "Fair early exit"): loads the locked contract and the asset's current condition and
// usage, then asks src/domain/early-exit.ts what buying or returning early should cost.
// No business rules live here — see src/domain/early-exit.ts and
// src/domain/residual-value.ts for those.
import { loadResidualCurves } from '@/data/load';
import type { AssetCategory } from '@/data/schemas';
import { monthsBetween } from '@/domain/calendar';
import { resolveEarlyExit, type EarlyExitAction, type EarlyExitResult } from '@/domain/early-exit';
import { residualValueCents } from '@/domain/residual-value';
import { changeAssetStatus, previewAssetWear, returnAsset } from '@/server/assets';
import { withAudit } from '@/server/audit';
import type { PrismaClient } from '@/generated/prisma/client';

export type ResolveEarlyExitInput = {
  contractId: string;
  action: EarlyExitAction;
  /** `YYYY-MM-DD`, the day the customer wants out. */
  asOfDate: string;
  /** Work out what it would cost, but change nothing: no status, no audit row. */
  dryRun?: boolean;
};

type OutcomeFailureReason = Extract<EarlyExitResult, { ok: false }>['reason'];

export type ResolveEarlyExitResult =
  | { ok: true; outcome: 'bought_early'; amountCents: number }
  | { ok: true; outcome: 'returned_early'; feeCents: number }
  | {
      ok: false;
      reason:
        | 'contract_not_found'
        | 'contract_already_settled'
        | 'term_already_over'
        | 'asset_not_found'
        | OutcomeFailureReason;
    };

export async function resolveContractEarlyExit(
  db: PrismaClient,
  input: ResolveEarlyExitInput
): Promise<ResolveEarlyExitResult> {
  const contract = await db.contract.findUnique({ where: { id: input.contractId } });
  if (!contract) return { ok: false, reason: 'contract_not_found' };
  if (contract.status !== 'active') return { ok: false, reason: 'contract_already_settled' };

  const monthsElapsed = monthsBetween(contract.start_date, input.asOfDate);
  // The term is already over — this is what src/server/features/end-of-term is for, not
  // an "early" exit.
  if (monthsElapsed >= contract.term_months) return { ok: false, reason: 'term_already_over' };

  if (input.action === 'buy') {
    const outcome = resolveEarlyExit({
      financedCents: contract.financed_cents,
      buyoutCents: contract.buyout_cents,
      monthlyNetRentCents: contract.monthly_net_rent_cents,
      termMonths: contract.term_months,
      monthsElapsed,
      action: 'buy',
    });
    if (!outcome.ok || outcome.outcome !== 'bought_early') return outcome;
    if (input.dryRun) return outcome;

    await withAudit(
      db,
      {
        actor: 'customer',
        action: 'contract.bought_early',
        entityType: 'contract',
        entityId: input.contractId,
        details: { amountCents: outcome.amountCents, monthsElapsed },
      },
      (tx) => tx.contract.update({ where: { id: input.contractId }, data: { status: 'bought' } })
    );
    // The item leaves the fleet for good — it never comes back, unlike 'reserved'.
    await changeAssetStatus(db, { id: contract.asset_id, status: 'sold', actor: 'customer' });
    return outcome;
  }

  const asset = await db.asset.findUnique({ where: { id: contract.asset_id } });
  if (!asset) return { ok: false, reason: 'asset_not_found' };

  // asset.condition/usage_value are never updated mid-lease — they still hold whatever
  // the item was before this contract started. Assess what monthsElapsed of this lease
  // has actually done before treating that as "now".
  const wearNow = await previewAssetWear(db, {
    id: contract.asset_id,
    category: asset.category as AssetCategory,
    monthsLeased: monthsElapsed,
  });
  if (!wearNow.ok) return { ok: false, reason: 'asset_not_found' };

  const residualCurves = await loadResidualCurves();
  const residualInput = {
    category: asset.category as AssetCategory,
    netListPriceAtFirstLeaseCents: contract.list_price_cents,
    condition: wearNow.wear.conditionAfter,
    usageValue: wearNow.wear.usageValueAfter,
  };
  const residualValueNowCents = residualValueCents(residualCurves, {
    ...residualInput,
    ageMonths: monthsElapsed,
  });
  // An approximation, documented in src/server/features/early-exit/README.md: holds the
  // item's condition and usage as they are *right now* (just assessed above) fixed, and
  // only projects the age curve forward to the natural end of the term — since nobody can
  // know how much more it would really be used between now and then.
  const residualValueAtFullTermCents = residualValueCents(residualCurves, {
    ...residualInput,
    ageMonths: contract.term_months,
  });

  const outcome = resolveEarlyExit({
    financedCents: contract.financed_cents,
    buyoutCents: contract.buyout_cents,
    monthlyNetRentCents: contract.monthly_net_rent_cents,
    termMonths: contract.term_months,
    monthsElapsed,
    action: 'return',
    residualValueNowCents,
    residualValueAtFullTermCents,
  });
  if (!outcome.ok || outcome.outcome !== 'returned_early') return outcome;
  if (input.dryRun) return outcome;

  await withAudit(
    db,
    {
      actor: 'customer',
      action: 'contract.returned_early',
      entityType: 'contract',
      entityId: input.contractId,
      details: { feeCents: outcome.feeCents, monthsElapsed },
    },
    (tx) => tx.contract.update({ where: { id: input.contractId }, data: { status: 'returned' } })
  );
  await returnAsset(db, {
    id: contract.asset_id,
    category: asset.category as AssetCategory,
    monthsLeased: monthsElapsed,
    actor: 'customer',
  });

  return outcome;
}
