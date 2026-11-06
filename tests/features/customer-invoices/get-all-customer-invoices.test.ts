// Mirrors src/server/features/customer-invoices/get-all-customer-invoices.ts — see AGENTS.md
// and src/server/README.md for why tests for src/server/features/** live here.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAssets, loadCustomers } from '@/data/load';
import { seedAssets } from '@/server/assets';
import { seedCustomers } from '@/server/customers';
import { signContract } from '@/server/features/contracts/sign-contract';
import { getAllCustomerInvoices } from '@/server/features/customer-invoices/get-all-customer-invoices';
import { createTestDb } from '../../helpers/test-db';
import type { PrismaClient } from '@/server/prisma-client';

let db: PrismaClient;
let cleanup: () => Promise<void>;
let firstLease: string;
let secondLease: string;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  await seedAssets(db, await loadAssets());
  await seedCustomers(db, await loadCustomers());
  firstLease = await sign('ebike-001', 'cust-aino', '2026-09-15');
  secondLease = await sign('ebike-002', 'cust-aino', '2026-10-20');
  await sign('ebike-003', 'cust-mikko', '2026-09-15');
});
afterAll(async () => {
  await cleanup();
});

async function sign(assetId: string, customerId: string, signDate: string) {
  const signed = await signContract(db, {
    assetId,
    customerId,
    termMonths: 24,
    downPaymentCents: 0,
    signDate,
  });
  if (!signed.ok) throw new Error(signed.reason);
  return signed.contract.id;
}

describe('getAllCustomerInvoices', () => {
  it('lists the invoices of every lease, newest invoice date first', async () => {
    const { rows, unavailableLeases } = await getAllCustomerInvoices(db, {
      customerId: 'cust-aino',
      asOfDate: '2026-11-20',
    });
    expect(unavailableLeases).toBe(0);
    expect(rows.map((row) => [row.lease.id, row.invoice.invoiceDate])).toEqual([
      [secondLease, '2026-11-20'],
      [firstLease, '2026-11-15'],
      [secondLease, '2026-10-20'],
      [firstLease, '2026-10-15'],
      [firstLease, '2026-09-15'],
    ]);
  });

  it("names each invoice's lease equipment", async () => {
    const { rows } = await getAllCustomerInvoices(db, {
      customerId: 'cust-aino',
      asOfDate: '2026-11-20',
    });
    expect(rows.every((row) => row.lease.assetName !== row.lease.id)).toBe(true);
    expect(new Set(rows.map((row) => row.lease.assetName)).size).toBe(2);
  });

  it("shows nothing that belongs to another customer's leases", async () => {
    const { rows } = await getAllCustomerInvoices(db, {
      customerId: 'cust-mikko',
      asOfDate: '2026-11-20',
    });
    expect(rows).toHaveLength(3);
    expect(rows.some((row) => [firstLease, secondLease].includes(row.lease.id))).toBe(false);
  });

  it('is empty for a customer with no leases', async () => {
    expect(
      await getAllCustomerInvoices(db, { customerId: 'cust-sanna', asOfDate: '2026-11-20' })
    ).toEqual({ rows: [], unavailableLeases: 0 });
  });

  it('issues what is due, once, so opening the page twice adds nothing', async () => {
    const input = { customerId: 'cust-lena', asOfDate: '2026-11-20' };
    await sign('farm-001', 'cust-lena', '2026-11-01');
    const first = await getAllCustomerInvoices(db, input);
    const second = await getAllCustomerInvoices(db, input);
    expect(first.rows).toHaveLength(1);
    expect(second.rows).toEqual(first.rows);
  });
});
