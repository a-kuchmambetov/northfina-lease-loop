// Mirrors src/server/features/customers/create-customer.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAssets } from '@/data/load';
import { startApplication } from '@/server/features/application/start-application';
import { createCustomer } from '@/server/features/customers/create-customer';
import { signContract } from '@/server/features/contracts/sign-contract';
import { seedAssets } from '@/server/assets';
import { createTestDb } from '../../helpers/test-db';
import type { PrismaClient } from '@/server/prisma-client';

let db: PrismaClient;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  await seedAssets(db, await loadAssets());
});
afterAll(async () => {
  await cleanup();
});

describe('createCustomer', () => {
  it('creates a consumer profile for a signed-up user', async () => {
    const result = await createCustomer(db, {
      userId: 'user-1',
      type: 'consumer',
      name: 'Terhi Testaaja',
      country: 'FI',
      city: 'Tampere',
      email: 'terhi@example.com',
      birthDate: '1990-05-01',
      employment: 'employed',
      monthlyNetIncomeCents: 250_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await db.customer.findUniqueOrThrow({ where: { id: result.customerId } });
    expect(row).toMatchObject({ user_id: 'user-1', type: 'consumer', is_pep: false });

    const auditRow = await db.auditLog.findFirst({
      where: { entity_type: 'customer', entity_id: result.customerId, action: 'customer.created' },
    });
    expect(auditRow).not.toBeNull();
  });

  it('creates a company profile with no linked user', async () => {
    const result = await createCustomer(db, {
      type: 'company',
      name: 'Testi Oy',
      country: 'FI',
      city: 'Helsinki',
      email: 'office@testi.example.com',
      businessId: '1234567-1',
      vatRegistered: true,
      annualRevenueCents: 1_000_000,
      applicantCanSign: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = await db.customer.findUniqueOrThrow({ where: { id: result.customerId } });
    expect(row).toMatchObject({ user_id: null, type: 'company', business_id: '1234567-1' });
  });

  it('rejects a second profile for the same user', async () => {
    const first = await createCustomer(db, {
      userId: 'user-2',
      type: 'consumer',
      name: 'A',
      country: 'FI',
      city: 'Helsinki',
      email: 'a@example.com',
      birthDate: '1990-01-01',
      employment: 'employed',
      monthlyNetIncomeCents: 100_000,
    });
    expect(first.ok).toBe(true);

    const second = await createCustomer(db, {
      userId: 'user-2',
      type: 'consumer',
      name: 'B',
      country: 'FI',
      city: 'Helsinki',
      email: 'b@example.com',
      birthDate: '1990-01-01',
      employment: 'employed',
      monthlyNetIncomeCents: 100_000,
    });
    expect(second).toEqual({ ok: false, reason: 'already_a_customer' });
  });

  it('the full chain: a brand new customer applies and signs, not one of the 10 seed personas', async () => {
    const created = await createCustomer(db, {
      userId: 'user-3',
      type: 'consumer',
      name: 'Uusi Asiakas',
      country: 'FI',
      city: 'Oulu',
      email: 'uusi@example.com',
      birthDate: '1988-03-20',
      employment: 'employed',
      monthlyNetIncomeCents: 300_000,
    });
    if (!created.ok) throw new Error('setup: customer creation failed');
    const customerId = created.customerId;

    // laptop-005's list price is low enough that q_monthly_income/q_usage_purpose never
    // apply — just the plain consumer identity questions.
    const started = await startApplication(db, {
      customerId,
      assetId: 'laptop-005',
      termMonths: 24,
      downPaymentCents: 0,
      applicationDate: '2026-11-05',
    });
    if (!started.ok) throw new Error(`setup: application did not start: ${started.reason}`);

    // The new profile already answers every identity question, so nothing is left to ask
    // and the application is decided straight away.
    expect(started.nextQuestion).toBeUndefined();
    const decision = started.decision;
    expect(decision).toEqual({ decision: 'approved' });

    const signed = await signContract(db, {
      assetId: 'laptop-005',
      customerId,
      termMonths: 24,
      downPaymentCents: 0,
      signDate: '2026-11-05',
      applicationId: started.applicationId,
    });
    expect(signed).toMatchObject({ ok: true, contract: { customerId } });
  });
});
