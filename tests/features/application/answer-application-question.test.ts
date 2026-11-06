// Mirrors src/server/features/application/answer-application-question.ts — see AGENTS.md
// and src/server/README.md for why tests for src/server/features/** live here.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCustomers } from '@/data/load';
import type { Customer } from '@/data/schemas';
import { answerApplicationQuestion } from '@/server/features/application/answer-application-question';
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

function customer(id: string): Customer {
  const found = customers.find((c) => c.id === id);
  if (!found) throw new Error(`setup: no customer ${id} in the data pack`);
  return found;
}

/** Starts an application and keeps answering with a plausible default until it is decided. */
async function driveToDecision(input: {
  customerId: string;
  assetId: string;
  termMonths: number;
  downPaymentCents: number;
  date: string;
}) {
  const started = await startApplication(db, {
    customerId: input.customerId,
    assetId: input.assetId,
    termMonths: input.termMonths,
    downPaymentCents: input.downPaymentCents,
    applicationDate: input.date,
  });
  if (!started.ok) throw new Error(`setup: application did not start: ${started.reason}`);

  const theCustomer = customer(input.customerId);
  let next = started.nextQuestion;
  let last;
  while (next) {
    last = await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: next.id,
      answer: defaultAnswerFor(next, theCustomer),
      answerDate: input.date,
    });
    if (!last.ok) throw new Error(`setup: answering ${next.id} failed: ${last.reason}`);
    next = last.status === 'in_progress' ? last.nextQuestion : undefined;
  }
  return { applicationId: started.applicationId, last };
}

