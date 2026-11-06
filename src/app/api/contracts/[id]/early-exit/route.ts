// POST /api/contracts/:id/early-exit — buy out or return a contract before its term is
// over (CHALLENGE.md Smart Problem #2, "Fair early exit"). Body:
// { action: "buy"|"return", asOfDate?, dryRun? }. With `dryRun: true` nothing changes and
// the answer says what the exit would cost.
import { z } from 'zod';
import { isoDateSchema } from '@/data/schemas';
import { fail, handleRoute, ok, readJsonBody } from '@/server/api-response';
import { db } from '@/server/db';
import { resolveContractEarlyExit } from '@/server/features/early-exit/resolve-early-exit';
import { todayIso } from '@/server/today';

const bodySchema = z.object({
  action: z.enum(['buy', 'return']),
  asOfDate: isoDateSchema.optional(),
  dryRun: z.boolean().optional(),
});

const NOT_FOUND_REASONS = new Set(['contract_not_found', 'asset_not_found']);
const CONFLICT_REASONS = new Set([
  'contract_already_settled',
  'contract_pending_signature',
  'term_already_over',
  'asset_status_conflict',
]);

export const POST = handleRoute(
  async (request, { params }: RouteContext<'/api/contracts/[id]/early-exit'>) => {
    const { id } = await params;
    const body = await readJsonBody(request, bodySchema);

    const result = await resolveContractEarlyExit(db, {
      contractId: id,
      action: body.action,
      asOfDate: body.asOfDate ?? todayIso(),
      dryRun: body.dryRun,
    });

    if (!result.ok) {
      const status = NOT_FOUND_REASONS.has(result.reason)
        ? 404
        : CONFLICT_REASONS.has(result.reason)
          ? 409
          : 422;
      return fail(status, result.reason.toUpperCase(), 'The early exit could not be settled');
    }
    return ok(result);
  }
);
