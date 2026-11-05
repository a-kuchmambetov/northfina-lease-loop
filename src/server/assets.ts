// Reading and changing assets in the database. Rows are converted to the same `Asset`
// shape as data/assets.json, so the UI and domain code see one type everywhere.
import type { Asset as AssetRow, PrismaClient } from '@/generated/prisma/client';
import { assetSchema, type Asset, type AssetCategory, type AssetStatus } from '@/data/schemas';
import { assessWearAfterLease, type WearResult } from '@/domain/wear';
import { withAudit } from './audit';

/** Database row → data-pack shape. Validates, so a bad value edited in by hand is caught. */
export function toAsset(row: AssetRow): Asset {
  return assetSchema.parse({
    id: row.id,
    category: row.category,
    make: row.make,
    model: row.model,
    model_year: row.model_year,
    serial_number: row.serial_number,
    condition: row.condition,
    usage: { unit: row.usage_unit, value: row.usage_value },
    previous_lives: row.previous_lives,
    status: row.status,
  });
}

/** Data-pack shape → columns for a new database row. */
export function toAssetRowData(asset: Asset) {
  return {
    id: asset.id,
    category: asset.category,
    make: asset.make,
    model: asset.model,
    model_year: asset.model_year,
    serial_number: asset.serial_number,
    condition: asset.condition,
    usage_unit: asset.usage.unit,
    usage_value: asset.usage.value,
    previous_lives: asset.previous_lives,
    status: asset.status,
  };
}

export async function listAssets(
  db: PrismaClient,
  filter: { category?: AssetCategory } = {}
): Promise<Asset[]> {
  const rows = await db.asset.findMany({
    where: filter.category ? { category: filter.category } : {},
    orderBy: { id: 'asc' },
  });
  return rows.map(toAsset);
}

export type ChangeAssetStatusResult =
  { ok: true; asset: Asset } | { ok: false; reason: 'not_found' };

/** Sets an asset's status and writes `asset.status_changed` to the audit log, atomically. */
export async function changeAssetStatus(
  db: PrismaClient,
  input: { id: string; status: AssetStatus; actor: string }
): Promise<ChangeAssetStatusResult> {
  const existing = await db.asset.findUnique({ where: { id: input.id } });
  if (!existing) return { ok: false, reason: 'not_found' };

  const updated = await withAudit(
    db,
    {
      actor: input.actor,
      action: 'asset.status_changed',
      entityType: 'asset',
      entityId: input.id,
      details: { from: existing.status, to: input.status },
    },
    (tx) => tx.asset.update({ where: { id: input.id }, data: { status: input.status } })
  );
  return { ok: true, asset: toAsset(updated) };
}

export type PreviewAssetWearResult =
  { ok: true; wear: WearResult } | { ok: false; reason: 'not_found' };

/**
 * What `monthsLeased` of use would do to this asset (see `src/domain/wear.ts`), without
 * writing anything. Lets a caller (e.g. end-of-term's `pass_on`) decide whether the result
 * is good enough *before* committing to it.
 */
export async function previewAssetWear(
  db: PrismaClient,
  input: { id: string; category: AssetCategory; monthsLeased: number }
): Promise<PreviewAssetWearResult> {
  const existing = await db.asset.findUnique({ where: { id: input.id } });
  if (!existing) return { ok: false, reason: 'not_found' };

  const wear = assessWearAfterLease({
    category: input.category,
    conditionBefore: existing.condition as Asset['condition'],
    usageValueBefore: existing.usage_value,
    monthsLeased: input.monthsLeased,
  });
  return { ok: true, wear };
}

export type WriteAssetWearResult = { ok: true; asset: Asset } | { ok: false; reason: 'not_found' };

/**
 * Writes an already-computed wear assessment (see `previewAssetWear`) together with the
 * asset's new status, in one audited update. `status` is `'returned'` for a normal return
 * (into the refurbishment queue) or `'available'` for `pass_on` (good enough to skip it).
 */
export async function writeAssetWear(
  db: PrismaClient,
  input: {
    id: string;
    status: 'returned' | 'available';
    wear: WearResult;
    monthsLeased: number;
    actor: string;
  }
): Promise<WriteAssetWearResult> {
  const existing = await db.asset.findUnique({ where: { id: input.id } });
  if (!existing) return { ok: false, reason: 'not_found' };

  const updated = await withAudit(
    db,
    {
      actor: input.actor,
      action: input.status === 'returned' ? 'asset.returned' : 'asset.passed_on',
      entityType: 'asset',
      entityId: input.id,
      details: {
        status: { from: existing.status, to: input.status },
        condition: { from: existing.condition, to: input.wear.conditionAfter },
        usageValue: { from: existing.usage_value, to: input.wear.usageValueAfter },
        monthsLeased: input.monthsLeased,
      },
    },
    (tx) =>
      tx.asset.update({
        where: { id: input.id },
        data: {
          status: input.status,
          condition: input.wear.conditionAfter,
          usage_value: input.wear.usageValueAfter,
        },
      })
  );
  return { ok: true, asset: toAsset(updated) };
}

export type ReturnAssetResult = { ok: true; asset: Asset } | { ok: false; reason: 'not_found' };

/**
 * An item coming back (CHALLENGE.md Spine #7 / Smart Problem #3's "a returned item has a
 * condition, wear...") is assessed, not just marked `returned` as if the lease never
 * happened. A thin wrapper over `previewAssetWear` + `writeAssetWear` for the common case
 * (an ordinary return, not `pass_on`, which needs to inspect the wear before writing it).
 */
export async function returnAsset(
  db: PrismaClient,
  input: { id: string; category: AssetCategory; monthsLeased: number; actor: string }
): Promise<ReturnAssetResult> {
  const preview = await previewAssetWear(db, input);
  if (!preview.ok) return preview;
  return writeAssetWear(db, { ...input, status: 'returned', wear: preview.wear });
}

/** Inserts assets that are not in the database yet. Never overwrites changes you made. */
export async function seedAssets(
  db: PrismaClient,
  assets: readonly Asset[]
): Promise<{ created: number; skipped: number }> {
  const existing = await db.asset.findMany({ select: { id: true } });
  const existingIds = new Set(existing.map((row) => row.id));
  const missing = assets.filter((asset) => !existingIds.has(asset.id));
  if (missing.length > 0) {
    await db.asset.createMany({ data: missing.map(toAssetRowData) });
  }
  return { created: missing.length, skipped: assets.length - missing.length };
}
