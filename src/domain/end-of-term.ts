// End of term (CHALLENGE.md Spine #6, "Buy it, return it, or pass it on"): once a
// contract's term is over, the customer can buy the item for the buyout price locked at
// signing, give it back (which is how it gets passed on to its next life, see
// src/domain/README.md's "second-life" entry), or extend — effectively leasing it again
// for a new term, priced off what it is worth today (src/domain/residual-value.ts), not
// its original price. This is deliberately separate from "early exit" (Smart Problem #2),
// which is for leaving mid-term, not at the natural end of it.
import { addCalendarMonths } from './calendar';

export type EndOfTermAction = 'buy' | 'return' | 'extend';

export type EndOfTermInput = {
  /** `YYYY-MM-DD`, the contract's start date. */
  startDate: string;
  termMonths: number;
  buyoutCents: number;
  action: EndOfTermAction;
  /** `YYYY-MM-DD`, the day the customer is making this choice. */
  asOfDate: string;
  /** Required, and only used, when `action` is `'extend'`: how many months to lease it for next. */
  additionalTermMonths?: number;
};

export type EndOfTermOutcome =
  | { ok: true; outcome: 'bought'; amountCents: number }
  | { ok: true; outcome: 'returned' }
  | { ok: true; outcome: 'extend_approved'; additionalTermMonths: number }
  | { ok: false; reason: 'term_not_finished' | 'extension_must_be_a_positive_whole_number' };

/**
 * The term ends the day the last invoice's monthly period is over — one calendar month
 * past the due date of the final invoice, which is the same as `termMonths` months past
 * `startDate` (invoice 1 is due at month 0, so invoice `termMonths` would be due at month
 * `termMonths`, one past the last real invoice at `termMonths - 1`).
 */
function termEndDate(startDate: string, termMonths: number): string {
  return addCalendarMonths(startDate, termMonths);
}

/**
 * Decides whether buying, returning or extending is even allowed for this contract on
 * `asOfDate`. For `'extend'`, this only validates the request (the term is over,
 * `additionalTermMonths` is a sane number) — it does not price the new term. Pricing a
 * renewal needs the item's current market value, which needs data this pure function
 * does not have (its condition, usage, today's residual-value curves); see
 * src/server/features/end-of-term/resolve-end-of-term.ts for where that happens.
 */
export function resolveEndOfTerm(input: EndOfTermInput): EndOfTermOutcome {
  const endDate = termEndDate(input.startDate, input.termMonths);
  if (input.asOfDate < endDate) return { ok: false, reason: 'term_not_finished' };

  if (input.action === 'buy')
    return { ok: true, outcome: 'bought', amountCents: input.buyoutCents };
  if (input.action === 'return') return { ok: true, outcome: 'returned' };

  if (!Number.isInteger(input.additionalTermMonths) || (input.additionalTermMonths ?? 0) <= 0) {
    return { ok: false, reason: 'extension_must_be_a_positive_whole_number' };
  }
  return {
    ok: true,
    outcome: 'extend_approved',
    additionalTermMonths: input.additionalTermMonths!,
  };
}
