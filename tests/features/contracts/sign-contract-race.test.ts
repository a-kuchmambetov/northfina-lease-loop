// KNOWN_ISSUES.md item 2: two direct signings (no applicationId) of the same asset must
// not both win. Mirrors src/server/features/contracts/sign-contract.ts.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadAssets, loadCustomers } from '@/data/load';
import { seedAssets } from '@/server/assets';
import { addCustomerCreditEntry, getCustomerCreditBalanceCents } from '@/server/customer-credit';
import { seedCustomers } from '@/server/customers';
import { signContract } from '@/server/features/contracts/sign-contract';
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

const base = { termMonths: 24, downPaymentCents: 0, signDate: '2026-11-05' };

describe('signContract — concurrent reservation of one asset', () => {
  it('lets exactly one of two simultaneous signings win', async () => {
    const results = await Promise.all([
      signContract(db, { ...base, assetId: 'ebike-005', customerId: 'cust-aino' }),
      signContract(db, { ...base, assetId: 'ebike-005', customerId: 'cust-mikko' }),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: 'asset_not_available' }]);
    expect(await db.contract.count({ where: { asset_id: 'ebike-005' } })).toBe(1);
    expect((await db.asset.findUniqueOrThrow({ where: { id: 'ebike-005' } })).status).toBe(
      'reserved'
    );
    expect(await db.auditLog.count({ where: { action: 'contract.signed' } })).toBe(1);
    expect(
      await db.auditLog.count({ where: { action: 'asset.status_changed', entity_id: 'ebike-005' } })
    ).toBe(1);
  });

  it('lets exactly one of many simultaneous signings win', async () => {
    const customers = ['cust-aino', 'cust-mikko', 'cust-sanna', 'cust-haapala'];
    const results = await Promise.all(
      customers.map((customerId) =>
        signContract(db, { ...base, assetId: 'laptop-001', customerId })
      )
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await db.contract.count({ where: { asset_id: 'laptop-001' } })).toBe(1);
  });

  it('commits nothing when the reservation is lost after the early availability check', async () => {
    await addCustomerCreditEntry(db, {
      customerId: 'cust-haapala',
      amountCents: 10_000,
      reason: 'pass_on_bonus',
      actor: 'system',
    });
    const auditBefore = await db.auditLog.count();
    const contractsBefore = await db.contract.count();

    // The loser's first look still sees 'available' (as in a real race), but by the time
    // its transaction runs, someone else has taken the asset.
    const stale = await db.asset.findUniqueOrThrow({ where: { id: 'ebike-004' } });
    await db.asset.update({ where: { id: 'ebike-004' }, data: { status: 'reserved' } });
    const spy = vi.spyOn(db.asset, 'findUnique').mockResolvedValueOnce(stale);
    const auditAfterTakeover = await db.auditLog.count();

    const result = await signContract(db, {
      ...base,
      assetId: 'ebike-004',
      customerId: 'cust-haapala',
      creditCentsToApply: 4_000,
    });
    spy.mockRestore();

    expect(result).toEqual({ ok: false, reason: 'asset_not_available' });
    expect(await db.contract.count()).toBe(contractsBefore);
    expect(await db.contract.count({ where: { asset_id: 'ebike-004' } })).toBe(0);
    expect(await getCustomerCreditBalanceCents(db, 'cust-haapala')).toBe(10_000);
    expect(await db.customerCredit.count({ where: { reason: 'applied_to_down_payment' } })).toBe(0);
    expect(await db.auditLog.count()).toBe(auditAfterTakeover);
    expect(auditAfterTakeover).toBe(auditBefore);
    expect((await db.asset.findUniqueOrThrow({ where: { id: 'ebike-004' } })).status).toBe(
      'reserved'
    );
  });
});
