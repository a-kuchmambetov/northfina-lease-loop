// Orchestration for the customer's invoice page: one of their own contracts, the name of its
// equipment, and its invoices (see get-invoices.ts, which issues whatever is due first).
// No business rules live here.
import { loadAssets } from '@/data/load';
import type { PrismaClient } from '@/generated/prisma/client';
import { getContractInvoices, type GetContractInvoicesResult } from './get-invoices';

type InvoiceFailureReason = Extract<GetContractInvoicesResult, { ok: false }>['reason'];

export type CustomerInvoices = {
  lease: {
    id: string;
    assetName: string;
    status: string;
    startDate: string;
    termMonths: number;
    monthlyNetRentCents: number;
  };
  invoices: Extract<GetContractInvoicesResult, { ok: true }>['invoices'];
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

  const result = await getContractInvoices(db, contract.id, input.asOfDate);
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
      invoices: result.invoices,
    },
  };
}
