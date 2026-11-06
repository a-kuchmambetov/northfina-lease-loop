// The customer's invoices across all their leases, as one list. Pure: the caller passes in
// each lease with the invoices already issued for it.

type Dated = { invoiceDate: string; sequenceNumber: number };

export type LeaseInvoiceRow<Lease, Invoice> = { lease: Lease; invoice: Invoice };

/**
 * Flattens each lease's invoices into one list, newest invoice date first. Invoices dated the
 * same day are ordered by lease id, then by their place in the term (latest first), so the
 * order never depends on the order the leases were passed in.
 */
export function listInvoicesByInvoiceDate<Lease extends { id: string }, Invoice extends Dated>(
  leases: readonly { lease: Lease; invoices: readonly Invoice[] }[]
): LeaseInvoiceRow<Lease, Invoice>[] {
  return leases
    .flatMap(({ lease, invoices }) => invoices.map((invoice) => ({ lease, invoice })))
    .sort(
      (a, b) =>
        b.invoice.invoiceDate.localeCompare(a.invoice.invoiceDate) ||
        a.lease.id.localeCompare(b.lease.id) ||
        b.invoice.sequenceNumber - a.invoice.sequenceNumber
    );
}
