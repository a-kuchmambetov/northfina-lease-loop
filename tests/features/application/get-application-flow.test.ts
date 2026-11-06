// Mirrors src/server/features/application/get-application-flow.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCustomers } from '@/data/load';
import { answerApplicationQuestion } from '@/server/features/application/answer-application-question';
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

async function start(): Promise<string> {
  const result = await startApplication(db, {
    customerId: 'cust-aino',
    assetId: 'ebike-003',
    termMonths: 36,
    downPaymentCents: 0,
    applicationDate: '2026-11-05',
  });
  if (!result.ok) throw new Error(`setup: could not start, ${result.reason}`);
  return result.applicationId;
}

async function answer(applicationId: string, questionId: string, value: string) {
  const result = await answerApplicationQuestion(db, {
    applicationId,
    questionId,
    answer: value,
    answerDate: '2026-11-05',
  });
  if (!result.ok) throw new Error(`setup: could not answer, ${result.reason}`);
}

async function flow(applicationId: string, requested?: string) {
  const result = await getApplicationFlow(db, applicationId, requested);
  if (!result.ok) throw new Error(`setup: no flow, ${result.reason}`);
  return result.flow;
}

describe('getApplicationFlow', () => {
  it('reports an application that does not exist', async () => {
    expect(await getApplicationFlow(db, 'nope')).toEqual({
      ok: false,
      reason: 'unknown_application',
    });
  });

  it('opens on the first question, with nothing to go back to', async () => {
    const { question, previousQuestionId, progress, asset } = await flow(await start());
    expect(question?.id).toBe('q_customer_type');
    expect(previousQuestionId).toBeNull();
    expect(progress.answered).toBe(0);
    expect(asset.category).toBe('e_bike');
  });

  it('resumes at the next unanswered question', async () => {
    const id = await start();
    await answer(id, 'q_customer_type', 'consumer');
    const { question, previousQuestionId, progress } = await flow(id);
    expect(question?.id).toBe('q_full_name');
    expect(previousQuestionId).toBe('q_customer_type');
    expect(progress.answered).toBe(1);
  });

  it('reopens an answered question, keeping its answer', async () => {
    const id = await start();
    await answer(id, 'q_customer_type', 'consumer');
    const { question, application } = await flow(id, 'q_customer_type');
    expect(question?.id).toBe('q_customer_type');
    expect(application.answers['q_customer_type']).toBe('consumer');
  });

  it('follows the applicant when going back changes the customer type', async () => {
    const id = await start();
    await answer(id, 'q_customer_type', 'consumer');
    await answer(id, 'q_full_name', 'Aino Virtanen');
    await answer(id, 'q_customer_type', 'company');
    const { question, application } = await flow(id, 'q_full_name');
    expect(application.answers).not.toHaveProperty('q_full_name');
    expect(question?.id).not.toBe('q_full_name');
  });

  it('shows no question once there is a decision', async () => {
    const id = await start();
    await answer(id, 'q_customer_type', 'consumer');
    await answer(id, 'q_full_name', 'Mikko Laine');
    await answer(id, 'q_birth_date', '2009-03-10');
    const { question, previousQuestionId, application } = await flow(id, 'q_full_name');
    expect(application.decision).toBe('rejected');
    expect(question).toBeNull();
    expect(previousQuestionId).toBeNull();
  });

  it('opens for a customer who only exists in the database, not in the data pack', async () => {
    await db.customer.create({
      data: {
        id: 'cust-new-profile',
        type: 'consumer',
        name: 'Nea Uusi',
        country: 'FI',
        city: 'Espoo',
        email: 'nea@example.com',
        birth_date: '1995-05-05',
      },
    });
    const started = await startApplication(db, {
      customerId: 'cust-new-profile',
      assetId: 'ebike-003',
      termMonths: 36,
      downPaymentCents: 0,
      applicationDate: '2026-11-05',
    });
    if (!started.ok) throw new Error(`setup: could not start, ${started.reason}`);
    const { question } = await flow(started.applicationId);
    expect(question?.id).toBe('q_customer_type');
  });
});
