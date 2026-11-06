import type { PrismaClient } from '@/generated/prisma/client';

/** Reads the profile linked to an account, without choosing a demo customer. */
export async function findCustomerForUser(db: PrismaClient, userId: string) {
  return db.customer.findUnique({ where: { user_id: userId }, select: { id: true } });
}
