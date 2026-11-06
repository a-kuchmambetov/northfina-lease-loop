// A consumer's 14-day right of withdrawal from a distance contract (EU Consumer Rights
// Directive 2011/83/EU, art. 9-14; Finland: Kuluttajansuojalaki ch. 6). Not required by
// CHALLENGE.md, RULES.md or the data pack — the team's own choice to model it, because the
// plain early-exit fee (src/domain/early-exit.ts) can come out close to a full term's rent
// on day 0, which is harsher than what real consumer law would allow. Only `type: 'consumer'`
// gets this; a business customer (sole_trader, company) is not covered by the directive.
//
// The directive lets a trader charge a proportional amount once the goods were actually
// used (art. 14(3)) — but this app has no signal for "used" that is finer than whole
// months (src/domain/wear.ts's condition/usage model only moves on month boundaries), and
// the whole withdrawal window is shorter than a month. There is nothing this app can
// actually observe that would distinguish a return on day 1 from a return on day 14, so
// rather than fake a usage signal it doesn't have, this app's own documented choice is:
// free for the whole window, every time. See KNOWN_ISSUES.md-style reasoning in
// src/server/features/early-exit/README.md's "Consumer withdrawal window" if that changes.
export const WITHDRAWAL_WINDOW_DAYS = 14;

/** Whether a withdrawal request, `daysSinceSigning` days after the contract started, still
 *  falls inside the 14-day window. Negative input (a signing date in the future) never does. */
export function isWithinWithdrawalWindow(daysSinceSigning: number): boolean {
  return daysSinceSigning >= 0 && daysSinceSigning <= WITHDRAWAL_WINDOW_DAYS;
}
