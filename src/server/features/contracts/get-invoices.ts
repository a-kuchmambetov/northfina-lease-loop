// Orchestration for a contract's full invoice view (CHALLENGE.md Spine #5): issues
// whatever invoices are due by `asOfDate` (see issue-invoices.ts), then merges them with
// the full projected schedule (src/domain/invoicing.ts) so the contract's later, not-yet-
// due invoices still show as a preview. No business rules live here.
import { loadVatRates } from '@/data/load';
import { buildInvoiceSchedule, type InvoiceScheduleResult } from '@/domain/invoicing';
import { issueDueInvoices, type IssuedInvoice } from './issue-invoices';
import type { PrismaClient } from '@/generated/prisma/client';

type InvoiceFailureReason = Extract<InvoiceScheduleResult, { ok: false }>['reason'];

export type ContractInvoiceView = (IssuedInvoice & { status: 'issued' | 'paid' }) | UpcomingInvoice;

type UpcomingInvoice = {
  id: null;
  sequenceNumber: number;
  dueDate: string;
  paymentDeadline: string;
  netCents: number;
  vatRatePercent: number;
  vatCents: number;
  grossCents: number;
  status: 'upcoming';
  paidAt: null;
};

export type GetContractInvoicesResult =
  | { ok: true; invoices: ContractInvoiceView[] }
  | { ok: false; reason: 'contract_not_found' | InvoiceFailureReason };

export async function getContractInvoices(
  db: PrismaClient,
  contractId: string,
  asOfDate: string
): Promise<GetContractInvoicesResult> {
  const issuedResult = await issueDueInvoices(db, contractId, asOfDate);
  if (!issuedResult.ok) return issuedResult;

  const contract = await db.contract.findUniqueOrThrow({ where: { id: contractId } });
  const vatRates = await loadVatRates();
  const scheduleResult = buildInvoiceSchedule(vatRates, {
    startDate: contract.start_date,
    termMonths: contract.term_months,
    monthlyNetRentCents: contract.monthly_net_rent_cents,
  });
  if (!scheduleResult.ok) return scheduleResult;

  const issuedBySequence = new Map(
    issuedResult.invoices.map((invoice) => [invoice.sequenceNumber, invoice])
  );

  const invoices: ContractInvoiceView[] = scheduleResult.invoices.map((projected) => {
    const issued = issuedBySequence.get(projected.sequenceNumber);
    if (issued) return issued;
    return {
      id: null,
      sequenceNumber: projected.sequenceNumber,
      dueDate: projected.dueDate,
      paymentDeadline: projected.paymentDeadline,
      netCents: projected.netCents,
      vatRatePercent: projected.vatRatePercent,
      vatCents: projected.vatCents,
      grossCents: projected.grossCents,
      status: 'upcoming',
      paidAt: null,
    };
  });

  return { ok: true, invoices };
}
