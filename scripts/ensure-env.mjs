// Creates .env from .env.example when .env is missing. Never overwrites an existing .env.
// Usage: node scripts/ensure-env.mjs
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * @param {string} root folder that holds .env.example
 * @returns {'created' | 'exists'}
 */
export function ensureEnvFile(root) {
  const target = join(root, '.env');
  if (existsSync(target)) return 'exists';
  const example = readFileSync(join(root, '.env.example'), 'utf8');
  writeFileSync(
    target,
    example.replace(
      /^BETTER_AUTH_SECRET=.*$/m,
      `BETTER_AUTH_SECRET=${randomBytes(32).toString('base64')}`
    ),
    { flag: 'wx', mode: 0o600 }
  );
  return 'created';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = ensureEnvFile(process.cwd());
  console.log(result === 'created' ? '📝 Created .env from .env.example' : '✔ .env already exists');
}
