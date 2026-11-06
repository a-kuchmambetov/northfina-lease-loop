// GET /api/assets/:id/passport — an item's full history across lives, and the CO2 it has
// saved by having more than one (CHALLENGE.md Spine #7 bonus, scenario card 10).
import { fail, handleRoute, ok } from '@/server/api-response';
import { db } from '@/server/db';
import { getAssetPassport } from '@/server/features/second-life/get-asset-passport';

export const GET = handleRoute(
  async (_request, { params }: RouteContext<'/api/assets/[id]/passport'>) => {
    const { id } = await params;
    const result = await getAssetPassport(db, id);
    if (!result.ok) return fail(404, 'ASSET_NOT_FOUND', `No asset with id "${id}"`);
    return ok(result.passport);
  }
);
