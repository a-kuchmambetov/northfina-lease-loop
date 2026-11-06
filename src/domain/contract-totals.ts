/** The original agreed lease cost excludes VAT and the optional buyout. It remains the
 * original term total if the lease ends early. Paid invoices include VAT and any paid fees;
 * the down payment is shown separately because it can include customer credit. */
export function contractTotals(input: {
  downPaymentCents: number;
  monthlyNetRentCents: number;
  termMonths: number;
  invoices: readonly { status: string; grossCents: number }[];
}) {
  return {
    agreedNetCents: input.downPaymentCents + input.monthlyNetRentCents * input.termMonths,
    paidInvoicesCents: input.invoices.reduce(
      (sum, invoice) => sum + (invoice.status === 'paid' ? invoice.grossCents : 0),
      0
    ),
  };
}
