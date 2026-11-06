// Orchestration for issuing a contract's due invoices (CHALLENGE.md Spine #5): computes
// the full projected schedule with src/domain/invoicing.ts, then persists — "issues" —
// only the ones whose invoice date has actually arrived, each one once. An invoice already
// issued keeps whatever VAT rate it was given then, even if a rate changes later; a later
// one simply does not exist as a row until its own day comes.
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
  invoiceDate: string;
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

// Roll back a no-op transaction so withAudit does not record an issuance that never
// happened. Another request may have issued the rows or settled the contract meanwhile.
class NoInvoicesToIssue extends Error {
  constructor(readonly invoices: IssuedInvoice[]) {
    super('No invoices to issue');
  }
}

function toIssuedInvoice(row: {
  id: string;
  sequence_number: number;
  kind: string;
  invoice_date: string;
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
    invoiceDate: row.invoice_date,
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
 * Issues every invoice of `contractId` whose invoice date is on or before `asOfDate` and does
 * not have a row yet, then returns every invoice issued so far (already-issued ones
 * included). Safe to call as often as you like — already-issued invoices are never
 * touched again, so this is how an invoice "generates itself" on its date: call this
 * (e.g. on every visit to the contract) and whatever has reached its date appears.
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
  // clock has stopped: no new invoice gets issued, even if its invoice date has technically
  // arrived. Invoices already issued before that point are untouched.
  if (contract.status !== 'active') return { ok: true, invoices: existing.map(toIssuedInvoice) };

  const reached = scheduleResult.invoices.filter((invoice) => invoice.invoiceDate <= asOfDate);
  const existingSequenceNumbers = new Set(existing.map((row) => row.sequence_number));
  const toIssue = reached.filter((invoice) => !existingSequenceNumbers.has(invoice.sequenceNumber));

  if (toIssue.length === 0) return { ok: true, invoices: existing.map(toIssuedInvoice) };

  const details = { invoiceIds: [] as string[], asOfDate };
  try {
    const issued = await withAudit(
      db,
      {
        actor: 'system',
        action: 'invoices.issued',
        entityType: 'contract',
        entityId: contractId,
        details,
      },
      async (tx) => {
        // The initial reads are only a fast path. Recheck under the same transaction as
        // the inserts to avoid redundant writes after another request has committed.
        // The database's unique constraint also protects against concurrent inserts.
        const currentContract = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
        const currentRows = await tx.invoice.findMany({
          where: { contract_id: contractId },
          orderBy: { sequence_number: 'asc' },
        });
        const currentSequences = new Set(currentRows.map((row) => row.sequence_number));
        const newRows = toIssue
          .filter((invoice) => !currentSequences.has(invoice.sequenceNumber))
          .map((invoice) => ({ id: randomUUID(), invoice }));
        if (currentContract.status !== 'active' || newRows.length === 0) {
          throw new NoInvoicesToIssue(currentRows.map(toIssuedInvoice));
        }
        // withAudit serializes details after this callback, so only rows actually created
        // by this transaction appear in its audit entry.
        details.invoiceIds = newRows.map((row) => row.id);
        for (const { id, invoice } of newRows) {
          await tx.invoice.create({
            data: {
              id,
              contract_id: contractId,
              sequence_number: invoice.sequenceNumber,
              invoice_date: invoice.invoiceDate,
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
  } catch (error) {
    if (error instanceof NoInvoicesToIssue) return { ok: true, invoices: error.invoices };
    throw error;
  }
}
