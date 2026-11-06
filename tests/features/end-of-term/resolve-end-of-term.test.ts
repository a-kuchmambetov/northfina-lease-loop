// Mirrors src/server/features/end-of-term/resolve-end-of-term.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
// Runs against the real data pack and a real, migrated SQLite database.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAssets, loadCustomers } from '@/data/load';
import { resolveContractEndOfTerm } from '@/server/features/end-of-term/resolve-end-of-term';
import { signContract } from '@/server/features/contracts/sign-contract';
import { issueDueInvoices } from '@/server/features/contracts/issue-invoices';
import { seedAssets } from '@/server/assets';
import { seedCustomers } from '@/server/customers';
import { getCustomerCreditBalanceCents } from '@/server/customer-credit';
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
// Each test signs the same asset from scratch via signShortContract — a prior test's own
// signing, return or wear assessment must not carry over into the next one.
beforeEach(async () => {
  await db.asset.updateMany({
    data: { status: 'available', condition: 'new', usage_value: 0, lifetime_usage_value: 0 },
  });
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

    const asset = await db.asset.findUniqueOrThrow({ where: { id: contract.assetId } });
    expect(asset.status).toBe('sold'); // leaves the fleet for good
  });

  it('returns the item, assessed for the wear a 12-month lease adds', async () => {
    const contract = await signShortContract();
    // ebike-003 starts 'new' with 0 km (data/assets.json).

    const result = await resolveContractEndOfTerm(db, {
      contractId: contract.id,
      action: 'return',
      asOfDate: '2027-11-05',
    });
    expect(result).toEqual({ ok: true, outcome: 'returned' });

    const asset = await db.asset.findUniqueOrThrow({ where: { id: contract.assetId } });
    expect(asset.status).toBe('returned');
    // 400 km/month (src/domain/wear.ts's assumed rate) x 12 months.
    expect(asset.usage_value).toBe(4_800);
    expect(asset.lifetime_usage_value).toBe(4_800);
    expect(asset.condition).toBe('like_new'); // past the 3000 km "new" ceiling

    const auditRow = await db.auditLog.findFirst({
      where: { entity_type: 'asset', action: 'asset.returned' },
    });
    expect(auditRow).toMatchObject({ entity_id: contract.assetId });
  });

  it('passes the item straight into a new lease for a named customer, skipping refurbishment', async () => {
    const contract = await signShortContract();
    // 12 months x 400 km = 4800 km -> 'like_new', still at or better than 'good'.

    const result = await resolveContractEndOfTerm(db, {
      contractId: contract.id,
      action: 'pass_on',
      asOfDate: '2027-11-05',
      nextCustomerId: 'cust-pekka',
      nextTermMonths: 24,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.outcome !== 'passed_on') throw new Error('expected a pass_on result');
    // like_new is one step better than the 'good' minimum: (2 + 3)% of the buyout.
    expect(result.bonusCents).toBe(Math.round(contract.buyoutCents * 0.05));
    expect(result.newContract.customerId).toBe('cust-pekka');
    expect(result.newContract.termMonths).toBe(24);
    expect(result.newContract.priceListVersion).toBe(0); // priced off residual value, not a price list

    const contractRow = await db.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(contractRow.status).toBe('returned');

    const newContractRow = await db.contract.findUniqueOrThrow({
      where: { id: result.newContract.id },
    });
    expect(newContractRow).toMatchObject({ customer_id: 'cust-pekka', term_months: 24 });

    const asset = await db.asset.findUniqueOrThrow({ where: { id: contract.assetId } });
    // Straight into the new lease, never idle in the pool — skipped the refurbishment queue.
    expect(asset.status).toBe('reserved');
    expect(asset.condition).toBe('like_new');
    expect(asset.usage_value).toBe(4_800);
    expect(asset.lifetime_usage_value).toBe(4_800);

    const balance = await getCustomerCreditBalanceCents(db, contract.customerId);
    expect(balance).toBe(result.bonusCents);
  });

  it('rejects passing on without naming who the item goes to next', async () => {
    const contract = await signShortContract();

    const result = await resolveContractEndOfTerm(db, {
      contractId: contract.id,
      action: 'pass_on',
      asOfDate: '2027-11-05',
    });
    expect(result).toEqual({ ok: false, reason: 'next_customer_required' });
  });

  it('rejects passing on to a customer that does not exist in the data pack', async () => {
    const contract = await signShortContract();

    const result = await resolveContractEndOfTerm(db, {
      contractId: contract.id,
      action: 'pass_on',
      asOfDate: '2027-11-05',
      nextCustomerId: 'cust-does-not-exist',
      nextTermMonths: 24,
    });
    expect(result).toEqual({ ok: false, reason: 'unknown_customer' });
  });

  it('rejects passing on an item that still needs refurbishment first', async () => {
    const signed = await signContract(db, {
      assetId: 'ebike-003',
      customerId: 'cust-aino',
      termMonths: 48,
      downPaymentCents: 0,
      signDate: '2026-11-05',
    });
    if (!signed.ok) throw new Error('setup: signing failed');
    // 48 months x 400 km = 19200 km -> past the 15000 km "good" ceiling, into 'fair'.

    const result = await resolveContractEndOfTerm(db, {
      contractId: signed.contract.id,
      action: 'pass_on',
      asOfDate: '2030-11-05',
    });
    expect(result).toEqual({ ok: false, reason: 'item_needs_refurbishment_first' });

    // Rejecting pass_on must not have settled the contract or touched the asset — the
    // customer can still return it for refurbishment instead.
    const contractRow = await db.contract.findUniqueOrThrow({ where: { id: signed.contract.id } });
    expect(contractRow.status).toBe('active');
    const asset = await db.asset.findUniqueOrThrow({ where: { id: signed.contract.assetId } });
    expect(asset.status).toBe('reserved'); // unchanged — still the signed-but-unsettled lease
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

    // The original 12-month term's wear is now on the record, even though the item never
    // left — it's what the renewal was priced off, and the asset stays leased ('reserved').
    const asset = await db.asset.findUniqueOrThrow({ where: { id: contract.assetId } });
    expect(asset.status).toBe('reserved');
    expect(asset.condition).toBe('like_new');
    expect(asset.usage_value).toBe(4_800);
    expect(asset.lifetime_usage_value).toBe(4_800);
  });

  it('rejects an extension of a term the coefficient table does not have', async () => {
    const contract = await signShortContract();

    const result = await resolveContractEndOfTerm(db, {
      contractId: contract.id,
      action: 'extend',
      asOfDate: '2027-11-05',
      additionalTermMonths: 18, // not 12/24/36/48
    });
    expect(result).toEqual({ ok: false, reason: 'unknown_term' });
  });

  it('rejects extending an item that has depreciated below the financing minimum', async () => {
    // laptop-005 is new, no usage, listed at 49900 cents. By 7+ years of age the laptop
    // curve holds its last point (12% at 60 months), so the residual value is
    // 49900 x 0.12 = 5988 cents — below the coefficient table's 30000-cent minimum.
    const signed = await signContract(db, {
      assetId: 'laptop-005',
      customerId: 'cust-aino',
      termMonths: 12,
      downPaymentCents: 0,
      signDate: '2026-11-05',
    });
    if (!signed.ok) throw new Error('setup: signing failed');

    const result = await resolveContractEndOfTerm(db, {
      contractId: signed.contract.id,
      action: 'extend',
      asOfDate: '2033-11-05', // 84 months after signing
      additionalTermMonths: 12,
    });
    expect(result).toEqual({ ok: false, reason: 'below_minimum' });

    // Rejecting the extension must not have settled the old contract — the customer can
    // still buy or return it instead.
    const row = await db.contract.findUniqueOrThrow({ where: { id: signed.contract.id } });
    expect(row.status).toBe('active');
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

  it('rejects a contract that is still waiting on a named signatory (scenario card 6)', async () => {
    const pending = await db.contract.create({
      data: {
        id: 'pending-contract-end-of-term',
        asset_id: 'ebike-003',
        customer_id: 'cust-norvi',
        start_date: '2026-11-05',
        term_months: 36,
        price_list_version: 1,
        list_price_cents: 389_000,
        down_payment_cents: 0,
        financed_cents: 389_000,
        monthly_net_rent_cents: 10_730,
        buyout_cents: 58_350,
        status: 'pending_signature',
        pending_signatory_email: 'someone@norvi.example.com',
      },
    });
    const result = await resolveContractEndOfTerm(db, {
      contractId: pending.id,
      action: 'buy',
      asOfDate: '2027-11-05',
    });
    expect(result).toEqual({ ok: false, reason: 'contract_pending_signature' });
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
