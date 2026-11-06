// Shared persistence for a locked contract (CHALLENGE.md Spine #4): writes the Contract
// row and issues invoice #1 (its invoice date is always the contract's own start date), under
// one audit action. Used both by a fresh signing (sign-contract.ts) and by an end-of-term
// extension, which really is "a new contract for the next term" priced off the item's
// current value (see src/server/features/end-of-term/resolve-end-of-term.ts).
import { randomUUID } from 'node:crypto';
import type { LockedContract } from '@/domain/contract';
import { withAudit, type TransactionClient } from '@/server/audit';
import { issueDueInvoices, type IssueDueInvoicesResult } from './issue-invoices';
import type { PrismaClient } from '@/generated/prisma/client';

/** Why an `inTransaction` step refused: the whole signing is rolled back. */
export type InTransactionResult = { ok: true } | { ok: false; reason: 'asset_not_available' };

export type PersistContractResult =
  | { ok: true; contract: LockedContract & { id: string; signedAt: string } }
  | {
      ok: false;
      reason: Extract<IssueDueInvoicesResult, { ok: false }>['reason'] | 'asset_not_available';
    };

/** Thrown inside the signing transaction to roll it back (nothing is committed). */
class RollbackSigning extends Error {
  constructor(readonly reason: 'asset_not_available') {
    super(reason);
  }
}

/** Set when the contract is formed from an approved application and signed with a typed name. */
export type ContractSignature = { applicationId: string; signedName: string };

export type PersistContractOptions = Partial<ContractSignature> & {
  /** `'pending_signature'` withholds the asset's first invoice — see
   *  src/server/features/contracts/confirm-signature.ts — by relying on
   *  issue-invoices.ts's own "only an active contract gets new invoices" rule below.
   *  Defaults to `'active'`, today's only behavior before this option existed. */
  status?: string;
  /** Only meaningful alongside `status: 'pending_signature'`. */
  pendingSignatoryEmail?: string;
  /** Extra writes that must commit or roll back together with the contract row (e.g. taking
   *  the asset, spending credit). Gets the transaction and the new contract's id; when it
   *  answers `ok: false`, the contract, its audit row and everything it wrote are rolled
   *  back and `persistContract` returns that reason. */
  inTransaction?: (tx: TransactionClient, contractId: string) => Promise<InTransactionResult>;
};

export async function persistContract(
  db: PrismaClient,
  contract: LockedContract,
  auditAction: string,
  options?: PersistContractOptions
): Promise<PersistContractResult> {
  const id = randomUUID();

  let row;
  try {
    row = await withAudit(
      db,
      {
        actor: 'customer',
        action: auditAction,
        entityType: 'contract',
        entityId: id,
        details: options?.applicationId
          ? { applicationId: options.applicationId, signedName: options.signedName }
          : undefined,
      },
      async (tx) => {
        const created = await tx.contract.create({
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
            application_id: options?.applicationId ?? null,
            signed_name: options?.signedName ?? null,
          },
        });
        const extra = await options?.inTransaction?.(tx, id);
        if (extra && !extra.ok) throw new RollbackSigning(extra.reason);
        return created;
      }
    );
  } catch (error) {
    if (error instanceof RollbackSigning) return { ok: false, reason: error.reason };
    throw error;
  }

  // Invoice #1 is dated the day the contract starts, which is today — issue it right away
  // instead of waiting for someone to ask for the invoice list.
  const issued = await issueDueInvoices(db, row.id, contract.startDate);
  if (!issued.ok) return issued;

  return { ok: true, contract: { ...contract, id: row.id, signedAt: row.signed_at.toISOString() } };
}
