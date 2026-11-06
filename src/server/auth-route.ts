import { authBody } from './auth-body';
import { authOperation } from './auth-operation';
import { z } from 'zod';
import { createAuthLimit } from './auth-limit';
import { fail, handleRoute, ok } from './api-response';
import type { createAuth } from './auth';

// Only expose flows offered by our UI. Better Auth handles CSRF, passwords,
// cookies; our boundary preserves the project's API envelope.
function jsonHeaders(request: Request) {
  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  headers.delete('transfer-encoding');
  return headers;
}

export function authRoute(auth: ReturnType<typeof createAuth>) {
  const limit = createAuthLimit();
  return handleRoute(async (request: Request) => {
    const path = new URL(request.url).pathname.replace(/^\/api\/auth\//, '');
    const allowed =
      request.method === 'GET'
        ? path === 'get-session'
        : request.method === 'POST' &&
          ['sign-up/email', 'sign-in/email', 'sign-out'].includes(path);
    if (!allowed) return fail(404, 'NOT_FOUND', 'Not found');
    const inputBody = request.method === 'POST' ? await authBody(request) : {};
    if (inputBody.tooLarge) return fail(413, 'PAYLOAD_TOO_LARGE', 'Authentication body too large');
    if (path === 'sign-up/email' || path === 'sign-in/email') {
      const fields = {
        email: z
          .email()
          .max(254)
          .transform((email) => email.toLowerCase()),
        password: z.string().min(8).max(128),
      };
      const schema =
        path === 'sign-up/email'
          ? z.strictObject({
              ...fields,
              accountType: z.enum(['customer', 'supplier']),
              name: z
                .string()
                .trim()
                .min(1)
                .max(100)
                .regex(/^[^\p{Cc}\p{Cf}]+$/u),
            })
          : z.strictObject(fields);
      const input = schema.safeParse(inputBody.value);
      if (!input.success) return fail(400, 'INVALID_INPUT', 'Invalid authentication fields');
      const blocked = limit(request, input.data.email);
      if (blocked) return blocked;
      request = new Request(request.url, {
        method: request.method,
        headers: jsonHeaders(request),
        body: JSON.stringify(input.data),
      });
    } else {
      const blocked = limit(request);
      if (blocked) return blocked;
      if (request.method === 'POST')
        request = new Request(request.url, {
          method: request.method,
          headers: jsonHeaders(request),
          body: '{}',
        });
    }
    const operation: { error?: unknown; path: string } = { path };
    const response = await authOperation.run(operation, () => auth.handler(request));
    if (operation.error && response.ok) throw operation.error;
    // Error responses (notably 429) may have no body.
    const body = response.ok && path === 'get-session' ? await response.json() : null;
    const result = response.ok
      ? ok(
          path === 'get-session' && body
            ? { user: { name: body.user.name, accountType: body.user.accountType } }
            : null
        )
      : fail(
          response.status,
          response.status === 429 ? 'TOO_MANY_REQUESTS' : 'AUTH_FAILED',
          'Unable to complete authentication'
        );
    // Preserve each cookie independently (Expires contains commas).
    for (const cookie of response.headers.getSetCookie())
      result.headers.append('set-cookie', cookie);
    const retryAfter = response.headers.get('retry-after') ?? response.headers.get('x-retry-after');
    if (retryAfter) result.headers.set('retry-after', retryAfter);
    result.headers.set('Cache-Control', 'no-store');
    return result;
  });
}
