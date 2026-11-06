// POST /api/applications — start an application (CHALLENGE.md Spine #3). Locks a price
// quote onto the application and returns the first question to ask.
// Body: { customerId, assetId, termMonths, downPaymentCents?, applicationDate? }
import { z } from 'zod';
import { isoDateSchema } from '@/data/schemas';
import { fail, handleRoute, ok, readJsonBody } from '@/server/api-response';
import { db } from '@/server/db';
import { startApplication } from '@/server/features/application/start-application';
import { todayIso } from '@/server/today';

const bodySchema = z.strictObject({
  customerId: z.string().min(1),
  assetId: z.string().min(1),
  termMonths: z.number().int().positive(),
  downPaymentCents: z.number().int().nonnegative().default(0),
  applicationDate: isoDateSchema.optional(),
});

const NOT_FOUND_REASONS = new Set(['unknown_customer', 'unknown_asset', 'no_price_list_on_date']);

export const POST = handleRoute(async (request) => {
  const body = await readJsonBody(request, bodySchema);

  const result = await startApplication(db, {
    customerId: body.customerId,
    assetId: body.assetId,
    termMonths: body.termMonths,
    downPaymentCents: body.downPaymentCents,
    applicationDate: body.applicationDate ?? todayIso(),
  });

  if (!result.ok) {
    const status = NOT_FOUND_REASONS.has(result.reason) ? 404 : 422;
    return fail(status, result.reason.toUpperCase(), 'The application could not be started');
  }
  return ok(
    { applicationId: result.applicationId, nextQuestion: result.nextQuestion ?? null },
    { status: 201 }
  );
});
