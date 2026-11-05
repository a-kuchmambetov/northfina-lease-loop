import { handleRoute } from '@/server/api-response';
import { getAuth } from '@/server/auth-instance';
import { authRoute } from '@/server/auth-route';

let route: ReturnType<typeof authRoute> | undefined;
export const GET = handleRoute(async (request: Request) => {
  route ??= authRoute(getAuth());
  return route(request, undefined);
});
export const POST = GET;
