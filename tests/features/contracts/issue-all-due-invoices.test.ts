// Mirrors src/server/features/contracts/issue-all-due-invoices.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
// Runs against the real data pack and a real, migrated SQLite database.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAssets, loadCustomers } from '@/data/load';
import { issueAllDueInvoices } from '@/server/features/contracts/issue-all-due-invoices';
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

describe('issueAllDueInvoices', () => {
  it('counts no contracts and no invoices when there are none', async () => {
    const result = await issueAllDueInvoices(db, '2026-12-06');
    expect(result).toEqual({ contractsChecked: 0, invoicesIssued: 0 });
  });

  it('issues each due invoice across every contract, counting only the new ones', async () => {
    const first = await signContract(db, {
      assetId: 'ebike-003',
      customerId: 'cust-aino',
      termMonths: 36,
      downPaymentCents: 0,
      signDate: '2026-11-05',
    });
    const second = await signContract(db, {
      assetId: 'laptop-004',
      customerId: 'cust-mikko',
      termMonths: 24,
      downPaymentCents: 0,
      signDate: '2026-11-06',
    });
    if (!first.ok || !second.ok) throw new Error('setup: signing failed');

    // Invoice 1 of each contract was already issued at signing; fast-forward a month.
    const result = await issueAllDueInvoices(db, '2026-12-06');

    expect(result.contractsChecked).toBe(2);
    expect(result.invoicesIssued).toBe(2);

    const totalInvoices = await db.invoice.count();
    expect(totalInvoices).toBe(4);
  });
});
