// Fair early exit (CHALLENGE.md Smart Problem #2): what it should cost to end a lease
// before its term is over — "the buyout from data/coefficient-table.json? Market value
// from data/residual-curves.json? Remaining rents?" There's no official formula; this one
// uses all three and is deliberately consistent with the ordinary end-of-term outcomes
// (src/domain/end-of-term.ts) at the boundary, month `termMonths`.
export type EarlyExitAction = 'buy' | 'return';

export type EarlyExitInput = {
  financedCents: number;
  buyoutCents: number;
  monthlyNetRentCents: number;
  termMonths: number;
  /** Whole months since the contract started. `termMonths` is the boundary with the
   *  ordinary end-of-term flow — this function still computes a (consistent) number there,
   *  but the caller decides whether to actually treat it as "early". */
  monthsElapsed: number;
  action: EarlyExitAction;
  /** Required (and only used) for `'return'`: the item's market value right now. */
  residualValueNowCents?: number;
  /** Required (and only used) for `'return'`: the item's projected market value if the
   *  customer had kept it (and its condition/usage) until the natural end of the term. */
  residualValueAtFullTermCents?: number;
};

export type EarlyExitResult =
  | { ok: true; outcome: 'bought_early'; amountCents: number }
  | { ok: true; outcome: 'returned_early'; feeCents: number }
  | { ok: false; reason: 'months_elapsed_out_of_range' | 'residual_values_required_for_return' };

/**
 * `buy`: an early payoff. On day 0 it is close to the full `financedCents` — hardly
 * anything has been paid off yet; by the last month it converges on the ordinary
 * end-of-term `buyoutCents`. In between, it's a straight line between the two: the
 * fraction of the term still remaining times the gap between them, on top of the
 * end-of-term buyout.
 *
 * `return`: a termination fee, not a purchase. The company loses the rent for the months
 * the customer won't pay (`monthlyNetRentCents x monthsRemaining`), but gets the item back
 * sooner — while it's worth more than it would be at the natural end of the term. That
 * gain (`residualValueNowCents - residualValueAtFullTermCents`) offsets the fee, which
 * never goes below zero. At `monthsElapsed = termMonths` there are no months left to lose
 * rent on, so the fee is 0 — the same as an ordinary end-of-term return.
 *
 * Rounding: one money line per outcome, rounded once at the end.
 */
export function resolveEarlyExit(input: EarlyExitInput): EarlyExitResult {
  if (
    !Number.isInteger(input.monthsElapsed) ||
    input.monthsElapsed < 0 ||
    input.monthsElapsed > input.termMonths
  ) {
    return { ok: false, reason: 'months_elapsed_out_of_range' };
  }

  const monthsRemaining = input.termMonths - input.monthsElapsed;

  if (input.action === 'buy') {
    const amountCents = Math.round(
      input.buyoutCents +
        (input.financedCents - input.buyoutCents) * (monthsRemaining / input.termMonths)
    );
    return { ok: true, outcome: 'bought_early', amountCents };
  }

  if (
    input.residualValueNowCents === undefined ||
    input.residualValueAtFullTermCents === undefined
  ) {
    return { ok: false, reason: 'residual_values_required_for_return' };
  }

  const remainingRentCents = input.monthlyNetRentCents * monthsRemaining;
  const earlyReturnGainCents = input.residualValueNowCents - input.residualValueAtFullTermCents;
  const feeCents = Math.max(0, Math.round(remainingRentCents - earlyReturnGainCents));

  return { ok: true, outcome: 'returned_early', feeCents };
}

/**
 * Whether the early-return fee already charges the rent of rent invoice `sequenceNumber`.
 * The fee is the rent for the months still to run, `termMonths - monthsElapsed`, which
 * are months `monthsElapsed + 1` to `termMonths`. That includes the month in progress:
 * its invoice was issued at the start of the month, but the month has not been used up. So
 * an unpaid invoice for any of those months is cancelled when the fee is invoiced, or the
 * customer would pay that rent twice. Invoices for the `monthsElapsed` months already used
 * stay payable.
 */
export function isRentCoveredByReturnFee(sequenceNumber: number, monthsElapsed: number): boolean {
  return sequenceNumber > monthsElapsed;
}
