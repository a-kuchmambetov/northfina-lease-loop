import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { authConfig } from './auth-config';

const production = () => ({
  NODE_ENV: 'production',
  BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
  BETTER_AUTH_URL: 'https://lease.example',
  AUTH_TRUSTED_IP_HEADER: 'x-lease-loop-client-ip',
  AUTH_SINGLE_INSTANCE: 'true',
});
describe('auth deployment configuration', () => {
  it('requires a production URL and HTTPS origin', () => {
    expect(() => authConfig({ ...production(), BETTER_AUTH_URL: '' })).toThrow('required');
    for (const url of [
      'http://lease.example',
      'https://lease.example/path',
      'https://user:pass@lease.example',
    ]) {
      expect(() => authConfig({ ...production(), BETTER_AUTH_URL: url })).toThrow();
    }
    expect(authConfig(production()).baseURL).toBe('https://lease.example');
  });
  it('rejects missing, weak and known example secrets', () => {
    for (const secret of [
      '',
      '12312312312312312312312312312312',
      'a'.repeat(64),
      'change-me-to-a-long-random-production-secret-123456789',
    ]) {
      expect(() => authConfig({ ...production(), BETTER_AUTH_SECRET: secret })).toThrow('secret');
    }
  });
  it('requires explicit proxy and single-instance configuration', () => {
    expect(() => authConfig({ ...production(), AUTH_TRUSTED_IP_HEADER: '' })).toThrow('proxy');
    expect(() => authConfig({ ...production(), AUTH_SINGLE_INSTANCE: '' })).toThrow('proxy');
  });
  it('uses a stable random development fallback', () => {
    expect(authConfig({}).secret).toHaveLength(44);
    expect(authConfig({}).secret).toBe(authConfig({}).secret);
  });
});
