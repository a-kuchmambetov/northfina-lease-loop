// GET /api/fleet/impact — CO2 and money saved by second and third lives, across the whole
// fleet (CHALLENGE.md Smart Problem #7). Per-item is GET /api/assets/:id/passport.
import { ok, handleRoute } from '@/server/api-response';
import { db } from '@/server/db';
import { getFleetImpact } from '@/server/features/second-life/get-fleet-impact';

export const GET = handleRoute(async () => ok(await getFleetImpact(db)));
