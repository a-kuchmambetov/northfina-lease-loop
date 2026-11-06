import { beforeAll, describe, expect, it } from 'vitest';
import { loadCo2Factors } from '@/data/load';
import type { Co2Factors } from '@/data/schemas';
import { avoidedCarKmKgForEbike, avoidedManufacturingKgForLife } from './co2-impact';

let factors: Co2Factors;
beforeAll(async () => {
  factors = await loadCo2Factors();
});

describe('avoidedManufacturingKgForLife', () => {
  it('credits the full manufacturing figure for an as-is second life', () => {
    expect(avoidedManufacturingKgForLife(factors, 'e_bike', false)).toBe(165);
  });

  it("discounts by the refurbishment's own share of a new item's footprint", () => {
    // 165 * (1 - 0.12) = 145.2
    expect(avoidedManufacturingKgForLife(factors, 'e_bike', true)).toBe(145.2);
  });

  it('uses each category its own manufacturing figure', () => {
    expect(avoidedManufacturingKgForLife(factors, 'laptop', false)).toBe(330);
    expect(avoidedManufacturingKgForLife(factors, 'farm_machine', false)).toBe(18000);
  });
});

describe('avoidedCarKmKgForEbike', () => {
  it('scales linearly with km ridden', () => {
    expect(avoidedCarKmKgForEbike(factors, 1000)).toBe(150); // 1000 * 0.15
  });

  it('credits lifetime km even after a battery reset zeroed the since-reset counter', () => {
    const sinceReset = 0;
    const lifetime = 18_400; // ebike-007's worked example
    expect(avoidedCarKmKgForEbike(factors, sinceReset)).toBe(0);
    expect(avoidedCarKmKgForEbike(factors, lifetime)).toBe(2_760); // 18400 * 0.15
  });

  it('is 0 for 0 km', () => {
    expect(avoidedCarKmKgForEbike(factors, 0)).toBe(0);
  });
});
