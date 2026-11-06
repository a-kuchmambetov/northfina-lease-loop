// Mirrors src/server/features/application/profile-answers.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCustomers } from '@/data/load';
import { answerApplicationQuestion } from '@/server/features/application/answer-application-question';
import { getApplicationFlow } from '@/server/features/application/get-application-flow';
import { startApplication } from '@/server/features/application/start-application';
import { createCustomer } from '@/server/features/customers/create-customer';
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

async function signedUpCustomer(input: Parameters<typeof createCustomer>[1]): Promise<string> {
  const result = await createCustomer(db, input);
  if (!result.ok) throw new Error(`setup: ${result.reason}`);
  return result.customerId;
}

async function start(customerId: string, assetId = 'laptop-005') {
  const result = await startApplication(db, {
    customerId,
    assetId, // a laptop: no e-bike/farm question about the item itself
    termMonths: 36,
    downPaymentCents: 0,
    applicationDate: '2026-11-05',
  });
  if (!result.ok) throw new Error(`setup: could not start, ${result.reason}`);
  return result;
}

const consumer = {
  type: 'consumer',
  name: 'Terhi Testaaja',
  country: 'FI',
  city: 'Tampere',
  email: 'terhi@example.com',
  birthDate: '1990-05-01',
  employment: 'employed',
  monthlyNetIncomeCents: 320_000,
} as const;

const company = {
  type: 'company',
  name: 'Testi Oy',
  country: 'FI',
  city: 'Helsinki',
  email: 'office@testi.example.com',
  businessId: '3187650-7',
  vatRegistered: true,
  annualRevenueCents: 100_000_000,
  applicantCanSign: false,
} as const;

describe('questions a profile already answers', () => {
  it('decides at once when the profile answers everything the deal asks', async () => {
    const customerId = await signedUpCustomer({ ...consumer, userId: 'user-full-profile' });
    const started = await start(customerId);

    expect(started.nextQuestion).toBeUndefined();
    expect(started.decision).toEqual({ decision: 'approved' });
    const row = await db.application.findUniqueOrThrow({ where: { id: started.applicationId } });
    expect(row.decision).toBe('approved');
    expect(JSON.parse(row.answers_json)).toMatchObject({
      q_customer_type: 'consumer',
      q_full_name: 'Terhi Testaaja',
      q_birth_date: '1990-05-01',
    });
  });

  it('rejects at once when a profile answer rules the applicant out', async () => {
    const customerId = await signedUpCustomer({
      ...consumer,
      userId: 'user-too-young',
      birthDate: '2009-03-10',
    });
    const started = await start(customerId);

    expect(started.decision).toEqual({ decision: 'rejected', reason: 'min_age' });
    const row = await db.application.findUniqueOrThrow({ where: { id: started.applicationId } });
    expect(row).toMatchObject({ decision: 'rejected', decision_reason: 'min_age' });
  });

  it('asks only what the profile cannot answer, and hides the rest from the flow', async () => {
    const customerId = await signedUpCustomer({ ...company, userId: 'user-company' });
    const started = await start(customerId);
    expect(started.nextQuestion?.id).toBe('q_signatory_email'); // applicantCanSign is false

    const result = await getApplicationFlow(db, started.applicationId, 'q_business_id');
    if (!result.ok) throw new Error('setup: no flow');
    // Asking for the already-answered business ID by hand does not reopen it.
    expect(result.flow.question?.id).toBe('q_signatory_email');
    expect(result.flow.previousQuestionId).toBeNull();
    expect(result.flow.progress).toEqual({ answered: 0, total: 1 });
    // The profile's answers are still on the application, for the decision.
    expect(result.flow.application.answers['q_business_id']).toBe('3187650-7');
  });

  it('refuses an answer to a question the profile already answered', async () => {
    const customerId = await signedUpCustomer({ ...company, userId: 'user-company-2' });
    const started = await start(customerId);

    const result = await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_business_id',
      answer: '1234567-8',
      answerDate: '2026-11-05',
    });
    expect(result).toEqual({ ok: false, reason: 'question_not_applicable' });
  });

  it('finishes the application once the remaining question is answered', async () => {
    const customerId = await signedUpCustomer({ ...company, userId: 'user-company-3' });
    const started = await start(customerId);

    const result = await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_signatory_email',
      answer: 'signer@testi.example.com',
      answerDate: '2026-11-05',
    });
    expect(result).toEqual({ ok: true, status: 'decided', decision: { decision: 'approved' } });
  });

  it('still asks everything for a demo persona, which has no account profile', async () => {
    const started = await start('cust-aino');
    expect(started.nextQuestion?.id).toBe('q_customer_type');
    expect(started.decision).toBeNull();
  });
});
