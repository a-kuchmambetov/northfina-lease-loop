import type { PrismaClient } from '@/generated/prisma/client';

export type CustomerProfile = {
  id: string;
  type: 'consumer' | 'sole_trader' | 'company';
  name: string;
  country: string;
  city: string;
  email: string;
  birthDate: string | null;
  employment: string | null;
  monthlyNetIncomeCents: number | null;
  businessId: string | null;
  vatRegistered: boolean | null;
  annualRevenueCents: number | null;
  applicantCanSign: boolean | null;
  beneficialOwners: string[];
};

function parseOwners(json: string | null): string[] {
  if (!json) return [];
  try {
    const owners: unknown = JSON.parse(json);
    return Array.isArray(owners) ? owners.filter((o): o is string => typeof o === 'string') : [];
  } catch {
    return [];
  }
}

/** The signed-in account's own customer profile, or null if it has not created one yet. */
export async function getCustomerProfile(
  db: PrismaClient,
  userId: string
): Promise<CustomerProfile | null> {
  const row = await db.customer.findUnique({ where: { user_id: userId } });
  if (!row) return null;
  return {
    id: row.id,
    type: row.type as CustomerProfile['type'],
    name: row.name,
    country: row.country,
    city: row.city,
    email: row.email,
    birthDate: row.birth_date,
    employment: row.employment,
    monthlyNetIncomeCents: row.monthly_net_income_cents,
    businessId: row.business_id,
    vatRegistered: row.vat_registered,
    annualRevenueCents: row.annual_revenue_cents,
    applicantCanSign: row.applicant_can_sign,
    beneficialOwners: parseOwners(row.beneficial_owners_json),
  };
}
