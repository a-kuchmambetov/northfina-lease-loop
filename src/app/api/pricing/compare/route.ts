// GET /api/pricing/compare?assetId=...&downPaymentCents=...&date=YYYY-MM-DD
// Every lease term quoted side by side for the same asset and down payment
// (CHALLENGE.md Smart Problem #6, "Explain my price": "Compare options side by side").
import { z } from 'zod';
import { isoDateSchema } from '@/data/schemas';
import { fail, handleRoute, ok } from '@/server/api-response';
import { getPriceQuoteComparison } from '@/server/features/pricing/compare-quotes';
import { todayIso } from '@/server/today';

const querySchema = z.object({
  assetId: z.string().min(1),
  downPaymentCents: z.coerce.number().int().nonnegative().default(0),
  date: isoDateSchema.optional(),
});

const NOT_FOUND_REASONS = new Set(['unknown_asset', 'no_price_list_on_date']);

export const GET = handleRoute(async (request) => {
  const searchParams = new URL(request.url).searchParams;
  const input = querySchema.parse({
    assetId: searchParams.get('assetId') ?? undefined,
    downPaymentCents: searchParams.get('downPaymentCents') ?? undefined,
    date: searchParams.get('date') ?? undefined,
  });

  const result = await getPriceQuoteComparison({
    assetId: input.assetId,
    downPaymentCents: input.downPaymentCents,
    quoteDate: input.date ?? todayIso(),
  });

  if (!result.ok) {
    const status = NOT_FOUND_REASONS.has(result.reason) ? 404 : 422;
    return fail(status, result.reason.toUpperCase(), 'The price could not be compared');
  }
  return ok(result);
});
