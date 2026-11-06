import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../../tests/helpers/test-db';
import { createAuth } from './auth';
import { listAuditLog } from './audit';
import { authRoute } from './auth-route';
import type { PrismaClient } from './prisma-client';

let db: PrismaClient;
let cleanup: () => Promise<void>;
let route: ReturnType<typeof authRoute>;
let testNumber = 0;
const baseURL = 'http://localhost:3000';
const credentials = {
  name: 'Aino Example',
  accountType: 'customer',
  email: 'aino@example.test',
  password: 'a-long-test-passphrase',
};

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  testNumber += 1;
  await db.user.deleteMany();
  await db.auditLog.deleteMany();
  route = authRoute(
    createAuth(db, { baseURL, secret: 'test-secret-for-auth-integration-only-12345' })
  );
});

function request(path: string, body?: unknown, cookie?: string, origin = baseURL) {
  if (path === 'sign-in/email' && body && typeof body === 'object') {
    const { name: _name, accountType: _accountType, ...fields } = body as typeof credentials;
    void _name;
    void _accountType;
    body = fields;
  }
  return route(
    new Request(`${baseURL}/api/auth/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        origin,
        'x-forwarded-for': `192.0.2.${testNumber}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    undefined
  );
}
function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
}

async function signup() {
  const response = await request('sign-up/email', credentials);
  expect(response.status).toBe(200);
  expect(await response.clone().json()).toMatchObject({ success: true, data: null });
  return response;
}

