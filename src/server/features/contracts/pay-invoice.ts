// Orchestration for marking an issued invoice paid (CHALLENGE.md Spine #5). No business
// rules live here: "paid" is just a status change with an audit row in the same
// transaction, same as every other write in this app (see src/server/audit.ts).
import { withAudit } from '@/server/audit';
import type { PrismaClient } from '@/generated/prisma/client';

export type PayInvoiceResult =
  | { ok: true; invoiceId: string; paidAt: string }
  | { ok: false; reason: 'invoice_not_found' | 'already_paid' | 'invoice_cancelled' };

export async function payInvoice(db: PrismaClient, invoiceId: string): Promise<PayInvoiceResult> {
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return { ok: false, reason: 'invoice_not_found' };
  if (invoice.status === 'paid') return { ok: false, reason: 'already_paid' };
  // Not owed any more: paying it would charge the customer for rent the return fee covers.
  if (invoice.status === 'cancelled') return { ok: false, reason: 'invoice_cancelled' };

  const paid = await withAudit(
    db,
    { actor: 'customer', action: 'invoice.paid', entityType: 'invoice', entityId: invoiceId },
    (tx) =>
      tx.invoice.update({ where: { id: invoiceId }, data: { status: 'paid', paid_at: new Date() } })
  );

  return { ok: true, invoiceId, paidAt: paid.paid_at!.toISOString() };
}
