// Mirrors src/server/features/supplier-equipment/get-supplier-equipment.ts — see AGENTS.md
// and src/server/README.md for why tests for src/server/features/** live here.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAssets, loadCustomers } from '@/data/load';
import { seedAssets } from '@/server/assets';
import { seedCustomers } from '@/server/customers';
import { signContract } from '@/server/features/contracts/sign-contract';
import { payInvoice } from '@/server/features/contracts/pay-invoice';
import { returnLease } from '@/server/features/return-lease/return-lease';
import { getSupplierEquipment } from '@/server/features/supplier-equipment/get-supplier-equipment';
import { createTestDb } from '../../helpers/test-db';
import type { PrismaClient } from '@/server/prisma-client';

let db: PrismaClient;
let cleanup: () => Promise<void>;
let ownItems: string[];
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  const assets = await loadAssets();
  await seedAssets(db, assets);
  await seedCustomers(db, await loadCustomers());
  ownItems = assets.filter((asset) => asset.make === 'Kettu Bikes').map((asset) => asset.id);
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.invoice.deleteMany();
  await db.contract.deleteMany();
  await db.application.deleteMany();
  await db.auditLog.deleteMany();
  const assets = await loadAssets();
  for (const asset of assets) {
    await db.asset.update({
      where: { id: asset.id },
      data: {
        status: asset.status,
        condition: asset.condition,
        usage_value: asset.usage.value,
        lifetime_usage_value: asset.usage.value,
      },
    });
  }
});

const get = (supplierName = 'Kettu Bikes', today = '2026-11-20') =>
  getSupplierEquipment(db, { supplierName, today });
const byId = async (...args: Parameters<typeof get>) =>
  Object.fromEntries((await get(...args)).map((item) => [item.assetId, item]));

async function lease(assetId: string, signDate = '2026-11-05', termMonths = 12) {
  const signed = await signContract(db, {
    assetId,
    customerId: 'cust-aino',
    termMonths,
    downPaymentCents: 0,
    signDate,
  });
  if (!signed.ok) throw new Error(signed.reason);
  return signed.contract;
}

describe('getSupplierEquipment', () => {
  it('lists only the items of the supplier whose name is the make', async () => {
    const items = await get('Kettu Bikes');

    expect(items.map((item) => item.assetId)).toEqual(ownItems);
    expect(items.every((item) => item.name.startsWith('Kettu Bikes '))).toBe(true);
  });

  it('matches the name loosely, and lists nothing for a name no brand has', async () => {
    expect((await get('  kettu   BIKES ')).length).toBe(ownItems.length);
    expect(await get('Nobody')).toEqual([]);
    expect(await get('')).toEqual([]);
  });

  it('shows an unleased item as available, with no contract', async () => {
    const [item] = await get();

    expect(item).toMatchObject({ status: 'available', contract: null, application: null });
    expect(item!.serialNumber).toMatch(/^LL-/);
  });

  it('shows a running lease as leased, with its contract, renter and end date', async () => {
    const contract = await lease(ownItems[0]!);

    const item = (await byId())[ownItems[0]!]!;

    expect(item.status).toBe('leased');
    expect(item.contract).toMatchObject({
      id: contract.id,
      code: `LL-${contract.id.slice(0, 6).toUpperCase()}`,
      renter: 'Aino Virtanen',
      status: 'active',
      startDate: '2026-11-05',
      endDate: '2027-11-05',
      termMonths: 12,
      monthlyNetRentCents: contract.monthlyNetRentCents,
      buyoutCents: contract.buyoutCents,
      returnedOn: null,
    });
  });

  it('shows a lease past its term, not yet settled, as contract_ended', async () => {
    await lease(ownItems[0]!);

    expect((await byId('Kettu Bikes', '2027-11-04'))[ownItems[0]!]!.status).toBe('leased');
    expect((await byId('Kettu Bikes', '2027-11-05'))[ownItems[0]!]!.status).toBe('contract_ended');
  });

  it('shows the original agreed total and paid invoices for the selected contract', async () => {
    const contract = await lease(ownItems[0]!);
    await lease(ownItems[1]!);
    const invoice = await db.invoice.findFirstOrThrow({ where: { contract_id: contract.id } });
    expect((await byId())[ownItems[0]!]!.contract).toMatchObject({
      downPaymentCents: 0,
      agreedNetCents: contract.monthlyNetRentCents * 12,
      paidInvoicesCents: 0,
    });

    await payInvoice(db, invoice.id);
    const items = await byId();
    expect(items[ownItems[0]!]!.contract!.paidInvoicesCents).toBe(invoice.gross_cents);
    expect(items[ownItems[1]!]!.contract!.paidInvoicesCents).toBe(0);
  });

  it('names the renter after the name typed at signing when there is one', async () => {
    const contract = await lease(ownItems[0]!);
    await db.contract.update({ where: { id: contract.id }, data: { signed_name: 'Artem K.' } });

    expect((await byId())[ownItems[0]!]!.contract!.renter).toBe('Artem K.');
  });

  it('shows a returned item as returned, with the day it came back', async () => {
    const contract = await lease(ownItems[0]!);
    await returnLease(db, {
      contractId: contract.id,
      customerId: 'cust-aino',
      asOfDate: '2026-11-20',
      confirm: true,
    });

    const item = (await byId())[ownItems[0]!]!;

    expect(item.status).toBe('returned');
    expect(item.contract).toMatchObject({ status: 'returned' });
    expect(item.contract!.returnedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('shows an item with an application waiting for review as manual_approval', async () => {
    await db.application.create({
      data: {
        id: 'abcdef12-0000',
        customer_id: 'cust-aino',
        asset_id: ownItems[1]!,
        term_months: 12,
        financed_amount_cents: 100_000,
        monthly_rent_with_vat_cents: 10_000,
        price_list_version: 1,
        answers_json: '{}',
        decision: 'manual_review',
      },
    });

    const item = (await byId())[ownItems[1]!]!;

    expect(item.status).toBe('manual_approval');
    expect(item.application).toMatchObject({ code: 'AP-ABCDEF' });
  });

  it('ignores applications that are not waiting for review', async () => {
    for (const decision of ['pending', 'approved', 'rejected', 'cancelled', 'signed']) {
      await db.application.create({
        data: {
          id: `app-${decision}`,
          customer_id: 'cust-aino',
          asset_id: ownItems[1]!,
          term_months: 12,
          financed_amount_cents: 100_000,
          monthly_rent_with_vat_cents: 10_000,
          price_list_version: 1,
          answers_json: '{}',
          decision,
        },
      });
    }

    expect((await byId())[ownItems[1]!]!.status).toBe('available');
  });

  it("does not show another supplier's items or leases", async () => {
    await lease('ebike-004'); // Nordvolt

    expect((await get('Kettu Bikes')).some((item) => item.assetId === 'ebike-004')).toBe(false);
    expect((await byId('Nordvolt'))['ebike-004']).toMatchObject({ status: 'leased' });
  });

  it('shows the latest contract of an item that has been leased more than once', async () => {
    const first = await lease(ownItems[0]!, '2026-01-05');
    await returnLease(db, {
      contractId: first.id,
      customerId: 'cust-aino',
      asOfDate: '2026-02-05',
      confirm: true,
    });
    await db.asset.update({ where: { id: ownItems[0]! }, data: { status: 'available' } });
    const second = await lease(ownItems[0]!, '2026-11-05');

    const item = (await byId())[ownItems[0]!]!;

    expect(item.contract!.id).toBe(second.id);
    expect(item.status).toBe('leased');
  });
});
