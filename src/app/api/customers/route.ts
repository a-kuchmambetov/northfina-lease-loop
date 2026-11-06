// POST /api/customers — a signed-up user creates their own customer profile (the missing
// link in sign up -> become a customer -> apply -> sign a contract). One profile per
// account: a second call for the same session rejects with ALREADY_A_CUSTOMER.
import { z } from 'zod';
import { countryCodeSchema, employmentSchema } from '@/data/schemas';
import { fail, handleRoute, ok, readJsonBody } from '@/server/api-response';
import { createCustomer } from '@/server/features/customers/create-customer';
import { getAuth } from '@/server/auth-instance';
import { db } from '@/server/db';

const bodySchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('consumer'),
    name: z.string().min(1),
    country: countryCodeSchema,
    city: z.string().min(1),
    email: z.email(),
    birthDate: z.iso.date(),
    employment: employmentSchema,
    monthlyNetIncomeCents: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('sole_trader'),
    name: z.string().min(1),
    country: countryCodeSchema,
    city: z.string().min(1),
    email: z.email(),
    birthDate: z.iso.date(),
    businessId: z.string().min(1),
    vatRegistered: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('company'),
    name: z.string().min(1),
    country: countryCodeSchema,
    city: z.string().min(1),
    email: z.email(),
    businessId: z.string().min(1),
    vatRegistered: z.boolean(),
    annualRevenueCents: z.number().int().nonnegative(),
    applicantCanSign: z.boolean(),
    beneficialOwners: z.array(z.string()).optional(),
  }),
]);

export const POST = handleRoute(async (request) => {
  const session = await getAuth().api.getSession({
    headers: request.headers,
    query: { disableRefresh: true },
  });
  if (!session) return fail(401, 'UNAUTHORIZED', 'Sign in required');
  if (session.user.accountType !== 'customer') {
    return fail(403, 'FORBIDDEN', 'Customer account required');
  }

  const body = await readJsonBody(request, bodySchema);
  const result = await createCustomer(db, { ...body, userId: session.user.id });
  if (!result.ok) return fail(409, result.reason.toUpperCase(), 'Customer profile already exists');
  return ok({ customerId: result.customerId }, { status: 201 });
});
