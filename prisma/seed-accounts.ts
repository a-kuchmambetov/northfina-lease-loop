import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { withAudit } from '@/server/audit';
import type { PrismaClient } from '@/server/prisma-client';

const accounts = [
  {
    name: 'Test Customer',
    email: 'customer@example.com',
    accountType: 'customer',
  },
  {
    name: 'Kettu Bikes',
    email: 'supplier@example.com',
    accountType: 'supplier',
  },
] as const;

/** Create missing demo accounts without changing existing users or their passwords. */
export async function seedAccounts(db: PrismaClient) {
  const created: { email: string; password: string }[] = [];
  for (const account of accounts) {
    if (await db.user.findUnique({ where: { email: account.email } })) continue;
    const password: string = 'test-pswd-123';
    const hash = await hashPassword(password);
    const id = randomUUID();
    await withAudit(
      db,
      { actor: 'system', action: 'auth.seeded', entityType: 'user', entityId: id },
      async (tx) => {
        await tx.user.create({ data: { id, ...account } });
        await tx.account.create({
          data: {
            id: randomUUID(),
            accountId: id,
            providerId: 'credential',
            userId: id,
            password: hash,
          },
        });
      }
    );
    created.push({ email: account.email, password });
  }
  return created;
}
