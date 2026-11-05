// Mirrors src/server/features/contracts/sign-contract.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
// Runs against the real data pack and a real, migrated SQLite database.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signContract } from '@/server/features/contracts/sign-contract';
import { createTestDb } from '../../helpers/test-db';
import type { PrismaClient } from '@/server/prisma-client';

let db: PrismaClient;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
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

  it('rejects an asset that is not in the price list', async () => {
    const result = await signContract(db, {
      assetId: 'nope',
      customerId: 'cust-aino',
      termMonths: 36,
      downPaymentCents: 0,
      signDate: '2026-11-05',
    });
    expect(result).toEqual({ ok: false, reason: 'unknown_asset' });
  });

  it('passes through a term the coefficient table does not have', async () => {
    const result = await signContract(db, {
      assetId: 'ebike-003',
      customerId: 'cust-aino',
      termMonths: 18,
      downPaymentCents: 0,
      signDate: '2026-11-05',
    });
    expect(result).toEqual({ ok: false, reason: 'unknown_term' });
  });
});
