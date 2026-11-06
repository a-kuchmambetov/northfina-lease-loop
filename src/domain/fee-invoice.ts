// The invoice for an early-return fee (src/domain/early-exit.ts). The fee is worked out from
// net rents, so it is a net amount: VAT is added at the rate in force on the day the invoice
// is dated, the same rule rent invoices follow (src/domain/invoicing.ts). The invoice is dated
// the day the item is returned, the same way a contract's first rent invoice is dated the day
// it is signed, and is due at the end of the usual payment term after that.
import type { VatRates } from '@/data/schemas';
import { addDays } from './calendar';
import { PAYMENT_TERM_DAYS } from './invoicing';
import { vatRateOn, type VatRateOnResult } from './vat';

export const INVOICE_KINDS = ['rent', 'early_return_fee'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export type FeeInvoice = {
  invoiceDate: string;
  paymentDeadline: string;
  netCents: number;
  vatRatePercent: number;
  vatCents: number;
  grossCents: number;
};

export type FeeInvoiceResult =
  | { ok: true; invoice: FeeInvoice }
  | { ok: false; reason: 'no_fee_to_invoice' | Extract<VatRateOnResult, { ok: false }>['reason'] };

/**
 * `feeCents` is the net fee and `returnDate` (`YYYY-MM-DD`) the day the item is returned.
 * A fee of zero has nothing to invoice. Rounding: VAT is rounded once, half a cent up,
 * like every other invoice, and the gross total is the net plus that VAT.
 */
export function buildFeeInvoice(
  vatRates: VatRates,
  input: { feeCents: number; returnDate: string }
): FeeInvoiceResult {
  if (!Number.isInteger(input.feeCents) || input.feeCents <= 0) {
    return { ok: false, reason: 'no_fee_to_invoice' };
  }
  const vat = vatRateOn(vatRates, input.returnDate);
  if (!vat.ok) return vat;

  const vatCents = Math.round((input.feeCents * vat.ratePercent) / 100);
  return {
    ok: true,
    invoice: {
      invoiceDate: input.returnDate,
      paymentDeadline: addDays(input.returnDate, PAYMENT_TERM_DAYS),
      netCents: input.feeCents,
      vatRatePercent: vat.ratePercent,
      vatCents,
      grossCents: input.feeCents + vatCents,
    },
  };
}

/** The number a fee invoice has in its lease's numbering: the one after the last rent
 *  invoice, so it never collides with one. */
export function feeInvoiceSequenceNumber(termMonths: number): number {
  return termMonths + 1;
}
