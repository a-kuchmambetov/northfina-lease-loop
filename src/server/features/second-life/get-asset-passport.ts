// Orchestration for an asset's passport (CHALLENGE.md Spine #7's bonus: "give every item a
// passport, its full history across lives" — needed for scenario card 10). Reads the
// asset's Contract rows and the AuditLog for its full history; no writes here. No business
// rules live here — see src/domain/co2-impact.ts for the CO2 math.
import { loadCo2Factors } from '@/data/load';
import type { AssetCategory } from '@/data/schemas';
import { avoidedCarKmKgForEbike, avoidedManufacturingKgForLife } from '@/domain/co2-impact';
import { toAsset } from '@/server/assets';
import type { PrismaClient } from '@/generated/prisma/client';

export type PassportLife = {
  contractId: string;
  customerId: string;
  startDate: string;
  termMonths: number;
  status: string;
  /** Whether a `second_life.refurbished` audit entry precedes this life — `false` for the
   *  asset's very first life, which was never a "second" life at all. */
  wasRefurbished: boolean;
  /** The manufacturing CO2 this life avoided — `0` for the first life (see
   *  `wasRefurbished`). Does not include the e-bike car-km credit, which is asset-level,
   *  not tied to one life — see `totalCo2SavedKg`. */
  co2SavedKg: number;
  /** This life's full contract revenue (`monthly_net_rent_cents × term_months`) — `0` for
   *  the first life. CHALLENGE.md's "money saved by second and third lives": this app's
   *  own reading is the revenue a second life earns that an item just scrapped instead
   *  never would have, not a comparison against the cost of a replacement new item (there
   *  is no money figure for that in the data pack, only CO2). */
  moneySavedCents: number;
};

export type AssetPassport = {
  assetId: string;
  category: AssetCategory;
  lives: PassportLife[];
  totalCo2SavedKg: number;
  totalMoneySavedCents: number;
};

export type GetAssetPassportResult =
  { ok: true; passport: AssetPassport } | { ok: false; reason: 'asset_not_found' };

export async function getAssetPassport(
  db: PrismaClient,
  assetId: string
): Promise<GetAssetPassportResult> {
  const assetRow = await db.asset.findUnique({ where: { id: assetId } });
  if (!assetRow) return { ok: false, reason: 'asset_not_found' };
  const asset = toAsset(assetRow);

  const [contracts, refurbishments, co2Factors] = await Promise.all([
    db.contract.findMany({ where: { asset_id: assetId }, orderBy: { start_date: 'asc' } }),
    db.auditLog.findMany({
      where: { entity_type: 'asset', entity_id: assetId, action: 'second_life.refurbished' },
      orderBy: { created_at: 'asc' },
    }),
    loadCo2Factors(),
  ]);

  const lives: PassportLife[] = contracts.map((contract, index) => {
    // The refurbishment that sent this life's item back out happens, in time, between the
    // previous contract's signing and this one's — there is no earlier contract for the
    // very first life, so it is never "refurbished into".
    const wasRefurbished =
      index > 0 &&
      refurbishments.some(
        (entry) =>
          entry.created_at >= contracts[index - 1]!.signed_at &&
          entry.created_at <= contract.signed_at
      );
    return {
      contractId: contract.id,
      customerId: contract.customer_id,
      startDate: contract.start_date,
      termMonths: contract.term_months,
      status: contract.status,
      wasRefurbished,
      co2SavedKg:
        index === 0 ? 0 : avoidedManufacturingKgForLife(co2Factors, asset.category, wasRefurbished),
      moneySavedCents: index === 0 ? 0 : contract.monthly_net_rent_cents * contract.term_months,
    };
  });

  // Lifetime km, not `usage.value`: a battery replacement zeroes the latter (see
  // KNOWN_ISSUES.md item 5), but the km ridden before it still avoided car trips.
  const carKmAvoidedKg =
    asset.category === 'e_bike'
      ? avoidedCarKmKgForEbike(co2Factors, assetRow.lifetime_usage_value)
      : 0;
  const totalCo2SavedKg =
    Math.round((lives.reduce((sum, life) => sum + life.co2SavedKg, 0) + carKmAvoidedKg) * 100) /
    100;
  const totalMoneySavedCents = lives.reduce((sum, life) => sum + life.moneySavedCents, 0);

  return {
    ok: true,
    passport: { assetId, category: asset.category, lives, totalCo2SavedKg, totalMoneySavedCents },
  };
}
