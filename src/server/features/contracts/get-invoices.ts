// Orchestration for a contract's invoice schedule (CHALLENGE.md Spine #5): loads the
// locked contract and the current VAT rates, then asks src/domain/invoicing.ts for the
// schedule. No business rules live here — see src/domain/invoicing.ts for those.
import { loadVatRates } from '@/data/load';
import { buildInvoiceSchedule, type Invoice, type InvoiceScheduleResult } from '@/domain/invoicing';
import type { PrismaClient } from '@/generated/prisma/client';

type InvoiceFailureReason = Extract<InvoiceScheduleResult, { ok: false }>['reason'];

export type GetContractInvoicesResult =
  | { ok: true; invoices: Invoice[] }
  | { ok: false; reason: 'contract_not_found' | InvoiceFailureReason };

export async function getContractInvoices(
  db: PrismaClient,
  contractId: string
): Promise<GetContractInvoicesResult> {
  const contract = await db.contract.findUnique({ where: { id: contractId } });
  if (!contract) return { ok: false, reason: 'contract_not_found' };

  const vatRates = await loadVatRates();
  return buildInvoiceSchedule(vatRates, {
    startDate: contract.start_date,
    termMonths: contract.term_months,
    monthlyNetRentCents: contract.monthly_net_rent_cents,
  });
}
