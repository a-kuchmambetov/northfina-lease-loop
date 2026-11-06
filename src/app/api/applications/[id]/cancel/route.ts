// POST /api/applications/:id/cancel — the signed-in customer cancels their application,
// while it is in progress or approved. No body.
import { loadCustomers } from '@/data/load';
import { applicantCustomerId } from '@/domain/catalogue';
import { fail, handleRoute, ok } from '@/server/api-response';
import { getAuth } from '@/server/auth-instance';
import { db } from '@/server/db';
import { cancelApplication } from '@/server/features/application/cancel-application';

export const POST = handleRoute(
  async (request, { params }: RouteContext<'/api/applications/[id]/cancel'>) => {
    const session = await getAuth().api.getSession({
      headers: request.headers,
      query: { disableRefresh: true },
    });
    if (!session) return fail(401, 'UNAUTHORIZED', 'Sign in required');
    if (session.user.accountType !== 'customer')
      return fail(403, 'FORBIDDEN', 'Customer account required');

    const customerId = applicantCustomerId(await loadCustomers());
    if (!customerId) return fail(404, 'UNKNOWN_APPLICATION', 'The application could not be found');

    const { id } = await params;
    const result = await cancelApplication(db, {
      applicationId: id,
      customerId,
      actor: session.user.id,
    });

    if (!result.ok) {
      const status = result.reason === 'unknown_application' ? 404 : 409;
      return fail(status, result.reason.toUpperCase(), 'The application could not be cancelled');
    }
    return ok({ status: 'cancelled' });
  }
);
