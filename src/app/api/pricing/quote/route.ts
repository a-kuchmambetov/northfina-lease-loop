// GET /api/pricing/quote?assetId=...&termMonths=12|24|36|48&downPaymentCents=...&date=YYYY-MM-DD
// Live price for the catalogue price step (CHALLENGE.md Spine #2). `date` defaults to today
// and is only there so a quote can be asked for any day, e.g. in a scenario-card demo.
import { z } from 'zod';
import { isoDateSchema } from '@/data/schemas';
import { fail, handleRoute, ok } from '@/server/api-response';
import { getPriceQuote } from '@/server/features/pricing/get-quote';
import { todayIso } from '@/server/today';

const querySchema = z.object({
  assetId: z.string().min(1),
  termMonths: z.coerce.number().int().positive(),
  downPaymentCents: z.coerce.number().int().nonnegative().default(0),
  date: isoDateSchema.optional(),
});

const NOT_FOUND_REASONS = new Set(['unknown_asset', 'no_price_list_on_date']);

export const GET = handleRoute(async (request) => {
  const searchParams = new URL(request.url).searchParams;
  const input = querySchema.parse({
    assetId: searchParams.get('assetId') ?? undefined,
    termMonths: searchParams.get('termMonths') ?? undefined,
    downPaymentCents: searchParams.get('downPaymentCents') ?? undefined,
    date: searchParams.get('date') ?? undefined,
  });

  const result = await getPriceQuote({
    assetId: input.assetId,
    termMonths: input.termMonths,
    downPaymentCents: input.downPaymentCents,
    quoteDate: input.date ?? todayIso(),
  });

  if (!result.ok) {
    const status = NOT_FOUND_REASONS.has(result.reason) ? 404 : 422;
    return fail(status, result.reason.toUpperCase(), 'The price could not be quoted');
  }
  return ok(result.quote);
});
