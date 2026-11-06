import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '@/server/auth';
import { loadAssets } from '@/data/load';
import { suppliesAsset } from '@/domain/catalogue';
import { seedAssets } from '@/server/assets';
import { createTestDb } from './helpers/test-db';
import { seedAccounts } from '../prisma/seed-accounts';

describe('seed accounts', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    testDb = await createTestDb();
  });
  afterAll(async () => {
    await testDb.cleanup();
  });

  it('creates usable accounts and supplier inventory, and preserves them on rerun', async () => {
    const { db } = testDb;
    await seedAssets(db, await loadAssets());
    const created = await seedAccounts(db);
    expect(created).toHaveLength(2);
    const auth = createAuth(db, {
      baseURL: 'http://localhost:3000',
      secret: 'test-secret-for-auth-integration-only-12345',
    });
    for (const credentials of created) {
      const result = await auth.api.signInEmail({ body: credentials });
      expect(result.user.email).toBe(credentials.email);
    }
    const supplier = await db.user.findUniqueOrThrow({ where: { email: 'supplier@example.com' } });
    expect(supplier.accountType).toBe('supplier');
    expect(
      (await db.asset.findMany()).filter((asset) => suppliesAsset(supplier.name, asset.make)).length
    ).toBeGreaterThan(0);
    expect(
      (await db.user.findUniqueOrThrow({ where: { email: 'customer@example.com' } })).accountType
    ).toBe('customer');
    expect(await seedAccounts(db)).toEqual([]);
    expect(await db.user.count()).toBe(2);
    expect(await db.auditLog.count({ where: { action: 'auth.seeded' } })).toBe(2);
    expect(JSON.stringify(await db.auditLog.findMany())).not.toContain(created[0]!.password);
  });
});
