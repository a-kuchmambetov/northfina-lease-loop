// GET /api/system/issue-due-invoices?asOf=YYYY-MM-DD — the daily invoice run for every
// contract (CHALLENGE.md Spine #5). Vercel Cron only ever sends a GET, once a day with no
// `asOf`, so it defaults to today; passing `asOf` by hand fast-forwards a demo to a later
// date instead of waiting for real days to pass — see vercel.json for the schedule. Calling
// it twice for the same date is harmless: issueDueInvoices never issues the same invoice
// twice (see its own doc comment).
//
// Protected by CRON_SECRET: Vercel signs its own calls with it automatically. If
// CRON_SECRET is not set (e.g. a hackathon laptop with no .env entry for it), the route is
// open, since there is no login in this starter either (see src/server/audit.ts).
import { z } from 'zod';
import { isoDateSchema } from '@/data/schemas';
import { ApiError, handleRoute, ok } from '@/server/api-response';
import { db } from '@/server/db';
import { issueAllDueInvoices } from '@/server/features/contracts/issue-all-due-invoices';
import { todayIso } from '@/server/today';

const querySchema = z.object({ asOf: isoDateSchema.optional() });

export const GET = handleRoute(async (request) => {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    throw new ApiError(401, 'UNAUTHORIZED', 'This endpoint needs a valid cron secret');
  }

  const { asOf } = querySchema.parse({
    asOf: new URL(request.url).searchParams.get('asOf') ?? undefined,
  });

  const result = await issueAllDueInvoices(db, asOf ?? todayIso());
  return ok(result);
});
