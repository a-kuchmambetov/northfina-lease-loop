// Mirrors src/server/features/contracts/get-invoices.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
// Runs against the real data pack and a real, migrated SQLite database.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getContractInvoices } from '@/server/features/contracts/get-invoices';
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

describe('getContractInvoices', () => {
  it('builds the first 3 invoices for scenario card 1 (ebike-003, 36 months, 5 Nov 2026)', async () => {
    const signed = await signContract(db, {
      assetId: 'ebike-003',
      customerId: 'cust-aino',
      termMonths: 36,
      downPaymentCents: 0,
      signDate: '2026-11-05',
    });
    if (!signed.ok) throw new Error('setup: signing failed');

    const result = await getContractInvoices(db, signed.contract.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invoices).toHaveLength(36);
    expect(result.invoices.slice(0, 3)).toEqual([
      {
        sequenceNumber: 1,
        dueDate: '2026-11-05',
        netCents: 10_730,
        vatRatePercent: 25.5,
        vatCents: 2_736,
        grossCents: 13_466,
      },
      {
        sequenceNumber: 2,
        dueDate: '2026-12-05',
        netCents: 10_730,
        vatRatePercent: 25.5,
        vatCents: 2_736,
        grossCents: 13_466,
      },
      {
        sequenceNumber: 3,
        dueDate: '2027-01-05',
        netCents: 10_730,
        vatRatePercent: 26,
        vatCents: 2_790,
        grossCents: 13_520,
      },
    ]);
  });

  it('reports a contract that does not exist', async () => {
    const result = await getContractInvoices(db, 'nope');
    expect(result).toEqual({ ok: false, reason: 'contract_not_found' });
  });
});
