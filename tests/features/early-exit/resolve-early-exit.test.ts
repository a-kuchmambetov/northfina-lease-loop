// Mirrors src/server/features/early-exit/resolve-early-exit.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
// Runs against the real data pack and a real, migrated SQLite database.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAssets } from '@/data/load';
import { resolveContractEarlyExit } from '@/server/features/early-exit/resolve-early-exit';
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
beforeEach(async () => {
  await db.asset.updateMany({ data: { status: 'available' } });
});

// Scenario card 8: Aino leases ebike-003, 36 months, no down payment, signed 5 Nov 2026,
// ends the lease in month 7.
async function signAinosContract() {
  const signed = await signContract(db, {
    assetId: 'ebike-003',
    customerId: 'cust-aino',
    termMonths: 36,
    downPaymentCents: 0,
    signDate: '2026-11-05',
  });
  if (!signed.ok) throw new Error('setup: signing failed');
  return signed.contract;
}

describe('resolveContractEarlyExit', () => {
  it('buys out month 7 of 36 for less than the full financed amount, more than the end-of-term buyout', async () => {
    const contract = await signAinosContract();

    const result = await resolveContractEarlyExit(db, {
      contractId: contract.id,
      action: 'buy',
      asOfDate: '2027-06-05', // 7 months after signing
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.outcome !== 'bought_early') throw new Error('expected a buy result');
    expect(result.amountCents).toBeLessThan(contract.financedCents);
    expect(result.amountCents).toBeGreaterThan(contract.buyoutCents);

    const row = await db.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(row.status).toBe('bought');
  });

  it('returns month 7 of 36 for a fee, and frees the asset', async () => {
    const contract = await signAinosContract();

    const result = await resolveContractEarlyExit(db, {
      contractId: contract.id,
      action: 'return',
      asOfDate: '2027-06-05',
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.outcome !== 'returned_early')
      throw new Error('expected a return result');
    expect(result.feeCents).toBeGreaterThan(0);

    const row = await db.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(row.status).toBe('returned');
    const asset = await db.asset.findUniqueOrThrow({ where: { id: contract.assetId } });
    expect(asset.status).toBe('returned');
  });

  it('rejects an early exit once the term is actually over', async () => {
    const contract = await signAinosContract();

    const result = await resolveContractEarlyExit(db, {
      contractId: contract.id,
      action: 'buy',
      asOfDate: '2029-11-05', // the exact natural end of a 36-month term
    });
    expect(result).toEqual({ ok: false, reason: 'term_already_over' });
  });

  it('rejects exiting a contract that is already settled', async () => {
    const contract = await signAinosContract();
    await resolveContractEarlyExit(db, {
      contractId: contract.id,
      action: 'buy',
      asOfDate: '2027-06-05',
    });

    const result = await resolveContractEarlyExit(db, {
      contractId: contract.id,
      action: 'return',
      asOfDate: '2027-07-05',
    });
    expect(result).toEqual({ ok: false, reason: 'contract_already_settled' });
  });

  it('reports a contract that does not exist', async () => {
    const result = await resolveContractEarlyExit(db, {
      contractId: 'nope',
      action: 'buy',
      asOfDate: '2026-12-05',
    });
    expect(result).toEqual({ ok: false, reason: 'contract_not_found' });
  });

  it('stops issuing new invoices once a contract exits early', async () => {
    const contract = await signAinosContract();
    await resolveContractEarlyExit(db, {
      contractId: contract.id,
      action: 'return',
      asOfDate: '2027-06-05',
    });

    const invoices = await issueDueInvoices(db, contract.id, '2028-01-05');
    expect(invoices.ok).toBe(true);
    if (!invoices.ok) return;
    // Only invoice #1 (issued at signing) exists — nothing was ever issued for the other
    // due dates between signing and the exit, and the exit itself stops any more.
    expect(invoices.invoices).toHaveLength(1);
  });
});
