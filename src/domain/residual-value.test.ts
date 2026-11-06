import { beforeAll, describe, expect, it } from 'vitest';
import { loadResidualCurves } from '@/data/load';
import type { ResidualCurves } from '@/data/schemas';
import { residualValueCents } from './residual-value';

let curves: ResidualCurves;
beforeAll(async () => {
  curves = await loadResidualCurves();
});

describe('residualValueCents', () => {
  it('is the full list price at age 0 in new condition with no usage', () => {
    const result = residualValueCents(curves, {
      category: 'e_bike',
      netListPriceAtFirstLeaseCents: 100_000,
      ageMonths: 0,
      condition: 'new',
      usageValue: 0,
    });
    expect(result).toBe(100_000);
  });

  it('applies the curve point exactly at a known age (e-bike, 12 months = 70%)', () => {
    const result = residualValueCents(curves, {
      category: 'e_bike',
      netListPriceAtFirstLeaseCents: 100_000,
      ageMonths: 12,
      condition: 'new',
      usageValue: 0,
    });
    expect(result).toBe(70_000);
  });

  it('interpolates linearly between two curve points (e-bike, 18 months between 70% and 52%)', () => {
    const result = residualValueCents(curves, {
      category: 'e_bike',
      netListPriceAtFirstLeaseCents: 100_000,
      ageMonths: 18,
      condition: 'new',
      usageValue: 0,
    });
    // Halfway between 12 (70%) and 24 (52%) is 61%.
    expect(result).toBe(61_000);
  });

  it('holds the last curve point for an age past it', () => {
    const result = residualValueCents(curves, {
      category: 'e_bike',
      netListPriceAtFirstLeaseCents: 100_000,
      ageMonths: 120,
      condition: 'new',
      usageValue: 0,
    });
    expect(result).toBe(25_000); // the 60-month point (25%), held
  });

  it('applies the condition multiplier', () => {
    const result = residualValueCents(curves, {
      category: 'e_bike',
      netListPriceAtFirstLeaseCents: 100_000,
      ageMonths: 0,
      condition: 'good',
      usageValue: 0,
    });
    expect(result).toBe(85_000); // condition_multiplier.good = 0.85
  });

  it('applies the usage adjustment', () => {
    const result = residualValueCents(curves, {
      category: 'e_bike',
      netListPriceAtFirstLeaseCents: 100_000,
      ageMonths: 0,
      condition: 'new',
      usageValue: 2_000, // 2 steps of 1000 km x -2% = -4%
    });
    expect(result).toBe(96_000);
  });

  it('floors the usage adjustment at max_total_percent, however much is used', () => {
    const result = residualValueCents(curves, {
      category: 'e_bike',
      netListPriceAtFirstLeaseCents: 100_000,
      ageMonths: 0,
      condition: 'new',
      usageValue: 100_000, // far beyond the -20% floor
    });
    expect(result).toBe(80_000);
  });

  it('combines the curve, condition and usage adjustment', () => {
    const result = residualValueCents(curves, {
      category: 'laptop',
      netListPriceAtFirstLeaseCents: 200_000,
      ageMonths: 24,
      condition: 'fair',
      usageValue: 300, // 3 steps of 100 cycles x -1.5% = -4.5%
    });
    // 200000 x 0.40 (curve) x 0.65 (fair) x 0.955 (usage) = 49660
    expect(result).toBe(49_660);
  });

  it('throws on a fraction of a cent, because that is a bug in the caller', () => {
    expect(() =>
      residualValueCents(curves, {
        category: 'e_bike',
        netListPriceAtFirstLeaseCents: 100_000.5,
        ageMonths: 0,
        condition: 'new',
        usageValue: 0,
      })
    ).toThrow(RangeError);
  });

  it('throws on a negative age', () => {
    expect(() =>
      residualValueCents(curves, {
        category: 'e_bike',
        netListPriceAtFirstLeaseCents: 100_000,
        ageMonths: -1,
        condition: 'new',
        usageValue: 0,
      })
    ).toThrow(RangeError);
  });

  // The mentor's worked example (scenario card 9, ebike-007): €5,490 list, 46 months, 18,400 km.
  // Pins that the two-counter change (KNOWN_ISSUES.md item 5) left the market-value maths —
  // which reads the since-reset `usage_value`, never lifetime usage — exact to the cent.
  describe('ebike-007 worked example', () => {
    const base = {
      category: 'e_bike' as const,
      netListPriceAtFirstLeaseCents: 549_000,
      ageMonths: 46,
    };

    it('values it at €927.81 as-is: fair, 18,400 km', () => {
      expect(residualValueCents(curves, { ...base, condition: 'fair', usageValue: 18_400 })).toBe(
        92_781
      );
    });

    it('rises to €1,159.76 once the battery replacement resets the since-reset counter', () => {
      expect(residualValueCents(curves, { ...base, condition: 'fair', usageValue: 0 })).toBe(
        115_976
      );
    });

    it('is €1,516.61 once it is also refurbished fair -> good', () => {
      expect(residualValueCents(curves, { ...base, condition: 'good', usageValue: 0 })).toBe(
        151_661
      );
    });
  });
});
