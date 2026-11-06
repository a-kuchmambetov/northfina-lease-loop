// Mirrors src/server/features/application/cancel-application.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadCustomers } from '@/data/load';
import { answerApplicationQuestion } from '@/server/features/application/answer-application-question';
import { cancelApplication } from '@/server/features/application/cancel-application';
import { getApplicationFlow } from '@/server/features/application/get-application-flow';
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

async function start(decision?: string): Promise<string> {
  const result = await startApplication(db, {
    customerId: 'cust-aino',
    assetId: 'ebike-003',
    termMonths: 36,
    downPaymentCents: 0,
    applicationDate: '2026-11-05',
  });
  if (!result.ok) throw new Error(`setup: could not start, ${result.reason}`);
  if (decision) {
    await db.application.update({ where: { id: result.applicationId }, data: { decision } });
  }
  return result.applicationId;
}

const cancel = (applicationId: string, customerId = 'cust-aino') =>
  cancelApplication(db, { applicationId, customerId, actor: 'user-1' });

const row = (id: string) => db.application.findUniqueOrThrow({ where: { id } });

const auditRows = (entity_id: string) =>
  db.auditLog.findMany({ where: { entity_id, action: 'application.cancelled' } });

describe('cancelApplication', () => {
  it.each([
    ['in-progress', undefined, 'pending'],
    ['approved', 'approved', 'approved'],
  ])('cancels an %s application and audits it', async (_label, decision, from) => {
    const id = await start(decision);
    expect(await cancel(id)).toEqual({ ok: true });

    const cancelled = await row(id);
    expect(cancelled.decision).toBe('cancelled');
    expect(cancelled.decision_reason).toBe('customer_cancelled');
    expect(cancelled.decided_at).not.toBeNull();

    const [audit, ...rest] = await auditRows(id);
    expect(rest).toEqual([]);
    expect(audit?.actor).toBe('user-1');
    expect(JSON.parse(audit!.details_json!)).toEqual({ from });
  });

  it.each(['rejected', 'manual_review', 'cancelled'])(
    'leaves a %s application',
    async (decision) => {
      const id = await start(decision);
      expect(await cancel(id)).toEqual({ ok: false, reason: 'not_cancellable' });
      expect((await row(id)).decision).toBe(decision);
      expect(await auditRows(id)).toEqual([]);
    }
  );

  it('cannot cancel twice', async () => {
    const id = await start();
    await cancel(id);
    expect(await cancel(id)).toEqual({ ok: false, reason: 'not_cancellable' });
    expect(await auditRows(id)).toHaveLength(1);
  });

  it('reports an application that does not exist', async () => {
    expect(await cancel('nope')).toEqual({ ok: false, reason: 'unknown_application' });
  });

  it("treats another customer's application as unknown and leaves it alone", async () => {
    const id = await start();
    expect(await cancel(id, 'cust-mikko')).toEqual({ ok: false, reason: 'unknown_application' });
    expect((await row(id)).decision).toBe('pending');
  });

  it('keeps a decision that lands just after the application was read', async () => {
    const id = await start();
    const read = db.application.findUnique.bind(db.application);
    const spy = vi.spyOn(db.application, 'findUnique').mockImplementationOnce((async (
      args: Parameters<typeof read>[0]
    ) => {
      const application = await read(args);
      await db.application.update({ where: { id }, data: { decision: 'rejected' } });
      return application;
    }) as never);

    expect(await cancel(id)).toEqual({ ok: false, reason: 'not_cancellable' });
    spy.mockRestore();
    expect((await row(id)).decision).toBe('rejected');
    expect(await auditRows(id)).toEqual([]);
  });

  it('closes the question flow', async () => {
    const id = await start();
    await cancel(id);
    expect(
      await answerApplicationQuestion(db, {
        applicationId: id,
        questionId: 'q_customer_type',
        answer: 'consumer',
        answerDate: '2026-11-05',
      })
    ).toEqual({ ok: false, reason: 'already_decided' });

    const flow = await getApplicationFlow(db, id);
    expect(flow.ok && flow.flow.question).toBeNull();
  });
});
