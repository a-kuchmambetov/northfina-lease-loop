// Runs against a real, migrated SQLite database (see tests/global-setup.ts).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAssets } from '@/data/load';
import type { Asset } from '@/data/schemas';
import { createTestDb } from '../../tests/helpers/test-db';
import {
  changeAssetStatus,
  listAssets,
  previewAssetWear,
  seedAssets,
  toAsset,
  toAssetRowData,
  transitionAssetStatus,
  writeAssetWear,
  writeAssetWearInTx,
} from './assets';
import type { PrismaClient } from './prisma-client';

let db: PrismaClient;
let cleanup: () => Promise<void>;
let dataPack: Asset[];

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  dataPack = await loadAssets();
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.auditLog.deleteMany();
  await db.asset.deleteMany();
});

describe('seedAssets', () => {
  it('inserts every asset from the data pack once', async () => {
    expect(await seedAssets(db, dataPack)).toEqual({ created: 31, skipped: 0 });
    expect(await seedAssets(db, dataPack)).toEqual({ created: 0, skipped: 31 });
    expect(await db.asset.count()).toBe(31);
  });

  it('does not overwrite a status you changed', async () => {
    await seedAssets(db, dataPack);
    await db.asset.update({ where: { id: 'ebike-001' }, data: { status: 'reserved' } });
    await seedAssets(db, dataPack);
    expect((await db.asset.findUniqueOrThrow({ where: { id: 'ebike-001' } })).status).toBe(
      'reserved'
    );
  });
});

describe('listAssets', () => {
  it('returns assets in the data-pack shape, round-tripping exactly', async () => {
    await seedAssets(db, dataPack);
    const assets = await listAssets(db);
    expect(assets).toEqual([...dataPack].sort((a, b) => a.id.localeCompare(b.id)));
  });

  it('filters by category', async () => {
    await seedAssets(db, dataPack);
    const laptops = await listAssets(db, { category: 'laptop' });
    expect(laptops).toHaveLength(10);
    expect(laptops.every((asset) => asset.category === 'laptop')).toBe(true);
  });
});

describe('changeAssetStatus', () => {
  it('updates the status and writes an audit row with from and to', async () => {
    await seedAssets(db, dataPack);

    const result = await changeAssetStatus(db, {
      id: 'ebike-001',
      status: 'reserved',
      actor: 'team-test',
    });

    expect(result).toMatchObject({ ok: true, asset: { id: 'ebike-001', status: 'reserved' } });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'asset.status_changed' } });
    expect(audit).toMatchObject({ action: 'asset.status_changed', entity_id: 'ebike-001' });
    expect(JSON.parse(audit.details_json ?? '')).toEqual({ from: 'available', to: 'reserved' });
  });

  it('answers not_found for an unknown id and writes nothing', async () => {
    const result = await changeAssetStatus(db, { id: 'nope', status: 'reserved', actor: 'x' });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(await db.auditLog.count()).toBe(0);
  });
});

describe('changeAssetStatus — races', () => {
  it('refuses when expectedStatus does not match, writing nothing', async () => {
    await seedAssets(db, dataPack);
    await db.asset.update({ where: { id: 'ebike-001' }, data: { status: 'reserved' } });
    const auditBefore = await db.auditLog.count();

    const result = await changeAssetStatus(db, {
      id: 'ebike-001',
      status: 'reserved',
      expectedStatus: 'available',
      actor: 'x',
    });

    expect(result).toEqual({ ok: false, reason: 'status_conflict' });
    expect(await db.auditLog.count()).toBe(auditBefore);
  });

  it('lets exactly one of two concurrent reservations of the same asset win', async () => {
    await seedAssets(db, dataPack);
    const reserve = (actor: string) =>
      changeAssetStatus(db, {
        id: 'ebike-002',
        status: 'reserved',
        expectedStatus: 'available',
        actor,
      });

    const results = await Promise.all([reserve('a'), reserve('b')]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: 'status_conflict' }]);
    expect(
      await db.auditLog.count({ where: { action: 'asset.status_changed', entity_id: 'ebike-002' } })
    ).toBe(1);
  });

  it('does not overwrite or audit a change that lands between the read and the write', async () => {
    await seedAssets(db, dataPack);
    const stale = await db.asset.findUniqueOrThrow({ where: { id: 'ebike-003' } });
    await db.asset.update({ where: { id: 'ebike-003' }, data: { status: 'sold' } });
    const spy = vi.spyOn(db.asset, 'findUnique').mockResolvedValueOnce(stale);
    const auditBefore = await db.auditLog.count();

    const result = await changeAssetStatus(db, { id: 'ebike-003', status: 'reserved', actor: 'x' });
    spy.mockRestore();

    expect(result).toEqual({ ok: false, reason: 'status_conflict' });
    expect((await db.asset.findUniqueOrThrow({ where: { id: 'ebike-003' } })).status).toBe('sold');
    expect(await db.auditLog.count()).toBe(auditBefore);
  });
});

