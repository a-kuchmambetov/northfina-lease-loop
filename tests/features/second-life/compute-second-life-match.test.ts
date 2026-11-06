// Mirrors src/server/features/second-life/compute-second-life-match.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
// Runs against the real data pack and a real, migrated SQLite database.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAssets, loadCustomers } from '@/data/load';
import { computeSecondLifeMatch } from '@/server/features/second-life/compute-second-life-match';
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
beforeEach(async () => {
  await db.asset.updateMany({
    data: { status: 'available', condition: 'new', usage_value: 0, lifetime_usage_value: 0 },
  });
});

/** A settled contract to value the asset off (list price + start date), inserted directly
 *  so the test can pick a start date outside any price list's own validity window — this
 *  is reconstructing history, not quoting a new lease today. Then marks the asset
 *  `returned` with whatever condition/usage the scenario needs. */
async function returnAssetAs(input: {
  assetId: string;
  listPriceCents: number;
  startDate: string;
  termMonths: number;
  condition: string;
  usageValue: number;
}) {
  await db.contract.create({
    data: {
      id: randomUUID(),
      asset_id: input.assetId,
      customer_id: 'cust-aino',
      start_date: input.startDate,
      term_months: input.termMonths,
      price_list_version: 1,
      list_price_cents: input.listPriceCents,
      down_payment_cents: 0,
      financed_cents: input.listPriceCents,
      monthly_net_rent_cents: 0,
      buyout_cents: 0,
      status: 'returned',
    },
  });
  await db.asset.update({
    where: { id: input.assetId },
    data: { status: 'returned', condition: input.condition, usage_value: input.usageValue },
  });
}

describe('computeSecondLifeMatch', () => {
  it('scenario card 9: ebike-007 back in fair condition, 18,400 km', async () => {
    // Started 2 years before the scenario date (2024-11-08 -> 2026-11-08), net list price
    // 549000 cents (data/price-lists.json).
    await returnAssetAs({
      assetId: 'ebike-007',
      listPriceCents: 549_000,
      startDate: '2024-11-08',
      termMonths: 24,
      condition: 'fair',
      usageValue: 18_400,
    });

    // As-is: wait-02 (budget 9000, 12mo, accepts 'fair') is quoted 8,316 cents — affordable,
    // revenue 99,792. Refurbishing to 'good' (51,500 cents: fair->good + the usage-
    // threshold battery replacement + the always-on safety inspection) is quoted 8,622
    // cents for a 24-month term — affordable to both wait-04 and wait-13 (budget 9000,
    // need 'good', 24mo each), an exact tie on revenue (206,928, net of the refurb cost
    // still far ahead of the as-is 99,792). wait-04 wins that tie: it's earlier in
    // data/second-life-demand.json than wait-13, our stand-in for "signed up first".
    // Either way, refurbishing is what wins the item — not wait-02.
    const result = await computeSecondLifeMatch(db, 'ebike-007', '2026-11-08');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.computation.outcome).toBe('refurbish');
    expect(result.computation.winner?.request.id).toBe('wait-04');
    expect(result.computation.conditionAfter).toBe('good');
  });

  it('stays as-is when refurbishing would cost more than the extra revenue it brings', async () => {
    // Only a few months old (little depreciation yet) and barely used: refurbishing to
    // 'good' from 'fair' is cheap, but the item is already valuable enough that every
    // e-bike request's budget is blown regardless of condition.
    await returnAssetAs({
      assetId: 'ebike-009',
      listPriceCents: 459_000,
      startDate: '2026-09-01',
      termMonths: 12,
      condition: 'fair',
      usageValue: 100,
    });

    const result = await computeSecondLifeMatch(db, 'ebike-009', '2026-11-05');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.computation.outcome).toBe('no_match');
    expect(result.computation.conditionAfter).toBe('fair');
  });

  it('rejects an asset that is not in the returned queue', async () => {
    const result = await computeSecondLifeMatch(db, 'ebike-007', '2026-11-05');
    expect(result).toEqual({ ok: false, reason: 'asset_not_returned' });
  });

  it('rejects an unknown asset', async () => {
    const result = await computeSecondLifeMatch(db, 'ebike-does-not-exist', '2026-11-05');
    expect(result).toEqual({ ok: false, reason: 'asset_not_found' });
  });
});
