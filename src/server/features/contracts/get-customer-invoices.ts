// Orchestration for the customer's invoice page: one of their own contracts, the name of its
// equipment, and the invoices issued so far: the current one and the previous ones, newest
// first. Later months are not shown, because an invoice only exists once its invoice date has
// arrived (see issue-invoices.ts, which issues whatever is due first). No business rules live here.
import { loadAssets } from '@/data/load';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  issueDueInvoices,
  type IssueDueInvoicesResult,
  type IssuedInvoice,
} from './issue-invoices';

type InvoiceFailureReason = Extract<IssueDueInvoicesResult, { ok: false }>['reason'];

export type CustomerInvoices = {
  lease: {
    id: string;
    assetName: string;
    status: string;
    startDate: string;
    termMonths: number;
    monthlyNetRentCents: number;
  };
  /** Newest first. */
  invoices: IssuedInvoice[];
};

export type GetCustomerInvoicesResult =
  | { ok: true; value: CustomerInvoices }
  | { ok: false; reason: 'unknown_lease' | InvoiceFailureReason };

export async function getCustomerInvoices(
  db: PrismaClient,
  input: { contractId: string; customerId: string; asOfDate: string }
): Promise<GetCustomerInvoicesResult> {
  const contract = await db.contract.findUnique({ where: { id: input.contractId } });
  // Someone else's lease reads the same as one that doesn't exist.
  if (contract?.customer_id !== input.customerId) return { ok: false, reason: 'unknown_lease' };

  const result = await issueDueInvoices(db, contract.id, input.asOfDate);
  if (!result.ok)
    return result.reason === 'contract_not_found' ? { ok: false, reason: 'unknown_lease' } : result;

  const asset = (await loadAssets()).find((candidate) => candidate.id === contract.asset_id);
  return {
    ok: true,
    value: {
      lease: {
        id: contract.id,
        // The lease stays reachable even if its asset has left the data pack.
        assetName: asset ? `${asset.make} ${asset.model}` : contract.asset_id,
        status: contract.status,
        startDate: contract.start_date,
        termMonths: contract.term_months,
        monthlyNetRentCents: contract.monthly_net_rent_cents,
      },
      invoices: result.invoices.toReversed(),
    },
  };
}
