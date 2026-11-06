// Mirrors src/server/features/customers/update-customer.ts and get-customer-profile.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCustomer } from '@/server/features/customers/create-customer';
import { getCustomerProfile } from '@/server/features/customers/get-customer-profile';
import { updateCustomer } from '@/server/features/customers/update-customer';
import type { PrismaClient } from '@/server/prisma-client';
import { createTestDb } from '../../helpers/test-db';

let db: PrismaClient;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => cleanup());

const consumer = {
  type: 'consumer' as const,
  name: 'Terhi Testaaja',
  country: 'FI',
  city: 'Tampere',
  email: 'terhi@example.com',
  birthDate: '1990-05-01',
  employment: 'employed' as const,
  monthlyNetIncomeCents: 250_000,
};

describe('getCustomerProfile', () => {
  it('returns null without a profile and the account’s own profile with one', async () => {
    expect(await getCustomerProfile(db, 'nobody')).toBeNull();
    const created = await createCustomer(db, { ...consumer, userId: 'get-1' });
    if (!created.ok) throw new Error('setup failed');
    expect(await getCustomerProfile(db, 'get-1')).toMatchObject({
      id: created.customerId,
      type: 'consumer',
      name: 'Terhi Testaaja',
      monthlyNetIncomeCents: 250_000,
      beneficialOwners: [],
    });
  });

  it('survives corrupt beneficial-owner JSON', async () => {
    const created = await createCustomer(db, { ...consumer, userId: 'get-2' });
    if (!created.ok) throw new Error('setup failed');
    await db.customer.update({
      where: { id: created.customerId },
      data: { beneficial_owners_json: '{not json' },
    });
    expect((await getCustomerProfile(db, 'get-2'))?.beneficialOwners).toEqual([]);
  });
});

describe('updateCustomer', () => {
  it('updates the changed fields and audits which ones', async () => {
    const created = await createCustomer(db, { ...consumer, userId: 'upd-1' });
    if (!created.ok) throw new Error('setup failed');

    const result = await updateCustomer(db, 'upd-1', {
      ...consumer,
      city: 'Oulu',
      monthlyNetIncomeCents: 310_050,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile).toMatchObject({ city: 'Oulu', monthlyNetIncomeCents: 310_050 });

    const audit = await db.auditLog.findFirstOrThrow({
      where: { entity_id: created.customerId, action: 'customer.updated' },
    });
    expect(JSON.parse(audit.details_json ?? '{}')).toEqual({
      changed: ['city', 'monthly_net_income_cents'],
    });
  });

  it('writes no audit row when nothing changed', async () => {
    const created = await createCustomer(db, { ...consumer, userId: 'upd-2' });
    if (!created.ok) throw new Error('setup failed');
    const result = await updateCustomer(db, 'upd-2', consumer);
    expect(result.ok).toBe(true);
    expect(
      await db.auditLog.count({
        where: { entity_id: created.customerId, action: 'customer.updated' },
      })
    ).toBe(0);
  });

  it('never touches is_pep or another customer', async () => {
    const mine = await createCustomer(db, { ...consumer, userId: 'upd-3' });
    const other = await createCustomer(db, { ...consumer, userId: 'upd-4' });
    if (!mine.ok || !other.ok) throw new Error('setup failed');
    await db.customer.update({ where: { id: mine.customerId }, data: { is_pep: true } });
    await updateCustomer(db, 'upd-3', { ...consumer, name: 'Changed' });
    expect((await db.customer.findUniqueOrThrow({ where: { id: mine.customerId } })).is_pep).toBe(
      true
    );
    expect((await db.customer.findUniqueOrThrow({ where: { id: other.customerId } })).name).toBe(
      'Terhi Testaaja'
    );
  });

  it('edits a company, trimming and clearing beneficial owners', async () => {
    const company = {
      type: 'company' as const,
      name: 'Testi Oy',
      country: 'FI',
      city: 'Helsinki',
      email: 'office@testi.example.com',
      businessId: '1234567-1',
      vatRegistered: true,
      annualRevenueCents: 1_000_000,
      applicantCanSign: true,
      beneficialOwners: ['A'],
    };
    await createCustomer(db, { ...company, userId: 'upd-5' });
    const result = await updateCustomer(db, 'upd-5', {
      ...company,
      applicantCanSign: false,
      beneficialOwners: [' Ann ', ' ', 'Bob'],
    });
    expect(result.ok && result.profile).toMatchObject({
      applicantCanSign: false,
      beneficialOwners: ['Ann', 'Bob'],
    });
    const cleared = await updateCustomer(db, 'upd-5', { ...company, beneficialOwners: [] });
    expect(cleared.ok && cleared.profile.beneficialOwners).toEqual([]);
  });

  it('rejects an account without a profile and a changed customer type', async () => {
    expect(await updateCustomer(db, 'ghost', consumer)).toEqual({
      ok: false,
      reason: 'not_a_customer',
    });
    await createCustomer(db, { ...consumer, userId: 'upd-6' });
    expect(
      await updateCustomer(db, 'upd-6', {
        type: 'sole_trader',
        name: 'X',
        country: 'FI',
        city: 'Y',
        email: 'x@example.com',
        birthDate: '1990-01-01',
        businessId: '1',
        vatRegistered: false,
      })
    ).toEqual({ ok: false, reason: 'type_locked' });
  });
});
