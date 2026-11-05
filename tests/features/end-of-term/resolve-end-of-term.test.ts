// Mirrors src/server/features/end-of-term/resolve-end-of-term.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
// Runs against the real data pack and a real, migrated SQLite database.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAssets } from '@/data/load';
import { resolveContractEndOfTerm } from '@/server/features/end-of-term/resolve-end-of-term';
import { signContract } from '@/server/features/contracts/sign-contract';
import { issueDueInvoices } from '@/server/features/contracts/issue-invoices';
import { seedAssets } from '@/server/assets';
import { createTestDb } from '../../helpers/test-db';
import type { PrismaClient } from '@/server/prisma-client';

let db: PrismaClient;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  await seedAssets(db, await loadAssets());
});
afterAll(async () => {
  await cleanup();
});

// The shortest term the coefficient table has (data/coefficient-table.json only has
// 12/24/36/48). Its term ends 2026-11-05 + 12 months = 2027-11-05.
async function signShortContract() {
  const signed = await signContract(db, {
    assetId: 'ebike-003',
    customerId: 'cust-aino',
    termMonths: 12,
    downPaymentCents: 0,
    signDate: '2026-11-05',
  });
  if (!signed.ok) throw new Error('setup: signing failed');
  return signed.contract;
}

describe('resolveContractEndOfTerm', () => {
  it('buys the item for the locked buyout once the term is over', async () => {
    const contract = await signShortContract();

    const result = await resolveContractEndOfTerm(db, {
      contractId: contract.id,
      action: 'buy',
      asOfDate: '2027-11-05',
    });
    expect(result).toEqual({ ok: true, outcome: 'bought', amountCents: contract.buyoutCents });

    const row = await db.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(row.status).toBe('bought');
  });

  it('returns the item and makes the asset available again', async () => {
    const contract = await signShortContract();

    const result = await resolveContractEndOfTerm(db, {
      contractId: contract.id,
      action: 'return',
      asOfDate: '2027-11-05',
    });
    expect(result).toEqual({ ok: true, outcome: 'returned' });

    const asset = await db.asset.findUniqueOrThrow({ where: { id: contract.assetId } });
    expect(asset.status).toBe('returned');
  });

  it("extends by signing a new contract priced off the item's current residual value", async () => {
    const contract = await signShortContract();

    const result = await resolveContractEndOfTerm(db, {
      contractId: contract.id,
      action: 'extend',
      asOfDate: '2027-11-05',
      additionalTermMonths: 12,
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.outcome !== 'extended') throw new Error('expected an extension');
    expect(result.newContract).toMatchObject({
      assetId: contract.assetId,
      customerId: contract.customerId,
      startDate: '2027-11-05',
      termMonths: 12,
      priceListVersion: 0,
    });
    // The item has depreciated, so the new rent is lower than the original.
    expect(result.newContract.monthlyNetRentCents).toBeLessThan(contract.monthlyNetRentCents);

    const oldRow = await db.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(oldRow.status).toBe('extended');

    const newRow = await db.contract.findUniqueOrThrow({ where: { id: result.newContract.id } });
    expect(newRow.status).toBe('active');
  });

  it('rejects an extension with no additionalTermMonths', async () => {
    const contract = await signShortContract();

    const result = await resolveContractEndOfTerm(db, {
      contractId: contract.id,
      action: 'extend',
      asOfDate: '2027-11-05',
    });
    expect(result).toEqual({ ok: false, reason: 'extension_must_be_a_positive_whole_number' });
  });

  it('rejects settling the term before it has actually ended', async () => {
    const signed = await signContract(db, {
      assetId: 'ebike-003',
      customerId: 'cust-aino',
      termMonths: 36,
      downPaymentCents: 0,
      signDate: '2026-11-05',
    });
    if (!signed.ok) throw new Error('setup: signing failed');

    const result = await resolveContractEndOfTerm(db, {
      contractId: signed.contract.id,
      action: 'buy',
      asOfDate: '2026-12-05',
    });
    expect(result).toEqual({ ok: false, reason: 'term_not_finished' });
  });

  it('rejects settling a contract twice', async () => {
    const contract = await signShortContract();
    await resolveContractEndOfTerm(db, {
      contractId: contract.id,
      action: 'buy',
      asOfDate: '2027-11-05',
    });

    const result = await resolveContractEndOfTerm(db, {
      contractId: contract.id,
      action: 'return',
      asOfDate: '2027-11-05',
    });
    expect(result).toEqual({ ok: false, reason: 'contract_already_settled' });
  });

  it('reports a contract that does not exist', async () => {
    const result = await resolveContractEndOfTerm(db, {
      contractId: 'nope',
      action: 'buy',
      asOfDate: '2026-12-05',
    });
    expect(result).toEqual({ ok: false, reason: 'contract_not_found' });
  });

  it('stops issuing new invoices once a contract is bought out', async () => {
    const contract = await signShortContract();
    await resolveContractEndOfTerm(db, {
      contractId: contract.id,
      action: 'buy',
      asOfDate: '2027-11-05',
    });

    const invoices = await issueDueInvoices(db, contract.id, '2028-06-05');
    expect(invoices.ok).toBe(true);
    if (!invoices.ok) return;
    expect(invoices.invoices).toHaveLength(1); // only invoice #1, issued at signing
  });
});
