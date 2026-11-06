// Mirrors src/server/features/second-life/get-fleet-impact.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAssets, loadCustomers } from '@/data/load';
import { getFleetImpact } from '@/server/features/second-life/get-fleet-impact';
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

async function contract(assetId: string, startDate: string, monthlyNetRentCents: number) {
  return db.contract.create({
    data: {
      id: randomUUID(),
      asset_id: assetId,
      customer_id: 'cust-aino',
      start_date: startDate,
      term_months: 12,
      price_list_version: 1,
      list_price_cents: 189_900,
      down_payment_cents: 0,
      financed_cents: 189_900,
      monthly_net_rent_cents: monthlyNetRentCents,
      buyout_cents: 0,
      status: 'returned',
      signed_at: new Date(`${startDate}T00:00:00Z`),
    },
  });
}

describe('getFleetImpact', () => {
  it('sums CO2 and money saved across every asset with at least one second life', async () => {
    // ebike-001: one second life, as-is (no refurbishment audit row).
    await contract('ebike-001', '2025-01-01', 1_000);
    await contract('ebike-001', '2026-01-01', 1_500);
    // laptop-001: one second life too.
    await contract('laptop-001', '2025-06-01', 800);
    await contract('laptop-001', '2026-06-01', 900);

    const result = await getFleetImpact(db);

    const ebike001 = result.items.find((item) => item.assetId === 'ebike-001')!;
    const laptop001 = result.items.find((item) => item.assetId === 'laptop-001')!;
    expect(ebike001.moneySavedCents).toBe(1_500 * 12);
    expect(laptop001.moneySavedCents).toBe(900 * 12);
    expect(ebike001.co2SavedKg).toBeGreaterThan(0);
    expect(laptop001.co2SavedKg).toBeGreaterThan(0);

    expect(result.totalMoneySavedCents).toBeGreaterThanOrEqual(
      ebike001.moneySavedCents + laptop001.moneySavedCents
    );
    expect(result.totalCo2SavedKg).toBeGreaterThanOrEqual(
      ebike001.co2SavedKg + laptop001.co2SavedKg
    );
    expect(result.items).toHaveLength((await loadAssets()).length);
  });
});
