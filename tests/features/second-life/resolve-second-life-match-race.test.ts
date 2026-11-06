// KNOWN_ISSUES.md item 2: committing a second-life match only reopens an asset that is
// still 'returned'. A stale resolution must never flip a newly leased asset back to
// 'available'. Mirrors src/server/features/second-life/resolve-second-life-match.ts.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAssets, loadCustomers } from '@/data/load';
import { seedAssets } from '@/server/assets';
import { seedCustomers } from '@/server/customers';
import { signContract } from '@/server/features/contracts/sign-contract';
import { resolveSecondLifeMatch } from '@/server/features/second-life/resolve-second-life-match';
import { createTestDb } from '../../helpers/test-db';
import type { PrismaClient } from '@/server/prisma-client';

let db: PrismaClient;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  await seedAssets(db, await loadAssets());
  await seedCustomers(db, await loadCustomers());
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.asset.updateMany({
    data: { status: 'available', condition: 'new', usage_value: 0, lifetime_usage_value: 0 },
  });
});

const ASSET = 'ebike-007';

/** A returned, worn item with its last (finished) contract, as in resolve-second-life-match.test.ts. */
async function makeReturned() {
  await db.contract.create({
    data: {
      id: randomUUID(),
      asset_id: ASSET,
      customer_id: 'cust-aino',
      start_date: '2024-11-08',
      term_months: 24,
      price_list_version: 1,
      list_price_cents: 549_000,
      down_payment_cents: 0,
      financed_cents: 549_000,
      monthly_net_rent_cents: 0,
      buyout_cents: 0,
      status: 'returned',
    },
  });
  await db.asset.update({
    where: { id: ASSET },
    data: {
      status: 'returned',
      condition: 'fair',
      usage_value: 18_400,
      lifetime_usage_value: 18_400,
    },
  });
}

describe('resolveSecondLifeMatch — concurrent and stale resolutions', () => {
  it('lets exactly one of two simultaneous resolutions win', async () => {
    await makeReturned();

    const results = await Promise.all([
      resolveSecondLifeMatch(db, ASSET, '2026-11-08'),
      resolveSecondLifeMatch(db, ASSET, '2026-11-08'),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    // The loser either saw 'available' already (not returned) or lost the swap (conflict).
    const loser = results.find((r) => !r.ok);
    expect(['asset_not_returned', 'asset_status_conflict']).toContain(
      loser && !loser.ok ? loser.reason : undefined
    );
    expect(await db.auditLog.count({ where: { action: 'second_life.refurbished' } })).toBe(1);
    expect((await db.asset.findUniqueOrThrow({ where: { id: ASSET } })).status).toBe('available');
  });

  it('does not reopen an asset that was leased after the computation read it', async () => {
    await makeReturned();
    // The resolution's computation still sees 'returned' (its read happened earlier) ...
    const stale = await db.asset.findUniqueOrThrow({ where: { id: ASSET } });
    // ... but by the time it writes, the asset has been leased again.
    await db.asset.update({ where: { id: ASSET }, data: { status: 'reserved' } });
    const before = {
      asset: await db.asset.findUniqueOrThrow({ where: { id: ASSET } }),
      audit: await db.auditLog.count(),
    };
    const spy = vi.spyOn(db.asset, 'findUnique').mockResolvedValueOnce(stale);

    const result = await resolveSecondLifeMatch(db, ASSET, '2026-11-08');
    spy.mockRestore();

    expect(result).toEqual({ ok: false, reason: 'asset_status_conflict' });
    const after = await db.asset.findUniqueOrThrow({ where: { id: ASSET } });
    expect(after).toEqual(before.asset); // still reserved, condition and usage untouched
    expect(after.status).toBe('reserved');
    expect(await db.auditLog.count()).toBe(before.audit);
  });

  it('cannot be used to double-book: a signing after a stale resolution still wins alone', async () => {
    await makeReturned();
    const resolved = await resolveSecondLifeMatch(db, ASSET, '2026-11-08');
    expect(resolved.ok).toBe(true);

    const signed = await signContract(db, {
      assetId: ASSET,
      customerId: 'cust-mikko',
      termMonths: 24,
      downPaymentCents: 0,
      signDate: '2026-11-08',
    });
    expect(signed.ok).toBe(true);

    // A late duplicate resolution now finds a leased asset and changes nothing.
    const late = await resolveSecondLifeMatch(db, ASSET, '2026-11-08');
    expect(late).toEqual({ ok: false, reason: 'asset_not_returned' });
    expect((await db.asset.findUniqueOrThrow({ where: { id: ASSET } })).status).toBe('reserved');
  });
});
