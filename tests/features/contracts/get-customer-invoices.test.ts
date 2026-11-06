// Mirrors src/server/features/contracts/get-customer-invoices.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAssets } from '@/data/load';
import { seedAssets } from '@/server/assets';
import { getCustomerInvoices } from '@/server/features/contracts/get-customer-invoices';
import { signContract } from '@/server/features/contracts/sign-contract';
import { createTestDb } from '../../helpers/test-db';
import type { PrismaClient } from '@/server/prisma-client';

let db: PrismaClient;
let cleanup: () => Promise<void>;
let contractId: string;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  await seedAssets(db, await loadAssets());
  const signed = await signContract(db, {
    assetId: 'ebike-001',
    customerId: 'cust-aino',
    termMonths: 24,
    downPaymentCents: 0,
    signDate: '2026-09-15',
  });
  if (!signed.ok) throw new Error(signed.reason);
  contractId = signed.contract.id;
});
afterAll(async () => {
  await cleanup();
});

const get = (overrides: { contractId?: string; customerId?: string; asOfDate?: string } = {}) =>
  getCustomerInvoices(db, {
    contractId,
    customerId: 'cust-aino',
    asOfDate: '2026-12-20',
    ...overrides,
  });

describe('getCustomerInvoices', () => {
  it("returns the lease with the equipment's name and its whole invoice schedule", async () => {
    const result = await get();
    if (!result.ok) throw new Error(result.reason);

    expect(result.value.lease).toMatchObject({ id: contractId, status: 'active', termMonths: 24 });
    expect(result.value.lease.assetName).not.toBe('ebike-001');
    expect(result.value.invoices).toHaveLength(24);
  });

  it('issues what is due by the date and leaves the rest as upcoming', async () => {
    const result = await get({ asOfDate: '2026-12-20' });
    if (!result.ok) throw new Error(result.reason);

    const statuses = result.value.invoices.map((invoice) => invoice.status);
    // Due 15 Sep, 15 Oct, 15 Nov and 15 Dec.
    expect(statuses.slice(0, 4)).toEqual(['issued', 'issued', 'issued', 'issued']);
    expect(statuses.slice(4).every((status) => status === 'upcoming')).toBe(true);
  });

  it('shows the VAT rate of each invoice own due date', async () => {
    const result = await get({ asOfDate: '2027-02-01' });
    if (!result.ok) throw new Error(result.reason);

    const rate = (due: string) =>
      result.value.invoices.find((invoice) => invoice.dueDate === due)?.vatRatePercent;
    expect(rate('2026-12-15')).toBe(25.5);
    expect(rate('2027-01-15')).toBe(26);
  });

  it("treats someone else's lease like one that doesn't exist", async () => {
    expect(await get({ customerId: 'cust-mikko' })).toEqual({ ok: false, reason: 'unknown_lease' });
    expect(await get({ contractId: 'no-such-contract' })).toEqual({
      ok: false,
      reason: 'unknown_lease',
    });
  });
});
