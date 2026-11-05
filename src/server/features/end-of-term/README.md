# end-of-term: buy, return, pass on or extend (Spine #6)

This feature covers what happens once a signed contract's term is over. Read
[`../contracts/README.md`](../contracts/README.md) first for how a contract is signed and
locked, and [`src/domain/README.md`](../../../domain/README.md) for the pure functions this
calls.

## What the four actions do

CHALLENGE.md phrases this Spine step as "buy it, return it, or pass it on" — three real,
distinct choices, not two:

| Action    | What happens                                                                                             | Who decides it                                                                                                                                           |
| --------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buy`     | Customer pays `buyout_cents`, the amount locked at signing.                                              | `src/domain/end-of-term.ts` just returns that stored amount.                                                                                             |
| `return`  | The asset goes into the refurbishment queue, assessed for wear.                                          | `resolve-end-of-term.ts` calls `returnAsset` with `status: 'returned'` (see "What a return assesses").                                                   |
| `pass_on` | The asset skips that queue and is available again immediately — only if it's still in good enough shape. | Same wear assessment, but `resolve-end-of-term.ts` checks the result is at least `'good'` before writing `status: 'available'`; otherwise it's rejected. |
| `extend`  | A brand new contract, for `additionalTermMonths`, replaces the old one.                                  | See "How extending is priced" below.                                                                                                                     |

All four are rejected with `term_not_finished` before the contract's natural term end
(`start_date` + `term_months` months, via `addCalendarMonths`). This is deliberate: ending a
lease **mid**-term is a different decision — "early exit" (Smart Problem #2) — with its own
fairness formula (see `../early-exit/README.md`). End-of-term only ever fires once the term
is genuinely over.

## `return` vs `pass_on`

Both give the item back; the difference is whether it needs attention first.
`data/refurbishment-costs.json`'s own note says "a returned item must reach at least
`'good'` to be leased again" — that's the exact bar `src/domain/end-of-term.ts` uses to
decide which of the two actually happened:

1. `resolve-end-of-term.ts` calls `previewAssetWear` (see `src/server/assets.ts`) to find
   out what this lease's wear did to the item — **before** committing to anything.
2. That result (`conditionAfterWear`) goes into `resolveEndOfTerm`. For `action: 'return'`
   it's irrelevant — a return always succeeds, straight into the queue. For
   `action: 'pass_on'`, the domain function rejects it with `item_needs_refurbishment_first`
   if `conditionAfterWear` is worse than `'good'`.
3. Only once the domain function approves does `resolve-end-of-term.ts` write anything —
   `writeAssetWear` with `status: 'returned'` (into the queue) or `status: 'available'`
   (skipped it), both carrying the same assessed `condition`/`usage_value`.

A customer asking for `pass_on` on a worn-out item gets a clear rejection telling them to
`return` it instead — the contract is left untouched either way.

## Why pick `pass_on` over `return`

Without a reason to, nobody would: both give the item back for free, but `pass_on` can be
rejected while `return` never is. So a successful `pass_on` earns the customer a credit
(`src/domain/pass-on-bonus.ts`), a percent of the end-of-term `buyout_cents` that scales
with how far above the `'good'` minimum the item's condition actually is — `'good'` itself
earns the smallest reward, `'like_new'` more, `'new'` more still. It's written to
`src/server/customer-credit.ts`'s ledger (`addCustomerCreditEntry`, reason
`pass_on_bonus`), checkable via `GET /api/customers/:id/credit`, and spendable as part of
the down payment on a future lease — see
[`../contracts/README.md`](../contracts/README.md)'s "Customer credit".

## How extending is priced

A lease's monthly rent is calculated from the item's **original** list price
(`src/domain/pricing.ts`), but after years of use the item is worth less than that. Charging
the same rent for a renewal would be unfair to the customer (and the opposite, charging
nothing extra, would be unfair to the next lease). So extending re-prices the item at its
current market value instead of pretending it is still new:

1. Assess what the term just ending actually did to the item — `previewAssetWear` (see
   `src/server/assets.ts`) with `monthsLeased: contract.term_months` — rather than reading
   `Asset.condition`/`usage_value` straight off the row. Nothing updates those columns
   mid-lease, so the raw row still holds whatever the item looked like **before this
   lease started**; only this assessment gives the condition/usage it actually has now.
2. Run that, plus how many whole months have passed since the contract's `start_date`
   (`src/domain/calendar.ts`'s `monthsBetween`), through `src/domain/residual-value.ts`'s
   formula (age curve × condition multiplier × usage adjustment, from
   `data/residual-curves.json`) to get today's market value.
3. Feed that value into `src/domain/contract.ts`'s `lockContract` as if it were a fresh
   `listPriceCents`, for `additionalTermMonths`. This gives a **new** monthly rent and a
   **new** buyout for the renewal — almost always lower than the original, because the item
   has depreciated.
4. Persist it as a genuinely new `Contract` row (`persist-contract.ts`, shared with
   `sign-contract.ts`), with `price_list_version: 0` — a sentinel meaning "this price came
   from a residual valuation, not `data/price-lists.json`". The old contract's status
   becomes `'extended'`, pointing at the new contract's id in its audit details, and the
   wear assessed in step 1 is written for real (`writeAssetWear` with `status: 'reserved'`
   — the item never left, but its record now says how it's actually aged).

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
value), `return`, or `pass_on`; they just can't `extend`. The same `lockContract` call also
rejects an `additionalTermMonths` the table has no factor for (`unknown_term`; only
12/24/36/48 exist). Either way, the old contract is left untouched (`status` stays
`'active'`) — a rejected extension is not a partial one.

## What a return (or pass_on) assesses

The data pack has no way to know how an item actually aged during a lease, so
`src/domain/wear.ts` makes its own documented assumption: a fixed amount of usage per
month (400 km for an e-bike, 25 battery cycles for a laptop, 80 engine hours for a farm
machine — our own numbers, not in the data pack), added to whatever usage it already had.
If the new total crosses one of our condition thresholds, `condition` moves to the worse
one — it never improves on its own. `writeAssetWear` writes `usage_value` and `condition`
together with `status`, in one audit row (`asset.returned` or `asset.passed_on`), so the
item's record reflects a lease that actually happened instead of staying frozen at
whatever it was when it was first leased.

## What gets written

`resolve-end-of-term.ts` sets the old `Contract.status` to `'bought'`, `'returned'`
(both `return` and `pass_on` settle the contract this way — only the asset's fate differs),
or `'extended'`. `buy` also flips `Asset.status` to `'sold'` — unlike `'reserved'`, which
means "leased out but will come back", a sold item leaves the fleet for good and this is
the one terminal state nothing ever changes it out of. Once settled, a contract cannot be
settled again
(`contract_already_settled`), and `src/server/features/contracts/issue-invoices.ts` stops
creating new invoice rows for it. Every write goes through `withAudit` (`contract.bought`,
`contract.returned`, `contract.passed_on`, `contract.renewed` for the new contract,
`contract.extended` for the old one), same as every other change in this app.

## API route

```
POST /api/contracts/:id/end-of-term
{ "action": "buy" | "return" | "pass_on" | "extend", "asOfDate"?: "YYYY-MM-DD", "additionalTermMonths"?: number }
```

`asOfDate` defaults to today. `additionalTermMonths` is required (and only used) for
`extend`.
