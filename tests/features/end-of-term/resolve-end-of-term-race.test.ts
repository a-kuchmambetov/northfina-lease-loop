// KNOWN_ISSUES.md item 2: settling a contract and moving its asset is one atomic step.
// Of simultaneous settlements exactly one wins; a settlement whose asset changed underneath
// it commits nothing at all. Mirrors src/server/features/end-of-term/resolve-end-of-term.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAssets, loadCustomers } from '@/data/load';
import { seedAssets } from '@/server/assets';
import { getCustomerCreditBalanceCents } from '@/server/customer-credit';
import { seedCustomers } from '@/server/customers';
import { signContract } from '@/server/features/contracts/sign-contract';
import { resolveContractEndOfTerm } from '@/server/features/end-of-term/resolve-end-of-term';
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
const TERM_END = '2027-11-05'; // a 12-month lease signed 2026-11-05

async function signShortContract() {
  const signed = await signContract(db, {
    assetId: ASSET,
    customerId: 'cust-aino',
    termMonths: 12,
    downPaymentCents: 0,
    signDate: '2026-11-05',
  });
  if (!signed.ok) throw new Error('setup: signing failed');
  return signed.contract;
}

function settle(contractId: string, action: 'buy' | 'return' | 'extend' | 'pass_on') {
  return resolveContractEndOfTerm(db, {
    contractId,
    action,
    asOfDate: TERM_END,
    additionalTermMonths: action === 'extend' ? 12 : undefined,
    nextCustomerId: action === 'pass_on' ? 'cust-pekka' : undefined,
    nextTermMonths: action === 'pass_on' ? 24 : undefined,
  });
}

/** Everything a settlement could write, for "nothing changed" comparisons. */
async function snapshot() {
  return {
    contracts: await db.contract.findMany({ orderBy: { id: 'asc' } }),
    asset: await db.asset.findUniqueOrThrow({ where: { id: ASSET } }),
    audit: await db.auditLog.count(),
    credit: await db.customerCredit.count(),
    invoices: await db.invoice.count(),
  };
}

describe('resolveContractEndOfTerm — concurrent settlements of one contract', () => {
  it('lets exactly one of two simultaneous buyouts win', async () => {
    const contract = await signShortContract();
    const auditBefore = await db.auditLog.count();

    const results = await Promise.all([settle(contract.id, 'buy'), settle(contract.id, 'buy')]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, reason: 'contract_already_settled' },
    ]);
    expect((await db.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe(
      'bought'
    );
    expect((await db.asset.findUniqueOrThrow({ where: { id: ASSET } })).status).toBe('sold');
    // One contract.bought + one asset.status_changed; the loser wrote nothing.
    expect(await db.auditLog.count()).toBe(auditBefore + 2);
  });

  it('lets exactly one of a buyout and a return racing for the same contract win', async () => {
    const contract = await signShortContract();

    const results = await Promise.all([settle(contract.id, 'buy'), settle(contract.id, 'return')]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const status = (await db.contract.findUniqueOrThrow({ where: { id: contract.id } })).status;
    const assetStatus = (await db.asset.findUniqueOrThrow({ where: { id: ASSET } })).status;
    expect([status, assetStatus]).toEqual(
      status === 'bought' ? ['bought', 'sold'] : ['returned', 'returned']
    );
  });

  it('assesses the wear once when two returns race', async () => {
    const contract = await signShortContract();

    const results = await Promise.all([
      settle(contract.id, 'return'),
      settle(contract.id, 'return'),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const asset = await db.asset.findUniqueOrThrow({ where: { id: ASSET } });
    expect(asset.usage_value).toBe(4_800); // 12 months x 400 km, not doubled
    expect(await db.auditLog.count({ where: { action: 'asset.returned' } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'contract.returned' } })).toBe(1);
  });

  it('creates exactly one renewal when two extensions race', async () => {
    const contract = await signShortContract();

    const results = await Promise.all([
      settle(contract.id, 'extend'),
      settle(contract.id, 'extend'),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, reason: 'contract_already_settled' },
    ]);
    const contracts = await db.contract.findMany({ where: { asset_id: ASSET } });
    expect(contracts).toHaveLength(2);
    expect(contracts.filter((c) => c.status === 'active')).toHaveLength(1);
    expect(contracts.filter((c) => c.status === 'extended')).toHaveLength(1);
    expect(await db.auditLog.count({ where: { action: 'contract.renewed' } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'contract.extended' } })).toBe(1);
    const asset = await db.asset.findUniqueOrThrow({ where: { id: ASSET } });
    expect(asset.status).toBe('reserved');
    expect(asset.usage_value).toBe(4_800); // the wear is recorded once
  });

  it('creates exactly one lease and one bonus when two pass-ons race', async () => {
    const contract = await signShortContract();

    const results = await Promise.all([
      settle(contract.id, 'pass_on'),
      settle(contract.id, 'pass_on'),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, reason: 'contract_already_settled' },
    ]);
    expect(await db.contract.count({ where: { asset_id: ASSET, status: 'active' } })).toBe(1);
    expect(await db.contract.count({ where: { asset_id: ASSET } })).toBe(2);
    expect(await db.customerCredit.count({ where: { reason: 'pass_on_bonus' } })).toBe(1);
    const winner = results.find((r) => r.ok);
    if (!winner?.ok || winner.outcome !== 'passed_on') throw new Error('expected a pass_on');
    expect(await getCustomerCreditBalanceCents(db, 'cust-aino')).toBe(winner.bonusCents);
  });

  it('lets exactly one of an extension and a pass-on racing win', async () => {
    const contract = await signShortContract();

    const results = await Promise.all([
      settle(contract.id, 'extend'),
      settle(contract.id, 'pass_on'),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await db.contract.count({ where: { asset_id: ASSET, status: 'active' } })).toBe(1);
    expect(await db.contract.count({ where: { asset_id: ASSET } })).toBe(2);
  });
});

