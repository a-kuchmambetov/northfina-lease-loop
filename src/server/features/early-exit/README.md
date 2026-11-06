# early-exit: a fair price for leaving a lease mid-term (Smart Problem #2)

CHALLENGE.md asks what it should cost for a customer who wants out in month 7 of 36, and
hints at three ingredients: remaining rents, the item's market value
(`data/residual-curves.json`), and the buyout (`data/coefficient-table.json`). There's no
official formula; this is ours. Read [`../end-of-term/README.md`](../end-of-term/README.md)
first — this is the same decision, just made before the term is naturally over instead of
after.

## Why this is separate from end-of-term

`src/server/features/end-of-term/` only ever fires once a contract's term has actually
ended. This feature is for everything before that point. They share a status model
(`Contract.status`: `'active'` → `'bought'` or `'returned'`) and reuse the same wear
write on a return (`writeAssetWearInTx`, see `src/server/assets.ts` and
[`../end-of-term/README.md`](../end-of-term/README.md)'s "What a return assesses" — the
wear is based on the months actually leased, `monthsElapsed`, not the full term), but the
pricing is different, because at month 7 of 36 neither "pay the full financed amount" (too
harsh) nor "pay the end-of-term buyout" (too generous — that number assumes the item
depreciated for the _whole_ term) is fair.

## A consumer's 14-day withdrawal window comes first

Before either formula below runs, a `return` checks one more thing:
`src/domain/consumer-withdrawal.ts`'s `isWithinWithdrawalWindow`. If the customer is a
`type: 'consumer'` (not `sole_trader`/`company`) and the return date is within 14 days of
`Contract.start_date`, the return is **free** — `feeCents: 0`, no fee invoice — full stop,
regardless of how the formula below would have priced it.

**Why:** the plain `return` formula below can come out close to a full term's rent on day
0 (barely anything has been paid off, and the item's own depreciation rarely offsets that
much). That's harsher than real consumer law would allow — the EU Consumer Rights
Directive (2011/83/EU, Finland: Kuluttajansuojalaki ch. 6) gives a consumer a 14-day right
of withdrawal from a distance contract. Not required by CHALLENGE.md, RULES.md or the data
pack — this is the team's own choice to model it, after a product discussion. Only a
`consumer` gets it; a `sole_trader`/`company` is not covered by the directive and always
gets the formula below.

**Why it's free for the whole window, not pro-rated by days used:** the directive lets a
trader charge a proportional amount once the goods were actually used (art. 14(3)), but
this app has no signal for "used" finer than whole months — `src/domain/wear.ts`'s
condition/usage model only moves on month boundaries, and the entire withdrawal window is
shorter than a month. There's nothing this app can actually observe that distinguishes a
return on day 1 from a return on day 14, so rather than fake a usage signal it doesn't
have, it's free for the whole window, every time.

