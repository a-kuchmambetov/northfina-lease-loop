# end-of-term: buy, return or extend (Spine #6)

This feature covers what happens once a signed contract's term is over. Read
[`../contracts/README.md`](../contracts/README.md) first for how a contract is signed and
locked, and [`src/domain/README.md`](../../../domain/README.md) for the pure functions this
calls.

## What the three actions do

CHALLENGE.md phrases this Spine step as "buy it, return it, or pass it on". `return` here
**is** "pass it on" — the data model has no separate state for it, giving the item back is
how it gets passed on to its next life — and `extend` is this app's own addition: a
customer who wants to keep the item just leases it again, at a price that reflects what it
is actually worth today.

| Action   | What happens                                                            | Who decides it                                                                                                                                                                                        |
| -------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buy`    | Customer pays `buyout_cents`, the amount locked at signing.             | `src/domain/end-of-term.ts` just returns that stored amount.                                                                                                                                          |
| `return` | The asset goes back into the pool.                                      | `resolve-end-of-term.ts` flips `Asset.status` to `returned` via the existing `changeAssetStatus` helper (see `src/server/assets.ts`), making it eligible for a second life (Spine #7, not built yet). |
| `extend` | A brand new contract, for `additionalTermMonths`, replaces the old one. | See "How extending is priced" below.                                                                                                                                                                  |

All three are rejected with `term_not_finished` before the contract's natural term end
(`start_date` + `term_months` months, via `addCalendarMonths`). This is deliberate: ending a
lease **mid**-term is a different decision — "early exit" (Smart Problem #2) — with its own
(not yet built) fairness formula. End-of-term only ever fires once the term is genuinely
over.

## How extending is priced

A lease's monthly rent is calculated from the item's **original** list price
(`src/domain/pricing.ts`), but after years of use the item is worth less than that. Charging
the same rent for a renewal would be unfair to the customer (and the opposite, charging
nothing extra, would be unfair to the next lease). So extending re-prices the item at its
current market value instead of pretending it is still new:

1. Load the asset's `condition`, `usage_value` and `category`, and how many whole months
   have passed since the _original_ contract's `start_date`
   (`src/domain/calendar.ts`'s `monthsBetween`).
2. Run those through `src/domain/residual-value.ts`'s formula (age curve × condition
   multiplier × usage adjustment, from `data/residual-curves.json`) to get today's market
   value — the same input `data/DATA.md` suggests for early exit.
3. Feed that value into `src/domain/contract.ts`'s `lockContract` as if it were a fresh
   `listPriceCents`, for `additionalTermMonths`. This gives a **new** monthly rent and a
   **new** buyout for the renewal — almost always lower than the original, because the item
   has depreciated.
4. Persist it as a genuinely new `Contract` row (`persist-contract.ts`, shared with
   `sign-contract.ts`), with `price_list_version: 0` — a sentinel meaning "this price came
   from a residual valuation, not `data/price-lists.json`". The old contract's status
   becomes `'extended'`, pointing at the new contract's id in its audit details.

This reuses the exact same locking and invoicing machinery as an ordinary signing — nothing
new had to be built for "how do invoices work during an extension", only for "what should
the extension cost".

**What this deliberately does not do:** extending never touches
`data/refurbishment-costs.json` or `data/second-life-demand.json`. Those matter when an
item actually comes back and needs to be matched to a _different_ customer (Smart Problem
#3, not built) — extending is the same customer keeping the same item in place, so there is
nothing to refurbish and no one to match it to.

**Edge case: the item has depreciated below what the coefficient table will finance.**
`lockContract` rejects a `listPriceCents` under the lowest band's minimum (30 000 cents,
`data/coefficient-table.json`) the same way it would for a brand-new lease — an old,
heavily-used, low-value item's residual value can easily fall under that floor. The
customer still has `buy` (the buyout was fixed at signing, independent of today's residual
value) or `return`; they just can't `extend`. The same `lockContract` call also rejects an
`additionalTermMonths` the table has no factor for (`unknown_term`; only 12/24/36/48 exist).
Either way, the old contract is left untouched (`status` stays `'active'`) — a rejected
extension is not a partial one.

## What gets written

`resolve-end-of-term.ts` sets the old `Contract.status` to `'bought'`, `'returned'` or
`'extended'`. Once settled, a contract cannot be settled again (`contract_already_settled`),
and `src/server/features/contracts/issue-invoices.ts` stops creating new invoice rows for
it. Every write goes through `withAudit` (`contract.bought`, `contract.returned`,
`contract.renewed` for the new contract, `contract.extended` for the old one), same as every
other change in this app.

## API route

```
POST /api/contracts/:id/end-of-term
{ "action": "buy" | "return" | "extend", "asOfDate"?: "YYYY-MM-DD", "additionalTermMonths"?: number }
```

`asOfDate` defaults to today. `additionalTermMonths` is required (and only used) for
`extend`.
