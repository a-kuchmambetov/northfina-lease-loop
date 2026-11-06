// How a lease wears an item down (CHALLENGE.md Spine #7 / Smart Problem #3's inputs: an
// item that comes back has to actually be assessed, not just assumed unchanged). None of
// this comes from the data pack — there is no "usage per month" or "condition thresholds"
// anywhere in it — so these numbers are this app's own, documented assumption, same spirit
// as the early-exit formula and the invoice payment term.
import type { AssetCategory, AssetCondition } from '@/data/schemas';

/** Assumed usage added per month of lease, in the category's own unit. Our own estimate. */
export const ASSUMED_MONTHLY_USAGE: Record<AssetCategory, number> = {
  e_bike: 400, // km
  laptop: 25, // battery cycles
  farm_machine: 80, // engine hours
};

/** `usageValue` at or below which the item is still in this condition. Our own scale. */
const CONDITION_USAGE_THRESHOLDS: Record<AssetCategory, readonly [number, AssetCondition][]> = {
  e_bike: [
    [3_000, 'new'],
    [8_000, 'like_new'],
    [15_000, 'good'],
    [25_000, 'fair'],
    [Infinity, 'poor'],
  ],
  laptop: [
    [100, 'new'],
    [300, 'like_new'],
    [500, 'good'],
    [800, 'fair'],
    [Infinity, 'poor'],
  ],
  farm_machine: [
    [500, 'new'],
    [2_000, 'like_new'],
    [4_000, 'good'],
    [7_000, 'fair'],
    [Infinity, 'poor'],
  ],
};

export const CONDITION_SEVERITY: readonly AssetCondition[] = [
  'new',
  'like_new',
  'good',
  'fair',
  'poor',
];

/** Lower is better — `new` is 0. Lets callers compare conditions, e.g. "at least good". */
export function conditionRank(condition: AssetCondition): number {
  return CONDITION_SEVERITY.indexOf(condition);
}

export type WearInput = {
  category: AssetCategory;
  conditionBefore: AssetCondition;
  /** Usage since the last `resets_usage` refurbishment (`Asset.usage_value`). */
  usageValueBefore: number;
  /** Total usage over the item's whole life (`Asset.lifetime_usage_value`). Never reset. */
  lifetimeUsageValueBefore: number;
  monthsLeased: number;
};

export type WearResult = {
  /** Usage since the last `resets_usage` refurbishment — feeds market value and triggers. */
  usageValueAfter: number;
  /** Total usage over the item's life. Grows by exactly the same amount as `usageValueAfter`
   *  does, but a `resets_usage` refurbishment (which zeroes `usageValue`) never touches it,
   *  so it never decreases. Feeds the passport and the CO2 number. */
  lifetimeUsageValueAfter: number;
  conditionAfter: AssetCondition;
};

/**
 * What a lease of `monthsLeased` months does to an item: usage goes up by the category's
 * assumed monthly rate (on both the since-last-reset counter and the lifetime counter), and condition moves to whichever is worse — what it already was,
 * or what that much usage implies on our scale. Condition never improves on its own.
 */
export function assessWearAfterLease(input: WearInput): WearResult {
  if (!Number.isInteger(input.monthsLeased) || input.monthsLeased < 0) {
    throw new RangeError(
      `monthsLeased must be a non-negative whole number, got ${input.monthsLeased}`
    );
  }

  const addedUsage = ASSUMED_MONTHLY_USAGE[input.category] * input.monthsLeased;
  const usageValueAfter = input.usageValueBefore + addedUsage;
  const lifetimeUsageValueAfter = input.lifetimeUsageValueBefore + addedUsage;

  const impliedByUsage = CONDITION_USAGE_THRESHOLDS[input.category].find(
    ([upTo]) => usageValueAfter <= upTo
  )![1];

  const conditionAfter =
    CONDITION_SEVERITY.indexOf(impliedByUsage) > CONDITION_SEVERITY.indexOf(input.conditionBefore)
      ? impliedByUsage
      : input.conditionBefore;

  return { usageValueAfter, lifetimeUsageValueAfter, conditionAfter };
}
