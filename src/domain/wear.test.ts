import { beforeAll, describe, expect, it } from 'vitest';
import { loadRefurbishmentCosts } from '@/data/load';
import type { RefurbishmentCosts } from '@/data/schemas';
import { refurbishToGoodCostCents } from './refurbishment';
import { assessWearAfterLease } from './wear';

describe('assessWearAfterLease', () => {
  it('adds the assumed monthly usage for the category', () => {
    const result = assessWearAfterLease({
      category: 'e_bike',
      conditionBefore: 'new',
      usageValueBefore: 0,
      lifetimeUsageValueBefore: 0,
      monthsLeased: 12,
    });
    expect(result.usageValueAfter).toBe(4_800); // 400 km/month x 12
  });

  it('downgrades condition when the new usage crosses a threshold', () => {
    const result = assessWearAfterLease({
      category: 'e_bike',
      conditionBefore: 'new',
      usageValueBefore: 0,
      lifetimeUsageValueBefore: 0,
      monthsLeased: 36, // 14400 km -> past the 8000 "like_new" ceiling
    });
    expect(result).toEqual({
      usageValueAfter: 14_400,
      lifetimeUsageValueAfter: 14_400,
      conditionAfter: 'good',
    });
  });

  it('never improves condition, even if the usage scale would imply a better one', () => {
    const result = assessWearAfterLease({
      category: 'laptop',
      conditionBefore: 'fair', // already worse than what 0 extra usage would imply
      usageValueBefore: 0,
      lifetimeUsageValueBefore: 0,
      monthsLeased: 0,
    });
    expect(result).toEqual({
      usageValueAfter: 0,
      lifetimeUsageValueAfter: 0,
      conditionAfter: 'fair',
    });
  });

  it('starts from whatever usage the item already had', () => {
    const result = assessWearAfterLease({
      category: 'farm_machine',
      conditionBefore: 'good',
      usageValueBefore: 4_200,
      lifetimeUsageValueBefore: 4_200,
      monthsLeased: 12, // +960 engine hours
    });
    expect(result.usageValueAfter).toBe(5_160);
  });

  it('holds the worst condition band beyond the last threshold', () => {
    const result = assessWearAfterLease({
      category: 'laptop',
      conditionBefore: 'new',
      usageValueBefore: 0,
      lifetimeUsageValueBefore: 0,
      monthsLeased: 1_000,
    });
    expect(result.conditionAfter).toBe('poor');
  });

  it('rejects a negative lease length', () => {
    expect(() =>
      assessWearAfterLease({
        category: 'e_bike',
        conditionBefore: 'new',
        usageValueBefore: 0,
        lifetimeUsageValueBefore: 0,
        monthsLeased: -1,
      })
    ).toThrow(RangeError);
  });
});

describe('lifetime usage (two-counter model, KNOWN_ISSUES.md item 5)', () => {
  let costs: RefurbishmentCosts;
  beforeAll(async () => {
    costs = await loadRefurbishmentCosts();
  });

  it('grows lifetime usage by exactly the same amount as the since-reset counter', () => {
    const result = assessWearAfterLease({
      category: 'e_bike',
      conditionBefore: 'good',
      usageValueBefore: 1_000,
      lifetimeUsageValueBefore: 6_500, // a battery was replaced once, so lifetime > current
      monthsLeased: 10, // +4000 km
    });
    expect(result.usageValueAfter).toBe(5_000);
    expect(result.lifetimeUsageValueAfter).toBe(10_500);
  });

  it('never decreases lifetime usage, even for a zero-month lease', () => {
    const result = assessWearAfterLease({
      category: 'e_bike',
      conditionBefore: 'good',
      usageValueBefore: 0,
      lifetimeUsageValueBefore: 18_400,
      monthsLeased: 0,
    });
    expect(result.lifetimeUsageValueAfter).toBe(18_400);
  });

  it('a battery reset zeroes the since-reset counter; later wear then adds to both separately', () => {
    // ebike-007's worked example: 18,400 km, 'fair' -> battery replacement resets usage.
    const refurb = refurbishToGoodCostCents(costs, {
      category: 'e_bike',
      conditionBefore: 'fair',
      usageValueBefore: 18_400,
    });
    expect(refurb.ok).toBe(true);
    if (!refurb.ok) return;
    expect(refurb.plan.usageValueAfter).toBe(0);

    // The refurbishment plan only produces the new since-reset value; lifetime is left at
    // whatever it was (18,400), so the next lease adds to both from different bases.
    const next = assessWearAfterLease({
      category: 'e_bike',
      conditionBefore: 'good',
      usageValueBefore: refurb.plan.usageValueAfter,
      lifetimeUsageValueBefore: 18_400,
      monthsLeased: 12, // +4800 km
    });
    expect(next.usageValueAfter).toBe(4_800);
    expect(next.lifetimeUsageValueAfter).toBe(23_200);
    expect(next.lifetimeUsageValueAfter).toBeGreaterThanOrEqual(next.usageValueAfter);
  });
});
