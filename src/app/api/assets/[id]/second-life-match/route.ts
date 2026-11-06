// GET /api/assets/:id/second-life-match?asOf=YYYY-MM-DD — previews the second-life
// recommendation (refurbish or not, who on the waiting list wins, at what rent) for a
// returned asset, without writing anything (CHALLENGE.md Spine #7 / Smart Problem #3).
// POST same path, body { asOfDate? } — commits it: writes the asset's new condition,
// usage and status, and an audit row.
import { z } from 'zod';
import { isoDateSchema } from '@/data/schemas';
import { fail, handleRoute, ok, readJsonBody } from '@/server/api-response';
import { db } from '@/server/db';
import { computeSecondLifeMatch } from '@/server/features/second-life/compute-second-life-match';
import { resolveSecondLifeMatch } from '@/server/features/second-life/resolve-second-life-match';
import { todayIso } from '@/server/today';

const NOT_FOUND_REASONS = new Set(['asset_not_found']);
const CONFLICT_REASONS = new Set(['asset_status_conflict']);

export const GET = handleRoute(
  async (request, { params }: RouteContext<'/api/assets/[id]/second-life-match'>) => {
    const { id } = await params;
    const asOf = new URL(request.url).searchParams.get('asOf') ?? todayIso();

    const result = await computeSecondLifeMatch(db, id, asOf);
    if (!result.ok) {
      const status = NOT_FOUND_REASONS.has(result.reason) ? 404 : 422;
      return fail(
        status,
        result.reason.toUpperCase(),
        'The second-life match could not be computed'
      );
    }
    return ok(result.computation);
  }
);

const bodySchema = z.strictObject({ asOfDate: isoDateSchema.optional() });

export const POST = handleRoute(
  async (request, { params }: RouteContext<'/api/assets/[id]/second-life-match'>) => {
    const { id } = await params;
    const body = await readJsonBody(request, bodySchema);

    const result = await resolveSecondLifeMatch(db, id, body.asOfDate ?? todayIso());
    if (!result.ok) {
      const status = NOT_FOUND_REASONS.has(result.reason)
        ? 404
        : CONFLICT_REASONS.has(result.reason)
          ? 409
          : 422;
      return fail(
        status,
        result.reason.toUpperCase(),
        'The second-life match could not be resolved'
      );
    }
    return ok(result.computation);
  }
);
