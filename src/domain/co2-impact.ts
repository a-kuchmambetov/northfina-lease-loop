// CO2 avoided by giving an item a second life (CHALLENGE.md Spine #7's "passport" bonus,
// needed for scenario card 10: "show its passport and the CO2 it has saved"). Reads
// data/co2-factors.json, which is explicitly FICTIONAL/indicative for the hackathon.
import type { AssetCategory, Co2Factors } from '@/data/schemas';

/**
 * `data/co2-factors.json`'s own hint: a second life avoids roughly one new item's
 * manufacturing footprint, minus the footprint of refurbishing the old one (if it was
 * refurbished to get there — an as-is second life adds no extra footprint of its own, so
 * the full manufacturing figure is avoided). This is credited once per life transition
 * (a new occupant starting a new life on the same item), not per year or per lease month.
 */
export function avoidedManufacturingKgForLife(
  factors: Co2Factors,
  category: AssetCategory,
  wasRefurbished: boolean
): number {
  const base = factors.manufacturing_new_kg[category];
  const kg = wasRefurbished ? base * (1 - factors.refurbishment_share_of_new) : base;
  return Math.round(kg * 100) / 100;
}

/**
 * E-bikes also avoid car trips while they're actually ridden. `totalKm` must be the item's
 * **lifetime** km (`Asset.lifetime_usage_value`), not `usage_value`: a `resets_usage`
 * refurbishment (e.g. a battery replacement) zeroes `usage_value`, but the km already ridden
 * before it still avoided car trips. Not meaningful for laptops or farm machines (no car-km
 * factor exists for them).
 */
export function avoidedCarKmKgForEbike(factors: Co2Factors, totalKm: number): number {
  return Math.round(totalKm * factors.e_bike_avoided_car_km_kg_per_km * 100) / 100;
}
