// Mirrors src/server/features/contracts/sign-application-contract.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
// Runs against the real data pack and a real, migrated SQLite database.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAssets, loadCustomers } from '@/data/load';
import { seedAssets } from '@/server/assets';
import { seedCustomers } from '@/server/customers';
import { startApplication } from '@/server/features/application/start-application';
import { cancelApplication } from '@/server/features/application/cancel-application';
import { signApplicationContract } from '@/server/features/contracts/sign-application-contract';
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

async function start(
  assetId: string,
  { downPaymentCents = 0, applicationDate = '2026-11-05', decision = 'approved' } = {}
): Promise<string> {
  const result = await startApplication(db, {
    customerId: 'cust-aino',
    assetId,
    termMonths: 36,
    downPaymentCents,
    applicationDate,
  });
  if (!result.ok) throw new Error(`setup: could not start, ${result.reason}`);
  await db.application.update({ where: { id: result.applicationId }, data: { decision } });
  return result.applicationId;
}

const sign = (
  applicationId: string,
  overrides: { signedName?: string; customerId?: string; signDate?: string } = {}
) =>
  signApplicationContract(db, {
    applicationId,
    customerId: overrides.customerId ?? 'cust-aino',
    signedName: overrides.signedName ?? 'Aino Virtanen',
    signDate: overrides.signDate ?? '2026-11-06',
    actor: 'user-1',
  });

describe('signApplicationContract', () => {
  it('forms the contract from the approved application, records the signature and closes the application', async () => {
    const applicationId = await start('ebike-003');

    const result = await sign(applicationId, { signedName: '  Aino   Virtanen ' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const contract = await db.contract.findUniqueOrThrow({ where: { id: result.contractId } });
    expect(contract).toMatchObject({
      asset_id: 'ebike-003',
      customer_id: 'cust-aino',
      start_date: '2026-11-06',
      term_months: 36,
      application_id: applicationId,
      signed_name: 'Aino Virtanen',
      status: 'active',
      // The worked example in data/DATA.md: 389000 cents, 36 months, no down payment.
      financed_cents: 389_000,
      monthly_net_rent_cents: 10_730,
    });

    expect(await db.application.findUniqueOrThrow({ where: { id: applicationId } })).toMatchObject({
      decision: 'signed',
      decision_reason: 'contract_signed',
    });
    expect((await db.asset.findUniqueOrThrow({ where: { id: 'ebike-003' } })).status).toBe(
      'reserved'
    );
    // Invoice #1 is dated the day the contract is signed.
    expect(await db.invoice.count({ where: { contract_id: result.contractId } })).toBe(1);

    const audit = await db.auditLog.findMany({
      where: { entity_id: { in: [applicationId, result.contractId] } },
      orderBy: { id: 'asc' },
    });
    expect(audit.map((row) => row.action)).toEqual([
      'application.started',
      'contract.signed',
      'invoices.issued',
      'application.signed',
    ]);
    expect(JSON.parse(audit[1]!.details_json!)).toEqual({
      applicationId,
      signedName: 'Aino Virtanen',
    });
  });

  it('locks the price the application was approved at, not the price list live on the signing day', async () => {
    // Applied on 5 Nov (price list v1), signed on 6 Nov, when v2 is live (e-bikes +5 %).
    const applicationId = await start('ebike-001');
    const result = await sign(applicationId, { signDate: '2026-11-06' });
    if (!result.ok) throw new Error(result.reason);

    const contract = await db.contract.findUniqueOrThrow({ where: { id: result.contractId } });
    expect(contract.price_list_version).toBe(1);
    expect(contract.list_price_cents).toBe(189_900);
    expect(contract.financed_cents).toBe(189_900);
  });

  it('keeps the down payment the application was quoted with', async () => {
    const applicationId = await start('ebike-005', { downPaymentCents: 50_000 });
    const result = await sign(applicationId);
    if (!result.ok) throw new Error(result.reason);

    const contract = await db.contract.findUniqueOrThrow({ where: { id: result.contractId } });
    const application = await db.application.findUniqueOrThrow({ where: { id: applicationId } });
    expect(contract.down_payment_cents).toBe(50_000);
    expect(contract.financed_cents).toBe(application.financed_amount_cents);
  });

  it('refuses a second signing of the same application', async () => {
    const applicationId = await start('ebike-006');
    expect((await sign(applicationId)).ok).toBe(true);

    expect(await sign(applicationId)).toEqual({ ok: false, reason: 'already_signed' });
    expect(await db.contract.count({ where: { application_id: applicationId } })).toBe(1);
  });

  it('lets only one of two simultaneous signings through', async () => {
    const applicationId = await start('ebike-004');
    const results = await Promise.all([sign(applicationId), sign(applicationId)]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await db.contract.count({ where: { application_id: applicationId } })).toBe(1);
  });

  it.each(['pending', 'rejected', 'manual_review'])(
    'refuses a %s application and creates nothing',
    async (decision) => {
      const applicationId = await start('laptop-001', { decision });

      expect(await sign(applicationId)).toEqual({ ok: false, reason: 'not_approved' });
      expect(await db.contract.count({ where: { application_id: applicationId } })).toBe(0);
    }
  );

  it('refuses an application that was cancelled', async () => {
    const applicationId = await start('laptop-002');
    await cancelApplication(db, { applicationId, customerId: 'cust-aino', actor: 'user-1' });

    expect(await sign(applicationId)).toEqual({ ok: false, reason: 'not_approved' });
  });

  it('cannot cancel an application once it is signed', async () => {
    const applicationId = await start('laptop-003');
    expect((await sign(applicationId)).ok).toBe(true);

    expect(
      await cancelApplication(db, { applicationId, customerId: 'cust-aino', actor: 'user-1' })
    ).toEqual({ ok: false, reason: 'not_cancellable' });
  });

  it.each([
    ['', 'signature_too_short'],
    ['   ', 'signature_too_short'],
    ['x'.repeat(101), 'signature_too_long'],
  ])('refuses the signature %j without signing', async (signedName, reason) => {
    const applicationId = await start('laptop-005');

    expect(await sign(applicationId, { signedName })).toEqual({ ok: false, reason });
    expect(await db.contract.count({ where: { application_id: applicationId } })).toBe(0);
    expect(
      (await db.application.findUniqueOrThrow({ where: { id: applicationId } })).decision
    ).toBe('approved');
  });

  it("treats someone else's application like one that doesn't exist", async () => {
    const applicationId = await start('laptop-006');

    expect(await sign(applicationId, { customerId: 'cust-mikko' })).toEqual({
      ok: false,
      reason: 'unknown_application',
    });
    expect(await sign('no-such-application')).toEqual({
      ok: false,
      reason: 'unknown_application',
    });
  });

  it('refuses when the item has been leased to someone else since', async () => {
    const applicationId = await start('laptop-009');
    await db.asset.update({ where: { id: 'laptop-009' }, data: { status: 'reserved' } });

    expect(await sign(applicationId)).toEqual({ ok: false, reason: 'asset_not_available' });
    expect(await db.contract.count({ where: { application_id: applicationId } })).toBe(0);
    expect(
      (await db.application.findUniqueOrThrow({ where: { id: applicationId } })).decision
    ).toBe('approved');
  });
});
