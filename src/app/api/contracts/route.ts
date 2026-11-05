// POST /api/contracts — sign a contract, locking its net rent and buyout
// (CHALLENGE.md Spine #4). Body: { assetId, customerId, termMonths, downPaymentCents?, signDate? }
import { z } from 'zod';
import { isoDateSchema } from '@/data/schemas';
import { fail, handleRoute, ok, readJsonBody } from '@/server/api-response';
import { db } from '@/server/db';
import { signContract } from '@/server/features/contracts/sign-contract';
import { todayIso } from '@/server/today';

const bodySchema = z.strictObject({
  assetId: z.string().min(1),
  customerId: z.string().min(1),
  termMonths: z.number().int().positive(),
  downPaymentCents: z.number().int().nonnegative().default(0),
  signDate: isoDateSchema.optional(),
});

const NOT_FOUND_REASONS = new Set(['unknown_asset', 'asset_not_found', 'no_price_list_on_date']);
const CONFLICT_REASONS = new Set(['asset_not_available']);

export const POST = handleRoute(async (request) => {
  const body = await readJsonBody(request, bodySchema);

  const result = await signContract(db, {
    assetId: body.assetId,
    customerId: body.customerId,
    termMonths: body.termMonths,
    downPaymentCents: body.downPaymentCents,
    signDate: body.signDate ?? todayIso(),
  });

  if (!result.ok) {
    const status = NOT_FOUND_REASONS.has(result.reason)
      ? 404
      : CONFLICT_REASONS.has(result.reason)
        ? 409
        : 422;
    return fail(status, result.reason.toUpperCase(), 'The contract could not be signed');
  }
  return ok(result.contract, { status: 201 });
});
