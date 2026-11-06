// Two usage counters (KNOWN_ISSUES.md item 5): `usage_value` (since the last resets_usage
// refurbishment) and `lifetime_usage_value` (never reset). Real migrated SQLite database.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAssets } from '@/data/load';
import { createTestDb } from '../../tests/helpers/test-db';
import { previewAssetWear, seedAssets, writeAssetWear } from './assets';
import type { PrismaClient } from './prisma-client';

let db: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.auditLog.deleteMany();
  await db.asset.deleteMany();
  await seedAssets(db, await loadAssets());
});

describe('lifetime_usage_value', () => {
  it('is seeded equal to the data pack usage for every asset', async () => {
    const rows = await db.asset.findMany();
    expect(rows).toHaveLength(31);
    for (const row of rows) expect(row.lifetime_usage_value).toBe(row.usage_value);
  });

  it('grows with wear by the same amount as usage_value and is audited', async () => {
    const before = await db.asset.findUniqueOrThrow({ where: { id: 'ebike-007' } });
    const preview = await previewAssetWear(db, {
      id: 'ebike-007',
      category: 'e_bike',
      monthsLeased: 10, // +4000 km
    });
    if (!preview.ok) throw new Error('asset missing');
    await writeAssetWear(db, {
      id: 'ebike-007',
      status: 'returned',
      wear: preview.wear,
      monthsLeased: 10,
      actor: 'test',
    });

    const after = await db.asset.findUniqueOrThrow({ where: { id: 'ebike-007' } });
    expect(after.usage_value).toBe(before.usage_value + 4_000);
    expect(after.lifetime_usage_value).toBe(before.lifetime_usage_value + 4_000);

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'asset.returned' } });
    expect(JSON.parse(audit.details_json!).lifetimeUsageValue).toEqual({
      from: before.lifetime_usage_value,
      to: before.lifetime_usage_value + 4_000,
    });
  });

  it('keeps counting from lifetime, not usage_value, after a reset', async () => {
    // Simulate a battery replacement that already zeroed the since-reset counter.
    await db.asset.update({
      where: { id: 'ebike-007' },
      data: { usage_value: 0, lifetime_usage_value: 18_400 },
    });
    const preview = await previewAssetWear(db, {
      id: 'ebike-007',
      category: 'e_bike',
      monthsLeased: 12, // +4800 km
    });
    if (!preview.ok) throw new Error('asset missing');
    await writeAssetWear(db, {
      id: 'ebike-007',
      status: 'returned',
      wear: preview.wear,
      monthsLeased: 12,
      actor: 'test',
    });

    const after = await db.asset.findUniqueOrThrow({ where: { id: 'ebike-007' } });
    expect(after.usage_value).toBe(4_800);
    expect(after.lifetime_usage_value).toBe(23_200);
  });
});
