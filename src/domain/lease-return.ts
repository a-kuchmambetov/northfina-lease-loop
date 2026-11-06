// Which kind of return a customer is asking for. Giving an item back once the term is over
// is the ordinary end-of-term return (src/domain/end-of-term.ts), which costs nothing.
// Giving it back sooner is an early exit (src/domain/early-exit.ts), which has a fee. The
// customer just says "return it"; the date decides which of the two this is.
import { termEndDate } from './end-of-term';
import { addCalendarMonths, monthsBetween } from './calendar';

export type LeaseReturnKind = 'end_of_term' | 'early';

/**
 * Completed lease months follow the invoice anniversaries, clamped to shorter months.
 * Unlike an item's age in months, a lease starting on 31 January has used one whole
 * period on 28 February. Each anniversary is calculated from the original start day,
 * so March still ends on the 31st. Never negative or greater than the agreed term.
 */
export function leaseMonthsElapsed(
  startDate: string,
  termMonths: number,
  asOfDate: string
): number {
  const months = Math.min(monthsBetween(startDate, asOfDate), termMonths);
  return months < termMonths && addCalendarMonths(startDate, months + 1) <= asOfDate
    ? months + 1
    : months;
}

/** The term ends on `termEndDate`, and that day already counts as over, the same rule the
 *  end-of-term flow uses to accept a return. */
export function leaseReturnKind(
  startDate: string,
  termMonths: number,
  asOfDate: string
): LeaseReturnKind {
  return asOfDate >= termEndDate(startDate, termMonths) ? 'end_of_term' : 'early';
}
