// Mirrors src/server/features/second-life/resolve-second-life-match.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAssets, loadCustomers } from '@/data/load';
import { resolveSecondLifeMatch } from '@/server/features/second-life/resolve-second-life-match';
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
    data: {
      status: 'returned',
      condition: input.condition,
      usage_value: input.usageValue,
      // A returned item's lifetime usage is at least what it has since its last reset.
      lifetime_usage_value: input.usageValue,
    },
  });
}

describe('resolveSecondLifeMatch', () => {
  it('refurbishes, updates the asset row and writes an audit row', async () => {
    await returnAssetAs({
      assetId: 'ebike-007',
      listPriceCents: 549_000,
      startDate: '2024-11-08',
      termMonths: 24,
      condition: 'fair',
      usageValue: 18_400,
    });

    const result = await resolveSecondLifeMatch(db, 'ebike-007', '2026-11-08');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.computation.outcome).toBe('refurbish');

    const asset = await db.asset.findUnique({ where: { id: 'ebike-007' } });
    expect(asset).toMatchObject({ status: 'available', condition: 'good' });
    // ebike-007's 18,400 km triggers the battery replacement (resets_usage): the
    // since-reset counter goes to 0, but lifetime km must survive (KNOWN_ISSUES.md item 5).
    expect(asset!.usage_value).toBe(0);
    expect(asset!.lifetime_usage_value).toBe(18_400);

    const auditRow = await db.auditLog.findFirst({
      where: { entity_type: 'asset', entity_id: 'ebike-007', action: 'second_life.refurbished' },
    });
    expect(auditRow).not.toBeNull();
    expect(JSON.parse(auditRow!.details_json!)).toMatchObject({
      outcome: 'refurbish',
      winner: 'wait-04',
    });
  });

  it('leaves the asset as-is and still makes it available when no match is worth the refurb', async () => {
    await returnAssetAs({
      assetId: 'ebike-009',
      listPriceCents: 459_000,
      startDate: '2026-09-01',
      termMonths: 12,
      condition: 'fair',
      usageValue: 100,
    });

    const result = await resolveSecondLifeMatch(db, 'ebike-009', '2026-11-05');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.computation.outcome).toBe('no_match');

    const asset = await db.asset.findUnique({ where: { id: 'ebike-009' } });
    expect(asset).toMatchObject({ status: 'available', condition: 'fair' });

    const auditRow = await db.auditLog.findFirst({
      where: { entity_type: 'asset', entity_id: 'ebike-009', action: 'second_life.no_match' },
    });
    expect(auditRow).not.toBeNull();
  });

  it('rejects an asset that is not returned', async () => {
    const result = await resolveSecondLifeMatch(db, 'ebike-007', '2026-11-05');
    expect(result).toEqual({ ok: false, reason: 'asset_not_returned' });
  });
});
