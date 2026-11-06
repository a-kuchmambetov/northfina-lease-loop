// Mirrors src/server/features/contracts/get-invoices.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
// Runs against the real data pack and a real, migrated SQLite database.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAssets, loadCustomers } from '@/data/load';
import { getContractInvoices } from '@/server/features/contracts/get-invoices';
import { signContract } from '@/server/features/contracts/sign-contract';
import { seedAssets } from '@/server/assets';
import { seedCustomers } from '@/server/customers';
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
  await db.asset.updateMany({ data: { status: 'available' } });
});

describe('getContractInvoices', () => {
  it('previews the first 3 invoices for scenario card 1, invoice 1 already issued at signing', async () => {
    const signed = await signContract(db, {
      assetId: 'ebike-003',
      customerId: 'cust-aino',
      termMonths: 36,
      downPaymentCents: 0,
      signDate: '2026-11-05',
    });
    if (!signed.ok) throw new Error('setup: signing failed');

    const result = await getContractInvoices(db, signed.contract.id, '2026-11-05');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invoices).toHaveLength(36);

    const [first, second, third] = result.invoices;
    expect(first).toMatchObject({
      sequenceNumber: 1,
      invoiceDate: '2026-11-05',
      paymentDeadline: '2026-11-19',
      netCents: 10_730,
      vatRatePercent: 25.5,
      vatCents: 2_736,
      grossCents: 13_466,
      status: 'issued',
    });
    expect(first?.id).not.toBeNull();

    // Not reached yet as of the signing date: shown as a preview, not actually issued.
    expect(second).toMatchObject({
      id: null,
      sequenceNumber: 2,
      invoiceDate: '2026-12-05',
      vatRatePercent: 25.5,
      status: 'upcoming',
    });
    expect(third).toMatchObject({
      id: null,
      sequenceNumber: 3,
      invoiceDate: '2027-01-05',
      vatRatePercent: 26,
      status: 'upcoming',
    });
  });

  it('issues invoice 2 once asOf reaches its invoice date', async () => {
    const signed = await signContract(db, {
      assetId: 'ebike-003',
      customerId: 'cust-aino',
      termMonths: 36,
      downPaymentCents: 0,
      signDate: '2026-11-05',
    });
    if (!signed.ok) throw new Error('setup: signing failed');

    const result = await getContractInvoices(db, signed.contract.id, '2026-12-05');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invoices[1]).toMatchObject({ sequenceNumber: 2, status: 'issued' });
    expect(result.invoices[1]?.id).not.toBeNull();
  });

  it('shows unissued months as cancelled, not upcoming, once the contract is settled', async () => {
    const signed = await signContract(db, {
      assetId: 'ebike-003',
      customerId: 'cust-aino',
      termMonths: 36,
      downPaymentCents: 0,
      signDate: '2026-11-05',
    });
    if (!signed.ok) throw new Error('setup: signing failed');

    // Simulates whatever settled it (bought, returned or extended) without coupling this
    // test to end-of-term's own rules — only get-invoices.ts's own behavior is at stake.
    await db.contract.update({ where: { id: signed.contract.id }, data: { status: 'bought' } });

    const result = await getContractInvoices(db, signed.contract.id, '2026-11-05');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.invoices[0]).toMatchObject({ sequenceNumber: 1, status: 'issued' }); // untouched
    expect(result.invoices[1]).toMatchObject({ id: null, sequenceNumber: 2, status: 'cancelled' });
    expect(result.invoices[35]).toMatchObject({
      id: null,
      sequenceNumber: 36,
      status: 'cancelled',
    });
  });

  it('shows every month as upcoming, not cancelled, while waiting on a named signatory (scenario card 6)', async () => {
    await db.contract.create({
      data: {
        id: 'pending-contract-get-invoices',
        asset_id: 'ebike-003',
        customer_id: 'cust-norvi',
        start_date: '2026-11-05',
        term_months: 24,
        price_list_version: 1,
        list_price_cents: 389_000,
        down_payment_cents: 0,
        financed_cents: 389_000,
        monthly_net_rent_cents: 13_822,
        buyout_cents: 97_250,
        status: 'pending_signature',
        pending_signatory_email: 'someone@norvi.example.com',
      },
    });

    const result = await getContractInvoices(db, 'pending-contract-get-invoices', '2026-11-05');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Nothing is issued yet (the contract hasn't started), but nothing is cancelled either.
    expect(result.invoices.every((invoice) => invoice.id === null)).toBe(true);
    expect(result.invoices.every((invoice) => invoice.status === 'upcoming')).toBe(true);
  });

  it('reports a contract that does not exist', async () => {
    const result = await getContractInvoices(db, 'nope', '2026-11-05');
    expect(result).toEqual({ ok: false, reason: 'contract_not_found' });
  });
});
