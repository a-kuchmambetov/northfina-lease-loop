// POST /api/invoices/:id/pay — marks an issued invoice paid (CHALLENGE.md Spine #5).
import { fail, handleRoute, ok } from '@/server/api-response';
import { db } from '@/server/db';
import { payInvoice } from '@/server/features/contracts/pay-invoice';

const NOT_FOUND_REASONS = new Set(['invoice_not_found']);

export const POST = handleRoute(
  async (_request, { params }: RouteContext<'/api/invoices/[id]/pay'>) => {
    const { id } = await params;
    const result = await payInvoice(db, id);

    if (!result.ok) {
      const status = NOT_FOUND_REASONS.has(result.reason) ? 404 : 409;
      return fail(status, result.reason.toUpperCase(), 'The invoice could not be marked paid');
    }
    return ok({ invoiceId: result.invoiceId, paidAt: result.paidAt });
  }
);
