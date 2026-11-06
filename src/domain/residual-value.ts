// What a used item is worth on the market right now (data/residual-curves.json): the
// formula behind "fair early exit" (Smart Problem #2) and end-of-term extension pricing
// (CHALLENGE.md Spine #6) — both need to know what the item is really worth today, not
// what it cost new.
import type { AssetCategory, AssetCondition, ResidualCurves } from '@/data/schemas';

export type ResidualValueInput = {
  category: AssetCategory;
  /** The net list price the item was leased at when it started its current life. */
  netListPriceAtFirstLeaseCents: number;
  /** How many whole months since that first lease started. */
  ageMonths: number;
  condition: AssetCondition;
  /** In the category's own unit (km for e-bikes, battery cycles for laptops, engine hours for farm machines). */
  usageValue: number;
};

/**
 * `how_to_use` in data/residual-curves.json: value = net list price x curve(age) x
 * condition multiplier x usage adjustment. The age curve and condition multiplier are
 * read directly from the data pack; the usage adjustment is also a data-pack rule, turned
 * into a multiplier here (`1 + percent/100`).
 *
 * Rounding: the whole formula is computed in floating point and rounded once, at the very
 * end, to the nearest cent — there is only one money line here, unlike pricing.ts's several.
 */
export function residualValueCents(curves: ResidualCurves, input: ResidualValueInput): number {
  if (!Number.isInteger(input.netListPriceAtFirstLeaseCents)) {
    // A fraction of a cent here is a programming error: money is always whole cents.
    throw new RangeError('netListPriceAtFirstLeaseCents must be whole cents');
  }
  if (!Number.isInteger(input.ageMonths) || input.ageMonths < 0) {
    throw new RangeError(`ageMonths must be a non-negative whole number, got ${input.ageMonths}`);
  }

  const curvePercent = ageCurvePercent(curves.curves[input.category], input.ageMonths);
  const conditionMultiplier = curves.condition_multiplier[input.condition];
  const usageMultiplier = 1 + usageAdjustmentPercent(curves, input) / 100;

  const valueCents =
    input.netListPriceAtFirstLeaseCents *
    (curvePercent / 100) *
    conditionMultiplier *
    usageMultiplier;
  return Math.round(valueCents);
}

/**
 * Linear interpolation between the curve's `[age_months, percent]` points. Before the
 * first point, use its value; past the last point, hold the last value — both as
 * `how_to_use` in data/residual-curves.json says.
 */
function ageCurvePercent(
  points: readonly (readonly [number, number])[],
  ageMonths: number
): number {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const first = sorted[0]!;
  if (ageMonths <= first[0]) return first[1];

  const last = sorted[sorted.length - 1]!;
  if (ageMonths >= last[0]) return last[1];

  for (let i = 1; i < sorted.length; i++) {
    const [prevAge, prevPercent] = sorted[i - 1]!;
    const [nextAge, nextPercent] = sorted[i]!;
    if (ageMonths <= nextAge) {
      const progress = (ageMonths - prevAge) / (nextAge - prevAge);
      return prevPercent + progress * (nextPercent - prevPercent);
    }
  }
  return last[1]; // unreachable given the checks above, kept for type safety
}

/** The usage penalty as a percent (0 or negative), floored at `max_total_percent`. */
function usageAdjustmentPercent(curves: ResidualCurves, input: ResidualValueInput): number {
  const rule = curves.usage_adjustment[input.category];
  const raw = (input.usageValue / rule.step) * rule.percent_per_step;
  return Math.max(raw, rule.max_total_percent);
}
