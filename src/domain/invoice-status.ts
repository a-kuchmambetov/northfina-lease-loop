// What an invoice is, to the customer, on a given day. An invoice is stored as `issued` until
// it is paid or cancelled (see src/domain/early-exit.ts, `isRentCoveredByReturnFee`); one that is
// still unpaid after its payment deadline has expired. Expiry is
// worked out from the date, never stored, so it needs no job to flip it and can't be wrong.

export type InvoiceDisplayStatus = 'issued' | 'paid' | 'expired' | 'cancelled';

/**
 * `paymentDeadline` and `today` are `YYYY-MM-DD`. The deadline day itself is still payable:
 * an invoice expires on the day after it. A paid or cancelled invoice never expires,
 * however old.
 */
export function invoiceDisplayStatus(
  status: 'issued' | 'paid' | 'cancelled',
  paymentDeadline: string,
  today: string
): InvoiceDisplayStatus {
  if (status === 'paid' || status === 'cancelled') return status;
  return today > paymentDeadline ? 'expired' : 'issued';
}
