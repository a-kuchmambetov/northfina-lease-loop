// Orchestration for the fleet-wide circular-impact total (CHALLENGE.md Smart Problem #7:
// "show the CO2 and money saved by second and third lives, per item and for the whole
// fleet"). Per-item is get-asset-passport.ts; this sums that across every asset. No
// business rules live here.
import { getAssetPassport } from './get-asset-passport';
import type { PrismaClient } from '@/generated/prisma/client';

export type FleetImpactItem = {
  assetId: string;
  co2SavedKg: number;
  moneySavedCents: number;
};

export type FleetImpact = {
  items: FleetImpactItem[];
  totalCo2SavedKg: number;
  totalMoneySavedCents: number;
};

export async function getFleetImpact(db: PrismaClient): Promise<FleetImpact> {
  const assetIds = await db.asset.findMany({ select: { id: true }, orderBy: { id: 'asc' } });

  const items: FleetImpactItem[] = [];
  for (const { id } of assetIds) {
    const result = await getAssetPassport(db, id);
    if (!result.ok) continue; // can't happen — we just read this id from the same table
    items.push({
      assetId: id,
      co2SavedKg: result.passport.totalCo2SavedKg,
      moneySavedCents: result.passport.totalMoneySavedCents,
    });
  }

  return {
    items,
    totalCo2SavedKg: Math.round(items.reduce((sum, item) => sum + item.co2SavedKg, 0) * 100) / 100,
    totalMoneySavedCents: items.reduce((sum, item) => sum + item.moneySavedCents, 0),
  };
}
