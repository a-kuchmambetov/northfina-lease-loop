// Reading and changing assets in the database. Rows are converted to the same `Asset`
// shape as data/assets.json, so the UI and domain code see one type everywhere.
import type { Asset as AssetRow, PrismaClient } from '@/generated/prisma/client';
import { assetSchema, type Asset, type AssetCategory, type AssetStatus } from '@/data/schemas';
import { assessWearAfterLease, type WearResult } from '@/domain/wear';
import { withAudit, writeAuditEntry, type TransactionClient } from './audit';

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
    // A fresh item has no reset history, so both counters start equal.
    lifetime_usage_value: asset.usage.value,
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
  { ok: true; asset: Asset } | { ok: false; reason: 'not_found' | 'status_conflict' };

/** Thrown inside a transaction to roll it back when the asset was no longer in the expected status. */
export class AssetStatusConflictError extends Error {
  constructor(readonly assetId: string) {
    super(`Asset ${assetId} is no longer in the expected status`);
    this.name = 'AssetStatusConflictError';
  }
}

export type TransitionAssetStatusResult =
  { ok: true } | { ok: false; reason: 'not_found' | 'status_conflict' };

/**
 * Atomic compare-and-swap on an asset's status, for use inside a transaction (`tx` from
 * `withAudit`): moves the asset `from` → `to` only if it is still in `from` when the write
 * lands, and writes `asset.status_changed` in the same transaction. One `updateMany` with
 * the status in its `where` is the whole check — there is no read-then-write gap for a
 * concurrent request to slip through, unlike a `findUnique` followed by `update`.
 */
export async function transitionAssetStatus(
  tx: TransactionClient,
  input: { id: string; from: AssetStatus; to: AssetStatus; actor: string }
): Promise<TransitionAssetStatusResult> {
  const { count } = await tx.asset.updateMany({
    where: { id: input.id, status: input.from },
    data: { status: input.to },
  });
  if (count !== 1) {
    const exists = (await tx.asset.count({ where: { id: input.id } })) > 0;
    return { ok: false, reason: exists ? 'status_conflict' : 'not_found' };
  }
  await tx.auditLog.create({
    data: {
      actor: input.actor,
      action: 'asset.status_changed',
      entity_type: 'asset',
      entity_id: input.id,
      details_json: JSON.stringify({ from: input.from, to: input.to }),
    },
  });
  return { ok: true };
}

/**
 * Sets an asset's status and writes `asset.status_changed` to the audit log, atomically.
 * The write is a compare-and-swap against the status read first: if another request
 * changed the asset in between, nothing is written and the answer is `status_conflict`.
 * Pass `expectedStatus` to also insist on a particular current status (e.g. `'available'`
 * to reserve), answering `status_conflict` if the asset is in any other.
 */
export async function changeAssetStatus(
  db: PrismaClient,
  input: { id: string; status: AssetStatus; actor: string; expectedStatus?: AssetStatus }
): Promise<ChangeAssetStatusResult> {
  const existing = await db.asset.findUnique({ where: { id: input.id } });
  if (!existing) return { ok: false, reason: 'not_found' };
  if (input.expectedStatus && existing.status !== input.expectedStatus) {
    return { ok: false, reason: 'status_conflict' };
  }

  try {
    const updated = await withAudit(
      db,
      {
        actor: input.actor,
        action: 'asset.status_changed',
        entityType: 'asset',
        entityId: input.id,
        details: { from: existing.status, to: input.status },
      },
      async (tx) => {
        const { count } = await tx.asset.updateMany({
          where: { id: input.id, status: existing.status },
          data: { status: input.status },
        });
        if (count !== 1) throw new AssetStatusConflictError(input.id);
        return tx.asset.findUniqueOrThrow({ where: { id: input.id } });
      }
    );
    return { ok: true, asset: toAsset(updated) };
  } catch (error) {
    if (error instanceof AssetStatusConflictError) return { ok: false, reason: 'status_conflict' };
    throw error;
  }
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
    lifetimeUsageValueBefore: existing.lifetime_usage_value,
    monthsLeased: input.monthsLeased,
  });
  return { ok: true, wear };
}

