// Mirrors src/server/features/contracts/confirm-signature.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAssets, loadCustomers } from '@/data/load';
import { confirmContractSignature } from '@/server/features/contracts/confirm-signature';
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

async function createPendingApplication(assetId: string, termMonths: number) {
  const id = randomUUID();
  await db.application.create({
    data: {
      id,
      customer_id: 'cust-norvi',
      asset_id: assetId,
      term_months: termMonths,
      financed_amount_cents: 0,
      monthly_rent_with_vat_cents: 0,
      price_list_version: 1,
      answers_json: JSON.stringify({
        q_customer_type: 'company',
        q_can_sign: 'no',
        q_signatory_email: 'someone@norvi.example.com',
      }),
      decision: 'approved',
      decided_at: new Date(),
    },
  });
  return id;
}

describe('confirmContractSignature', () => {
  it('flips a pending_signature contract active and issues its first invoice', async () => {
    const applicationId = await createPendingApplication('ebike-004', 24);
    const signed = await signContract(db, {
      assetId: 'ebike-004',
      customerId: 'cust-norvi',
      termMonths: 24,
      downPaymentCents: 0,
      signDate: '2026-11-05',
      applicationId,
    });
    if (!signed.ok) throw new Error('setup: signing failed');

    const before = await db.contract.findUniqueOrThrow({ where: { id: signed.contract.id } });
    expect(before.status).toBe('pending_signature');

    const result = await confirmContractSignature(db, signed.contract.id, '2026-11-05');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invoices).toHaveLength(1);
    expect(result.invoices[0]).toMatchObject({ sequenceNumber: 1, invoiceDate: '2026-11-05' });

    const after = await db.contract.findUniqueOrThrow({ where: { id: signed.contract.id } });
    expect(after.status).toBe('active');

    const auditRow = await db.auditLog.findFirst({
      where: {
        entity_type: 'contract',
        entity_id: signed.contract.id,
        action: 'contract.signature_confirmed',
      },
    });
    expect(auditRow).not.toBeNull();
  });

  it('rejects confirming a contract that is already active', async () => {
    const signed = await signContract(db, {
      assetId: 'laptop-005',
      customerId: 'cust-aino',
      termMonths: 12,
      downPaymentCents: 0,
      signDate: '2026-11-05',
    });
    if (!signed.ok) throw new Error('setup: signing failed');

    const result = await confirmContractSignature(db, signed.contract.id, '2026-11-05');
    expect(result).toEqual({ ok: false, reason: 'not_pending_signature' });
  });

  it('rejects an unknown contract', async () => {
    const result = await confirmContractSignature(db, 'contract-does-not-exist', '2026-11-05');
    expect(result).toEqual({ ok: false, reason: 'contract_not_found' });
  });
});