describe('transitionAssetStatus', () => {
  it('swaps from → to and audits, but only when the asset is in `from`', async () => {
    await seedAssets(db, dataPack);
    const input = { id: 'ebike-004', from: 'available', to: 'reserved', actor: 'x' } as const;

    expect(await db.$transaction((tx) => transitionAssetStatus(tx, input))).toEqual({ ok: true });
    expect(await db.$transaction((tx) => transitionAssetStatus(tx, input))).toEqual({
      ok: false,
      reason: 'status_conflict',
    });
    expect(
      await db.$transaction((tx) => transitionAssetStatus(tx, { ...input, id: 'nope' }))
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(
      await db.auditLog.count({ where: { action: 'asset.status_changed', entity_id: 'ebike-004' } })
    ).toBe(1);
  });
});

describe('writeAssetWear — expectedStatus guard', () => {
  async function input(status: 'returned' | 'reserved') {
    await seedAssets(db, dataPack);
    const preview = await previewAssetWear(db, {
      id: 'ebike-004',
      category: 'e_bike',
      monthsLeased: 12,
    });
    if (!preview.ok) throw new Error('setup: asset missing');
    return { id: 'ebike-004', status, wear: preview.wear, monthsLeased: 12, actor: 'x' } as const;
  }

  it('writes the wear when the asset is in the expected status', async () => {
    const wearInput = await input('returned');
    await db.asset.update({ where: { id: 'ebike-004' }, data: { status: 'reserved' } });

    const result = await writeAssetWear(db, { ...wearInput, expectedStatus: 'reserved' });

    expect(result.ok).toBe(true);
    const row = await db.asset.findUniqueOrThrow({ where: { id: 'ebike-004' } });
    expect(row.status).toBe('returned');
    expect(await db.auditLog.count({ where: { action: 'asset.returned' } })).toBe(1);
  });

  it('answers status_conflict and writes nothing when the asset is in another status', async () => {
    const wearInput = await input('returned'); // ebike-004 is 'available' in the data pack
    const before = await db.asset.findUniqueOrThrow({ where: { id: 'ebike-004' } });
    const auditBefore = await db.auditLog.count();

    const result = await writeAssetWear(db, { ...wearInput, expectedStatus: 'reserved' });

    expect(result).toEqual({ ok: false, reason: 'status_conflict' });
    expect(await db.asset.findUniqueOrThrow({ where: { id: 'ebike-004' } })).toEqual(before);
    expect(await db.auditLog.count()).toBe(auditBefore);
  });

  it('answers not_found for a missing asset', async () => {
    const wearInput = await input('returned');
    expect(
      await db.$transaction((tx) => writeAssetWearInTx(tx, { ...wearInput, id: 'nope' }))
    ).toEqual({ ok: false, reason: 'not_found' });
  });

  it('loses cleanly when the status changes between its read and its write', async () => {
    const wearInput = await input('returned');
    await db.asset.update({ where: { id: 'ebike-004' }, data: { status: 'reserved' } });
    const auditBefore = await db.auditLog.count();

    // Another request flips the asset right after this one has read it.
    const result = await db.$transaction(async (tx) => {
      // The wear write sees 'reserved' on its read, then the swap meets 'sold'.
      const seen = await tx.asset.findUniqueOrThrow({ where: { id: 'ebike-004' } });
      vi.spyOn(tx.asset, 'findUnique').mockImplementationOnce((async () => {
        await db.asset.update({ where: { id: 'ebike-004' }, data: { status: 'sold' } });
        return seen;
      }) as never);
      return writeAssetWearInTx(tx, { ...wearInput, expectedStatus: 'reserved' });
    });

    expect(result).toEqual({ ok: false, reason: 'status_conflict' });
    expect((await db.asset.findUniqueOrThrow({ where: { id: 'ebike-004' } })).status).toBe('sold');
    expect(await db.auditLog.count()).toBe(auditBefore);
  });
});

describe('toAsset', () => {
  it('rejects a row with a value the schema does not allow', () => {
    const [first] = dataPack;
    if (!first) throw new Error('empty data pack');
    const row = {
      ...toAssetRowData(first),
      status: 'stolen',
      created_at: new Date(),
      updated_at: new Date(),
    };
    expect(() => toAsset(row)).toThrow();
  });
});
