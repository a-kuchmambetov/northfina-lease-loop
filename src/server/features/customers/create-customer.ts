// Orchestration for creating a real customer profile: the missing link between signing up
// (better-auth's User, src/server/auth.ts) and everything else in this app that needs a
// real `customerId` — starting an application (CHALLENGE.md Spine #3), signing a contract
// (Spine #4), or being handed an item directly via end-of-term's `pass_on`. Without this,
// `nextCustomerId`/`customerId` could only ever be one of data/customers.json's 10 fixed
// personas; this is how a genuinely new person (for example, the real waiting-list winner
// `computeSecondLifeMatch` recommends) gets a `customerId` at all. No business rules live
// here — see src/data/schemas.ts's `customerSchema` for what each customer type needs.
import { randomUUID } from 'node:crypto';
import { withAudit } from '@/server/audit';
import type { PrismaClient } from '@/generated/prisma/client';

export type CreateCustomerInput = {
  /** The signed-up `User` this profile belongs to, if any — one profile per user. */
  userId?: string;
  type: 'consumer' | 'sole_trader' | 'company';
  name: string;
  country: string;
  city: string;
  email: string;
  // consumer / sole_trader
  birthDate?: string;
  // consumer
  employment?: string;
  monthlyNetIncomeCents?: number;
  // sole_trader / company
  businessId?: string;
  vatRegistered?: boolean;
  // company
  annualRevenueCents?: number;
  applicantCanSign?: boolean;
  beneficialOwners?: string[];
};

export type CreateCustomerResult =
  { ok: true; customerId: string } | { ok: false; reason: 'already_a_customer' };

export async function createCustomer(
  db: PrismaClient,
  input: CreateCustomerInput
): Promise<CreateCustomerResult> {
  if (input.userId) {
    const existing = await db.customer.findUnique({ where: { user_id: input.userId } });
    if (existing) return { ok: false, reason: 'already_a_customer' };
  }

  const id = randomUUID();
  await withAudit(
    db,
    { actor: 'customer', action: 'customer.created', entityType: 'customer', entityId: id },
    (tx) =>
      tx.customer.create({
        data: {
          id,
          user_id: input.userId,
          type: input.type,
          name: input.name,
          country: input.country,
          city: input.city,
          email: input.email,
          // Never set at signup — a self-declared PEP status is the application's own
          // q_pep question's job (src/domain/eligibility.ts), not a signup field.
          is_pep: false,
          birth_date: input.birthDate,
          employment: input.employment,
          monthly_net_income_cents: input.monthlyNetIncomeCents,
          business_id: input.businessId,
          vat_registered: input.vatRegistered,
          annual_revenue_cents: input.annualRevenueCents,
          applicant_can_sign: input.applicantCanSign,
          beneficial_owners_json: input.beneficialOwners
            ? JSON.stringify(input.beneficialOwners)
            : undefined,
        },
      })
  );

  return { ok: true, customerId: id };
}
