# end-of-term: buy, return, pass on or extend (Spine #6)

This feature covers what happens once a signed contract's term is over. Read
[`../contracts/README.md`](../contracts/README.md) first for how a contract is signed and
locked, and [`src/domain/README.md`](../../../domain/README.md) for the pure functions this
calls.

## What the four actions do

CHALLENGE.md phrases this Spine step as "buy it, return it, or pass it on" — three real,
distinct choices, not two:

| Action    | What happens                                                                                                                        | Who decides it                                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buy`     | Customer pays `buyout_cents`, the amount locked at signing.                                                                         | `src/domain/end-of-term.ts` just returns that stored amount.                                                                                        |
| `return`  | The asset goes into the refurbishment queue, assessed for wear.                                                                     | `resolve-end-of-term.ts` writes the assessed wear with `status: 'returned'` (see "What a return assesses").                                         |
| `pass_on` | The asset skips that queue and goes straight into a brand new lease for `nextCustomerId` — only if it's still in good enough shape. | Same wear assessment, but `resolve-end-of-term.ts` checks the result is at least `'good'` before signing the new contract; otherwise it's rejected. |
| `extend`  | A brand new contract, for `additionalTermMonths`, replaces the old one.                                                             | See "How extending is priced" below.                                                                                                                |

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
3. Only once the domain function approves does `resolve-end-of-term.ts` write anything.
   `return` writes the wear with `status: 'returned'` (into the queue). `pass_on`
   instead prices and signs a brand new contract for `nextCustomerId` right away (see
   "Who `pass_on` goes to" below) and writes `status: 'reserved'` — the item never sits
   idle, it goes straight into its next lease.

A customer asking for `pass_on` on a worn-out item gets a clear rejection telling them to
`return` it instead — the contract is left untouched either way.

## Who `pass_on` goes to

The organizers have clarified (after this was first built) that "pass it on" means the
item moves **directly to the next person**, who starts a new lease on it — someone from
the waiting list (`data/second-life-demand.json`) or someone the first customer names.
This feature always takes the same path regardless of who that is: the caller names a
real, existing `nextCustomerId` and `nextTermMonths` — missing either rejects with
`next_customer_required`, and a `nextCustomerId` that isn't actually in the `Customer`
table rejects with `unknown_customer`.

`data/second-life-demand.json`'s entries have no `customer_id` of their own, so a
waiting-list winner is never _automatically_ usable here — but
[`../customers/README.md`](../customers/README.md)'s `POST /api/customers` is how that
person (or anyone else genuinely new) gets a real `customerId` at all: sign up, create a
profile, then pass that id through here. (A caller that wants to honor the waiting list
calls `GET /api/assets/:id/second-life-match` first to find out who that would be — that
lookup still isn't done automatically.)

Once named, the new lease is priced exactly like an extend: off the item's residual value
right now (`src/domain/residual-value.ts`), not its original price, locked via
`src/domain/contract.ts`'s `lockContract` and persisted with `persist-contract.ts` (shared
with `sign-contract.ts` and `extend`) under `price_list_version: 0`, same sentinel meaning
"priced off a residual valuation, not `data/price-lists.json`".

## Why pick `pass_on` over `return`

Without a reason to, nobody would: both give the item back for free, but `pass_on` can be
rejected while `return` never is. So a successful `pass_on` earns the **first** customer a
credit (`src/domain/pass-on-bonus.ts`), a percent of the end-of-term `buyout_cents` that
scales with how far above the `'good'` minimum the item's condition actually is — `'good'`
itself earns the smallest reward, `'like_new'` more, `'new'` more still. It's written to
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
   (`src/domain/end-of-term.ts`'s `renewalAgeMonths`), through `src/domain/residual-value.ts`'s
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
   wear assessed in step 1 is written for real (`status: 'reserved'` — the item never left,
   but its record now says how it's actually aged). The new contract, the old contract's
   settlement and the wear are one transaction (see "One transaction, one winner" below).

This reuses the exact same locking and invoicing machinery as an ordinary signing — nothing
new had to be built for "how do invoices work during an extension", only for "what should
the extension cost".

**What this deliberately does not do:** extending never touches
`data/refurbishment-costs.json` or `data/second-life-demand.json` — extending is the same
customer keeping the same item in place, so there is nothing to refurbish and no one to
match it to. Those matter for `return`ed items instead (Smart Problem #3,
[`../second-life/README.md`](../second-life/README.md)).

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
one — it never improves on its own. The same added usage also goes onto
`lifetime_usage_value`, the never-reset second counter (see the second-life README).
`writeAssetWearInTx` (`src/server/assets.ts`) writes `usage_value`,
`lifetime_usage_value` and `condition` together with `status`, in one audit row (`asset.returned` or `asset.passed_on`), so the
item's record reflects a lease that actually happened instead of staying frozen at
whatever it was when it was first leased.

## One transaction, one winner

Every outcome settles the contract **and** moves the asset in a single `withAudit` /
`persistContract` transaction, built from `../contracts/settle-contract.ts`. Both steps are
compare-and-swaps: the contract moves out of `'active'` only if it still is
(`updateMany where status = 'active'`, `count === 1`), and the asset moves out of
`'reserved'` only if it still is. A step that loses throws, the whole transaction rolls back
(no half-settled contract, no new lease, no bonus, no stray audit row), and the result is
`contract_already_settled` or `asset_status_conflict` — both `409` at the route. So of two
simultaneous renewals or pass-ons exactly one commits, and a buyout can no longer report
success while the asset stays in another status. Invoice #1 of a renewal / pass-on lease is
issued right after its transaction commits (`persistContract`).

## What gets written

`resolve-end-of-term.ts` sets the old `Contract.status` to `'bought'`, `'returned'`
(both `return` and `pass_on` settle the **old** contract this way — only the asset's fate
differs), or `'extended'`. `buy` also flips `Asset.status` to `'sold'` — unlike
`'reserved'`, which means "leased out but will come back", a sold item leaves the fleet
for good and this is the one terminal state nothing ever changes it out of. `pass_on` and
`extend` both flip it to `'reserved'` instead, straight into the new contract. Once
settled, a contract cannot be settled again (`contract_already_settled`) — a distinct
reason from `contract_pending_signature`, a contract that hasn't started yet because it's
still waiting on a named co-signer (`src/server/features/contracts/README.md`'s "Linking
an application, and waiting on a co-signer") — and
`src/server/features/contracts/issue-invoices.ts` stops creating new invoice rows for it.
Every write goes through `withAudit` (`contract.bought`, `contract.returned`,
`contract.renewed`/`contract.pass_on_leased` for the new contract, `contract.passed_on`/
`contract.extended` for the old one), same as every other change in this app.

## API route

```
POST /api/contracts/:id/end-of-term
{
  "action": "buy" | "return" | "pass_on" | "extend",
  "asOfDate"?: "YYYY-MM-DD",
  "additionalTermMonths"?: number,   // required for "extend"
  "nextCustomerId"?: string,          // required for "pass_on"
  "nextTermMonths"?: number           // required for "pass_on"
}
```

`asOfDate` defaults to today.
