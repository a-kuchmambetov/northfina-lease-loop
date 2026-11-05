// Orchestration for ending a contract before its term is over (CHALLENGE.md Smart Problem
// #2, "Fair early exit"): loads the locked contract and the asset's current condition and
// usage, then asks src/domain/early-exit.ts what buying or returning early should cost.
// No business rules live here — see src/domain/early-exit.ts and
// src/domain/residual-value.ts for those.
import { loadResidualCurves } from '@/data/load';
import type { AssetCategory, AssetCondition } from '@/data/schemas';
import { monthsBetween } from '@/domain/calendar';
import { resolveEarlyExit, type EarlyExitAction, type EarlyExitResult } from '@/domain/early-exit';
import { residualValueCents } from '@/domain/residual-value';
import { changeAssetStatus } from '@/server/assets';
import { withAudit } from '@/server/audit';
import type { PrismaClient } from '@/generated/prisma/client';

export type ResolveEarlyExitInput = {
  contractId: string;
  action: EarlyExitAction;
  /** `YYYY-MM-DD`, the day the customer wants out. */
  asOfDate: string;
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
    return outcome;
  }

  const asset = await db.asset.findUnique({ where: { id: contract.asset_id } });
  if (!asset) return { ok: false, reason: 'asset_not_found' };

  const residualCurves = await loadResidualCurves();
  const residualInput = {
    category: asset.category as AssetCategory,
    netListPriceAtFirstLeaseCents: contract.list_price_cents,
    condition: asset.condition as AssetCondition,
    usageValue: asset.usage_value,
  };
  const residualValueNowCents = residualValueCents(residualCurves, {
    ...residualInput,
    ageMonths: monthsElapsed,
  });
  // An approximation, documented in src/server/features/early-exit/README.md: projects
  // the item's condition and usage as they are today forward to the natural end of the
  // term, since nobody can know how it would really have aged.
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
  await changeAssetStatus(db, { id: contract.asset_id, status: 'returned', actor: 'customer' });

  return outcome;
}
