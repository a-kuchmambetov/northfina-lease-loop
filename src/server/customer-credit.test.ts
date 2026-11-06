// Runs against a real, migrated SQLite database (see tests/global-setup.ts).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '../../tests/helpers/test-db';
import { addCustomerCreditEntry, getCustomerCreditBalanceCents } from './customer-credit';
import type { PrismaClient } from './prisma-client';

let db: PrismaClient;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});

describe('customer credit', () => {
  it('is 0 for a customer with no entries', async () => {
    expect(await getCustomerCreditBalanceCents(db, 'cust-nobody')).toBe(0);
  });

  it('sums earned and spent entries into a balance', async () => {
    await addCustomerCreditEntry(db, {
      customerId: 'cust-aino',
      amountCents: 2_000,
      reason: 'pass_on_bonus',
      actor: 'system',
    });
    await addCustomerCreditEntry(db, {
      customerId: 'cust-aino',
      amountCents: -500,
      reason: 'applied_to_down_payment',
      actor: 'customer',
    });

    expect(await getCustomerCreditBalanceCents(db, 'cust-aino')).toBe(1_500);
  });

  it('keeps each customer separate', async () => {
    await addCustomerCreditEntry(db, {
      customerId: 'cust-mikko',
      amountCents: 3_000,
      reason: 'pass_on_bonus',
      actor: 'system',
    });

    expect(await getCustomerCreditBalanceCents(db, 'cust-mikko')).toBe(3_000);
    expect(await getCustomerCreditBalanceCents(db, 'cust-aino')).toBe(1_500); // unaffected
  });

  it('writes an audit row for every entry', async () => {
    const before = await db.auditLog.count({ where: { entity_type: 'customer_credit' } });
    await addCustomerCreditEntry(db, {
      customerId: 'cust-aino',
      amountCents: 1_000,
      reason: 'pass_on_bonus',
      relatedContractId: 'contract-1',
      actor: 'system',
    });
    const after = await db.auditLog.count({ where: { entity_type: 'customer_credit' } });
    expect(after).toBe(before + 1);
  });
});
