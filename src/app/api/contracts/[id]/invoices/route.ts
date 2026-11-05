// GET /api/contracts/:id/invoices — the locked contract's monthly invoice schedule
// (CHALLENGE.md Spine #5). VAT is recomputed per invoice's own due date; the net rent
// never changes (CHALLENGE.md Smart Problem "Lock the price, not the tax").
import { fail, handleRoute, ok } from '@/server/api-response';
import { db } from '@/server/db';
import { getContractInvoices } from '@/server/features/contracts/get-invoices';

const NOT_FOUND_REASONS = new Set(['contract_not_found']);

export const GET = handleRoute(
  async (_request, { params }: RouteContext<'/api/contracts/[id]/invoices'>) => {
    const { id } = await params;
    const result = await getContractInvoices(db, id);

    if (!result.ok) {
      const status = NOT_FOUND_REASONS.has(result.reason) ? 404 : 422;
      return fail(status, result.reason.toUpperCase(), 'The invoices could not be built');
    }
    return ok({ invoices: result.invoices });
  }
);
