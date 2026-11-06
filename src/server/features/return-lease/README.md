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

## The fee is invoiced

An early return with a fee above zero also issues a fee invoice (`kind: 'early_return_fee'`)
and cancels the unpaid rent invoices the fee already covers, all in the same transaction as
the return. A return that is free (the end of the term, or a consumer's first 14 days) issues
nothing. See [`../early-exit/README.md`](../early-exit/README.md), "The fee gets an invoice".
