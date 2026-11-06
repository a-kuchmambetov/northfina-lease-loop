import { createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { fail } from './api-response';

// Group IPv6 privacy addresses by /64, including canonical and IPv4-mapped forms.
function network(ip: string): string {
  if (isIP(ip) === 4) return ip;
  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const [left, right] = canonical.split('::');
  const a = left ? left.split(':') : [];
  const b = right ? right.split(':') : [];
  const words = canonical.includes('::')
    ? [...a, ...Array(8 - a.length - b.length).fill('0'), ...b]
    : a;
  const values = words.map((word) => parseInt(word, 16));
  if (values.slice(0, 5).every((value) => value === 0) && values[5] === 65535)
    return [values[6]! >> 8, values[6]! & 255, values[7]! >> 8, values[7]! & 255].join('.');
  return `${values
    .slice(0, 4)
    .map((value) => value.toString(16))
    .join(':')}::/64`;
}

// Fixed-size, independently keyed tables never overflow into global denial.
// Secret hashing prevents chosen collisions. Collisions conservatively share a
// window; edge limits remain required for distributed attacks and multiple workers.
export function createAuthLimit(env: Record<string, string | undefined> = process.env) {
  const salt = randomBytes(32);
  const tables = new Map<string, Map<number, { count: number; until: number }>>();
  return (request: Request, email?: string, now = Date.now()) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/get-session')) return;
    const kind = path.endsWith('/sign-up/email')
      ? 'signup'
      : path.endsWith('/sign-out')
        ? 'logout'
        : 'login';
    const header = env.AUTH_TRUSTED_IP_HEADER;
    const raw = header ? request.headers.get(header)?.trim() : undefined;
    const ip = raw && !raw.includes('%') && isIP(raw) ? network(raw) : undefined;
    if (env.NODE_ENV === 'production' && !ip)
      return fail(503, 'AUTH_UNAVAILABLE', 'Authentication temporarily unavailable');
    const keys: [string, string, number][] = [];
    if (ip) keys.push(['ip', ip, kind === 'signup' ? 10 : kind === 'logout' ? 60 : 30]);
    if (email) {
      const account = email.toLowerCase();
      keys.push(['pair', `${ip ?? 'local'}:${account}`, 5]);
      keys.push(['account', account, kind === 'signup' ? 20 : 100]);
    }
    const selected = keys.map(([scope, key, max]) => {
      const name = `${kind}:${scope}`;
      let table = tables.get(name);
      if (!table) tables.set(name, (table = new Map()));
      // 2^20 slots: a Map only grows with keys actually seen, so this costs nothing at
      // rest — it just keeps two unrelated keys landing in the same slot (a false-
      // positive shared throttle, not a security hole, per the design note above) rare
      // enough that it stopped showing up as test flakiness with a few dozen test keys.
      const slot =
        createHmac('sha256', salt).update(`${name}:${key}`).digest().readUInt32BE(0) % 1_048_576;
      const existing = table.get(slot);
      const bucket = existing && existing.until > now ? existing : { count: 0, until: now + 60000 };
      return { table, slot, bucket, max };
    });
    for (const { bucket, max } of selected) {
      if (bucket.count >= max) {
        const response = fail(429, 'TOO_MANY_REQUESTS', 'Too many authentication attempts');
        response.headers.set(
          'retry-after',
          String(Math.max(1, Math.ceil((bucket.until - now) / 1000)))
        );
        return response;
      }
    }
    for (const { table, slot, bucket } of selected) {
      bucket.count++;
      table.set(slot, bucket);
    }
  };
}
