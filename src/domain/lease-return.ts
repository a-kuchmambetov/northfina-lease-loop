// Which kind of return a customer is asking for. Giving an item back once the term is over
// is the ordinary end-of-term return (src/domain/end-of-term.ts), which costs nothing.
// Giving it back sooner is an early exit (src/domain/early-exit.ts), which has a fee. The
// customer just says "return it"; the date decides which of the two this is.
import { termEndDate } from './end-of-term';

export type LeaseReturnKind = 'end_of_term' | 'early';

/** The term ends on `termEndDate`, and that day already counts as over, the same rule the
 *  end-of-term flow uses to accept a return. */
export function leaseReturnKind(
  startDate: string,
  termMonths: number,
  asOfDate: string
): LeaseReturnKind {
  return asOfDate >= termEndDate(startDate, termMonths) ? 'end_of_term' : 'early';
}
