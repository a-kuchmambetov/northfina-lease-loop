import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureEnvFile } from './ensure-env.mjs';

let root;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ensure-env-'));
  writeFileSync(path.join(root, '.env.example'), 'DATABASE_URL="file:./dev.db"\n');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('ensureEnvFile', () => {
  it('copies .env.example to .env when .env is missing', () => {
    expect(ensureEnvFile(root)).toBe('created');
    expect(readFileSync(path.join(root, '.env'), 'utf8')).toBe('DATABASE_URL="file:./dev.db"\n');
  });

  it('generates a fresh local secret instead of copying the placeholder', () => {
    writeFileSync(path.join(root, '.env.example'), 'BETTER_AUTH_SECRET=\n');
    ensureEnvFile(root);
    const first = readFileSync(path.join(root, '.env'), 'utf8');
    expect(first).toMatch(/^BETTER_AUTH_SECRET=[A-Za-z0-9+/]{43}=$/m);
    rmSync(path.join(root, '.env'));
    ensureEnvFile(root);
    expect(readFileSync(path.join(root, '.env'), 'utf8')).not.toBe(first);
  });

  it('never overwrites an existing .env', () => {
    writeFileSync(path.join(root, '.env'), 'DATABASE_URL="file:./mine.db"\n');
    expect(ensureEnvFile(root)).toBe('exists');
    expect(readFileSync(path.join(root, '.env'), 'utf8')).toBe('DATABASE_URL="file:./mine.db"\n');
  });
});
