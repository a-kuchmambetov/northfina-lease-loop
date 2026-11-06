# return-lease: giving a leased item back, from the customer's side

The customer's **Return item** button on an active lease (account page). It sits on top of
two features that already know how to settle a contract, and picks between them:

| When                            | Which flow                                                                          | What it costs        |
| ------------------------------- | ----------------------------------------------------------------------------------- | -------------------- |
| On or after the term's end date | `end-of-term/` `return`, see [`../end-of-term/README.md`](../end-of-term/README.md) | Nothing              |
| Before it                       | `early-exit/` `return`, see [`../early-exit/README.md`](../early-exit/README.md)    | The early-return fee |

`src/domain/lease-return.ts` makes that call from the dates (it uses the same term end date
as the end-of-term flow, so the two can never disagree about whether the term is over).
`return-lease.ts` only checks that the lease belongs to the signed-in customer and still
runs, then hands over.

## Quote first, then confirm

`POST /api/leases/:id/return` takes `{ confirm: boolean }`. With `confirm: false` it changes
nothing, not even an audit row (it runs the early exit with `dryRun`), and answers with what
returning would cost today. The dialog asks for that when it opens, so the customer sees the
fee before agreeing. With `confirm: true` the item is returned and the answer is the same
numbers. The fee is the one quoted, because both calls compute it the same way on the same
day.

A returned item goes into the refurbishment queue, the contract becomes `returned`, and
invoices stop (see [`../contracts/README.md`](../contracts/README.md)).

## What it doesn't do

The early-return fee is calculated and written to the audit log (`contract.returned_early`),
but nothing invoices it: no invoice is issued for it, and it isn't shown on any invoice.
