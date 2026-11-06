// Reading and seeding customers in the database. data/customers.json's 10 personas seed
// this table (see seedCustomers) so everything already built against them keeps working;
// src/server/features/customers/create-customer.ts is how a real, new one gets added.
import type { PrismaClient } from '@/generated/prisma/client';
import type { Customer } from '@/data/schemas';

/** Data-pack shape → columns for a new database row. Type-specific fields that don't
 *  apply to this customer are left `null`. */
export function toCustomerRowData(customer: Customer) {
  const base = {
    id: customer.id,
    type: customer.type,
    name: customer.name,
    country: customer.country,
    city: customer.city,
    email: customer.email,
    is_pep: customer.is_pep,
    story: customer.story,
  };
  if (customer.type === 'consumer') {
    return {
      ...base,
      birth_date: customer.birth_date,
      employment: customer.employment,
      monthly_net_income_cents: customer.monthly_net_income_cents,
    };
  }
  if (customer.type === 'sole_trader') {
    return {
      ...base,
      birth_date: customer.birth_date,
      business_id: customer.business_id,
      vat_registered: customer.vat_registered,
    };
  }
  return {
    ...base,
    business_id: customer.business_id,
    vat_registered: customer.vat_registered,
    annual_revenue_cents: customer.annual_revenue_cents,
    applicant_can_sign: customer.applicant_can_sign,
    beneficial_owners_json: customer.beneficial_owners
      ? JSON.stringify(customer.beneficial_owners)
      : null,
  };
}

/** Inserts customers that are not in the database yet. Never overwrites changes you made
 *  (e.g. a real signup that happens to reuse one of the 10 seed ids would be unusual, but
 *  this guards it the same way seedAssets does). */
export async function seedCustomers(
  db: PrismaClient,
  customers: readonly Customer[]
): Promise<{ created: number; skipped: number }> {
  const existing = await db.customer.findMany({ select: { id: true } });
  const existingIds = new Set(existing.map((row) => row.id));
  const missing = customers.filter((customer) => !existingIds.has(customer.id));
  if (missing.length > 0) {
    await db.customer.createMany({ data: missing.map(toCustomerRowData) });
  }
  return { created: missing.length, skipped: customers.length - missing.length };
}
