// POST /api/contracts/:id/end-of-term — buy or return a contract once its term is over
// (CHALLENGE.md Spine #6). Body: { action: "buy"|"return", asOfDate? }.
import { z } from 'zod';
import { isoDateSchema } from '@/data/schemas';
import { fail, handleRoute, ok, readJsonBody } from '@/server/api-response';
import { db } from '@/server/db';
import { resolveContractEndOfTerm } from '@/server/features/end-of-term/resolve-end-of-term';
import { todayIso } from '@/server/today';

const bodySchema = z.object({
  action: z.enum(['buy', 'return']),
  asOfDate: isoDateSchema.optional(),
});

const NOT_FOUND_REASONS = new Set(['contract_not_found']);
const CONFLICT_REASONS = new Set(['contract_already_settled']);

export const POST = handleRoute(
  async (request, { params }: RouteContext<'/api/contracts/[id]/end-of-term'>) => {
    const { id } = await params;
    const body = await readJsonBody(request, bodySchema);

    const result = await resolveContractEndOfTerm(db, {
      contractId: id,
      action: body.action,
      asOfDate: body.asOfDate ?? todayIso(),
    });

    if (!result.ok) {
      const status = NOT_FOUND_REASONS.has(result.reason)
        ? 404
        : CONFLICT_REASONS.has(result.reason)
          ? 409
          : 422;
      return fail(status, result.reason.toUpperCase(), 'The term could not be settled');
    }
    return ok(result);
  }
);
