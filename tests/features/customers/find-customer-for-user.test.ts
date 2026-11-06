import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCustomer } from '@/server/features/customers/create-customer';
import { findCustomerForUser } from '@/server/features/customers/find-customer-for-user';
import type { PrismaClient } from '@/server/prisma-client';
import { createTestDb } from '../../helpers/test-db';

let db: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => cleanup());

describe('findCustomerForUser', () => {
  it('returns null for an account without a profile', async () => {
    expect(await findCustomerForUser(db, 'no-profile')).toBeNull();
  });

  it('finds each account’s own profile and ignores unlinked customers', async () => {
    const input = {
      type: 'consumer' as const,
      name: 'Profile Test',
      country: 'FI',
      city: 'Helsinki',
      email: 'profile@example.com',
      birthDate: '1990-01-01',
      employment: 'employed',
      monthlyNetIncomeCents: 250000,
    };
    await createCustomer(db, input);
    const first = await createCustomer(db, { ...input, userId: 'first-account' });
    const second = await createCustomer(db, { ...input, userId: 'second-account' });
    if (!first.ok || !second.ok) throw new Error('Profile setup failed');

    expect(await findCustomerForUser(db, 'first-account')).toEqual({ id: first.customerId });
    expect(await findCustomerForUser(db, 'second-account')).toEqual({ id: second.customerId });
    expect(await findCustomerForUser(db, 'no-profile')).toBeNull();
  });
});
