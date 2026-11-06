// Mirrors src/server/features/audit-log/get-audit-log.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAssets, loadCustomers } from '@/data/load';
import { seedAssets } from '@/server/assets';
import { seedCustomers } from '@/server/customers';
import { getAuditLog } from '@/server/features/audit-log/get-audit-log';
import { issueDueInvoices } from '@/server/features/contracts/issue-invoices';
import { signContract } from '@/server/features/contracts/sign-contract';
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
  await db.invoice.deleteMany();
  await db.contract.deleteMany();
  await db.application.deleteMany();
  await db.auditLog.deleteMany();
  // Signing reserves an asset; put every item back as the data pack has it.
  for (const asset of await loadAssets()) {
    await db.asset.update({
      where: { id: asset.id },
      data: { status: asset.status, condition: asset.condition, usage_value: asset.usage.value },
    });
  }
});

const SECRET = 'applicant-secret-pep-flag';

async function lease(assetId: string) {
  const signed = await signContract(db, {
    assetId,
    customerId: 'cust-aino',
    termMonths: 12,
    downPaymentCents: 0,
    signDate: '2026-11-05',
  });
  if (!signed.ok) throw new Error(signed.reason);
  const issued = await issueDueInvoices(db, signed.contract.id, '2026-12-20');
  if (!issued.ok) throw new Error(issued.reason);
  return { contractId: signed.contract.id, invoiceId: issued.invoices[0]!.id };
}

async function application(assetId: string, id: string) {
  await db.application.create({
    data: {
      id,
      customer_id: 'cust-aino',
      asset_id: assetId,
      term_months: 12,
      financed_amount_cents: 100000,
      monthly_rent_with_vat_cents: 10000,
      price_list_version: 1,
      answers_json: '{}',
      decision: 'manual_review',
    },
  });
  await db.auditLog.create({
    data: {
      actor: 'customer',
      action: 'application.decided',
      entity_type: 'application',
      entity_id: id,
      details_json: JSON.stringify({ reason: SECRET }),
    },
  });
}

const asSupplier = (accountName: string, limit?: number) =>
  getAuditLog(db, { accountType: 'supplier', accountName, limit });

async function entries(accountName: string) {
  const result = await asSupplier(accountName);
  if (!result.ok) throw new Error(result.reason);
  return result.entries;
}

describe('getAuditLog', () => {
  it('denies a customer account', async () => {
    await lease('ebike-001');
    expect(await getAuditLog(db, { accountType: 'customer', accountName: 'Aino' })).toEqual({
      ok: false,
      reason: 'forbidden',
    });
  });

  it('denies an account with no type, and a customer named like a supplier', async () => {
    await lease('ebike-001');
    expect(await getAuditLog(db, { accountType: undefined, accountName: 'Kettu Bikes' })).toEqual({
      ok: false,
      reason: 'forbidden',
    });
    expect(await getAuditLog(db, { accountType: 'customer', accountName: 'Kettu Bikes' })).toEqual({
      ok: false,
      reason: 'forbidden',
    });
  });

  it('gives a supplier the rows about their asset, contract, application and invoice', async () => {
    const { contractId, invoiceId } = await lease('ebike-001');
    await application('ebike-002', 'app-kettu');
    await db.auditLog.create({
      data: {
        actor: 'customer',
        action: 'invoice.paid',
        entity_type: 'invoice',
        entity_id: invoiceId,
      },
    });
    const rows = await entries('Kettu Bikes');
    const seen = rows.map((row) => `${row.entity_type}:${row.entity_id}`);
    expect(seen).toEqual(
      expect.arrayContaining([
        'asset:ebike-001',
        `contract:${contractId}`,
        'application:app-kettu',
        `invoice:${invoiceId}`,
      ])
    );
    expect(
      rows.every((row) => ['asset', 'contract', 'application', 'invoice'].includes(row.entity_type))
    ).toBe(true);
  });

  it("does not show a supplier another supplier's rows", async () => {
    const kettu = await lease('ebike-001');
    const nordvolt = await lease('ebike-003');
    await application('ebike-004', 'app-nordvolt');
    const ids = (await entries('Kettu Bikes')).map((row) => row.entity_id);
    expect(ids).toContain(kettu.contractId);
    expect(ids).not.toContain(nordvolt.contractId);
    expect(ids).not.toContain(nordvolt.invoiceId);
    expect(ids).not.toContain('ebike-003');
    expect(ids).not.toContain('app-nordvolt');

    const theirs = (await entries('Nordvolt')).map((row) => row.entity_id);
    expect(theirs).toContain(nordvolt.contractId);
    expect(theirs).toContain('app-nordvolt');
    expect(theirs).not.toContain(kettu.contractId);
  });

  it('matches the supplier name like the catalogue does (capitals, extra spaces)', async () => {
    await lease('ebike-001');
    expect((await entries('  kettu   BIKES ')).length).toBeGreaterThan(0);
  });

  it('never returns customer or customer-credit rows, nor auth rows', async () => {
    await lease('ebike-001');
    await db.auditLog.createMany({
      data: [
        {
          actor: 'customer',
          action: 'customer.created',
          entity_type: 'customer',
          entity_id: 'cust-aino',
        },
        {
          actor: 'customer',
          action: 'customer_credit.earned',
          entity_type: 'customer_credit',
          entity_id: 'cc-1',
        },
        { actor: 'x', action: 'auth.sign_in', entity_type: 'asset', entity_id: 'ebike-001' },
      ],
    });
    const rows = await entries('Kettu Bikes');
    expect(rows.some((row) => row.entity_type === 'customer')).toBe(false);
    expect(rows.some((row) => row.entity_type === 'customer_credit')).toBe(false);
    expect(rows.some((row) => row.action.startsWith('auth.'))).toBe(false);
  });

  it('never leaks the details JSON', async () => {
    await lease('ebike-001');
    await application('ebike-002', 'app-kettu');
    const result = await asSupplier('Kettu Bikes');
    if (!result.ok) throw new Error('expected ok');
    expect(result.entries.length).toBeGreaterThan(0);
    for (const row of result.entries) expect(row).not.toHaveProperty('details');
    expect(JSON.stringify(result.entries)).not.toContain(SECRET);
    expect(JSON.stringify(result.entries)).not.toContain('details_json');
  });

  it('returns newest first and respects the limit', async () => {
    await lease('ebike-001');
    await lease('ebike-002');
    const all = await entries('Kettu Bikes');
    expect(all.length).toBeGreaterThan(2);
    const ids = all.map((row) => row.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    const result = await asSupplier('Kettu Bikes', 2);
    if (!result.ok) throw new Error('expected ok');
    expect(result.entries.map((row) => row.id)).toEqual(ids.slice(0, 2));
  });

  it('is empty for a supplier with no equipment, or with a blank name', async () => {
    await lease('ebike-001');
    expect(await entries('Unknown Supplier')).toEqual([]);
    expect(await entries('   ')).toEqual([]);
  });
});
