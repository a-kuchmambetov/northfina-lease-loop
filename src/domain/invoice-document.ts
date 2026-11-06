// What a printed invoice says. Pure: the caller passes in the stored invoice, its lease and
// the customer's name, and gets back the figures and wording-free facts the PDF renders.
// Nothing is recalculated here: the amounts are the ones frozen on the invoice when it was
// issued (src/domain/invoicing.ts), and this only refuses to print a set that doesn't add up.

import type { InvoiceDisplayStatus } from './invoice-status';
import type { InvoiceKind } from './fee-invoice';

export type InvoiceDocumentInput = {
  contractId: string;
  sequenceNumber: number;
  /** A monthly rent invoice, or the invoice for an early-return fee. */
  kind: InvoiceKind;
  termMonths: number;
  /** `YYYY-MM-DD`. */
  contractStartDate: string;
  assetName: string;
  customerName: string;
  /** `YYYY-MM-DD`. */
  invoiceDate: string;
  /** `YYYY-MM-DD`. */
  paymentDeadline: string;
  netCents: number;
  vatRatePercent: number;
  vatCents: number;
  grossCents: number;
  /** Expired when unpaid after its payment deadline (src/domain/invoice-status.ts). */
  status: InvoiceDisplayStatus;
  /** `YYYY-MM-DD`, in the date the customer sees; set once the invoice is paid. */
  paidOn: string | null;
};

export type InvoiceDocument = InvoiceDocumentInput & { number: string };

export type InvoiceDocumentResult =
  { ok: true; document: InvoiceDocument } | { ok: false; reason: 'amounts_do_not_add_up' };

/**
 * A readable, unique invoice number: the first 8 characters of the contract id, then the
 * invoice's place in the term padded to 3 digits, e.g. `3F2A9C1D-007`. Padding keeps
 * numbers of one lease sorted (a term never exceeds 48 invoices). A lease has at most one
 * fee invoice, which ends in `FEE` instead, e.g. `3F2A9C1D-FEE`.
 */
export function invoiceNumber(
  contractId: string,
  sequenceNumber: number,
  kind: InvoiceKind = 'rent'
): string {
  const prefix = contractId.slice(0, 8).toUpperCase();
  return kind === 'rent' ? `${prefix}-${String(sequenceNumber).padStart(3, '0')}` : `${prefix}-FEE`;
}

/** The figures of one invoice, ready to print. Fails rather than printing an invoice whose
 *  net rent and VAT don't add up to its total, because a customer would be asked to pay it. */
export function buildInvoiceDocument(input: InvoiceDocumentInput): InvoiceDocumentResult {
  if (input.netCents + input.vatCents !== input.grossCents) {
    return { ok: false, reason: 'amounts_do_not_add_up' };
  }
  return {
    ok: true,
    document: {
      ...input,
      number: invoiceNumber(input.contractId, input.sequenceNumber, input.kind),
    },
  };
}