describe('email/password authentication', () => {
  it.each(['customer', 'supplier'])('saves the selected %s account type', async (accountType) => {
    expect((await request('sign-up/email', { ...credentials, accountType })).status).toBe(200);
    expect((await db.user.findFirstOrThrow()).accountType).toBe(accountType);
  });

  it.each([undefined, '', 'admin'])('rejects invalid account type %j', async (accountType) => {
    expect((await request('sign-up/email', { ...credentials, accountType })).status).toBe(400);
    expect(await db.user.count()).toBe(0);
  });
  it('registers a hashed password, persists a session, and audits without secrets', async () => {
    const response = await signup();
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    const account = await db.account.findFirstOrThrow();
    expect(account.password).not.toBe(credentials.password);
    expect(account.password).toBeTruthy();
    expect(await db.user.count()).toBe(1);
    const session = await request('get-session', undefined, cookies(response));
    expect(await session.json()).toMatchObject({
      success: true,
      data: { user: { name: credentials.name } },
    });
    expect(session.headers.get('cache-control')).toBe('no-store');
    const audit = await db.auditLog.findMany();
    const user = await db.user.findFirstOrThrow();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor: user.id,
      action: 'auth.signup',
      entity_type: 'user',
      entity_id: user.id,
    });
    expect(await listAuditLog(db)).toEqual([]);
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain(credentials.password);
    expect(serialized).not.toContain(account.password);
    expect(serialized).not.toContain((await db.session.findFirstOrThrow()).token);
  });

  it('logs out, invalidates the old cookie, then logs back in', async () => {
    const response = await signup();
    const cookie = cookies(response);
    const oldSession = await db.session.findFirstOrThrow();
    expect((await request('sign-out', {}, cookie)).status).toBe(200);
    expect(await db.session.count()).toBe(0);
    expect(await db.auditLog.findFirst({ where: { action: 'auth.logout' } })).toMatchObject({
      actor: oldSession.userId,
      entity_type: 'session',
      entity_id: oldSession.id,
    });
    expect(await (await request('get-session', undefined, cookie)).json()).toMatchObject({
      data: null,
    });
    const login = await request('sign-in/email', credentials);
    expect(login.status).toBe(200);
    const newSession = await db.session.findFirstOrThrow();
    expect(await db.auditLog.findFirst({ where: { action: 'auth.login' } })).toMatchObject({
      actor: newSession.userId,
      entity_type: 'session',
      entity_id: newSession.id,
    });
    expect(await (await request('get-session', undefined, cookies(login))).json()).toMatchObject({
      data: { user: { name: credentials.name } },
    });
  });

  it('rejects incorrect and unknown credentials with the same safe response', async () => {
    await signup();
    const wrong = await request('sign-in/email', {
      ...credentials,
      password: 'incorrect-password',
    });
    const unknown = await request('sign-in/email', {
      ...credentials,
      email: 'unknown@example.test',
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect((await wrong.json()).error).toEqual((await unknown.json()).error);
  });

  it('rejects duplicate accounts and invalid credentials without changing user count', async () => {
    await signup();
    expect((await request('sign-up/email', credentials)).ok).toBe(false);
    expect((await request('sign-up/email', { ...credentials, email: 'invalid' })).ok).toBe(false);
    expect(await db.user.count()).toBe(1);
  });

  it('handles concurrent independent and duplicate signups without 500s', async () => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        request('sign-up/email', { ...credentials, email: `user${i}@example.test` })
      )
    );
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(200));
    const duplicates = await Promise.all([signup(), request('sign-up/email', credentials)]);
    expect(duplicates.map((r) => r.status).sort()).toEqual([200, 422]);
    expect(await db.user.count()).toBe(9);
    expect(await db.auditLog.count()).toBe(9);
  });

  it.each(['', '   ', 'x'.repeat(101), 'A\u0000B', 'A\u200bB', 42])(
    'rejects invalid signup name %j',
    async (name) => {
      expect((await request('sign-up/email', { ...credentials, name })).status).toBe(400);
      expect(await db.user.count()).toBe(0);
    }
  );

  it('rejects privileged and unexpected signup fields', async () => {
    for (const extra of [
      { emailVerified: true },
      { id: 'forged' },
      { image: 'https://example.test' },
      { callbackURL: '/admin' },
    ]) {
      expect((await request('sign-up/email', { ...credentials, ...extra })).status).toBe(400);
    }
    expect(await db.user.count()).toBe(0);
  });

  it('rejects short passwords on the server', async () => {
    const response = await request('sign-up/email', { ...credentials, password: 'short' });
    expect(response.status).toBe(400);
    expect(await db.user.count()).toBe(0);
  });

  it('rate limits repeated authentication attempts', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await request('sign-in/email', credentials)).status).toBe(401);
    }
    const response = await request('sign-in/email', credentials);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBeTruthy();
    expect(await response.json()).toMatchObject({ error: { code: 'TOO_MANY_REQUESTS' } });
  });

  it('rejects foreign origins and unexposed endpoints', async () => {
    const csrf = await request('sign-up/email', credentials, undefined, 'https://foreign.example');
    expect(csrf.status).toBe(403);
    expect(await db.user.count()).toBe(0);
    expect((await request('list-sessions')).status).toBe(404);
    expect((await request('delete-user', {})).status).toBe(404);
  });

  it('returns no session for missing or forged cookies', async () => {
    expect(await (await request('get-session')).json()).toMatchObject({ data: null });
    expect(
      await (await request('get-session', undefined, 'better-auth.session_token=forged')).json()
    ).toMatchObject({ data: null });
  });

  it('rejects bulk adapter mutations before any write or audit', async () => {
    await signup();
    const { adapter } = await createAuth(db, {
      baseURL,
      secret: 'test-secret-for-auth-integration-only-12345',
    }).$context;
    const initial = await db.session.findMany();
    const auditCount = await db.auditLog.count();
    await expect(adapter.deleteMany({ model: 'session', where: [] })).rejects.toThrow(
      'Bulk auth mutations are unsupported'
    );
    await expect(
      adapter.updateMany({ model: 'session', where: [], update: { userAgent: 'changed' } })
    ).rejects.toThrow('Bulk auth mutations are unsupported');
    expect(await db.session.findMany()).toEqual(initial);
    expect(await db.auditLog.count()).toBe(auditCount);
  });

  it('audits automatic expiry with a system actor', async () => {
    const registered = await signup();
    const initial = await db.session.findFirstOrThrow();
    await db.session.update({
      where: { id: initial.id },
      data: { expiresAt: new Date('2000-01-01') },
    });
    expect(
      await (await request('get-session', undefined, cookies(registered))).json()
    ).toMatchObject({ data: null });
    expect(await db.session.count()).toBe(0);
    expect(
      await db.auditLog.findFirst({ where: { action: 'auth.session_expired' } })
    ).toMatchObject({ actor: 'system', entity_id: initial.id });
    expect(await db.auditLog.count({ where: { action: 'auth.logout' } })).toBe(0);
  });

  it('rolls login and logout back when auditing fails', async () => {
    const registered = await signup();
    const initial = await db.session.findFirstOrThrow();
    const broken = db.$extends({
      query: {
        auditLog: {
          create() {
            throw new Error('audit unavailable');
          },
        },
      },
    });
    const handler = authRoute(
      createAuth(broken as PrismaClient, {
        baseURL,
        secret: 'test-secret-for-auth-integration-only-12345',
      })
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const path of ['sign-in/email', 'sign-out']) {
        const response = await handler(
          new Request(`${baseURL}/api/auth/${path}`, {
            method: 'POST',
            headers: {
              origin: baseURL,
              'content-type': 'application/json',
              cookie: cookies(registered),
            },
            body: JSON.stringify(
              path === 'sign-out'
                ? {}
                : { email: credentials.email, password: credentials.password }
            ),
          }),
          undefined
        );
        expect(response.ok).toBe(false);
        expect(await db.session.findMany()).toEqual([initial]);
        expect(await db.auditLog.count()).toBe(1);
      }
    } finally {
      log.mockRestore();
    }
  });

  it('rolls registration back when the audit insert fails', async () => {
    const broken = db.$extends({
      query: {
        auditLog: {
          create() {
            throw new Error('audit unavailable');
          },
        },
      },
    });
    const handler = authRoute(
      createAuth(broken as PrismaClient, {
        baseURL,
        secret: 'test-secret-for-auth-integration-only-12345',
      })
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await handler(
        new Request(`${baseURL}/api/auth/sign-up/email`, {
          method: 'POST',
          headers: {
            origin: baseURL,
            'Content-Type': 'application/json',
            'x-forwarded-for': `192.0.2.${testNumber}`,
          },
          body: JSON.stringify(credentials),
        }),
        undefined
      );
      expect(response.status).toBe(500);
      expect(await db.user.count()).toBe(0);
      expect(await db.account.count()).toBe(0);
      expect(await db.session.count()).toBe(0);
      expect(JSON.stringify(await response.json())).not.toContain('audit unavailable');
    } finally {
      log.mockRestore();
    }
  });
});
