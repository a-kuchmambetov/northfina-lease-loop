import { describe, expect, it, vi } from 'vitest';
import { authRoute } from './auth-route';
import type { createAuth } from './auth';

describe('auth response boundary', () => {
  it.each([400, 401, 429, 500])('preserves empty error response status %i', async (status) => {
    const handler = vi
      .fn()
      .mockResolvedValue(new Response(null, { status, headers: { 'retry-after': '12' } }));
    const route = authRoute({ handler } as unknown as ReturnType<typeof createAuth>);
    const response = await route(
      new Request('http://localhost:3000/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'a@example.test', password: 'password-test' }),
      }),
      undefined
    );
    expect(response.status).toBe(status);
    expect(response.headers.get('retry-after')).toBe('12');
    expect(await response.json()).toMatchObject({ success: false });
  });
});

it('gives the browser only the name and account type from the session', async () => {
  const handler = vi.fn().mockResolvedValue(
    Response.json({
      session: { token: 'secret-token' },
      user: { id: 'u1', name: 'Aino', email: 'a@example.test', accountType: 'customer' },
    })
  );
  const route = authRoute({ handler } as unknown as ReturnType<typeof createAuth>);
  const response = await route(
    new Request('http://localhost:3000/api/auth/get-session'),
    undefined
  );
  expect((await response.json()).data).toEqual({ user: { name: 'Aino', accountType: 'customer' } });
});

it('reconstructs a Next-style proxied Request after consuming its body', async () => {
  const handler = vi.fn(async (request: Request) => {
    expect(await request.json()).toEqual({ email: 'a@example.test', password: 'password-test' });
    expect(request.headers.get('origin')).toBe('http://localhost:3000');
    return Response.json({});
  });
  const route = authRoute({ handler } as unknown as ReturnType<typeof createAuth>);
  const original = new Request('http://localhost:3000/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify({ email: 'A@example.test', password: 'password-test' }),
  });
  const proxied = new Proxy(original, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  expect((await route(proxied, undefined)).status).toBe(200);
  expect(handler).toHaveBeenCalledOnce();
});

it('bounds both declared and chunked bodies before parsing or calling auth', async () => {
  const handler = vi.fn();
  const route = authRoute({ handler } as unknown as ReturnType<typeof createAuth>);
  for (const path of ['sign-up/email', 'sign-in/email', 'sign-out']) {
    for (const declared of [false, true]) {
      const response = await route(
        new Request(`http://localhost:3000/api/auth/${path}`, {
          method: 'POST',
          headers: declared ? { 'content-length': '9000' } : {},
          body: 'x'.repeat(9000),
        }),
        undefined
      );
      expect(response.status).toBe(413);
    }
  }
  expect(handler).not.toHaveBeenCalled();
});
