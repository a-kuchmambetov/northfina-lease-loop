// Runs against a real, migrated SQLite database (see tests/global-setup.ts).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadCustomers } from '@/data/load';
import type { Customer } from '@/data/schemas';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedCustomers, toCustomerRowData } from './customers';
import type { PrismaClient } from './prisma-client';

let db: PrismaClient;
let cleanup: () => Promise<void>;
let dataPack: Customer[];

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  dataPack = [...(await loadCustomers())];
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.auditLog.deleteMany();
  await db.customer.deleteMany();
});

describe('seedCustomers', () => {
  it('inserts every customer from the data pack once', async () => {
    expect(await seedCustomers(db, dataPack)).toEqual({ created: dataPack.length, skipped: 0 });
    expect(await seedCustomers(db, dataPack)).toEqual({ created: 0, skipped: dataPack.length });
    expect(await db.customer.count()).toBe(dataPack.length);
  });

  it('does not overwrite a row you changed', async () => {
    await seedCustomers(db, dataPack);
    await db.customer.update({ where: { id: 'cust-aino' }, data: { city: 'Somewhere Else' } });
    await seedCustomers(db, dataPack);
    expect((await db.customer.findUniqueOrThrow({ where: { id: 'cust-aino' } })).city).toBe(
      'Somewhere Else'
    );
  });
});

describe('toCustomerRowData', () => {
  it('fills the consumer-only fields and leaves the rest null', () => {
    const consumer = dataPack.find((c) => c.type === 'consumer')!;
    const row = toCustomerRowData(consumer);
    expect(row).toMatchObject({
      id: consumer.id,
      type: 'consumer',
      birth_date: consumer.birth_date,
      employment: consumer.employment,
      monthly_net_income_cents: consumer.monthly_net_income_cents,
    });
    expect('business_id' in row).toBe(false);
  });

  it('fills the company-only fields, including beneficial owners as JSON', () => {
    const companies = dataPack.filter((c) => c.type === 'company');
    const company = companies.find((c) => c.beneficial_owners)!;
    const row = toCustomerRowData(company);
    expect(row).toMatchObject({
      id: company.id,
      type: 'company',
      business_id: company.business_id,
      vat_registered: company.vat_registered,
      annual_revenue_cents: company.annual_revenue_cents,
      applicant_can_sign: company.applicant_can_sign,
      beneficial_owners_json: JSON.stringify(company.beneficial_owners),
    });
  });

  it('fills the sole trader fields', () => {
    const soleTrader = dataPack.find((c) => c.type === 'sole_trader')!;
    const row = toCustomerRowData(soleTrader);
    expect(row).toMatchObject({
      id: soleTrader.id,
      type: 'sole_trader',
      birth_date: soleTrader.birth_date,
      business_id: soleTrader.business_id,
      vat_registered: soleTrader.vat_registered,
    });
  });
});
