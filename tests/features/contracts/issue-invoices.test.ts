// Mirrors src/server/features/contracts/issue-invoices.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
// Runs against the real data pack and a real, migrated SQLite database.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { issueDueInvoices } from '@/server/features/contracts/issue-invoices';
import { signContract } from '@/server/features/contracts/sign-contract';
import { createTestDb } from '../../helpers/test-db';
import type { PrismaClient } from '@/server/prisma-client';

let db: PrismaClient;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});

describe('issueDueInvoices', () => {
  it('issues invoice 1 at signing, because its due date is the signing date', async () => {
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
    expect(rows[0]).toMatchObject({ sequence_number: 1, due_date: '2026-11-05', status: 'issued' });
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

  it('issues every invoice whose due date has arrived, not just the next one', async () => {
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
