// Mirrors src/server/features/customer-overview/get-customer-overview.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getCustomerOverview } from '@/server/features/customer-overview/get-customer-overview';
import { createTestDb } from '../../helpers/test-db';
import type { PrismaClient } from '@/server/prisma-client';

let db: PrismaClient;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());

  await application('app-old', 'cust-aino', {
    created_at: new Date('2026-11-01T10:00:00Z'),
    decision: 'rejected',
    decision_reason: 'affordability',
  });
  // 22:30 UTC on 4 Nov is already 5 Nov in Helsinki.
  await application('app-new', 'cust-aino', { created_at: new Date('2026-11-04T22:30:00Z') });
  await application('app-other', 'cust-mikko');
  await application('app-gone', 'cust-lena', { asset_id: 'no-such-asset' });

  await contract('lease-active', 'cust-aino', 'active', '2026-11-05');
  await contract('lease-newest', 'cust-aino', 'active', '2026-11-06');
  await contract('lease-bought', 'cust-aino', 'bought', '2025-01-10');
  await contract('lease-returned', 'cust-aino', 'returned', '2024-01-10');
  await contract('lease-extended', 'cust-aino', 'extended', '2023-01-10');
  await contract('lease-other', 'cust-mikko', 'active', '2026-11-05');
  await contract('lease-unsigned', 'cust-norvi', 'pending_signature', '2026-11-05');
});
afterAll(async () => {
  await cleanup();
});

function application(
  id: string,
  customerId: string,
  overrides: Partial<Parameters<PrismaClient['application']['create']>[0]['data']> = {}
) {
  return db.application.create({
    data: {
      id,
      customer_id: customerId,
      asset_id: 'ebike-003',
      term_months: 36,
      financed_amount_cents: 389000,
      monthly_rent_with_vat_cents: 13466,
      price_list_version: 1,
      answers_json: '{}',
      decision: 'pending',
      ...overrides,
    },
  });
}

function contract(id: string, customerId: string, status: string, startDate: string) {
  return db.contract.create({
    data: {
      id,
      asset_id: 'ebike-003',
      customer_id: customerId,
      start_date: startDate,
      term_months: 36,
      price_list_version: 1,
      list_price_cents: 389000,
      down_payment_cents: 0,
      financed_cents: 389000,
      monthly_net_rent_cents: 10730,
      buyout_cents: 58350,
      status,
    },
  });
}

describe('getCustomerOverview', () => {
  it('exposes the requested customer id even when there is no history', async () => {
    expect((await getCustomerOverview(db, 'cust-sanna', '2026-11-06')).customerId).toBe(
      'cust-sanna'
    );
  });

  it('shows an unsigned contract as ongoing without invoices or end-of-term actions', async () => {
    const overview = await getCustomerOverview(db, 'cust-norvi', '2030-01-01');
    expect(overview.customerId).toBe('cust-norvi');
    expect(overview.pastLeases).toEqual([]);
    expect(overview.activeLeases).toEqual([
      expect.objectContaining({
        id: 'lease-unsigned',
        status: 'pending_signature',
        termOver: false,
        nextInvoice: null,
      }),
    ]);
  });

  it('lists applications newest first, with the equipment and the decision', async () => {
    const { applications } = await getCustomerOverview(db, 'cust-aino', '2026-11-06');
    expect(applications.map((a) => a.id)).toEqual(['app-new', 'app-old']);
    expect(applications[1]).toMatchObject({
      assetName: expect.stringContaining('Trail 500'),
      category: 'e_bike',
      decision: 'rejected',
      decisionReason: 'affordability',
      termMonths: 36,
      monthlyRentWithVatCents: 13466,
    });
  });

  it('dates an application in Finnish time', async () => {
    const { applications } = await getCustomerOverview(db, 'cust-aino', '2026-11-06');
    expect(applications[0]?.appliedOn).toBe('2026-11-05');
  });

  it('splits contracts into active and past leases, newest first', async () => {
    const { activeLeases, pastLeases } = await getCustomerOverview(db, 'cust-aino', '2026-11-06');
    expect(activeLeases.map((l) => l.id)).toEqual(['lease-newest', 'lease-active']);
    expect(pastLeases.map((l) => l.id)).toEqual([
      'lease-bought',
      'lease-returned',
      'lease-extended',
    ]);
  });

  it('says where an active lease stands', async () => {
    const { activeLeases } = await getCustomerOverview(db, 'cust-aino', '2026-11-06');
    expect(activeLeases[1]).toMatchObject({
      endDate: '2029-11-05',
      termOver: false,
      nextInvoice: { invoiceDate: '2026-12-05', grossCents: 13466 },
    });
  });

  it('keeps a lease active after its term until it is settled', async () => {
    const { activeLeases } = await getCustomerOverview(db, 'cust-aino', '2029-11-05');
    expect(activeLeases[1]).toMatchObject({ termOver: true, nextInvoice: null });
  });

  it('shows nothing that belongs to another customer', async () => {
    const overview = await getCustomerOverview(db, 'cust-mikko', '2026-11-06');
    expect(overview.applications.map((a) => a.id)).toEqual(['app-other']);
    expect(overview.activeLeases.map((l) => l.id)).toEqual(['lease-other']);
    expect(overview.pastLeases).toEqual([]);
  });

  it('keeps a row whose asset has left the data pack', async () => {
    const { applications } = await getCustomerOverview(db, 'cust-lena', '2026-11-06');
    expect(applications[0]).toMatchObject({ assetName: 'no-such-asset', category: null });
  });

  it('is empty for a customer with no history', async () => {
    expect(await getCustomerOverview(db, 'cust-sanna', '2026-11-06')).toEqual({
      customerId: 'cust-sanna',
      applications: [],
      activeLeases: [],
      pastLeases: [],
    });
  });

  it('writes nothing, so viewing the page never issues an invoice', async () => {
    await getCustomerOverview(db, 'cust-aino', '2029-11-05');
    expect(await db.invoice.count()).toBe(0);
  });
});
