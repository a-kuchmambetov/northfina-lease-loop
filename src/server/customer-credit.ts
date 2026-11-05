// A customer's credit balance: the sum of their CustomerCredit ledger rows. Earned by a
// good pass_on (src/domain/pass-on-bonus.ts), spent as part of a down payment at signing
// (see src/server/features/contracts/sign-contract.ts). Never stored as a single mutable
// balance column — the ledger is the source of truth, same reasoning as an invoice's
// audit trail: every change is its own row, nothing is overwritten.
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@/generated/prisma/client';
import { withAudit } from './audit';

export async function getCustomerCreditBalanceCents(
  db: PrismaClient,
  customerId: string
): Promise<number> {
  const result = await db.customerCredit.aggregate({
    where: { customer_id: customerId },
    _sum: { amount_cents: true },
  });
  return result._sum.amount_cents ?? 0;
}

export type AddCustomerCreditInput = {
  customerId: string;
  /** Positive to earn, negative to spend. */
  amountCents: number;
  reason: string;
  relatedContractId?: string;
  actor: string;
};

/** Writes one ledger row and its audit entry, atomically. */
export async function addCustomerCreditEntry(db: PrismaClient, input: AddCustomerCreditInput) {
  const id = randomUUID();
  return withAudit(
    db,
    {
      actor: input.actor,
      action: 'customer_credit.' + (input.amountCents >= 0 ? 'earned' : 'spent'),
      entityType: 'customer_credit',
      entityId: id,
      details: {
        customerId: input.customerId,
        amountCents: input.amountCents,
        reason: input.reason,
        relatedContractId: input.relatedContractId,
      },
    },
    (tx) =>
      tx.customerCredit.create({
        data: {
          id,
          customer_id: input.customerId,
          amount_cents: input.amountCents,
          reason: input.reason,
          related_contract_id: input.relatedContractId,
        },
      })
  );
}
