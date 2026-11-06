// Mirrors src/server/features/contracts/pay-invoice.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
// Runs against the real data pack and a real, migrated SQLite database.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAssets, loadCustomers } from '@/data/load';
import { payInvoice } from '@/server/features/contracts/pay-invoice';
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
// Each test signs the same asset from scratch; a prior test's own signing must not
// leave it 'reserved' for the next one — this file isn't testing asset availability.
beforeEach(async () => {
  await db.asset.updateMany({ data: { status: 'available' } });
});

async function signedInvoiceId(): Promise<string> {
  const signed = await signContract(db, {
    assetId: 'ebike-003',
    customerId: 'cust-aino',
    termMonths: 36,
    downPaymentCents: 0,
    signDate: '2026-11-05',
  });
  if (!signed.ok) throw new Error('setup: signing failed');
  const [invoice] = await db.invoice.findMany({ where: { contract_id: signed.contract.id } });
  if (!invoice) throw new Error('setup: invoice 1 was not issued');
  return invoice.id;
}

describe('payInvoice', () => {
  it('marks an issued invoice paid, with an audit row', async () => {
    const invoiceId = await signedInvoiceId();

    const result = await payInvoice(db, invoiceId);
    expect(result).toMatchObject({ ok: true, invoiceId });

    const row = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(row.status).toBe('paid');
    expect(row.paid_at).not.toBeNull();

    const auditRow = await db.auditLog.findFirst({
      where: { entity_type: 'invoice', entity_id: invoiceId },
    });
    expect(auditRow).toMatchObject({ action: 'invoice.paid' });
  });

  it('rejects paying the same invoice twice', async () => {
    const invoiceId = await signedInvoiceId();
    await payInvoice(db, invoiceId);

    const result = await payInvoice(db, invoiceId);
    expect(result).toEqual({ ok: false, reason: 'already_paid' });
  });

  it('reports an invoice that does not exist', async () => {
    const result = await payInvoice(db, 'nope');
    expect(result).toEqual({ ok: false, reason: 'invoice_not_found' });
  });

  it('refuses to pay a cancelled invoice and leaves it cancelled', async () => {
    const invoiceId = await signedInvoiceId();
    await db.invoice.update({ where: { id: invoiceId }, data: { status: 'cancelled' } });

    expect(await payInvoice(db, invoiceId)).toEqual({ ok: false, reason: 'invoice_cancelled' });
    expect((await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status).toBe(
      'cancelled'
    );
    expect((await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).paid_at).toBeNull();
  });
});
