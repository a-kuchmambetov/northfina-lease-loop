// Mirrors src/server/features/return-lease/return-lease.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
// Runs against the real data pack and a real, migrated SQLite database.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAssets, loadCustomers } from '@/data/load';
import { seedAssets } from '@/server/assets';
import { seedCustomers } from '@/server/customers';
import { signContract } from '@/server/features/contracts/sign-contract';
import { returnLease } from '@/server/features/return-lease/return-lease';
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
// Each test signs the same asset from scratch.
beforeEach(async () => {
  await db.asset.updateMany({
    data: { status: 'available', condition: 'new', usage_value: 0, lifetime_usage_value: 0 },
  });
});

// Scenario card 8: Aino leases ebike-003 for 36 months from 5 Nov 2026.
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

const giveBack = (
  contractId: string,
  asOfDate: string,
  confirm: boolean,
  customerId = 'cust-aino'
) => returnLease(db, { contractId, customerId, asOfDate, confirm });

const statusOf = async (contractId: string) =>
  (await db.contract.findUniqueOrThrow({ where: { id: contractId } })).status;

describe('returnLease, before the term is over', () => {
  it('quotes the early-return fee for month 7 of 36 and changes nothing', async () => {
    const contract = await signAinosContract();
    const auditBefore = await db.auditLog.count();

    const quote = await giveBack(contract.id, '2027-06-05', false);

    expect(quote).toMatchObject({
      ok: true,
      kind: 'early',
      monthsElapsed: 7,
      termMonths: 36,
      returned: false,
    });
    if (!quote.ok) return;
    expect(quote.feeCents).toBeGreaterThan(0);
    // The customer is shown what the invoice will come to, VAT (26 % in June 2027) included.
    expect(quote.feeGrossCents).toBe(quote.feeCents + Math.round((quote.feeCents * 26) / 100));
    expect(await statusOf(contract.id)).toBe('active');
    expect((await db.asset.findUniqueOrThrow({ where: { id: 'ebike-003' } })).status).toBe(
      'reserved'
    );
    expect(await db.auditLog.count()).toBe(auditBefore);
  });

  it('returns the item for exactly the fee that was quoted', async () => {
    const contract = await signAinosContract();
    const quote = await giveBack(contract.id, '2027-06-05', false);
    const done = await giveBack(contract.id, '2027-06-05', true);

    expect(done).toMatchObject({ ok: true, kind: 'early', returned: true });
    if (!quote.ok || !done.ok) throw new Error('expected both to work');
    expect(done.feeCents).toBe(quote.feeCents);
    expect(done.feeGrossCents).toBe(quote.feeGrossCents);
    const invoice = await db.invoice.findFirstOrThrow({
      where: { contract_id: contract.id, kind: 'early_return_fee' },
    });
    expect(invoice.gross_cents).toBe(quote.feeGrossCents);
    expect(await statusOf(contract.id)).toBe('returned');
    // It goes into the refurbishment queue.
    expect((await db.asset.findUniqueOrThrow({ where: { id: 'ebike-003' } })).status).toBe(
      'returned'
    );
    const audit = await db.auditLog.findMany({
      where: { entity_id: contract.id, action: 'contract.returned_early' },
    });
    expect(audit).toHaveLength(1);
  });

  it('stops invoices once the item is returned', async () => {
    const contract = await signAinosContract();
    await giveBack(contract.id, '2027-06-05', true);

    expect(await statusOf(contract.id)).not.toBe('active');
  });
});

describe('returnLease, the unpaid invoice of the month in progress', () => {
  it('is announced in the quote, with its amount, and cancelled by the return', async () => {
    const contract = await signAinosContract();
    const first = await db.invoice.findFirstOrThrow({ where: { contract_id: contract.id } });

    const quote = await giveBack(contract.id, '2026-11-20', false);
    expect(quote).toMatchObject({
      ok: true,
      cancelledInvoiceCount: 1,
      cancelledInvoicesGrossCents: first.gross_cents,
    });
    expect((await db.invoice.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('issued');

    await giveBack(contract.id, '2026-11-20', true);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: first.id } })).status).toBe(
      'cancelled'
    );
  });

  it('is not announced once it has been paid', async () => {
    const contract = await signAinosContract();
    const first = await db.invoice.findFirstOrThrow({ where: { contract_id: contract.id } });
    await db.invoice.update({ where: { id: first.id }, data: { status: 'paid' } });

    expect(await giveBack(contract.id, '2026-11-20', false)).toMatchObject({
      ok: true,
      cancelledInvoiceCount: 0,
      cancelledInvoicesGrossCents: 0,
    });
  });
});

describe('returnLease, once the term is over', () => {
  it('counts the whole term on the clamped end date of a leap-day lease', async () => {
    const signed = await signContract(db, {
      assetId: 'laptop-001',
      customerId: 'cust-aino',
      termMonths: 24,
      downPaymentCents: 0,
      signDate: '2028-02-29',
    });
    if (!signed.ok) throw new Error('setup: signing failed');

    expect(await giveBack(signed.contract.id, '2030-02-28', false)).toMatchObject({
      ok: true,
      kind: 'end_of_term',
      monthsElapsed: 24,
      feeCents: 0,
    });
  });

  it('issues no fee invoice', async () => {
    const contract = await signAinosContract();
    await giveBack(contract.id, '2029-11-05', true);

    expect(
      await db.invoice.count({ where: { contract_id: contract.id, kind: 'early_return_fee' } })
    ).toBe(0);
  });

  it('is free, and says so in a quote', async () => {
    const contract = await signAinosContract();

    expect(await giveBack(contract.id, '2029-11-05', false)).toEqual({
      ok: true,
      kind: 'end_of_term',
      feeCents: 0,
      feeGrossCents: 0,
      cancelledInvoiceCount: 0,
      cancelledInvoicesGrossCents: 0,
      monthsElapsed: 36,
      termMonths: 36,
      returned: false,
    });
    expect(await statusOf(contract.id)).toBe('active');
  });

  it('returns the item through the end-of-term flow, with no fee', async () => {
    const contract = await signAinosContract();

    const done = await giveBack(contract.id, '2029-11-05', true);

    expect(done).toMatchObject({ ok: true, kind: 'end_of_term', feeCents: 0, returned: true });
    expect(await statusOf(contract.id)).toBe('returned');
    expect(
      await db.auditLog.count({ where: { entity_id: contract.id, action: 'contract.returned' } })
    ).toBe(1);
  });

  it('counts a return long after the term as 36 months used, not more', async () => {
    const contract = await signAinosContract();

    expect(await giveBack(contract.id, '2032-01-01', false)).toMatchObject({
      ok: true,
      monthsElapsed: 36,
    });
  });
});

describe('returnLease, refusals', () => {
  it("treats someone else's lease like one that doesn't exist", async () => {
    const contract = await signAinosContract();

    expect(await giveBack(contract.id, '2027-06-05', true, 'cust-mikko')).toEqual({
      ok: false,
      reason: 'unknown_lease',
    });
    expect(await giveBack('no-such-contract', '2027-06-05', true)).toEqual({
      ok: false,
      reason: 'unknown_lease',
    });
    expect(await statusOf(contract.id)).toBe('active');
  });

  it('refuses a lease that is already settled, for a quote and for a return', async () => {
    const contract = await signAinosContract();
    await giveBack(contract.id, '2027-06-05', true);

    for (const confirm of [false, true]) {
      expect(await giveBack(contract.id, '2027-06-05', confirm)).toEqual({
        ok: false,
        reason: 'contract_already_settled',
      });
    }
  });
});
