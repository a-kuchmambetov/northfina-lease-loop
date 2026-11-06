// GET /api/audit-log: the 50 newest audit rows about the signed-in supplier's own equipment,
// newest first, without their `details`. Guests get 401; customers and any other account type
// get 403 (see src/domain/audit-access.ts for why).
import { fail, handleRoute, ok } from '@/server/api-response';
import { getAuth } from '@/server/auth-instance';
import { db } from '@/server/db';
import { getAuditLog } from '@/server/features/audit-log/get-audit-log';

export const GET = handleRoute(async (request) => {
  const session = await getAuth().api.getSession({
    headers: request.headers,
    query: { disableRefresh: true },
  });
  if (!session) return fail(401, 'UNAUTHORIZED', 'Sign in required');

  const result = await getAuditLog(db, {
    accountType: session.user.accountType,
    accountName: session.user.name,
    limit: 50,
  });
  if (!result.ok) return fail(403, 'FORBIDDEN', 'Supplier account required');
  return ok(result.entries, { headers: { 'Cache-Control': 'private, no-store' } });
});
