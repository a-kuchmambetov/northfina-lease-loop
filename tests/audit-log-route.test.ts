// GET /api/audit-log: authentication and the response envelope. The scoping itself is tested
// in tests/features/audit-log/get-audit-log.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAssets } from '@/data/load';
import { seedAssets } from '@/server/assets';
import { createTestDb } from './helpers/test-db';
import type { PrismaClient } from '@/server/prisma-client';

const state = vi.hoisted(() => ({
  session: null as null | { user: { accountType: string; name: string } },
  db: null as unknown,
}));
vi.mock('@/server/auth-instance', () => ({
  getAuth: () => ({ api: { getSession: async () => state.session } }),
}));
vi.mock('@/server/db', () => ({
  get db() {
    return state.db;
  },
}));

let cleanup: () => Promise<void>;
let db: PrismaClient;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  state.db = db;
  await seedAssets(db, await loadAssets());
  await db.auditLog.createMany({
    data: ['ebike-001', 'ebike-003'].map((id) => ({
      actor: 'test',
      action: 'asset.status_changed',
      entity_type: 'asset',
      entity_id: id,
      details_json: '{"secret":true}',
    })),
  });
});
afterAll(async () => {
  await cleanup();
});
beforeEach(() => {
  state.session = null;
});

async function get() {
  const { GET } = await import('@/app/api/audit-log/route');
  const response = await GET(new Request('http://localhost/api/audit-log'), {});
  return { status: response.status, body: await response.json() };
}

describe('GET /api/audit-log', () => {
  it('answers 401 to a guest', async () => {
    const { status, body } = await get();
    expect(status).toBe(401);
    expect(body).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
  });

  it('answers 403 to a customer', async () => {
    state.session = { user: { accountType: 'customer', name: 'Aino' } };
    const { status, body } = await get();
    expect(status).toBe(403);
    expect(body).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
  });

  it('answers 200 with only the supplier’s rows to a supplier', async () => {
    state.session = { user: { accountType: 'supplier', name: 'Kettu Bikes' } };
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.map((row: { entity_id: string }) => row.entity_id)).toContain('ebike-001');
    for (const row of body.data) {
      expect(row.entity_type).toBe('asset');
      expect(row.entity_id).toMatch(/^(ebike-00[128]|farm-009)$/);
      expect(row).not.toHaveProperty('details');
    }
  });
});