This still cancels whatever unpaid rent invoice the return would otherwise cover (see "The
month in progress is not billed twice" below) — a fee of 0 does not mean the rent is still
owed, it means the return is free.

## The two formulas

### `buy`: an early payoff

A straight line between two points that are already known:

- Day 0 (`monthsElapsed = 0`): paying almost nothing off yet, so the price should be close
  to the full `financed_cents`.
- The natural end of the term (`monthsElapsed = termMonths`): the price must be exactly
  `buyout_cents` — **the same number `end-of-term`'s `buy` action charges** — because
  exiting "early" at the exact boundary isn't early at all.

```
amountCents = buyoutCents + (financedCents - buyoutCents) x (monthsRemaining / termMonths)
```

`src/domain/early-exit.test.ts` checks that boundary explicitly.

### `return`: a termination fee

Giving the item back isn't a purchase, but it isn't free either: the company loses the
rent for the months the customer won't pay. It does, however, get the item back sooner —
while it is worth more than it would be after the months left on the term also wore it
down. That gain offsets the fee:

```
remainingRentCents      = monthlyNetRentCents x monthsRemaining
earlyReturnGainCents     = residualValueNowCents - residualValueAtFullTermCents
feeCents                 = max(0, remainingRentCents - earlyReturnGainCents)
```

At `monthsElapsed = termMonths`, `remainingRentCents` is 0, so the fee is 0 — the same as
an ordinary end-of-term return (no fee at all).

Both `residualValueNowCents` and `residualValueAtFullTermCents` need the item's condition
and usage **right now** (`monthsElapsed` into this lease) — not the stale row in `Asset`,
which nothing updates mid-lease and still holds whatever the item looked like before this
contract started. `resolve-early-exit.ts` calls `previewAssetWear` (see
`src/server/assets.ts`) with `monthsLeased: monthsElapsed` first, then holds that
assessed condition/usage fixed for both residual-value calls — only `ageMonths` differs
between them (`monthsElapsed` vs `termMonths`) — rather than guessing how they'll change
between now and the natural end of the term.

## What gets written

Same shape as end-of-term: `Contract.status` becomes `'bought'` or `'returned'`. A `'buy'`
flips `Asset.status` to `'sold'` (the item leaves the fleet for good); a `'return'` instead
records the wear for `monthsElapsed` months (not the full term) and moves the asset to
`'returned'`. The contract's settlement, the asset change, the fee invoice and the cancelled
invoices are one transaction with compare-and-swap guards on the contract (`'active'`) and the
asset (`'reserved'`), so a concurrent exit or a changed asset rolls it all back and answers
`contract_already_settled` / `asset_status_conflict` (409); see end-of-term's "One
transaction, one winner". Either way, `src/server/features/contracts/issue-invoices.ts` stops issuing new
invoices once the status leaves `'active'`. The audit actions are distinct from the ordinary ones —
`contract.bought_early` / `contract.returned_early` — so `GET /api/audit-log` can tell an
early exit from a normal end-of-term settlement.

`term_already_over` is returned (422/409) if `asOfDate` is on or after the contract's
natural end — use `POST /api/contracts/:id/end-of-term` instead at that point.

## API route

```
POST /api/contracts/:id/early-exit
{ "action": "buy" | "return", "asOfDate"?: "YYYY-MM-DD" }
```

`asOfDate` defaults to today.

`resolveContractEarlyExit` also takes `dryRun: true`, which works out the price and returns
it without changing the contract, the asset or the audit log. The customer's return button
uses it to show the fee before asking for confirmation (see
[`../return-lease/README.md`](../return-lease/README.md)).

## The fee gets an invoice

A `return` with a fee above zero also issues an invoice for it, in the same transaction that
marks the contract `returned` (so there can't be a returned contract without its fee invoice,
or the other way round). `src/domain/fee-invoice.ts` builds it:

- The calculated fee is a **net** amount, because it is made of net rents. VAT is added at
  the rate in force on the return date, rounded once, like every other invoice.
- It is dated the day the item is returned and due the usual 14 days after that.
- It is an `Invoice` row with `kind: 'early_return_fee'` and sequence number
  `term_months + 1`, so it can never collide with a rent invoice (numbered 1 to
  `term_months`) and a lease can have at most one. Its invoice number ends in `FEE`.
- `contract.returned_early`'s audit row names it (`feeInvoiceId`). A fee of zero, a quote
  (`dryRun`) and an early `buy` issue nothing. (An early buy has a price, not a fee.)

### The month in progress is not billed twice

The fee is the rent for the months still to run, `termMonths - monthsElapsed`, and that
includes the month in progress: its rent invoice was issued when the month began, but the
month isn't used up. Left alone, that month would be charged twice, once on its invoice and
once inside the fee. So when a return with a fee is confirmed, every **unpaid** rent invoice
for a month the fee covers (`isRentCoveredByReturnFee` in `src/domain/early-exit.ts`:
sequence number above `monthsElapsed`) is set to `cancelled`, in the same transaction.

- Invoices for months already used stay payable, and so does an invoice that is already paid
  (that rent is then paid twice, which nothing refunds).
- A cancelled invoice can't be paid (`pay-invoice.ts` refuses it), never expires, and is
  still shown, and printable, marked cancelled.
- Nothing is cancelled when there is no fee (the rent isn't charged then), for a quote, or
  for an early `buy`.
- The result lists `cancelledInvoices`, so the customer is told which amount before they
  confirm, and the audit row names them (`cancelledInvoiceIds`).

Rent invoices that were due before the return but never issued stay unissued: invoices are
issued when something asks for them, and a settled contract stops issuing. In production the
daily sweep (`issue-all-due-invoices.ts`) keeps that gap to a day.
