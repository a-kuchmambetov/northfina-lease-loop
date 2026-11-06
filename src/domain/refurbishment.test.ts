import { beforeAll, describe, expect, it } from 'vitest';
import { loadRefurbishmentCosts } from '@/data/load';
import type { RefurbishmentCosts } from '@/data/schemas';
import { mandatoryBeforeNextLeaseCostCents, refurbishToGoodCostCents } from './refurbishment';

let costs: RefurbishmentCosts;
beforeAll(async () => {
  costs = await loadRefurbishmentCosts();
});

describe('refurbishToGoodCostCents', () => {
  it('is a no-op once the item is already good or better', () => {
    expect(
      refurbishToGoodCostCents(costs, {
        category: 'e_bike',
        conditionBefore: 'good',
        usageValueBefore: 1000,
      })
    ).toEqual({ ok: false, reason: 'already_good_enough' });
    expect(
      refurbishToGoodCostCents(costs, {
        category: 'e_bike',
        conditionBefore: 'like_new',
        usageValueBefore: 1000,
      })
    ).toEqual({ ok: false, reason: 'already_good_enough' });
  });

  it('sums one condition-ladder step and the always-applied fixed cost (fair e-bike, low usage)', () => {
    const result = refurbishToGoodCostCents(costs, {
      category: 'e_bike',
      conditionBefore: 'fair',
      usageValueBefore: 5000,
    });
    expect(result).toEqual({
      ok: true,
      plan: {
        targetCondition: 'good',
        conditionUpgradeCostCents: 12000, // fair->good
        fixedCostCents: 4500, // safety_inspection, always
        totalCostCents: 16500,
        usageValueAfter: 5000,
        appliedItems: [
          { id: 'fair->good', costCents: 12000 },
          { id: 'safety_inspection', costCents: 4500 },
        ],
      },
    });
  });

  it('sums two condition-ladder steps for a poor item', () => {
    const result = refurbishToGoodCostCents(costs, {
      category: 'e_bike',
      conditionBefore: 'poor',
      usageValueBefore: 1000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.conditionUpgradeCostCents).toBe(15000 + 12000); // poor->fair, fair->good
  });

  it('adds the usage-threshold fixed cost and resets usage once it is crossed (e-bike battery)', () => {
    const result = refurbishToGoodCostCents(costs, {
      category: 'e_bike',
      conditionBefore: 'fair',
      usageValueBefore: 18_400, // scenario card 9's own number
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.fixedCostCents).toBe(4500 + 35000); // safety_inspection + battery_replacement
    expect(result.plan.usageValueAfter).toBe(0); // battery_replacement resets_usage
  });

  it('does not charge the usage-threshold cost below the threshold', () => {
    const result = refurbishToGoodCostCents(costs, {
      category: 'e_bike',
      conditionBefore: 'fair',
      usageValueBefore: 14_999,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.fixedCostCents).toBe(4500);
    expect(result.plan.usageValueAfter).toBe(14_999);
  });

  it('includes the mandatory certified_data_wipe for a laptop (always, mandatory)', () => {
    const result = refurbishToGoodCostCents(costs, {
      category: 'laptop',
      conditionBefore: 'fair',
      usageValueBefore: 100,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.appliedItems).toContainEqual({ id: 'certified_data_wipe', costCents: 2500 });
  });

  it('charges one farm-machine major service per started 1000 engine hours of total usage', () => {
    const result = refurbishToGoodCostCents(costs, {
      category: 'farm_machine',
      conditionBefore: 'fair',
      usageValueBefore: 1500, // ceil(1500/1000) = 2 services
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.fixedCostCents).toBe(40000 + 2 * 150000); // safety_inspection + 2 services
  });

  it('charges no major service when usage is 0', () => {
    const result = refurbishToGoodCostCents(costs, {
      category: 'farm_machine',
      conditionBefore: 'fair',
      usageValueBefore: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.fixedCostCents).toBe(40000); // safety_inspection only
  });
});

describe('mandatoryBeforeNextLeaseCostCents', () => {
  it("is laptop's certified_data_wipe", () => {
    expect(mandatoryBeforeNextLeaseCostCents(costs, 'laptop')).toEqual({
      totalCostCents: 2500,
      appliedItems: [{ id: 'certified_data_wipe', costCents: 2500 }],
    });
  });

  it('is nothing for e-bikes or farm machines', () => {
    expect(mandatoryBeforeNextLeaseCostCents(costs, 'e_bike')).toEqual({
      totalCostCents: 0,
      appliedItems: [],
    });
    expect(mandatoryBeforeNextLeaseCostCents(costs, 'farm_machine')).toEqual({
      totalCostCents: 0,
      appliedItems: [],
    });
  });
});
