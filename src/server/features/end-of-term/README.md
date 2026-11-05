# end-of-term: buy or return (Spine #6)

This feature covers what happens once a signed contract's term is over. Read
[`../contracts/README.md`](../contracts/README.md) first for how a contract is signed and
locked, and [`src/domain/README.md`](../../../domain/README.md) for the pure functions this
calls.

## What the two actions do

CHALLENGE.md phrases this Spine step as "buy it, return it, or pass it on" — three words
for two outcomes, since the data model has no state for "passed on" separate from
`returned`: giving the item back **is** how it gets passed on to its next life.

| Action   | What happens                                                | Who decides it                                                                                                                                                                                        |
| -------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buy`    | Customer pays `buyout_cents`, the amount locked at signing. | `src/domain/end-of-term.ts` just returns that stored amount.                                                                                                                                          |
| `return` | The asset goes back into the pool.                          | `resolve-end-of-term.ts` flips `Asset.status` to `returned` via the existing `changeAssetStatus` helper (see `src/server/assets.ts`), making it eligible for a second life (Spine #7, not built yet). |

Both are rejected with `term_not_finished` before the contract's natural term end
(`start_date` + `term_months` months, via `addCalendarMonths`). This is deliberate: ending a
lease **mid**-term is a different decision — "early exit" (Smart Problem #2) — with its own
(not yet built) fairness formula. End-of-term only ever fires once the term is genuinely
over.

## What gets written

`resolve-end-of-term.ts` sets `Contract.status` from `'active'` to `'bought'` (buy) or
`'returned'` (return). Once settled, a contract cannot be settled again
(`contract_already_settled`), and `src/server/features/contracts/issue-invoices.ts` stops
creating new invoice rows for it.

Every write goes through `withAudit` (`contract.bought`, `contract.returned`), same as every
other change in this app.

## API route

```
POST /api/contracts/:id/end-of-term
{ "action": "buy" | "return", "asOfDate"?: "YYYY-MM-DD" }
```

`asOfDate` defaults to today.
