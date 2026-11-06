// KNOWN_ISSUES.md item 2: an early exit settles the contract and moves its asset in one
// atomic step. Of simultaneous exits exactly one wins; an exit whose asset changed
// underneath it commits nothing. Mirrors src/server/features/early-exit/resolve-early-exit.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAssets, loadCustomers } from '@/data/load';
import { seedAssets } from '@/server/assets';
import { seedCustomers } from '@/server/customers';
import { issueDueInvoices } from '@/server/features/contracts/issue-invoices';
import { signContract } from '@/server/features/contracts/sign-contract';
import { resolveContractEarlyExit } from '@/server/features/early-exit/resolve-early-exit';
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
  // Counts below are absolute, so every test starts from no contracts, invoices or audit rows.
  await db.invoice.deleteMany();
  await db.customerCredit.deleteMany();
  await db.contract.deleteMany();
  await db.auditLog.deleteMany();
  await db.asset.updateMany({
    data: { status: 'available', condition: 'new', usage_value: 0, lifetime_usage_value: 0 },
  });
});

const ASSET = 'ebike-003';
const MONTH_7 = '2027-06-05'; // 7 months into a 36-month lease signed 2026-11-05

async function signLease() {
  const signed = await signContract(db, {
    assetId: ASSET,
    customerId: 'cust-aino',
    termMonths: 36,
    downPaymentCents: 0,
    signDate: '2026-11-05',
  });
  if (!signed.ok) throw new Error('setup: signing failed');
  // Rent invoices up to month 7 exist, so a return has some to cancel.
  await issueDueInvoices(db, signed.contract.id, MONTH_7);
  return signed.contract;
}

function exit(contractId: string, action: 'buy' | 'return') {
  return resolveContractEarlyExit(db, { contractId, action, asOfDate: MONTH_7 });
}

async function snapshot() {
  return {
    contracts: await db.contract.findMany({ orderBy: { id: 'asc' } }),
    asset: await db.asset.findUniqueOrThrow({ where: { id: ASSET } }),
    invoices: await db.invoice.findMany({ orderBy: { id: 'asc' } }),
    audit: await db.auditLog.count(),
  };
}

describe('resolveContractEarlyExit — concurrent exits from one contract', () => {
  it('lets exactly one of two simultaneous early buyouts win', async () => {
    const contract = await signLease();
    const auditBefore = await db.auditLog.count();

    const results = await Promise.all([exit(contract.id, 'buy'), exit(contract.id, 'buy')]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, reason: 'contract_already_settled' },
    ]);
    expect((await db.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe(
      'bought'
    );
    expect((await db.asset.findUniqueOrThrow({ where: { id: ASSET } })).status).toBe('sold');
    expect(await db.auditLog.count()).toBe(auditBefore + 2); // bought_early + status_changed
  });

  it('charges the fee and assesses the wear once when two early returns race', async () => {
    const contract = await signLease();

    const results = await Promise.all([exit(contract.id, 'return'), exit(contract.id, 'return')]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await db.invoice.count({ where: { kind: 'early_return_fee' } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'contract.returned_early' } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'asset.returned' } })).toBe(1);
    const asset = await db.asset.findUniqueOrThrow({ where: { id: ASSET } });
    expect(asset.status).toBe('returned');
    expect(asset.usage_value).toBe(2_800); // 7 months x 400 km, not doubled
  });

  it('lets exactly one of an early buyout and an early return racing win', async () => {
    const contract = await signLease();

    const results = await Promise.all([exit(contract.id, 'buy'), exit(contract.id, 'return')]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const status = (await db.contract.findUniqueOrThrow({ where: { id: contract.id } })).status;
    const assetStatus = (await db.asset.findUniqueOrThrow({ where: { id: ASSET } })).status;
    expect([status, assetStatus]).toEqual(
      status === 'bought' ? ['bought', 'sold'] : ['returned', 'returned']
    );
  });
});

describe('resolveContractEarlyExit — asset changed underneath the exit', () => {
  // The bug this guards: the buyout committed `bought` and ignored the failed asset
  // transition, answering success while the asset stayed 'available'.
  it.each(['buy', 'return'] as const)(
    'rolls an early %s back and answers asset_status_conflict',
    async (action) => {
      const contract = await signLease();
      await db.asset.update({ where: { id: ASSET }, data: { status: 'available' } });
      const before = await snapshot();

      expect(await exit(contract.id, action)).toEqual({
        ok: false,
        reason: 'asset_status_conflict',
      });

      // Nothing moved: contract still active, no fee invoice, nothing cancelled, no audit.
      expect(await snapshot()).toEqual(before);
      expect((await db.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe(
        'active'
      );
      expect(await db.invoice.count({ where: { status: 'cancelled' } })).toBe(0);
    }
  );
});

describe('resolveContractEarlyExit — stale read of an already settled contract', () => {
  // A stale read stands in for the loser of a real race, which read 'active' before the
  // winner committed, so only the in-transaction swap can stop it.
  it.each(['buy', 'return'] as const)(
    'a stale early %s changes nothing and answers contract_already_settled',
    async (action) => {
      const contract = await signLease();
      const stale = await db.contract.findUniqueOrThrow({ where: { id: contract.id } });
      expect(await exit(contract.id, 'return')).toMatchObject({ ok: true });
      const before = await snapshot();
      const spy = vi.spyOn(db.contract, 'findUnique').mockResolvedValueOnce(stale);

      const result = await exit(contract.id, action);
      spy.mockRestore();

      expect(result).toEqual({ ok: false, reason: 'contract_already_settled' });
      expect(await snapshot()).toEqual(before);
    }
  );
});
