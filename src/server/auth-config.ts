import { randomBytes } from 'node:crypto';

// Stable for this development process only. db:setup writes a persistent secret.
const developmentSecret = randomBytes(32).toString('base64');
export function authConfig(env: Record<string, string | undefined> = process.env) {
  const production = env.NODE_ENV === 'production';
  const secret = env.BETTER_AUTH_SECRET || (production ? '' : developmentSecret);
  if (
    production &&
    (secret.length < 43 ||
      new Set(secret).size < 16 ||
      /example|change.?me|test.secret|123123/i.test(secret))
  ) {
    throw new Error('Set BETTER_AUTH_SECRET to a unique random secret (openssl rand -base64 32)');
  }
  if (production && !env.BETTER_AUTH_URL)
    throw new Error('BETTER_AUTH_URL is required in production');
  const url = new URL(env.BETTER_AUTH_URL || 'http://localhost:3000');
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (production && url.protocol !== 'https:')
  ) {
    throw new Error('BETTER_AUTH_URL must be an explicit HTTPS origin in production');
  }
  if (production && (!env.AUTH_TRUSTED_IP_HEADER || env.AUTH_SINGLE_INSTANCE !== 'true')) {
    throw new Error(
      'Production auth requires a trusted proxy header and AUTH_SINGLE_INSTANCE=true; see README'
    );
  }
  return { secret, baseURL: url.origin };
}
