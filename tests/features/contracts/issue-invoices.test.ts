// Mirrors src/server/features/contracts/issue-invoices.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
// Runs against the real data pack and a real, migrated SQLite database.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAssets, loadCustomers } from '@/data/load';
import { issueDueInvoices } from '@/server/features/contracts/issue-invoices';
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

describe('issueDueInvoices', () => {
  it('does not issue or audit invoices when the contract settles after the initial read', async () => {
    const signed = await signContract(db, {
      assetId: 'ebike-003',
      customerId: 'cust-aino',
      termMonths: 36,
      downPaymentCents: 0,
      signDate: '2026-11-05',
    });
    if (!signed.ok) throw new Error('setup: signing failed');
    const where = { id: signed.contract.id };
    const activeSnapshot = await db.contract.findUniqueOrThrow({ where });
    await db.contract.update({ where, data: { status: 'returned' } });
    const read = vi.spyOn(db.contract, 'findUnique').mockResolvedValueOnce(activeSnapshot);
    try {
      const result = await issueDueInvoices(db, signed.contract.id, '2027-01-05');
      expect(result.ok && result.invoices.map((invoice) => invoice.sequenceNumber)).toEqual([1]);
    } finally {
      read.mockRestore();
    }
    expect(await db.invoice.count({ where: { contract_id: signed.contract.id } })).toBe(1);
    expect(
      await db.auditLog.count({
        where: { entity_id: signed.contract.id, action: 'invoices.issued' },
      })
    ).toBe(1);
  });

  it('issues each invoice once when multiple requests overlap, auditing only inserted rows', async () => {
    const signed = await signContract(db, {
      assetId: 'ebike-003',
      customerId: 'cust-aino',
      termMonths: 36,
      downPaymentCents: 0,
      signDate: '2026-11-05',
    });
    if (!signed.ok) throw new Error('setup: signing failed');

    // Force all four requests to see the same initial snapshot, even if SQLite happens
    // to serialize their reads. Transaction-scoped reads still use the real database.
    const initialRows = await db.invoice.findMany({ where: { contract_id: signed.contract.id } });
    const read = vi.spyOn(db.invoice, 'findMany');
    for (let i = 0; i < 4; i++) read.mockResolvedValueOnce(initialRows);
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => issueDueInvoices(db, signed.contract.id, '2027-01-05'))
    );
    read.mockRestore();
    for (const result of results) {
      expect(result.status).toBe('fulfilled');
      if (result.status !== 'fulfilled' || !result.value.ok) throw new Error('expected invoices');
      expect(result.value.invoices.map((invoice) => invoice.sequenceNumber)).toEqual([1, 2, 3]);
    }
    const rows = await db.invoice.findMany({ where: { contract_id: signed.contract.id } });
    expect(rows).toHaveLength(3);
    const audits = await db.auditLog.findMany({
      where: { entity_id: signed.contract.id, action: 'invoices.issued' },
    });
    expect(audits).toHaveLength(2); // one signing, one catch-up; overlapping reads write no audit
    const auditedIds = audits.flatMap(
      (row) => (JSON.parse(row.details_json!) as { invoiceIds: string[] }).invoiceIds
    );
    expect(auditedIds.sort()).toEqual(rows.map((row) => row.id).sort());
  });

  it('issues invoice 1 at signing, because its invoice date is the signing date', async () => {
    const signed = await signContract(db, {
      assetId: 'ebike-003',
      customerId: 'cust-aino',
      termMonths: 36,
      downPaymentCents: 0,
      signDate: '2026-11-05',
    });
    if (!signed.ok) throw new Error('setup: signing failed');

    const rows = await db.invoice.findMany({ where: { contract_id: signed.contract.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sequence_number: 1,
      invoice_date: '2026-11-05',
      status: 'issued',
    });
  });

  it('does not re-issue an invoice that already exists', async () => {
    const signed = await signContract(db, {
      assetId: 'ebike-003',
      customerId: 'cust-aino',
      termMonths: 36,
      downPaymentCents: 0,
      signDate: '2026-11-05',
    });
    if (!signed.ok) throw new Error('setup: signing failed');

    await issueDueInvoices(db, signed.contract.id, '2026-11-05');
    await issueDueInvoices(db, signed.contract.id, '2026-11-05');
    const rows = await db.invoice.findMany({ where: { contract_id: signed.contract.id } });
    expect(rows).toHaveLength(1);
  });

  it('issues every invoice whose invoice date has arrived, not just the next one', async () => {
    const signed = await signContract(db, {
      assetId: 'ebike-003',
      customerId: 'cust-aino',
      termMonths: 36,
      downPaymentCents: 0,
      signDate: '2026-11-05',
    });
    if (!signed.ok) throw new Error('setup: signing failed');

    const result = await issueDueInvoices(db, signed.contract.id, '2027-01-05');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invoices.map((invoice) => invoice.sequenceNumber)).toEqual([1, 2, 3]);
    expect(result.invoices[2]).toMatchObject({ vatRatePercent: 26 });
  });

  it('reports a contract that does not exist', async () => {
    const result = await issueDueInvoices(db, 'nope', '2026-11-05');
    expect(result).toEqual({ ok: false, reason: 'contract_not_found' });
  });
});
