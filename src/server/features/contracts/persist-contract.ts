// Shared persistence for a locked contract (CHALLENGE.md Spine #4): writes the Contract
// row and issues invoice #1 (its due date is always the contract's own start date), under
// one audit action. Used both by a fresh signing (sign-contract.ts) and by an end-of-term
// extension, which really is "a new contract for the next term" priced off the item's
// current value (see src/server/features/end-of-term/resolve-end-of-term.ts).
import { randomUUID } from 'node:crypto';
import type { LockedContract } from '@/domain/contract';
import { withAudit } from '@/server/audit';
import { issueDueInvoices, type IssueDueInvoicesResult } from './issue-invoices';
import type { PrismaClient } from '@/generated/prisma/client';

export type PersistContractResult =
  | { ok: true; contract: LockedContract & { id: string; signedAt: string } }
  | { ok: false; reason: Extract<IssueDueInvoicesResult, { ok: false }>['reason'] };

export type PersistContractOptions = {
  /** `'pending_signature'` withholds the asset's first invoice — see
   *  src/server/features/contracts/confirm-signature.ts — by relying on
   *  issue-invoices.ts's own "only an active contract gets new invoices" rule below.
   *  Defaults to `'active'`, today's only behavior before this option existed. */
  status?: string;
  /** Only meaningful alongside `status: 'pending_signature'`. */
  pendingSignatoryEmail?: string;
};

export async function persistContract(
  db: PrismaClient,
  contract: LockedContract,
  auditAction: string,
  options?: PersistContractOptions
): Promise<PersistContractResult> {
  const id = randomUUID();

  const row = await withAudit(
    db,
    { actor: 'customer', action: auditAction, entityType: 'contract', entityId: id },
    (tx) =>
      tx.contract.create({
        data: {
          id,
          asset_id: contract.assetId,
          customer_id: contract.customerId,
          start_date: contract.startDate,
          term_months: contract.termMonths,
          price_list_version: contract.priceListVersion,
          list_price_cents: contract.listPriceCents,
          down_payment_cents: contract.downPaymentCents,
          financed_cents: contract.financedCents,
          monthly_net_rent_cents: contract.monthlyNetRentCents,
          buyout_cents: contract.buyoutCents,
          status: options?.status ?? 'active',
          pending_signatory_email: options?.pendingSignatoryEmail ?? null,
        },
      })
  );

  // Invoice #1 is due the day the contract starts, which is today — issue it right away
  // instead of waiting for someone to ask for the invoice list.
  const issued = await issueDueInvoices(db, row.id, contract.startDate);
  if (!issued.ok) return issued;

  return { ok: true, contract: { ...contract, id: row.id, signedAt: row.signed_at.toISOString() } };
}
