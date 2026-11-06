// Mirrors src/server/features/contracts/sign-contract.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
// Runs against the real data pack and a real, migrated SQLite database.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAssets, loadCustomers } from '@/data/load';
import { signContract } from '@/server/features/contracts/sign-contract';
import { seedAssets } from '@/server/assets';
import { seedCustomers } from '@/server/customers';
import { addCustomerCreditEntry, getCustomerCreditBalanceCents } from '@/server/customer-credit';
import { createTestDb } from '../../helpers/test-db';
import type { PrismaClient } from '@/server/prisma-client';

async function createApplication(
  db: PrismaClient,
  input: {
    customerId: string;
    assetId: string;
    termMonths: number;
    decision: string;
    answers?: Record<string, unknown>;
  }
) {
  const id = randomUUID();
  await db.application.create({
    data: {
      id,
      customer_id: input.customerId,
      asset_id: input.assetId,
      term_months: input.termMonths,
      financed_amount_cents: 0,
      monthly_rent_with_vat_cents: 0,
      price_list_version: 1,
      answers_json: JSON.stringify(input.answers ?? {}),
      decision: input.decision,
      decided_at: input.decision === 'pending' ? null : new Date(),
    },
  });
  return id;
}

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

describe('signContract', () => {
  it('locks the net rent from the worked example in data/DATA.md and writes an audit row', async () => {
    const result = await signContract(db, {
      assetId: 'ebike-003',
      customerId: 'cust-aino',
      termMonths: 36,
      downPaymentCents: 0,
      signDate: '2026-11-05',
    });

    expect(result).toMatchObject({
      ok: true,
      contract: {
        assetId: 'ebike-003',
        customerId: 'cust-aino',
        startDate: '2026-11-05',
        termMonths: 36,
        priceListVersion: 1,
        listPriceCents: 389_000,
        financedCents: 389_000,
        monthlyNetRentCents: 10_730,
        buyoutCents: 58_350,
      },
    });
    if (!result.ok) return;

    const row = await db.contract.findUnique({ where: { id: result.contract.id } });
    expect(row).not.toBeNull();

    const auditRow = await db.auditLog.findFirst({
      where: { entity_type: 'contract', entity_id: result.contract.id },
    });
    expect(auditRow).toMatchObject({ action: 'contract.signed' });

    // Signing reserves the asset, so it cannot be leased out from under this customer.
    const asset = await db.asset.findUniqueOrThrow({ where: { id: 'ebike-003' } });
    expect(asset.status).toBe('reserved');
  });

  it('locks price-list version 2 when signed the day it starts (scenario card 2)', async () => {
    const result = await signContract(db, {
      assetId: 'laptop-004',
      customerId: 'cust-aino',
      termMonths: 24,
      downPaymentCents: 0,
      signDate: '2026-11-06',
    });
    expect(result).toMatchObject({ ok: true, contract: { priceListVersion: 2 } });
  });

  it('rejects an asset that does not exist at all', async () => {
    const result = await signContract(db, {
      assetId: 'nope',
      customerId: 'cust-aino',
      termMonths: 36,
      downPaymentCents: 0,
      signDate: '2026-11-05',
    });
    expect(result).toEqual({ ok: false, reason: 'asset_not_found' });
  });

  it('rejects an asset that is already leased (reserved), not just not-found', async () => {
    // ebike-003 was reserved by the first test in this file.
    const result = await signContract(db, {
      assetId: 'ebike-003',
      customerId: 'cust-mikko',
      termMonths: 24,
      downPaymentCents: 0,
      signDate: '2026-11-05',
    });
    expect(result).toEqual({ ok: false, reason: 'asset_not_available' });
  });

  it('rejects a customer that does not exist in the data pack', async () => {
    const result = await signContract(db, {
      assetId: 'ebike-005',
      customerId: 'cust-does-not-exist',
      termMonths: 24,
      downPaymentCents: 0,
      signDate: '2026-11-05',
    });
    expect(result).toEqual({ ok: false, reason: 'unknown_customer' });
  });

  it("applies the customer's credit toward the down payment, then spends it", async () => {
    await addCustomerCreditEntry(db, {
      customerId: 'cust-haapala',
      amountCents: 20_000,
      reason: 'pass_on_bonus',
      actor: 'system',
    });

    const result = await signContract(db, {
      assetId: 'ebike-002',
      customerId: 'cust-haapala',
      termMonths: 24,
      downPaymentCents: 10_000,
      creditCentsToApply: 15_000,
      signDate: '2026-11-05',
    });

    expect(result).toMatchObject({ ok: true, contract: { downPaymentCents: 25_000 } });

    const balance = await getCustomerCreditBalanceCents(db, 'cust-haapala');
    expect(balance).toBe(5_000); // 20000 earned - 15000 spent
  });

  it('rejects applying more credit than the customer has', async () => {
    const result = await signContract(db, {
      assetId: 'ebike-006',
      customerId: 'cust-mikko', // has 0 credit
      termMonths: 24,
      downPaymentCents: 0,
      creditCentsToApply: 1_000,
      signDate: '2026-11-05',
    });
    expect(result).toEqual({ ok: false, reason: 'insufficient_credit' });
  });

  it('passes through a term the coefficient table does not have', async () => {
    const result = await signContract(db, {
      assetId: 'ebike-001',
      customerId: 'cust-aino',
      termMonths: 18,
      downPaymentCents: 0,
      signDate: '2026-11-05',
    });
    expect(result).toEqual({ ok: false, reason: 'unknown_term' });
  });

  it('signs active with an approved application that needed no co-signer', async () => {
    const applicationId = await createApplication(db, {
      customerId: 'cust-sanna',
      assetId: 'ebike-012',
      termMonths: 12,
      decision: 'approved',
      answers: { q_customer_type: 'consumer' },
    });

    const result = await signContract(db, {
      assetId: 'ebike-012',
      customerId: 'cust-sanna',
      termMonths: 12,
      downPaymentCents: 0,
      signDate: '2026-11-05',
      applicationId,
    });
    expect(result).toMatchObject({ ok: true, contract: { customerId: 'cust-sanna' } });
    if (!result.ok) return;

    const row = await db.contract.findUniqueOrThrow({ where: { id: result.contract.id } });
    expect(row.status).toBe('active');
    expect(row.pending_signatory_email).toBeNull();

    // Active from the start, so invoice #1 is issued right away.
    const invoice = await db.invoice.findFirst({ where: { contract_id: result.contract.id } });
    expect(invoice).not.toBeNull();
  });

  it("signs pending_signature when the application's own answers say the applicant can't sign (scenario card 6)", async () => {
    const applicationId = await createApplication(db, {
      customerId: 'cust-norvi',
      assetId: 'ebike-004',
      termMonths: 24,
      decision: 'approved',
      answers: {
        q_customer_type: 'company',
        q_can_sign: 'no',
        q_signatory_email: 'someone@norvi.example.com',
      },
    });

    const result = await signContract(db, {
      assetId: 'ebike-004',
      customerId: 'cust-norvi',
      termMonths: 24,
      downPaymentCents: 0,
      signDate: '2026-11-05',
      applicationId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await db.contract.findUniqueOrThrow({ where: { id: result.contract.id } });
    expect(row.status).toBe('pending_signature');
    expect(row.pending_signatory_email).toBe('someone@norvi.example.com');

    // Not active yet, so no invoice should exist.
    const invoice = await db.invoice.findFirst({ where: { contract_id: result.contract.id } });
    expect(invoice).toBeNull();
  });

  it('rejects signing against an application that does not exist', async () => {
    const result = await signContract(db, {
      assetId: 'laptop-002',
      customerId: 'cust-aino',
      termMonths: 24,
      downPaymentCents: 0,
      signDate: '2026-11-05',
      applicationId: 'app-does-not-exist',
    });
    expect(result).toEqual({ ok: false, reason: 'application_not_found' });
  });

  it('rejects signing against an application that is not approved', async () => {
    const applicationId = await createApplication(db, {
      customerId: 'cust-mikko',
      assetId: 'laptop-008',
      termMonths: 24,
      decision: 'rejected',
    });

    const result = await signContract(db, {
      assetId: 'laptop-008',
      customerId: 'cust-mikko',
      termMonths: 24,
      downPaymentCents: 0,
      signDate: '2026-11-05',
      applicationId,
    });
    expect(result).toEqual({ ok: false, reason: 'application_not_approved' });
  });

  it('rejects signing an asset the application was not approved for', async () => {
    const applicationId = await createApplication(db, {
      customerId: 'cust-sanna',
      assetId: 'laptop-003',
      termMonths: 12,
      decision: 'approved',
    });

    const result = await signContract(db, {
      assetId: 'laptop-009', // different asset than the application names
      customerId: 'cust-sanna',
      termMonths: 12,
      downPaymentCents: 0,
      signDate: '2026-11-05',
      applicationId,
    });
    expect(result).toEqual({ ok: false, reason: 'application_mismatch' });
  });
});
