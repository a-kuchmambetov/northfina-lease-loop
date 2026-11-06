// Mirrors src/server/features/contracts/get-invoice-document.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAssets, loadCustomers } from '@/data/load';
import { seedAssets } from '@/server/assets';
import { seedCustomers } from '@/server/customers';
import { getInvoiceDocument } from '@/server/features/contracts/get-invoice-document';
import { payInvoice } from '@/server/features/contracts/pay-invoice';
import { signContract } from '@/server/features/contracts/sign-contract';
import { createTestDb } from '../../helpers/test-db';
import type { PrismaClient } from '@/server/prisma-client';

let db: PrismaClient;
let cleanup: () => Promise<void>;
let contractId: string;
let invoiceId: string;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  await seedAssets(db, await loadAssets());
  await seedCustomers(db, await loadCustomers());
  // Scenario card 3: ebike-001, 24 months, started 15 Sep 2026.
  const signed = await signContract(db, {
    assetId: 'ebike-001',
    customerId: 'cust-aino',
    termMonths: 24,
    downPaymentCents: 0,
    signDate: '2026-09-15',
  });
  if (!signed.ok) throw new Error(signed.reason);
  contractId = signed.contract.id;
  // Invoice #1 is issued at signing.
  invoiceId = (await db.invoice.findFirstOrThrow({ where: { contract_id: contractId } })).id;
});
afterAll(async () => {
  await cleanup();
});

const get = (overrides: { invoiceId?: string; customerId?: string; today?: string } = {}) =>
  getInvoiceDocument(db, {
    invoiceId,
    customerId: 'cust-aino',
    today: '2026-09-20',
    ...overrides,
  });

describe('getInvoiceDocument', () => {
  it('returns the frozen amounts of the invoice with its lease and customer', async () => {
    const row = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const result = await get();
    if (!result.ok) throw new Error(result.reason);

    expect(result.document).toMatchObject({
      number: `${contractId.slice(0, 8).toUpperCase()}-001`,
      sequenceNumber: 1,
      termMonths: 24,
      contractStartDate: '2026-09-15',
      customerName: 'Aino Virtanen',
      invoiceDate: '2026-09-15',
      netCents: row.net_cents,
      vatRatePercent: row.vat_rate_percent,
      vatCents: row.vat_cents,
      grossCents: row.gross_cents,
      status: 'issued',
      paidOn: null,
    });
    expect(result.document.assetName).not.toBe('ebike-001');
  });

  it('is a rent invoice by default', async () => {
    expect(await get()).toMatchObject({ ok: true, document: { kind: 'rent' } });
  });

  it('shows an unpaid invoice as expired the day after its payment deadline, not before', async () => {
    // Invoice #1 is dated 15 Sep, payable until 29 Sep.
    expect(await get({ today: '2026-09-29' })).toMatchObject({
      ok: true,
      document: { status: 'issued' },
    });
    expect(await get({ today: '2026-09-30' })).toMatchObject({
      ok: true,
      document: { status: 'expired' },
    });
  });

  it('shows a cancelled invoice as cancelled, however long ago its deadline was', async () => {
    await db.invoice.update({ where: { id: invoiceId }, data: { status: 'cancelled' } });
    const result = await get({ today: '2030-01-01' });
    await db.invoice.update({ where: { id: invoiceId }, data: { status: 'issued' } });

    expect(result).toMatchObject({ ok: true, document: { status: 'cancelled' } });
  });

  it('uses the name typed when the contract was signed', async () => {
    await db.contract.update({ where: { id: contractId }, data: { signed_name: 'Aino V.' } });
    const result = await get();
    await db.contract.update({ where: { id: contractId }, data: { signed_name: null } });

    expect(result).toMatchObject({ ok: true, document: { customerName: 'Aino V.' } });
  });

  it('marks a paid invoice with the day it was paid, and never as expired', async () => {
    await payInvoice(db, invoiceId);
    const result = await get({ today: '2030-01-01' });

    expect(result).toMatchObject({ ok: true, document: { status: 'paid' } });
    if (result.ok) expect(result.document.paidOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("treats someone else's invoice like one that doesn't exist", async () => {
    expect(await get({ customerId: 'cust-mikko' })).toEqual({
      ok: false,
      reason: 'unknown_invoice',
    });
    expect(await get({ invoiceId: 'no-such-invoice' })).toEqual({
      ok: false,
      reason: 'unknown_invoice',
    });
  });

  it('refuses to print an invoice whose amounts do not add up', async () => {
    const broken = await db.invoice.create({
      data: {
        id: 'broken-invoice',
        contract_id: contractId,
        sequence_number: 99,
        invoice_date: '2026-10-15',
        payment_deadline: '2026-10-29',
        net_cents: 1000,
        vat_rate_percent: 25.5,
        vat_cents: 255,
        gross_cents: 1256,
        status: 'issued',
      },
    });

    expect(await get({ invoiceId: broken.id })).toEqual({
      ok: false,
      reason: 'amounts_do_not_add_up',
    });
  });
});
