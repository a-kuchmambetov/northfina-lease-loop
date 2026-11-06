// End of term (CHALLENGE.md Spine #6, "Buy it, return it, or pass it on"): once a
// contract's term is over, the customer can buy the item for the buyout price locked at
// signing, return it (into the refurbishment queue, see src/domain/wear.ts), pass it on
// directly if it's still in good enough shape to skip that queue, or extend — effectively
// leasing it again for a new term, priced off what it is worth today
// (src/domain/residual-value.ts), not its original price. This is deliberately separate
// from "early exit" (Smart Problem #2), which is for leaving mid-term, not at the natural
// end of it.
import type { AssetCondition } from '@/data/schemas';
import { addCalendarMonths, monthsBetween } from './calendar';
import { conditionRank } from './wear';

export type EndOfTermAction = 'buy' | 'return' | 'pass_on' | 'extend';

/** `data/refurbishment-costs.json`'s own rule: "a returned item must reach at least
 *  'good' to be leased again" — that's also the bar for passing it on directly, skipping
 *  the refurbishment queue `return` goes through. */
const MIN_CONDITION_TO_PASS_ON = 'good';

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
  /** Required, and only used, when `action` is `'pass_on'`: the item's condition after
   *  this lease's wear (`src/domain/wear.ts`'s `assessWearAfterLease`). */
  conditionAfterWear?: AssetCondition;
};

export type EndOfTermOutcome =
  | { ok: true; outcome: 'bought'; amountCents: number }
  | { ok: true; outcome: 'returned' }
  | { ok: true; outcome: 'passed_on' }
  | { ok: true; outcome: 'extend_approved'; additionalTermMonths: number }
  | {
      ok: false;
      reason:
        | 'term_not_finished'
        | 'extension_must_be_a_positive_whole_number'
        | 'item_needs_refurbishment_first';
    };

/**
 * The term ends the day the last invoice's monthly period is over — one calendar month
 * past the invoice date of the final invoice, which is the same as `termMonths` months past
 * `startDate` (invoice 1 is dated month 0, so invoice `termMonths` would be dated month
 * `termMonths`, one past the last real invoice at `termMonths - 1`).
 */
export function termEndDate(startDate: string, termMonths: number): string {
  return addCalendarMonths(startDate, termMonths);
}

/** Age for renewal valuation, including a term ending on a clamped calendar date. */
export function renewalAgeMonths(startDate: string, termMonths: number, asOfDate: string): number {
  const age = monthsBetween(startDate, asOfDate);
  return asOfDate >= termEndDate(startDate, termMonths) ? Math.max(age, termMonths) : age;
}

/**
 * Decides whether buying, returning, passing on, or extending is even allowed for this
 * contract on `asOfDate`. For `'extend'`, this only validates the request (the term is
 * over, `additionalTermMonths` is a sane number) — it does not price the new term, which
 * needs data this pure function does not have; see
 * src/server/features/end-of-term/resolve-end-of-term.ts for where that happens.
 */
export function resolveEndOfTerm(input: EndOfTermInput): EndOfTermOutcome {
  const endDate = termEndDate(input.startDate, input.termMonths);
  if (input.asOfDate < endDate) return { ok: false, reason: 'term_not_finished' };

  if (input.action === 'buy')
    return { ok: true, outcome: 'bought', amountCents: input.buyoutCents };
  if (input.action === 'return') return { ok: true, outcome: 'returned' };

  if (input.action === 'pass_on') {
    if (input.conditionAfterWear === undefined) {
      // The caller always knows the item's condition before asking this; a missing value
      // here is a bug in the caller, not a business answer.
      throw new RangeError('conditionAfterWear is required when action is "pass_on"');
    }
    if (conditionRank(input.conditionAfterWear) > conditionRank(MIN_CONDITION_TO_PASS_ON)) {
      return { ok: false, reason: 'item_needs_refurbishment_first' };
    }
    return { ok: true, outcome: 'passed_on' };
  }

  if (!Number.isInteger(input.additionalTermMonths) || (input.additionalTermMonths ?? 0) <= 0) {
    return { ok: false, reason: 'extension_must_be_a_positive_whole_number' };
  }
  return {
    ok: true,
    outcome: 'extend_approved',
    additionalTermMonths: input.additionalTermMonths!,
  };
}
