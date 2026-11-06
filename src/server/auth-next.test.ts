import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inject, it, expect } from 'vitest';

it('signs up, reads the session, logs out and logs in through an actual Next server', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lease-auth-next-'));
  const database = path.join(directory, 'auth.db');
  let child: ChildProcess | undefined;
  let output = '';
  try {
    await copyFile(inject('templateDatabasePath'), database);
    const root = process.cwd();
    for (const file of ['package.json', 'tsconfig.json', 'next.config.ts'])
      await copyFile(path.join(root, file), path.join(directory, file));
    await cp(path.join(root, 'src'), path.join(directory, 'src'), { recursive: true });
    await cp(path.join(root, 'data'), path.join(directory, 'data'), { recursive: true });
    await symlink(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
    const reservation = createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const address = reservation.address() as { port: number };
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const baseURL = `http://127.0.0.1:${address.port}`;
    child = spawn(
      process.execPath,
      [
        'node_modules/next/dist/bin/next',
        'dev',
        '--webpack',
        '--hostname',
        '127.0.0.1',
        '--port',
        String(address.port),
      ],
      {
        cwd: directory,
        detached: true,
        env: {
          ...process.env,
          NODE_ENV: 'development',
          DATABASE_URL: `file:${database}`,
          BETTER_AUTH_URL: baseURL,
          AUTH_TRUSTED_IP_HEADER: '',
          NEXT_TELEMETRY_DISABLED: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    child.stdout?.on('data', (data) => {
      output = (output + String(data)).slice(-10000);
    });
    child.stderr?.on('data', (data) => {
      output = (output + String(data)).slice(-10000);
    });
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) throw new Error(`Next exited: ${output}`);
      try {
        const response = await fetch(`${baseURL}/api/auth/get-session`, {
          signal: AbortSignal.timeout(15000),
        });
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        /* server starting */
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(ready, output).toBe(true);
    const credentials = {
      name: 'Next Regression',
      accountType: 'customer',
      email: 'next@example.test',
      password: 'a-long-test-passphrase',
    };
    async function call(endpoint: string, body?: unknown, cookie?: string) {
      return fetch(`${baseURL}/api/auth/${endpoint}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          origin: baseURL,
          'content-type': 'application/json',
          ...(cookie ? { cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    }
    function cookies(response: Response) {
      return response.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ');
    }
    async function catalogue(pathname: string, cookie?: string) {
      return fetch(`${baseURL}${pathname}`, {
        headers: cookie ? { cookie } : {},
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      });
    }
    // The catalogue is public, but serial numbers stay out of what a guest receives.
    const guestPage = await catalogue('/en');
    expect(guestPage.status, output).toBe(200);
    expect(guestPage.headers.get('location')).toBeNull();
    expect(await guestPage.text()).not.toContain('serial_number');
    expect((await catalogue('/api/assets')).status).toBe(401);
    const supplier = await call('sign-up/email', {
      ...credentials,
      email: 'supplier@example.test',
      accountType: 'supplier',
    });
    expect(supplier.status, output).toBe(200);
    const supplierCookie = cookies(supplier);
    const supplierPage = await catalogue('/en', supplierCookie);
    expect(supplierPage.status, output).toBe(200);
    expect(await supplierPage.text()).not.toContain('serial_number');
    expect((await catalogue('/api/assets', supplierCookie)).status).toBe(403);

    const signup = await call('sign-up/email', credentials);
    expect(signup.status, output).toBe(200);
    const cookie = cookies(signup);
    expect(cookie).toContain('session_token=');
    const customerPage = await catalogue('/en', cookie);
    expect(customerPage.status, output).toBe(200);
    expect(await customerPage.text()).toContain('Catalogue');
    const customerAssets = await catalogue('/api/assets', cookie);
    expect(customerAssets.status, output).toBe(200);
    expect((await customerAssets.json()).success).toBe(true);
    expect(await (await call('get-session', undefined, cookie)).json()).toMatchObject({
      data: { user: { name: credentials.name } },
    });
    const logout = await fetch(`${baseURL}/api/auth/sign-out`, {
      method: 'POST',
      headers: { origin: baseURL, cookie, 'content-length': '0' },
      signal: AbortSignal.timeout(15000),
    });
    expect(logout.status, output).toBe(200);
    expect((await catalogue('/api/assets', cookie)).status).toBe(401);
    expect(await (await call('get-session', undefined, cookie)).json()).toMatchObject({
      data: null,
    });
    const login = await call('sign-in/email', {
      email: credentials.email,
      password: credentials.password,
    });
    expect(login.status, output).toBe(200);
    expect(await (await call('get-session', undefined, cookies(login))).json()).toMatchObject({
      data: { user: { name: credentials.name } },
    });
    expect((await call('sign-out', {}, cookies(login))).status).toBe(200);
    expect(await (await call('get-session', undefined, cookies(login))).json()).toMatchObject({
      data: null,
    });
  } finally {
    if (child && child.exitCode === null) {
      const stopped = once(child, 'exit');
      process.kill(-child.pid!, 'SIGTERM');
      const timer = setTimeout(() => {
        try {
          process.kill(-child!.pid!, 'SIGKILL');
        } catch {
          /* already stopped */
        }
      }, 3000);
      await stopped;
      clearTimeout(timer);
    }
    await rm(directory, { recursive: true, force: true });
  }
}, 120000);
