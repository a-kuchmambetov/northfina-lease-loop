// What it costs to bring a returned item back to leasable condition (CHALLENGE.md Spine
// #7 / Smart Problem #3's inputs: "a returned item has... refurbishment costs"). Reads
// data/refurbishment-costs.json's condition-upgrade ladder and fixed costs; deciding
// whether refurbishing is actually worth it belongs to second-life-match.ts, not here.
import type { AssetCategory, AssetCondition, RefurbishmentCosts } from '@/data/schemas';
import { conditionRank } from './wear';

const CONDITION_LADDER: readonly AssetCondition[] = ['poor', 'fair', 'good', 'like_new', 'new'];
const TARGET_CONDITION: AssetCondition = 'good';

export type AppliedCost = { id: string; costCents: number };

export type RefurbishPlan = {
  targetCondition: AssetCondition;
  conditionUpgradeCostCents: number;
  fixedCostCents: number;
  totalCostCents: number;
  usageValueAfter: number;
  appliedItems: AppliedCost[];
};

export type RefurbishResult =
  { ok: true; plan: RefurbishPlan } | { ok: false; reason: 'already_good_enough' };

/** `data/refurbishment-costs.json`'s own bar: a returned item is refurbished up to `'good'`
 *  at most, never further — a request wanting `'like_new'` is served only by an item that
 *  already is, not by extra refurbishment spend. */
export function refurbishToGoodCostCents(
  costs: RefurbishmentCosts,
  input: { category: AssetCategory; conditionBefore: AssetCondition; usageValueBefore: number }
): RefurbishResult {
  if (conditionRank(input.conditionBefore) <= conditionRank(TARGET_CONDITION)) {
    return { ok: false, reason: 'already_good_enough' };
  }

  const categoryCosts = costs[input.category];
  const appliedItems: AppliedCost[] = [];

  let conditionUpgradeCostCents = 0;
  const fromIndex = CONDITION_LADDER.indexOf(input.conditionBefore);
  const toIndex = CONDITION_LADDER.indexOf(TARGET_CONDITION);
  for (let step = fromIndex; step < toIndex; step++) {
    const key = `${CONDITION_LADDER[step]}->${CONDITION_LADDER[step + 1]}`;
    const stepCostCents = categoryCosts.condition_upgrades[key];
    if (stepCostCents !== undefined) {
      conditionUpgradeCostCents += stepCostCents;
      appliedItems.push({ id: key, costCents: stepCostCents });
    }
  }

  let usageValueAfter = input.usageValueBefore;
  let fixedCostCents = 0;
  for (const item of categoryCosts.fixed) {
    const costCents = fixedCostForWhen(item.when, input.usageValueBefore, item.cost_cents);
    if (costCents === 0) continue;
    fixedCostCents += costCents;
    appliedItems.push({ id: item.id, costCents });
    if (item.resets_usage) usageValueAfter = 0;
  }

  return {
    ok: true,
    plan: {
      targetCondition: TARGET_CONDITION,
      conditionUpgradeCostCents,
      fixedCostCents,
      totalCostCents: conditionUpgradeCostCents + fixedCostCents,
      usageValueAfter,
      appliedItems,
    },
  };
}

/**
 * `fixed[].when` is free text in the data pack ("always", "usage.value >= 15000 km", or
 * farm machinery's "per started 1000 engine_hours since last service"). This turns it into
 * a cost. The last case is this app's own documented simplification: nothing tracks when
 * an asset was last serviced, so it charges for `ceil(usageValueBefore / 1000)` services
 * off the item's total lifetime usage every time it's refurbished — the same spirit as
 * src/domain/wear.ts's own assumed-usage numbers.
 */
function fixedCostForWhen(when: string, usageValueBefore: number, costCents: number): number {
  if (when === 'always') return costCents;

  const thresholdMatch = /^usage\.value >= (\d+)/.exec(when);
  if (thresholdMatch) {
    return usageValueBefore >= Number(thresholdMatch[1]) ? costCents : 0;
  }

  const perIntervalMatch = /^per started (\d+) \w+ since last service$/.exec(when);
  if (perIntervalMatch) {
    const interval = Number(perIntervalMatch[1]);
    return usageValueBefore <= 0 ? 0 : Math.ceil(usageValueBefore / interval) * costCents;
  }

  // An unrecognized rule in the data pack is a bug worth surfacing loudly, not a silent 0.
  throw new RangeError(`refurbishment.ts does not know how to apply the rule "${when}"`);
}

export type MandatoryCostResult = { totalCostCents: number; appliedItems: AppliedCost[] };

/**
 * Costs that apply before *any* next lease, refurbished or not (today: only laptop's
 * `certified_data_wipe` — a privacy requirement, not a condition one). Add this to the
 * "as-is" path's cost; `refurbishToGoodCostCents` already includes these on the
 * refurbished path, so never add both.
 */
export function mandatoryBeforeNextLeaseCostCents(
  costs: RefurbishmentCosts,
  category: AssetCategory
): MandatoryCostResult {
  const appliedItems = costs[category].fixed
    .filter((item) => item.mandatory_before_next_lease)
    .map((item) => ({ id: item.id, costCents: item.cost_cents }));
  return {
    totalCostCents: appliedItems.reduce((sum, item) => sum + item.costCents, 0),
    appliedItems,
  };
}
