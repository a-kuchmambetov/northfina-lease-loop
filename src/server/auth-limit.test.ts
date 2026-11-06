import { describe, expect, it } from 'vitest';
import { createAuthLimit } from './auth-limit';
const request = (ip = '192.0.2.1', path = 'sign-in/email') =>
  new Request(`https://lease.example/api/auth/${path}`, { headers: { 'x-client-ip': ip } });
const setup = () => createAuthLimit({ AUTH_TRUSTED_IP_HEADER: 'x-client-ip' });
describe('auth rate limiting', () => {
  it('scopes strict limits to account and IP and expires windows', () => {
    const limit = setup();
    for (let i = 0; i < 5; i++) expect(limit(request(), 'a@example.test', 0)).toBeUndefined();
    const blocked = limit(request(), 'a@example.test', 1000);
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get('retry-after')).toBe('59');
    expect(limit(request('192.0.2.2'), 'a@example.test', 1000)).toBeUndefined();
    expect(limit(request(), 'a@example.test', 60000)).toBeUndefined();
  });
  it('uses a higher global account limit', () => {
    const limit = setup();
    for (let i = 0; i < 100; i++)
      expect(limit(request(`192.0.2.${i}`), 'a@example.test', 0)).toBeUndefined();
    expect(limit(request('198.51.100.1'), 'a@example.test', 0)?.status).toBe(429);
  });
  it('ignores unconfigured forwarding headers', () => {
    const limit = createAuthLimit({});
    for (let i = 0; i < 5; i++)
      expect(limit(request(`192.0.2.${i}`), 'a@example.test', 0)).toBeUndefined();
    expect(limit(request('198.51.100.1'), 'a@example.test', 0)?.status).toBe(429);
  });
  it('exempts session reads and isolates signup and logout', () => {
    const limit = setup();
    for (let i = 0; i < 100; i++)
      expect(limit(request('192.0.2.1', 'get-session'), undefined, 0)).toBeUndefined();
    for (let i = 0; i < 5; i++) expect(limit(request(), 'a@example.test', 0)).toBeUndefined();
    expect(limit(request('192.0.2.1', 'sign-up/email'), 'a@example.test', 0)).toBeUndefined();
    expect(limit(request('192.0.2.1', 'sign-out'), undefined, 0)).toBeUndefined();
  });
  it('fails closed when production proxy IP is missing, invalid or a chain', () => {
    const limit = createAuthLimit({
      NODE_ENV: 'production',
      AUTH_TRUSTED_IP_HEADER: 'x-client-ip',
    });
    for (const ip of ['', 'invalid', '192.0.2.1, 192.0.2.2'])
      expect(limit(request(ip), 'a@example.test', 0)?.status).toBe(503);
    expect(limit(request(), 'a@example.test', 0)).toBeUndefined();
  });
  it('groups IPv6 /64 addresses and equivalent IPv4 mappings', () => {
    const limit = setup();
    for (let i = 0; i < 30; i++)
      expect(
        limit(request(`2001:db8:1:2::${i.toString(16)}`), `${i}@example.test`, 0)
      ).toBeUndefined();
    expect(limit(request('2001:0db8:0001:0002:abcd::1'), 'other@example.test', 0)?.status).toBe(
      429
    );
    expect(limit(request('2001:db8:1:3::1'), 'other@example.test', 0)).toBeUndefined();
    for (let i = 0; i < 5; i++)
      expect(limit(request('::ffff:192.0.2.1'), 'mapped@example.test', 0)).toBeUndefined();
    expect(limit(request(), 'mapped@example.test', 0)?.status).toBe(429);
  });
  it('cannot fill global capacity by rotating addresses within a /64', () => {
    const limit = setup();
    for (let i = 0; i < 12000; i++)
      limit(request(`2001:db8:1:2::${i.toString(16)}`), `${i}@example.test`, 0);
    expect(limit(request('2001:db8:1:3::1'), 'victim@example.test', 0)).toBeUndefined();
    expect(limit(request('2001:db8:1:2::1'), 'victim@example.test', 0)?.status).toBe(429);
  });
});