describe('answerApplicationQuestion', () => {
  it('walks the happy path to approved (cust-aino) and writes a decided audit row', async () => {
    const { applicationId, last } = await driveToDecision({
      customerId: 'cust-aino',
      assetId: 'ebike-003',
      termMonths: 36,
      downPaymentCents: 0,
      date: '2026-11-05',
    });

    expect(last).toEqual({ ok: true, status: 'decided', decision: { decision: 'approved' } });

    const row = await db.application.findUnique({ where: { id: applicationId } });
    expect(row).toMatchObject({ decision: 'approved', decision_reason: null });
    expect(row?.decided_at).not.toBeNull();

    const auditRow = await db.auditLog.findFirst({
      where: {
        entity_type: 'application',
        entity_id: applicationId,
        action: 'application.decided',
      },
    });
    expect(auditRow).not.toBeNull();
  });

  it('rejects an under-18 applicant (cust-mikko) right after his birth date, not after the whole form', async () => {
    const started = await startApplication(db, {
      customerId: 'cust-mikko',
      assetId: 'laptop-008',
      termMonths: 24,
      downPaymentCents: 0,
      applicationDate: '2026-11-05',
    });
    if (!started.ok) throw new Error('setup: application did not start');
    expect(started.nextQuestion?.id).toBe('q_customer_type');

    const typeAnswer = await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_customer_type',
      answer: 'consumer',
      answerDate: '2026-11-05',
    });
    expect(typeAnswer).toMatchObject({
      status: 'in_progress',
      nextQuestion: { id: 'q_full_name' },
    });

    const nameAnswer = await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_full_name',
      answer: 'Mikko Virtanen',
      answerDate: '2026-11-05',
    });
    expect(nameAnswer).toMatchObject({
      status: 'in_progress',
      nextQuestion: { id: 'q_birth_date' },
    });

    const birthDateAnswer = await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_birth_date',
      answer: '2009-03-10',
      answerDate: '2026-11-05',
    });
    expect(birthDateAnswer).toEqual({
      ok: true,
      status: 'decided',
      decision: { decision: 'rejected', reason: 'min_age' },
    });

    // Rejected right after the birth date — email, country, employment and income were
    // never collected (CHALLENGE.md scenario card 5: "Be kind and clear").
    const row = await db.application.findUnique({ where: { id: started.applicationId } });
    expect(JSON.parse(row!.answers_json)).toEqual({
      q_customer_type: 'consumer',
      q_full_name: 'Mikko Virtanen',
      q_birth_date: '2009-03-10',
    });
  });

  it('decides from the answer given, not from the hidden customer record (cust-aino answers as a minor)', async () => {
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
    await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_full_name',
      answer: 'Aino Virtanen',
      answerDate: '2026-11-05',
    });
    // cust-aino's real birth date (in data/customers.json) makes her an adult; this answer
    // does not, and the decision must follow what was actually typed.
    const result = await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_birth_date',
      answer: '2015-01-01',
      answerDate: '2026-11-05',
    });
    expect(result).toEqual({
      ok: true,
      status: 'decided',
      decision: { decision: 'rejected', reason: 'min_age' },
    });
  });

  it('rejects residency right after a non-FI/SE/EE country answer', async () => {
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
    await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_full_name',
      answer: 'Someone Else',
      answerDate: '2026-11-05',
    });
    await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_birth_date',
      answer: '1990-01-01',
      answerDate: '2026-11-05',
    });
    const result = await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_country',
      answer: 'other',
      answerDate: '2026-11-05',
    });
    expect(result).toEqual({
      ok: true,
      status: 'decided',
      decision: { decision: 'rejected', reason: 'residency' },
    });
  });

  it('rejects business_id at the end of the flow when the typed ID has the wrong check digit, even though it is shaped like a real one', async () => {
    const { last } = await driveToDecision({
      customerId: 'cust-broken-id',
      assetId: 'laptop-004',
      termMonths: 24,
      downPaymentCents: 0,
      date: '2026-11-05',
    });

    expect(last).toEqual({
      ok: true,
      status: 'decided',
      decision: { decision: 'rejected', reason: 'business_id' },
    });
  });

  it('reacts to a changed customer_type answer, not the real persona (smart question flow)', async () => {
    // cust-aino's own record is a consumer, but the applicant answers q_customer_type as
    // a company — the rest of the flow, and the eventual decision, must follow that.
    const started = await startApplication(db, {
      customerId: 'cust-aino',
      assetId: 'laptop-004',
      termMonths: 24,
      downPaymentCents: 0,
      applicationDate: '2026-11-05',
    });
    if (!started.ok) throw new Error('setup: application did not start');

    const typeAnswer = await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_customer_type',
      answer: 'company',
      answerDate: '2026-11-05',
    });
    // A company skips the consumer-only q_full_name/q_birth_date/q_country entirely.
    expect(typeAnswer).toMatchObject({ status: 'in_progress', nextQuestion: { id: 'q_email' } });

    const emailAnswer = await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_email',
      answer: 'owner@example.com',
      answerDate: '2026-11-05',
    });
    expect(emailAnswer).toMatchObject({
      status: 'in_progress',
      nextQuestion: { id: 'q_business_id' },
    });

    // A company's eligibility is decided by business_id, not by age/residency.
    const businessIdAnswer = await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_business_id',
      answer: '1234567-8',
      answerDate: '2026-11-05',
    });
    expect(businessIdAnswer).toMatchObject({ status: 'in_progress' });
  });

  it('asks for a signatory email when the applicant cannot sign for the company (cust-norvi, scenario card 6)', async () => {
    const started = await startApplication(db, {
      customerId: 'cust-norvi',
      assetId: 'ebike-004',
      termMonths: 36,
      downPaymentCents: 0,
      applicationDate: '2026-11-05',
    });
    if (!started.ok) throw new Error('setup: application did not start');

    await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_customer_type',
      answer: 'company',
      answerDate: '2026-11-05',
    });
    await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_email',
      answer: 'coordinator@norvi.example.com',
      answerDate: '2026-11-05',
    });
    await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_business_id',
      answer: '3299871-7', // cust-norvi's own business ID (data/customers.json)
      answerDate: '2026-11-05',
    });
    await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_company_name',
      answer: 'Norvi Logistics',
      answerDate: '2026-11-05',
    });
    const canSignAnswer = await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_can_sign',
      answer: 'no',
      answerDate: '2026-11-05',
    });
    expect(canSignAnswer).toMatchObject({
      status: 'in_progress',
      nextQuestion: { id: 'q_signatory_email' },
    });
  });

  it('rejects an answer with the wrong format for its question type', async () => {
    const started = await startApplication(db, {
      customerId: 'cust-aino',
      assetId: 'ebike-003',
      termMonths: 36,
      downPaymentCents: 0,
      applicationDate: '2026-11-05',
    });
    if (!started.ok) throw new Error('setup: application did not start');

    const notAnOption = await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_customer_type',
      answer: 'not-a-real-type',
      answerDate: '2026-11-05',
    });
    expect(notAnOption).toEqual({ ok: false, reason: 'invalid_answer_format' });

    await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_customer_type',
      answer: 'consumer',
      answerDate: '2026-11-05',
    });
    await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_full_name',
      answer: 'Aino Virtanen',
      answerDate: '2026-11-05',
    });

    const notADate = await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_birth_date',
      answer: 'not-a-date',
      answerDate: '2026-11-05',
    });
    expect(notADate).toEqual({ ok: false, reason: 'invalid_answer_format' });
  });

  it('rejects a malformed business ID shape with the hint from data/questions.json', async () => {
    const started = await startApplication(db, {
      customerId: 'cust-kettukoodi',
      assetId: 'laptop-004',
      termMonths: 24,
      downPaymentCents: 0,
      applicationDate: '2026-11-05',
    });
    if (!started.ok) throw new Error('setup: application did not start');

    await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_customer_type',
      answer: 'company',
      answerDate: '2026-11-05',
    });
    await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_email',
      answer: 'owner@kettukoodi.fi',
      answerDate: '2026-11-05',
    });

    const result = await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_business_id',
      answer: 'not-a-business-id',
      answerDate: '2026-11-05',
    });
    expect(result).toEqual({
      ok: false,
      reason: 'invalid_answer_format',
      hint: '1234567-8 with a valid check digit',
    });
  });

  it('sends a politically exposed company to manual review (cust-haapala)', async () => {
    const { last } = await driveToDecision({
      customerId: 'cust-haapala',
      assetId: 'farm-002',
      termMonths: 48,
      downPaymentCents: 2_000_000,
      date: '2026-11-05',
    });

    expect(last).toEqual({
      ok: true,
      status: 'decided',
      decision: { decision: 'manual_review', reason: 'pep_manual_review' },
    });
  });

  it('persists each answer and moves to the next applicable question (cust-kettukoodi, a company)', async () => {
    const started = await startApplication(db, {
      customerId: 'cust-kettukoodi',
      assetId: 'laptop-004',
      termMonths: 24,
      downPaymentCents: 0,
      applicationDate: '2026-11-05',
    });
    if (!started.ok) throw new Error('setup: application did not start');

    // A company skips the consumer/sole-trader-only questions, so q_email comes right after.
    const first = await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_customer_type',
      answer: 'company',
      answerDate: '2026-11-05',
    });
    expect(first).toMatchObject({
      ok: true,
      status: 'in_progress',
      nextQuestion: { id: 'q_email' },
    });

    const second = await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_email',
      answer: 'owner@kettukoodi.fi',
      answerDate: '2026-11-05',
    });
    expect(second).toMatchObject({
      ok: true,
      status: 'in_progress',
      nextQuestion: { id: 'q_business_id' },
    });

    const row = await db.application.findUnique({ where: { id: started.applicationId } });
    expect(JSON.parse(row!.answers_json)).toEqual({
      q_customer_type: 'company',
      q_email: 'owner@kettukoodi.fi',
    });
  });

  it('rejects an answer to a question that is not currently applicable', async () => {
    const started = await startApplication(db, {
      customerId: 'cust-aino',
      assetId: 'ebike-003',
      termMonths: 36,
      downPaymentCents: 0,
      applicationDate: '2026-11-05',
    });
    if (!started.ok) throw new Error('setup: application did not start');

    // q_company_name only applies to a company, and no answer has set customer_type yet.
    const result = await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_company_name',
      answer: 'Should not apply Oy',
      answerDate: '2026-11-05',
    });
    expect(result).toEqual({ ok: false, reason: 'question_not_applicable' });
  });

  it('rejects an unknown application', async () => {
    const result = await answerApplicationQuestion(db, {
      applicationId: 'app-does-not-exist',
      questionId: 'q_customer_type',
      answer: 'consumer',
      answerDate: '2026-11-05',
    });
    expect(result).toEqual({ ok: false, reason: 'unknown_application' });
  });

  it('rejects an unknown question id', async () => {
    const started = await startApplication(db, {
      customerId: 'cust-aino',
      assetId: 'ebike-003',
      termMonths: 36,
      downPaymentCents: 0,
      applicationDate: '2026-11-05',
    });
    if (!started.ok) throw new Error('setup: application did not start');

    const result = await answerApplicationQuestion(db, {
      applicationId: started.applicationId,
      questionId: 'q_does_not_exist',
      answer: 'whatever',
      answerDate: '2026-11-05',
    });
    expect(result).toEqual({ ok: false, reason: 'unknown_question' });
  });

  it('rejects answering an application that already has a decision', async () => {
    const { applicationId } = await driveToDecision({
      customerId: 'cust-aino',
      assetId: 'ebike-003',
      termMonths: 36,
      downPaymentCents: 0,
      date: '2026-11-05',
    });

    const result = await answerApplicationQuestion(db, {
      applicationId,
      questionId: 'q_customer_type',
      answer: 'consumer',
      answerDate: '2026-11-05',
    });
    expect(result).toEqual({ ok: false, reason: 'already_decided' });
  });
});
