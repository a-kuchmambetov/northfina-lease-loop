// POST /api/contracts/:id/end-of-term — buy, return, pass on or extend a contract once
// its term is over (CHALLENGE.md Spine #6). Body: { action:
// "buy"|"return"|"pass_on"|"extend", asOfDate?, additionalTermMonths? (required for
// "extend"), nextCustomerId?/nextTermMonths? (required for "pass_on" — who the item goes
// straight to next, and for how long) }.
import { z } from 'zod';
import { isoDateSchema } from '@/data/schemas';
import { fail, handleRoute, ok, readJsonBody } from '@/server/api-response';
import { db } from '@/server/db';
import { resolveContractEndOfTerm } from '@/server/features/end-of-term/resolve-end-of-term';
import { todayIso } from '@/server/today';

const bodySchema = z.object({
  action: z.enum(['buy', 'return', 'pass_on', 'extend']),
  asOfDate: isoDateSchema.optional(),
  additionalTermMonths: z.number().int().positive().optional(),
  nextCustomerId: z.string().min(1).optional(),
  nextTermMonths: z.number().int().positive().optional(),
});

const NOT_FOUND_REASONS = new Set(['contract_not_found', 'asset_not_found', 'unknown_customer']);
const CONFLICT_REASONS = new Set([
  'contract_already_settled',
  'contract_pending_signature',
  'asset_status_conflict',
]);

export const POST = handleRoute(
  async (request, { params }: RouteContext<'/api/contracts/[id]/end-of-term'>) => {
    const { id } = await params;
    const body = await readJsonBody(request, bodySchema);

    const result = await resolveContractEndOfTerm(db, {
      contractId: id,
      action: body.action,
      asOfDate: body.asOfDate ?? todayIso(),
      additionalTermMonths: body.additionalTermMonths,
      nextCustomerId: body.nextCustomerId,
      nextTermMonths: body.nextTermMonths,
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
