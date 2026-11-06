// POST /api/leases/:id/return — the signed-in customer gives their leased item back.
// Body: { confirm }. With `confirm: false` nothing changes and the answer says what returning
// now would cost (free once the term is over, a fee before). With `confirm: true` the item
// is returned.
import { z } from 'zod';
import { loadCustomers } from '@/data/load';
import { applicantCustomerId } from '@/domain/catalogue';
import { fail, handleRoute, ok, readJsonBody } from '@/server/api-response';
import { getAuth } from '@/server/auth-instance';
import { db } from '@/server/db';
import { returnLease } from '@/server/features/return-lease/return-lease';
import { findCustomerForUser } from '@/server/features/customers/find-customer-for-user';
import { todayIso } from '@/server/today';

const bodySchema = z.strictObject({ confirm: z.boolean() });

const NOT_FOUND_REASONS = new Set(['unknown_lease', 'contract_not_found', 'asset_not_found']);
const CONFLICT_REASONS = new Set([
  'contract_already_settled',
  'term_already_over',
  'asset_status_conflict',
]);

export const POST = handleRoute(
  async (request, { params }: RouteContext<'/api/leases/[id]/return'>) => {
    const session = await getAuth().api.getSession({
      headers: request.headers,
      query: { disableRefresh: true },
    });
    if (!session) return fail(401, 'UNAUTHORIZED', 'Sign in required');
    if (session.user.accountType !== 'customer')
      return fail(403, 'FORBIDDEN', 'Customer account required');

    const profile = await findCustomerForUser(db, session.user.id);
    const customerId = profile?.id ?? applicantCustomerId(await loadCustomers());
    if (!customerId) return fail(404, 'UNKNOWN_LEASE', 'The lease could not be found');

    const body = await readJsonBody(request, bodySchema);
    const { id } = await params;
    const result = await returnLease(db, {
      contractId: id,
      customerId,
      asOfDate: todayIso(),
      confirm: body.confirm,
    });

    if (!result.ok) {
      const status = NOT_FOUND_REASONS.has(result.reason)
        ? 404
        : CONFLICT_REASONS.has(result.reason)
          ? 409
          : 422;
      return fail(status, result.reason.toUpperCase(), 'The item could not be returned');
    }
    const { ok: _ok, ...data } = result;
    return ok(data);
  }
);
