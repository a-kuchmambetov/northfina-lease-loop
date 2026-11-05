// End of term (CHALLENGE.md Spine #6, "Buy it, return it, or pass it on"): once a
// contract's term is over, the customer either buys the item for the buyout price locked
// at signing, or gives it back — which is how it gets passed on to its next life (see
// src/domain/README.md's "second-life" entry). This is deliberately separate from "early
// exit" (Smart Problem #2), which is for leaving mid-term, not at the natural end of it.
import { addCalendarMonths } from './calendar';

export type EndOfTermAction = 'buy' | 'return';

export type EndOfTermInput = {
  /** `YYYY-MM-DD`, the contract's start date. */
  startDate: string;
  termMonths: number;
  buyoutCents: number;
  action: EndOfTermAction;
  /** `YYYY-MM-DD`, the day the customer is making this choice. */
  asOfDate: string;
};

export type EndOfTermOutcome =
  | { ok: true; outcome: 'bought'; amountCents: number }
  | { ok: true; outcome: 'returned' }
  | { ok: false; reason: 'term_not_finished' };

/**
 * The term ends the day the last invoice's monthly period is over — one calendar month
 * past the due date of the final invoice, which is the same as `termMonths` months past
 * `startDate` (invoice 1 is due at month 0, so invoice `termMonths` would be due at month
 * `termMonths`, one past the last real invoice at `termMonths - 1`).
 */
function termEndDate(startDate: string, termMonths: number): string {
  return addCalendarMonths(startDate, termMonths);
}

/** Decides what buying or returning means for this contract on `asOfDate`. */
export function resolveEndOfTerm(input: EndOfTermInput): EndOfTermOutcome {
  const endDate = termEndDate(input.startDate, input.termMonths);
  if (input.asOfDate < endDate) return { ok: false, reason: 'term_not_finished' };

  if (input.action === 'buy')
    return { ok: true, outcome: 'bought', amountCents: input.buyoutCents };
  return { ok: true, outcome: 'returned' };
}
