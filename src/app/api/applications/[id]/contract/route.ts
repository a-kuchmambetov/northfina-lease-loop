// POST /api/applications/:id/contract — the signed-in customer forms a contract from their
// approved application and signs it with a typed name. Body: { signedName }
import { z } from 'zod';
import { loadCustomers } from '@/data/load';
import { applicantCustomerId } from '@/domain/catalogue';
import { fail, handleRoute, ok, readJsonBody } from '@/server/api-response';
import { getAuth } from '@/server/auth-instance';
import { db } from '@/server/db';
import { signApplicationContract } from '@/server/features/contracts/sign-application-contract';
import { findCustomerForUser } from '@/server/features/customers/find-customer-for-user';
import { todayIso } from '@/server/today';

const bodySchema = z.strictObject({ signedName: z.string() });

const CONFLICT_REASONS = new Set(['not_approved', 'already_signed', 'asset_not_available']);
const NOT_FOUND_REASONS = new Set(['unknown_application', 'asset_not_found']);

export const POST = handleRoute(
  async (request, { params }: RouteContext<'/api/applications/[id]/contract'>) => {
    const session = await getAuth().api.getSession({
      headers: request.headers,
      query: { disableRefresh: true },
    });
    if (!session) return fail(401, 'UNAUTHORIZED', 'Sign in required');
    if (session.user.accountType !== 'customer')
      return fail(403, 'FORBIDDEN', 'Customer account required');

    const profile = await findCustomerForUser(db, session.user.id);
    const customerId = profile?.id ?? applicantCustomerId(await loadCustomers());
    if (!customerId) return fail(404, 'UNKNOWN_APPLICATION', 'The application could not be found');

    const body = await readJsonBody(request, bodySchema);
    const { id } = await params;
    const result = await signApplicationContract(db, {
      applicationId: id,
      customerId,
      signedName: body.signedName,
      signDate: todayIso(),
      actor: session.user.id,
    });

    if (!result.ok) {
      const status = NOT_FOUND_REASONS.has(result.reason)
        ? 404
        : CONFLICT_REASONS.has(result.reason)
          ? 409
          : 422;
      return fail(status, result.reason.toUpperCase(), 'The contract could not be signed');
    }
    return ok({ contractId: result.contractId }, { status: 201 });
  }
);
