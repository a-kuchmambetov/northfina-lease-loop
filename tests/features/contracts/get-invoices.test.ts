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
      dueDate: '2026-11-05',
      paymentDeadline: '2026-11-19',
      netCents: 10_730,
      vatRatePercent: 25.5,
      vatCents: 2_736,
      grossCents: 13_466,
      status: 'issued',
    });
    expect(first?.id).not.toBeNull();

    // Not due yet as of the signing date: shown as a preview, not actually issued.
    expect(second).toMatchObject({
      id: null,
      sequenceNumber: 2,
      dueDate: '2026-12-05',
      vatRatePercent: 25.5,
      status: 'upcoming',
    });
    expect(third).toMatchObject({
      id: null,
      sequenceNumber: 3,
      dueDate: '2027-01-05',
      vatRatePercent: 26,
      status: 'upcoming',
    });
  });

  it('issues invoice 2 once asOf reaches its due date', async () => {
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

  it('reports a contract that does not exist', async () => {
    const result = await getContractInvoices(db, 'nope', '2026-11-05');
    expect(result).toEqual({ ok: false, reason: 'contract_not_found' });
  });
});
