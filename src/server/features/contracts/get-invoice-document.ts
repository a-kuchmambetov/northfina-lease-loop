// Orchestration for printing one invoice: loads an issued or paid invoice with its contract,
// the equipment's name and the customer's name, and lets src/domain/invoice-document.ts turn
// them into the document to print. No business rules live here.
import { loadAssets, loadCustomers } from '@/data/load';
import {
  buildInvoiceDocument,
  type InvoiceDocument,
  type InvoiceDocumentResult,
} from '@/domain/invoice-document';
import { invoiceDisplayStatus } from '@/domain/invoice-status';
import type { PrismaClient } from '@/generated/prisma/client';
import { todayIso } from '@/server/today';

export type GetInvoiceDocumentResult =
  | { ok: true; document: InvoiceDocument }
  | {
      ok: false;
      reason: 'unknown_invoice' | Extract<InvoiceDocumentResult, { ok: false }>['reason'];
    };

export async function getInvoiceDocument(
  db: PrismaClient,
  input: {
    invoiceId: string;
    customerId: string;
    /** `YYYY-MM-DD`; decides whether an unpaid invoice has expired. */
    today: string;
  }
): Promise<GetInvoiceDocumentResult> {
  const invoice = await db.invoice.findUnique({ where: { id: input.invoiceId } });
  if (!invoice) return { ok: false, reason: 'unknown_invoice' };
  const contract = await db.contract.findUnique({ where: { id: invoice.contract_id } });
  // Someone else's invoice reads the same as one that doesn't exist.
  if (contract?.customer_id !== input.customerId) return { ok: false, reason: 'unknown_invoice' };

  const [assets, customers] = await Promise.all([loadAssets(), loadCustomers()]);
  const asset = assets.find((candidate) => candidate.id === contract.asset_id);
  const customer = customers.find((candidate) => candidate.id === contract.customer_id);

  return buildInvoiceDocument({
    contractId: contract.id,
    sequenceNumber: invoice.sequence_number,
    kind: invoice.kind === 'early_return_fee' ? 'early_return_fee' : 'rent',
    termMonths: contract.term_months,
    contractStartDate: contract.start_date,
    // The invoice stays printable even if its asset has left the data pack.
    assetName: asset ? `${asset.make} ${asset.model}` : contract.asset_id,
    // A signed contract holds the name its customer typed; the data pack's name is the
    // fallback for contracts that were not signed through an application.
    customerName: contract.signed_name ?? customer?.name ?? contract.customer_id,
    invoiceDate: invoice.invoice_date,
    paymentDeadline: invoice.payment_deadline,
    netCents: invoice.net_cents,
    vatRatePercent: invoice.vat_rate_percent,
    vatCents: invoice.vat_cents,
    grossCents: invoice.gross_cents,
    status: invoiceDisplayStatus(
      invoice.status === 'paid' || invoice.status === 'cancelled' ? invoice.status : 'issued',
      invoice.payment_deadline,
      input.today
    ),
    paidOn: invoice.paid_at ? todayIso(invoice.paid_at) : null,
  });
}
