// Orchestration for issuing a contract's due invoices (CHALLENGE.md Spine #5): computes
// the full projected schedule with src/domain/invoicing.ts, then persists — "issues" —
// only the ones whose due date has actually arrived, each one once. An invoice already
// issued keeps whatever VAT rate it was given then, even if a rate changes later; one not
// due yet simply does not exist as a row until its own day comes.
import { randomUUID } from 'node:crypto';
import { loadVatRates } from '@/data/load';
import type { InvoiceKind } from '@/domain/fee-invoice';
import { buildInvoiceSchedule, type InvoiceScheduleResult } from '@/domain/invoicing';
import { withAudit } from '@/server/audit';
import type { PrismaClient } from '@/generated/prisma/client';

type InvoiceFailureReason = Extract<InvoiceScheduleResult, { ok: false }>['reason'];

export type IssuedInvoice = {
  id: string;
  sequenceNumber: number;
  kind: InvoiceKind;
  dueDate: string;
  paymentDeadline: string;
  netCents: number;
  vatRatePercent: number;
  vatCents: number;
  grossCents: number;
  /** `cancelled`: unpaid, but not owed any more (see src/domain/early-exit.ts). */
  status: 'issued' | 'paid' | 'cancelled';
  paidAt: string | null;
};

export type IssueDueInvoicesResult =
  | { ok: true; invoices: IssuedInvoice[] }
  | { ok: false; reason: 'contract_not_found' | InvoiceFailureReason };

function toIssuedInvoice(row: {
  id: string;
  sequence_number: number;
  kind: string;
  due_date: string;
  payment_deadline: string;
  net_cents: number;
  vat_rate_percent: number;
  vat_cents: number;
  gross_cents: number;
  status: string;
  paid_at: Date | null;
}): IssuedInvoice {
  return {
    id: row.id,
    sequenceNumber: row.sequence_number,
    kind: row.kind === 'early_return_fee' ? 'early_return_fee' : 'rent',
    dueDate: row.due_date,
    paymentDeadline: row.payment_deadline,
    netCents: row.net_cents,
    vatRatePercent: row.vat_rate_percent,
    vatCents: row.vat_cents,
    grossCents: row.gross_cents,
    status: row.status === 'paid' || row.status === 'cancelled' ? row.status : 'issued',
    paidAt: row.paid_at ? row.paid_at.toISOString() : null,
  };
}

/**
 * Issues every invoice of `contractId` whose due date is on or before `asOfDate` and does
 * not have a row yet, then returns every invoice issued so far (already-issued ones
 * included). Safe to call as often as you like — already-issued invoices are never
 * touched again, so this is how an invoice "generates itself" on its date: call this
 * (e.g. on every visit to the contract) and whatever has become due appears.
 */
export async function issueDueInvoices(
  db: PrismaClient,
  contractId: string,
  asOfDate: string
): Promise<IssueDueInvoicesResult> {
  const contract = await db.contract.findUnique({ where: { id: contractId } });
  if (!contract) return { ok: false, reason: 'contract_not_found' };

  const vatRates = await loadVatRates();
  const scheduleResult = buildInvoiceSchedule(vatRates, {
    startDate: contract.start_date,
    termMonths: contract.term_months,
    monthlyNetRentCents: contract.monthly_net_rent_cents,
  });
  if (!scheduleResult.ok) return scheduleResult;

  const existing = await db.invoice.findMany({
    where: { contract_id: contractId },
    orderBy: { sequence_number: 'asc' },
  });

  // Once a contract has been bought out or returned (CHALLENGE.md Spine #6), the rent
  // clock has stopped: no new invoice gets issued, even if its due date has technically
  // arrived. Invoices already issued before that point are untouched.
  if (contract.status !== 'active') return { ok: true, invoices: existing.map(toIssuedInvoice) };

  const due = scheduleResult.invoices.filter((invoice) => invoice.dueDate <= asOfDate);
  const existingSequenceNumbers = new Set(existing.map((row) => row.sequence_number));
  const toIssue = due.filter((invoice) => !existingSequenceNumbers.has(invoice.sequenceNumber));

  if (toIssue.length === 0) return { ok: true, invoices: existing.map(toIssuedInvoice) };

  const newRows = toIssue.map((invoice) => ({ id: randomUUID(), invoice }));
  const issued = await withAudit(
    db,
    {
      actor: 'system',
      action: 'invoices.issued',
      entityType: 'contract',
      entityId: contractId,
      details: { invoiceIds: newRows.map((row) => row.id), asOfDate },
    },
    async (tx) => {
      for (const { id, invoice } of newRows) {
        await tx.invoice.create({
          data: {
            id,
            contract_id: contractId,
            sequence_number: invoice.sequenceNumber,
            due_date: invoice.dueDate,
            payment_deadline: invoice.paymentDeadline,
            net_cents: invoice.netCents,
            vat_rate_percent: invoice.vatRatePercent,
            vat_cents: invoice.vatCents,
            gross_cents: invoice.grossCents,
            status: 'issued',
          },
        });
      }
      return tx.invoice.findMany({
        where: { contract_id: contractId },
        orderBy: { sequence_number: 'asc' },
      });
    }
  );

  return { ok: true, invoices: issued.map(toIssuedInvoice) };
}
