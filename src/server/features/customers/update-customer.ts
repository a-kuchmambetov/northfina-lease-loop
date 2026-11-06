// Orchestration for editing the signed-in user's own customer profile. The customer type
// cannot change (it decides which fields exist), and `is_pep` is never touched here — see
// create-customer.ts. Every edit is audited with the names of the fields that changed.
import { withAudit } from '@/server/audit';
import type { PrismaClient } from '@/generated/prisma/client';
import type { CustomerInput } from './customer-input-schema';
import { getCustomerProfile, type CustomerProfile } from './get-customer-profile';

export type UpdateCustomerResult =
  { ok: true; profile: CustomerProfile } | { ok: false; reason: 'not_a_customer' | 'type_locked' };

export async function updateCustomer(
  db: PrismaClient,
  userId: string,
  input: CustomerInput
): Promise<UpdateCustomerResult> {
  const current = await getCustomerProfile(db, userId);
  if (!current) return { ok: false, reason: 'not_a_customer' };
  if (current.type !== input.type) return { ok: false, reason: 'type_locked' };

  const data = {
    name: input.name,
    country: input.country,
    city: input.city,
    email: input.email,
    ...(input.type !== 'company' ? { birth_date: input.birthDate } : {}),
    ...(input.type === 'consumer'
      ? { employment: input.employment, monthly_net_income_cents: input.monthlyNetIncomeCents }
      : { business_id: input.businessId, vat_registered: input.vatRegistered }),
    ...(input.type === 'company'
      ? {
          annual_revenue_cents: input.annualRevenueCents,
          applicant_can_sign: input.applicantCanSign,
          beneficial_owners_json: JSON.stringify(
            (input.beneficialOwners ?? []).map((owner) => owner.trim()).filter(Boolean)
          ),
        }
      : {}),
  };

  const before = await db.customer.findUniqueOrThrow({ where: { id: current.id } });
  const changed = Object.entries(data)
    .filter(([key, value]) => before[key as keyof typeof before] !== value)
    .map(([key]) => key);

  if (changed.length > 0) {
    await withAudit(
      db,
      {
        actor: 'customer',
        action: 'customer.updated',
        entityType: 'customer',
        entityId: current.id,
        details: { changed },
      },
      (tx) => tx.customer.update({ where: { id: current.id }, data })
    );
  }

  return { ok: true, profile: (await getCustomerProfile(db, userId)) ?? current };
}
