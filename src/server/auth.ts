import { betterAuth } from 'better-auth';
import { authConfig } from './auth-config';
import { auditedAuthAdapter } from './auth-adapter';
import type { PrismaClient } from './prisma-client';

export function createAuth(db: PrismaClient, overrides?: { secret: string; baseURL: string }) {
  return betterAuth({
    appName: 'Lease Loop',
    ...(overrides ?? authConfig()),
    database: auditedAuthAdapter(db),
    user: { additionalFields: { accountType: { type: 'string', required: true } } },
    advanced: {
      disableOriginCheck: false,
      disableCSRFCheck: false,
      ipAddress: { disableIpTracking: true },
    },
    emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128 },
    // The route boundary applies account and explicitly trusted proxy limits.
    rateLimit: { enabled: false },
  });
}
