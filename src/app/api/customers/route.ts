// /api/customers — a signed-up user's own customer profile (the missing link in sign up ->
// become a customer -> apply -> sign a contract). GET reads it, POST creates it (one per
// account: a second call rejects with ALREADY_A_CUSTOMER), PATCH edits it.
import { fail, handleRoute, ok, readJsonBody } from '@/server/api-response';
import { createCustomer } from '@/server/features/customers/create-customer';
import { customerInputSchema } from '@/server/features/customers/customer-input-schema';
import { getCustomerProfile } from '@/server/features/customers/get-customer-profile';
import { updateCustomer } from '@/server/features/customers/update-customer';
import { getAuth } from '@/server/auth-instance';
import { db } from '@/server/db';

async function customerSession(request: Request) {
  const session = await getAuth().api.getSession({
    headers: request.headers,
    query: { disableRefresh: true },
  });
  if (!session) return { error: fail(401, 'UNAUTHORIZED', 'Sign in required') };
  if (session.user.accountType !== 'customer') {
    return { error: fail(403, 'FORBIDDEN', 'Customer account required') };
  }
  return { userId: session.user.id };
}

// GET /api/customers — the signed-in customer's own profile.
export const GET = handleRoute(async (request) => {
  const auth = await customerSession(request);
  if (auth.error) return auth.error;
  const profile = await getCustomerProfile(db, auth.userId);
  if (!profile) return fail(404, 'NOT_A_CUSTOMER', 'No customer profile yet');
  return ok(profile);
});

// PATCH /api/customers — the signed-in customer edits their own profile (same body as POST;
// the customer type itself cannot change).
export const PATCH = handleRoute(async (request) => {
  const auth = await customerSession(request);
  if (auth.error) return auth.error;
  const body = await readJsonBody(request, customerInputSchema);
  const result = await updateCustomer(db, auth.userId, body);
  if (!result.ok) {
    return result.reason === 'not_a_customer'
      ? fail(404, 'NOT_A_CUSTOMER', 'No customer profile yet')
      : fail(409, 'TYPE_LOCKED', 'Customer type cannot be changed');
  }
  return ok(result.profile);
});

export const POST = handleRoute(async (request) => {
  const auth = await customerSession(request);
  if (auth.error) return auth.error;
  const body = await readJsonBody(request, customerInputSchema);
  const result = await createCustomer(db, { ...body, userId: auth.userId });
  if (!result.ok) return fail(409, result.reason.toUpperCase(), 'Customer profile already exists');
  return ok({ customerId: result.customerId }, { status: 201 });
});