describe('resolveContractEndOfTerm — asset changed underneath the settlement', () => {
  // The bug this guards: the buyout committed `bought` and ignored the failed asset
  // transition, answering success while the asset stayed 'available'.
  it.each(['buy', 'return', 'extend', 'pass_on'] as const)(
    'rolls a %s back and answers asset_status_conflict',
    async (action) => {
      const contract = await signShortContract();
      await db.asset.update({ where: { id: ASSET }, data: { status: 'available' } });
      const before = await snapshot();

      const result = await settle(contract.id, action);

      expect(result).toEqual({ ok: false, reason: 'asset_status_conflict' });
      expect(await snapshot()).toEqual(before);
      expect((await db.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe(
        'active'
      );
    }
  );

  it('settles normally once the asset is back in its leased status', async () => {
    const contract = await signShortContract();
    await db.asset.update({ where: { id: ASSET }, data: { status: 'available' } });
    expect(await settle(contract.id, 'buy')).toEqual({
      ok: false,
      reason: 'asset_status_conflict',
    });

    await db.asset.update({ where: { id: ASSET }, data: { status: 'reserved' } });
    expect(await settle(contract.id, 'buy')).toMatchObject({ ok: true, outcome: 'bought' });
  });
});

describe('resolveContractEndOfTerm — stale read of an already settled contract', () => {
  // The loser of a real race read the contract as 'active' before the winner committed. A
  // stale read stands in for that, so only the in-transaction swap can stop it.
  it.each(['buy', 'return', 'extend', 'pass_on'] as const)(
    'a stale %s changes nothing and answers contract_already_settled',
    async (action) => {
      const contract = await signShortContract();
      const stale = await db.contract.findUniqueOrThrow({ where: { id: contract.id } });
      expect(await settle(contract.id, 'return')).toEqual({ ok: true, outcome: 'returned' });
      const before = await snapshot();
      const spy = vi.spyOn(db.contract, 'findUnique').mockResolvedValueOnce(stale);

      const result = await settle(contract.id, action);
      spy.mockRestore();

      expect(result).toEqual({ ok: false, reason: 'contract_already_settled' });
      expect(await snapshot()).toEqual(before);
    }
  );
});
