// Mirrors src/server/features/application/get-application.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCustomers } from '@/data/load';
import type { Customer } from '@/data/schemas';
import { answerApplicationQuestion } from '@/server/features/application/answer-application-question';
import { getApplication } from '@/server/features/application/get-application';
import { startApplication } from '@/server/features/application/start-application';
import { seedCustomers } from '@/server/customers';
import { defaultAnswerFor } from '../../helpers/application-answers';
import { createTestDb } from '../../helpers/test-db';
import type { PrismaClient } from '@/server/prisma-client';

let db: PrismaClient;
let cleanup: () => Promise<void>;
let customers: readonly Customer[];
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  customers = await loadCustomers();
  await seedCustomers(db, customers);
});
afterAll(async () => {
  await cleanup();
});

describe('getApplication', () => {
  it('reflects a pending application and its answers so far', async () => {
    const started = await startApplication(db, {
      customerId: 'cust-aino',
      assetId: 'ebike-003',
      termMonths: 36,
      downPaymentCents: 0,
      applicationDate: '2026-11-05',
    });
    if (!started.ok) throw new Error('setup: application did not start');

    await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_customer_type',
      answer: 'consumer',
      answerDate: '2026-11-05',
    });

    const result = await getApplication(db, started.applicationId);
    expect(result).toMatchObject({
      ok: true,
      application: {
        customerId: 'cust-aino',
        assetId: 'ebike-003',
        financedAmountCents: 389_000,
        answers: { q_customer_type: 'consumer' },
        decision: 'pending',
        decisionReason: null,
        decidedAt: null,
      },
    });
  });

  it('reflects a rejected decision', async () => {
    const started = await startApplication(db, {
      customerId: 'cust-mikko',
      assetId: 'laptop-008',
      termMonths: 24,
      downPaymentCents: 0,
      applicationDate: '2026-11-05',
    });
    if (!started.ok) throw new Error('setup: application did not start');

    const mikko = customers.find((c) => c.id === 'cust-mikko');
    if (!mikko) throw new Error('setup: no customer cust-mikko in the data pack');

    let next = started.nextQuestion;
    while (next) {
      const outcome = await answerApplicationQuestion(db, {
        applicationId: started.applicationId,
        questionId: next.id,
        answer: defaultAnswerFor(next, mikko),
        answerDate: '2026-11-05',
      });
      if (!outcome.ok) throw new Error(`setup: answering ${next.id} failed: ${outcome.reason}`);
      next = outcome.status === 'in_progress' ? outcome.nextQuestion : undefined;
    }

    const result = await getApplication(db, started.applicationId);
    expect(result).toMatchObject({
      ok: true,
      application: { decision: 'rejected', decisionReason: 'min_age' },
    });
    if (result.ok) expect(result.application.decidedAt).not.toBeNull();
  });

  it('rejects an unknown application', async () => {
    const result = await getApplication(db, 'app-does-not-exist');
    expect(result).toEqual({ ok: false, reason: 'unknown_application' });
  });
});
