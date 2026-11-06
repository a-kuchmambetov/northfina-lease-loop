// POST /api/contracts/:id/confirm-signature — the named signatory confirms a contract
// that was waiting on them (CHALLENGE.md scenario card 6, "Who can sign?"). Body:
// { asOfDate? }. Flips the contract active and issues whatever invoices are now due.
import { z } from 'zod';
import { isoDateSchema } from '@/data/schemas';
import { fail, handleRoute, ok, readJsonBody } from '@/server/api-response';
import { confirmContractSignature } from '@/server/features/contracts/confirm-signature';
import { db } from '@/server/db';
import { todayIso } from '@/server/today';

const bodySchema = z.strictObject({ asOfDate: isoDateSchema.optional() });

const NOT_FOUND_REASONS = new Set(['contract_not_found']);

export const POST = handleRoute(
  async (request, { params }: RouteContext<'/api/contracts/[id]/confirm-signature'>) => {
    const { id } = await params;
    const body = await readJsonBody(request, bodySchema);

    const result = await confirmContractSignature(db, id, body.asOfDate ?? todayIso());
    if (!result.ok) {
      const status = NOT_FOUND_REASONS.has(result.reason) ? 404 : 422;
      return fail(status, result.reason.toUpperCase(), 'The signature could not be confirmed');
    }
    return ok({ invoices: result.invoices });
  }
);