export type WriteAssetWearResult =
  { ok: true; asset: Asset } | { ok: false; reason: 'not_found' | 'status_conflict' };

const WEAR_AUDIT_ACTION: Record<'returned' | 'available' | 'reserved', string> = {
  returned: 'asset.returned',
  available: 'asset.passed_on',
  // The lease continues (e.g. an end-of-term extend) — the item isn't coming back, but it
  // has genuinely aged, so its record has to say so.
  reserved: 'asset.wear_updated',
};

export type WriteAssetWearInput = {
  id: string;
  status: 'returned' | 'available' | 'reserved';
  wear: WearResult;
  monthsLeased: number;
  actor: string;
  /** Only write if the asset is still in this status (e.g. `'reserved'` while it is
   *  leased out); otherwise nothing is written and the answer is `status_conflict`. */
  expectedStatus?: AssetStatus;
};

/**
 * `writeAssetWear` inside a transaction the caller already has, so the wear and the new
 * status commit or roll back together with the caller's other writes (e.g. settling the
 * contract). The write is a compare-and-swap on the status that was read, and with
 * `expectedStatus` also on the status the caller requires: a lost race answers
 * `status_conflict` and writes nothing (the caller should then roll its transaction back).
 */
export async function writeAssetWearInTx(
  tx: TransactionClient,
  input: WriteAssetWearInput
): Promise<WriteAssetWearResult> {
  const existing = await tx.asset.findUnique({ where: { id: input.id } });
  if (!existing) return { ok: false, reason: 'not_found' };
  if (input.expectedStatus && existing.status !== input.expectedStatus) {
    return { ok: false, reason: 'status_conflict' };
  }

  const { count } = await tx.asset.updateMany({
    where: { id: input.id, status: existing.status },
    data: {
      status: input.status,
      condition: input.wear.conditionAfter,
      usage_value: input.wear.usageValueAfter,
      lifetime_usage_value: input.wear.lifetimeUsageValueAfter,
    },
  });
  if (count !== 1) return { ok: false, reason: 'status_conflict' };

  await writeAuditEntry(tx, {
    actor: input.actor,
    action: WEAR_AUDIT_ACTION[input.status],
    entityType: 'asset',
    entityId: input.id,
    details: {
      status: { from: existing.status, to: input.status },
      condition: { from: existing.condition, to: input.wear.conditionAfter },
      usageValue: { from: existing.usage_value, to: input.wear.usageValueAfter },
      lifetimeUsageValue: {
        from: existing.lifetime_usage_value,
        to: input.wear.lifetimeUsageValueAfter,
      },
      monthsLeased: input.monthsLeased,
    },
  });
  return {
    ok: true,
    asset: toAsset(await tx.asset.findUniqueOrThrow({ where: { id: input.id } })),
  };
}

/**
 * Writes an already-computed wear assessment (see `previewAssetWear`) together with the
 * asset's new status, in one audited update. `status` is `'returned'` for a normal return
 * (into the refurbishment queue), `'available'` for `pass_on` (good enough to skip it), or
 * `'reserved'` when the item stays leased but its wear still needs recording (an extend).
 * Pass `expectedStatus` to make it a guarded transition. Callers that also change other
 * rows (a contract settlement) must use `writeAssetWearInTx` in that same transaction.
 */
export async function writeAssetWear(
  db: PrismaClient,
  input: WriteAssetWearInput
): Promise<WriteAssetWearResult> {
  return db.$transaction((tx) => writeAssetWearInTx(tx, input));
}

export type ReturnAssetResult = WriteAssetWearResult;

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
    await withAudit(
      db,
      {
        actor: 'system',
        action: 'asset.seeded',
        entityType: 'asset',
        entityId: 'data-pack',
        details: { ids: missing.map((asset) => asset.id) },
      },
      (tx) => tx.asset.createMany({ data: missing.map(toAssetRowData) })
    );
  }
  return { created: missing.length, skipped: assets.length - missing.length };
}
