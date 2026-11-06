# second-life: refurbish-or-not and waiting-list matchmaking (Spine #7, Smart Problem #3)

A returned item (`Asset.status === 'returned'`) has a condition and usage already assessed
at return time (`src/server/assets.ts`'s `returnAsset`/`writeAssetWear`). This feature
decides what happens to it next: refurbish it to `'good'` or not, who on the waiting list
(`data/second-life-demand.json`) wins it, and at what rent — then writes that outcome.

## Data sources

| Source                          | What for                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `Asset` row                     | Current condition/usage (already post-wear from the return itself)                                       |
| Its most recent `Contract` row  | `list_price_cents`/`start_date`, the same inputs `residualValueCents` already uses for early-exit/extend |
| `data/refurbishment-costs.json` | Cost to reach `'good'`, and the mandatory-regardless-of-condition costs                                  |
| `data/residual-curves.json`     | What the item is worth today, as-is and if refurbished                                                   |
| `data/coefficient-table.json`   | The monthly rent a given term/residual-value combination quotes to                                       |
| `data/second-life-demand.json`  | Who is waiting, their budget, minimum condition, term and deadline                                       |

## Why this only recommends, and does not sign a contract

`data/second-life-demand.json`'s entries have no `customer_id` — there's no real customer
behind `wait-02` to sign a `Contract` for. This feature decides the match and updates the
asset (condition, usage, back to `'available'`) and logs the decision; actually leasing it
to the winner is a separate, already-built `POST /api/contracts` call with a real
`customerId`.

**Known gap, not yet wired up:** the organizers have since clarified that `end-of-term`'s
`pass_on` action (CHALLENGE.md Spine #6) is meant to hand the item straight to whoever this
feature would match it to — "the item moves directly to the next person... who starts a
new lease (its second life) at a price based on its used value." Today, `pass_on`
(`src/domain/end-of-term.ts`, already merged) only frees the asset and credits the first
customer; it does not call into this feature at all. Wiring `pass_on` to actually run
`computeSecondLifeMatch` and sign the resulting contract is follow-up work, not done here.

## How the refurbish decision works

1. If the asset is already `'good'` or better, there is no refurbishment path to consider
   — only the as-is one.
2. Otherwise, `src/domain/refurbishment.ts`'s `refurbishToGoodCostCents` prices getting it
   to `'good'` (never further — `data/refurbishment-costs.json`'s own bar): every
   condition-ladder step from the current condition to `'good'`, plus every `fixed` cost
   whose `when` applies (`"always"`, a crossed `usage.value` threshold, or — for farm
   machinery's "per started 1000 engine hours since last service" — this app's own
   documented simplification: nothing tracks _when_ a machine was last serviced, so it
   charges for `ceil(usageValueBefore / 1000)` services off the item's whole lifetime
   usage every time).
3. For both paths (as-is, and refurbished-to-`'good'` if applicable), the item's residual
   value (`src/domain/residual-value.ts`) is priced at today's age/condition/usage, then
   quoted (`src/domain/pricing.ts`'s `quoteNetRent`) at every distinct
   `preferred_term_months` the waiting list actually asks for.
4. `src/domain/second-life-match.ts`'s `rankSecondLifeCandidates` filters each path's
   waiting-list requests to the eligible ones (category, condition floor, deadline,
   budget) and ranks them by total revenue (`rent × their own term`); ties go to whoever
   is earlier in `data/second-life-demand.json` — the file has no signup-date field, so
   list order is this app's documented stand-in for it (the `wait-06`/`wait-14` pair is
   explicitly worded "signed up one day later").
5. `decideSecondLifeOutcome` refurbishes only if the best match it unlocks earns more, net
   of the refurbishment cost, than the best match available as-is. A tie keeps the item
   as-is.

## What gets written

`resolve-second-life-match.ts` always sets the asset back to `'available'` — refurbished
or not, it's ready for its next lease either way — and writes one audit row:
`second_life.refurbished`, `second_life.matched_as_is`, or `second_life.no_match`, with the
winning candidate (if any), the quoted rent, and the full cost breakdown.

## Files

| File                           | What it does                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `compute-second-life-match.ts` | The whole decision above, with no writes — safe to call repeatedly as a preview. |
| `resolve-second-life-match.ts` | Runs the above, then persists the asset's new state and the audit row.           |

## API routes that call these

| Route                                         | Calls                          |
| --------------------------------------------- | ------------------------------ |
| `GET /api/assets/:id/second-life-match?asOf=` | `compute-second-life-match.ts` |
| `POST /api/assets/:id/second-life-match`      | `resolve-second-life-match.ts` |

`asOf`/`asOfDate` default to `todayIso()`, same convention as every other feature.
