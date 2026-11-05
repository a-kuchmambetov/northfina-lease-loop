// GET /api/assets[?category=e_bike|laptop|farm_machine]
import { z } from 'zod';
import { assetCategorySchema } from '@/data/schemas';
import { fail, handleRoute, ok } from '@/server/api-response';
import { listAssets } from '@/server/assets';
import { getAuth } from '@/server/auth-instance';
import { db } from '@/server/db';

const querySchema = z.object({ category: assetCategorySchema.optional() });

export const GET = handleRoute(async (request) => {
  const session = await getAuth().api.getSession({
    headers: request.headers,
    query: { disableRefresh: true },
  });
  if (!session) return fail(401, 'UNAUTHORIZED', 'Sign in required');
  if (session.user.accountType !== 'customer')
    return fail(403, 'FORBIDDEN', 'Customer account required');

  const searchParams = new URL(request.url).searchParams;
  const { category } = querySchema.parse({ category: searchParams.get('category') ?? undefined });
  return ok(await listAssets(db, { category }), {
    headers: { 'Cache-Control': 'private, no-store' },
  });
});
