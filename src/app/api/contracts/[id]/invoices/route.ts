// GET /api/contracts/:id/invoices?asOf=YYYY-MM-DD — issues whatever invoices are due by
// `asOf` (default today), then returns the full view: issued/paid invoices with their
// frozen values, and the rest of the term as an "upcoming" preview (CHALLENGE.md Spine
// #5). The net rent never changes; VAT is only frozen once an invoice is actually issued
// (CHALLENGE.md Smart Problem "Lock the price, not the tax").
import { z } from 'zod';
import { isoDateSchema } from '@/data/schemas';
import { fail, handleRoute, ok } from '@/server/api-response';
import { db } from '@/server/db';
import { getContractInvoices } from '@/server/features/contracts/get-invoices';
import { todayIso } from '@/server/today';

const querySchema = z.object({ asOf: isoDateSchema.optional() });

const NOT_FOUND_REASONS = new Set(['contract_not_found']);

export const GET = handleRoute(
  async (request, { params }: RouteContext<'/api/contracts/[id]/invoices'>) => {
    const { id } = await params;
    const { asOf } = querySchema.parse({
      asOf: new URL(request.url).searchParams.get('asOf') ?? undefined,
    });

    const result = await getContractInvoices(db, id, asOf ?? todayIso());

    if (!result.ok) {
      const status = NOT_FOUND_REASONS.has(result.reason) ? 404 : 422;
      return fail(status, result.reason.toUpperCase(), 'The invoices could not be built');
    }
    return ok({ invoices: result.invoices });
  }
);
