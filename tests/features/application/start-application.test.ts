// Mirrors src/server/features/application/start-application.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCustomers } from '@/data/load';
import { startApplication } from '@/server/features/application/start-application';
import { seedCustomers } from '@/server/customers';
import { createTestDb } from '../../helpers/test-db';
import type { PrismaClient } from '@/server/prisma-client';

let db: PrismaClient;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  await seedCustomers(db, await loadCustomers());
});
afterAll(async () => {
  await cleanup();
});

describe('startApplication', () => {
  it('locks the quote onto a new pending application and asks the first question', async () => {
    const result = await startApplication(db, {
      customerId: 'cust-aino',
      assetId: 'ebike-003',
      termMonths: 36,
      downPaymentCents: 0,
      applicationDate: '2026-11-05',
    });

    expect(result).toMatchObject({ ok: true, nextQuestion: { id: 'q_customer_type' } });
    if (!result.ok) return;

    const row = await db.application.findUnique({ where: { id: result.applicationId } });
    expect(row).toMatchObject({
      customer_id: 'cust-aino',
      asset_id: 'ebike-003',
      term_months: 36,
      financed_amount_cents: 389_000,
      decision: 'pending',
      answers_json: '{}',
    });

    const auditRow = await db.auditLog.findFirst({
      where: { entity_type: 'application', entity_id: result.applicationId },
    });
    expect(auditRow).toMatchObject({ action: 'application.started' });
  });

  it('rejects an unknown customer', async () => {
    const result = await startApplication(db, {
      customerId: 'cust-does-not-exist',
      assetId: 'ebike-003',
      termMonths: 36,
      downPaymentCents: 0,
      applicationDate: '2026-11-05',
    });
    expect(result).toEqual({ ok: false, reason: 'unknown_customer' });
  });

  it('rejects an unknown asset', async () => {
    const result = await startApplication(db, {
      customerId: 'cust-aino',
      assetId: 'ebike-does-not-exist',
      termMonths: 36,
      downPaymentCents: 0,
      applicationDate: '2026-11-05',
    });
    expect(result).toEqual({ ok: false, reason: 'unknown_asset' });
  });
});
