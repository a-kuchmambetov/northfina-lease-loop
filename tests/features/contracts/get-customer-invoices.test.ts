// Mirrors src/server/features/contracts/get-customer-invoices.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAssets, loadCustomers } from '@/data/load';
import { seedAssets } from '@/server/assets';
import { seedCustomers } from '@/server/customers';
import { getCustomerInvoices } from '@/server/features/contracts/get-customer-invoices';
import { resolveContractEarlyExit } from '@/server/features/early-exit/resolve-early-exit';
import { issueDueInvoices } from '@/server/features/contracts/issue-invoices';
import { getContractInvoices } from '@/server/features/contracts/get-invoices';
import { signContract } from '@/server/features/contracts/sign-contract';
import { createTestDb } from '../../helpers/test-db';
import type { PrismaClient } from '@/server/prisma-client';

let db: PrismaClient;
let cleanup: () => Promise<void>;
let contractId: string;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  await seedAssets(db, await loadAssets());
  await seedCustomers(db, await loadCustomers());
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
  // Invoices stay issued once they are, so these tests move forward in time, as dates do.
  it("returns the lease with the equipment's name", async () => {
    const result = await get({ asOfDate: '2026-09-15' });
    if (!result.ok) throw new Error(result.reason);

    expect(result.value.lease).toMatchObject({ id: contractId, status: 'active', termMonths: 24 });
    expect(result.value.lease.assetName).not.toBe('ebike-001');
  });

  it('shows the first invoice alone on the day the lease starts', async () => {
    const result = await get({ asOfDate: '2026-09-15' });
    if (!result.ok) throw new Error(result.reason);

    expect(result.value.invoices.map((invoice) => invoice.sequenceNumber)).toEqual([1]);
  });

  it('adds the next invoice on its own invoice date, not a day before', async () => {
    const dayBefore = await get({ asOfDate: '2026-10-14' });
    const onTheDay = await get({ asOfDate: '2026-10-15' });
    if (!dayBefore.ok || !onTheDay.ok) throw new Error('setup');

    expect(dayBefore.value.invoices).toHaveLength(1);
    expect(onTheDay.value.invoices).toHaveLength(2);
  });

  it('shows only the invoices issued so far, the current one first', async () => {
    const result = await get({ asOfDate: '2026-12-20' });
    if (!result.ok) throw new Error(result.reason);

    // Dated 15 Sep, 15 Oct, 15 Nov and 15 Dec; the other 20 months are not shown yet.
    expect(result.value.invoices.map((invoice) => invoice.sequenceNumber)).toEqual([4, 3, 2, 1]);
    expect(result.value.invoices.map((invoice) => invoice.invoiceDate)).toEqual([
      '2026-12-15',
      '2026-11-15',
      '2026-10-15',
      '2026-09-15',
    ]);
  });

  it('shows the VAT rate on the date of each invoice', async () => {
    const result = await get({ asOfDate: '2027-02-01' });
    if (!result.ok) throw new Error(result.reason);

    const rate = (invoiceDate: string) =>
      result.value.invoices.find((invoice) => invoice.invoiceDate === invoiceDate)?.vatRatePercent;
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

  it('lists the early-return fee invoice first, after the rent invoices, once the item is returned', async () => {
    const signed = await signContract(db, {
      assetId: 'ebike-002',
      customerId: 'cust-aino',
      termMonths: 24,
      downPaymentCents: 0,
      signDate: '2026-09-15',
    });
    if (!signed.ok) throw new Error(signed.reason);
    // The daily sweep (src/server/features/contracts/issue-all-due-invoices.ts) has issued
    // what was due by the day of the return.
    await issueDueInvoices(db, signed.contract.id, '2026-11-20');
    const exit = await resolveContractEarlyExit(db, {
      contractId: signed.contract.id,
      action: 'return',
      asOfDate: '2026-11-20',
    });
    if (!exit.ok || exit.outcome !== 'returned_early') throw new Error('setup: no early return');

    const result = await get({ contractId: signed.contract.id, asOfDate: '2026-11-20' });
    if (!result.ok) throw new Error(result.reason);

    expect(result.value.invoices.map((invoice) => [invoice.kind, invoice.sequenceNumber])).toEqual([
      ['early_return_fee', 25],
      ['rent', 3],
      ['rent', 2],
      ['rent', 1],
    ]);

    // The full schedule view keeps the months that were never invoiced as they were and adds
    // the fee invoice after them, rather than putting it in place of month 25 or 3.
    const full = await getContractInvoices(db, signed.contract.id, '2026-11-20');
    if (!full.ok) throw new Error(full.reason);
    expect(full.invoices).toHaveLength(25);
    expect(full.invoices.at(-1)).toMatchObject({ kind: 'early_return_fee', sequenceNumber: 25 });
    expect(full.invoices[3]).toMatchObject({
      kind: 'rent',
      sequenceNumber: 4,
      status: 'cancelled',
    });
  });
});
