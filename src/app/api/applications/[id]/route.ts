// GET /api/applications/:id — the application's current state: answers so far and its
// decision, once it has one (CHALLENGE.md Spine #3).
import { fail, handleRoute, ok } from '@/server/api-response';
import { db } from '@/server/db';
import { getApplication } from '@/server/features/application/get-application';

const NOT_FOUND_REASONS = new Set(['unknown_application']);

export const GET = handleRoute(
  async (_request, { params }: RouteContext<'/api/applications/[id]'>) => {
    const { id } = await params;
    const result = await getApplication(db, id);

    if (!result.ok) {
      const status = NOT_FOUND_REASONS.has(result.reason) ? 404 : 422;
      return fail(status, result.reason.toUpperCase(), 'The application could not be found');
    }
    return ok(result.application);
  }
);
