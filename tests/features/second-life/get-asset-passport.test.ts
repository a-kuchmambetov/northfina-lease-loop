// Mirrors src/server/features/second-life/get-asset-passport.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAssets, loadCustomers } from '@/data/load';
import { getAssetPassport } from '@/server/features/second-life/get-asset-passport';
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

async function contract(input: {
  assetId: string;
  customerId: string;
  startDate: string;
  signedAt: Date;
  status: string;
  monthlyNetRentCents?: number;
}) {
  return db.contract.create({
    data: {
      id: randomUUID(),
      asset_id: input.assetId,
      customer_id: input.customerId,
      start_date: input.startDate,
      term_months: 24,
      price_list_version: 1,
      list_price_cents: 179_900,
      down_payment_cents: 0,
      financed_cents: 179_900,
      monthly_net_rent_cents: input.monthlyNetRentCents ?? 0,
      buyout_cents: 0,
      status: input.status,
      signed_at: input.signedAt,
    },
  });
}

describe('getAssetPassport', () => {
  it("scenario card 10: ebike-008's third life, two second lives, one refurbished", async () => {
    await contract({
      assetId: 'ebike-008',
      customerId: 'cust-aino',
      startDate: '2023-01-01',
      signedAt: new Date('2023-01-01T00:00:00Z'),
      status: 'returned',
      monthlyNetRentCents: 5_000,
    });
    // Refurbished between life 1 and life 2.
    await db.auditLog.create({
      data: {
        actor: 'system',
        action: 'second_life.refurbished',
        entity_type: 'asset',
        entity_id: 'ebike-008',
        created_at: new Date('2024-12-15T00:00:00Z'),
      },
    });
    await contract({
      assetId: 'ebike-008',
      customerId: 'cust-pekka',
      startDate: '2025-01-01',
      signedAt: new Date('2025-01-01T00:00:00Z'),
      status: 'returned',
      monthlyNetRentCents: 3_000,
    });
    // Life 2 -> life 3: no refurbishment audit row (matched as-is).
    await contract({
      assetId: 'ebike-008',
      customerId: 'cust-sanna',
      startDate: '2026-01-01',
      signedAt: new Date('2026-01-01T00:00:00Z'),
      status: 'active',
      monthlyNetRentCents: 2_000,
    });

    const result = await getAssetPassport(db, 'ebike-008');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.passport.lives).toHaveLength(3);
    expect(result.passport.lives.map((life) => life.customerId)).toEqual([
      'cust-aino',
      'cust-pekka',
      'cust-sanna',
    ]);
    expect(result.passport.lives[0]!.wasRefurbished).toBe(false); // the first life, never "second"
    expect(result.passport.lives[1]!.wasRefurbished).toBe(true);
    expect(result.passport.lives[2]!.wasRefurbished).toBe(false);
    expect(result.passport.lives[0]!.co2SavedKg).toBe(0); // the first life earns no credit
    expect(result.passport.lives[0]!.moneySavedCents).toBe(0);

    // Two second lives: one refurbished (165 * (1 - 0.12) = 145.2), one as-is (165).
    // Plus the e-bike's car-km credit off its current usage (9800 km * 0.15 = 1470).
    expect(result.passport.lives[1]!.co2SavedKg).toBe(145.2);
    expect(result.passport.lives[2]!.co2SavedKg).toBe(165);
    expect(result.passport.totalCo2SavedKg).toBe(145.2 + 165 + 1470);

    // Each second/third life's own full contract revenue (monthly rent x 24 months).
    expect(result.passport.lives[1]!.moneySavedCents).toBe(3_000 * 24);
    expect(result.passport.lives[2]!.moneySavedCents).toBe(2_000 * 24);
    expect(result.passport.totalMoneySavedCents).toBe(3_000 * 24 + 2_000 * 24);
  });

  it("counts an e-bike's lifetime km for CO2, not the since-battery-reset counter", async () => {
    // After a battery replacement usage_value is 0, but the 20,000 km already ridden still
    // avoided car trips (KNOWN_ISSUES.md item 5): 20000 * 0.15 = 3000 kg.
    await db.asset.update({
      where: { id: 'ebike-009' },
      data: { usage_value: 0, lifetime_usage_value: 20_000 },
    });
    const result = await getAssetPassport(db, 'ebike-009');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.passport.totalCo2SavedKg).toBe(3_000);
  });

  it('is 0 lives and 0 CO2/money saved for an item with no contracts yet', async () => {
    const result = await getAssetPassport(db, 'ebike-001');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.passport.lives).toEqual([]);
    expect(result.passport.totalCo2SavedKg).toBe(0);
    expect(result.passport.totalMoneySavedCents).toBe(0);
  });

  it('rejects an unknown asset', async () => {
    const result = await getAssetPassport(db, 'ebike-does-not-exist');
    expect(result).toEqual({ ok: false, reason: 'asset_not_found' });
  });
});
