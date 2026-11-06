// Orchestration for second-life matchmaking (CHALLENGE.md Spine #7 / Smart Problem #3):
// for one returned asset, works out whether refurbishing it to 'good' is worth it, who on
// the waiting list wins it, and at what rent. No writes here — see
// resolve-second-life-match.ts for the version that persists the outcome. No business
// rules live here either — see src/domain/refurbishment.ts and
// src/domain/second-life-match.ts for those.
import {
  loadCoefficientTable,
  loadRefurbishmentCosts,
  loadResidualCurves,
  loadSecondLifeDemand,
} from '@/data/load';
import type { AssetCategory, AssetCondition } from '@/data/schemas';
import { monthsBetween } from '@/domain/calendar';
import {
  mandatoryBeforeNextLeaseCostCents,
  refurbishToGoodCostCents,
  type RefurbishPlan,
} from '@/domain/refurbishment';
import { residualValueCents } from '@/domain/residual-value';
import { quoteNetRent } from '@/domain/pricing';
import {
  decideSecondLifeOutcome,
  rankSecondLifeCandidates,
  type SecondLifeMatch,
  type SecondLifeOutcome,
} from '@/domain/second-life-match';
import { conditionRank } from '@/domain/wear';
import type { PrismaClient } from '@/generated/prisma/client';

export type SecondLifeMatchComputation = {
  outcome: SecondLifeOutcome;
  /** Present only when `outcome === 'refurbish'`. */
  refurbishPlan?: RefurbishPlan;
  /** The mandatory-before-next-lease cost (e.g. a laptop's data wipe), charged whichever
   *  way this goes — `0` for categories with none. */
  mandatoryCostCents: number;
  /** The winning candidate for the outcome actually chosen, if any. */
  winner?: SecondLifeMatch;
  /** What usage_value the asset ends up with (0 if a reset fixed cost applied). */
  usageValueAfter: number;
  /** What condition the asset ends up with. */
  conditionAfter: AssetCondition;
  /** Every eligible candidate as-is and after refurbishment, ranked — lets a caller show
   *  *why* the winner won, and who else was close. */
  candidatesAsIs: SecondLifeMatch[];
  candidatesRefurbished: SecondLifeMatch[];
};

export type ComputeSecondLifeMatchResult =
  | { ok: true; computation: SecondLifeMatchComputation }
  | { ok: false; reason: 'asset_not_found' | 'asset_not_returned' | 'asset_contract_not_found' };

export async function computeSecondLifeMatch(
  db: PrismaClient,
  assetId: string,
  asOfDate: string
): Promise<ComputeSecondLifeMatchResult> {
  const asset = await db.asset.findUnique({ where: { id: assetId } });
  if (!asset) return { ok: false, reason: 'asset_not_found' };
  if (asset.status !== 'returned') return { ok: false, reason: 'asset_not_returned' };

  const lastContract = await db.contract.findFirst({
    where: { asset_id: assetId },
    orderBy: { start_date: 'desc' },
  });
  if (!lastContract) return { ok: false, reason: 'asset_contract_not_found' };

  const [costs, residualCurves, coefficientTable, demand] = await Promise.all([
    loadRefurbishmentCosts(),
    loadResidualCurves(),
    loadCoefficientTable(),
    loadSecondLifeDemand(),
  ]);

  const category = asset.category as AssetCategory;
  const condition = asset.condition as AssetCondition;
  const requests = demand.filter((request) => request.category === category);
  const ageMonths = monthsBetween(lastContract.start_date, asOfDate);
  const mandatory = mandatoryBeforeNextLeaseCostCents(costs, category);

  const refurbResult =
    conditionRank(condition) <= conditionRank('good')
      ? undefined
      : refurbishToGoodCostCents(costs, {
          category,
          conditionBefore: condition,
          usageValueBefore: asset.usage_value,
        });
  const refurbishPlan = refurbResult?.ok ? refurbResult.plan : undefined;

  const rentByTerm = (listPriceCents: number) => {
    const rents: Record<number, number | undefined> = {};
    for (const termMonths of new Set(requests.map((r) => r.preferred_term_months))) {
      const result = quoteNetRent(coefficientTable, {
        listPriceCents,
        downPaymentCents: 0,
        termMonths,
      });
      rents[termMonths] = result.ok ? result.netRent.monthlyNetRentCents : undefined;
    }
    return rents;
  };

  const residualNowCents = residualValueCents(residualCurves, {
    category,
    netListPriceAtFirstLeaseCents: lastContract.list_price_cents,
    ageMonths,
    condition,
    usageValue: asset.usage_value,
  });
  const candidatesAsIs = rankSecondLifeCandidates(
    requests,
    { category, condition, asOfDate },
    rentByTerm(residualNowCents)
  );

  let candidatesRefurbished: SecondLifeMatch[] = [];
  if (refurbishPlan) {
    const residualRefurbishedCents = residualValueCents(residualCurves, {
      category,
      netListPriceAtFirstLeaseCents: lastContract.list_price_cents,
      ageMonths,
      condition: 'good',
      usageValue: refurbishPlan.usageValueAfter,
    });
    candidatesRefurbished = rankSecondLifeCandidates(
      requests,
      { category, condition: 'good', asOfDate },
      rentByTerm(residualRefurbishedCents)
    );
  }

  const outcome = decideSecondLifeOutcome(
    candidatesAsIs[0],
    candidatesRefurbished[0],
    refurbishPlan?.totalCostCents ?? 0
  );

  const conditionAfter = outcome === 'refurbish' ? 'good' : condition;
  const usageValueAfter =
    outcome === 'refurbish' ? refurbishPlan!.usageValueAfter : asset.usage_value;
  const winner = outcome === 'refurbish' ? candidatesRefurbished[0] : candidatesAsIs[0];

  return {
    ok: true,
    computation: {
      outcome,
      refurbishPlan: outcome === 'refurbish' ? refurbishPlan : undefined,
      mandatoryCostCents: mandatory.totalCostCents,
      winner,
      usageValueAfter,
      conditionAfter,
      candidatesAsIs,
      candidatesRefurbished,
    },
  };
}
