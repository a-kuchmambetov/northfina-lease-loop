# contracts: signing, invoicing and payment (Spine #4/#5, Smart Problem #1)

This feature covers everything from "sign a contract" to "mark an invoice paid". It is the
one place that ties the pricing domain logic to the database. Read
[`src/domain/README.md`](../../../domain/README.md) first for the pure functions this calls.

## Data sources

| Source                        | What for                                                          | Read by                                                                               |
| ----------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `data/price-lists.json`       | The net list price on the signing date                            | `sign-contract.ts`                                                                    |
| `data/coefficient-table.json` | The monthly factor and buyout % for the financed amount/term      | `sign-contract.ts`                                                                    |
| `data/vat-rates.json`         | The VAT rate on each invoice's own due date                       | `issue-invoices.ts`, `get-invoices.ts`                                                |
| `Contract` table              | The locked terms of a signed contract                             | `issue-invoices.ts`, `get-invoices.ts`, `issue-all-due-invoices.ts`                   |
| `Invoice` table               | Invoices that have actually been issued, and their payment status | `issue-invoices.ts`, `get-invoices.ts`, `pay-invoice.ts`, `issue-all-due-invoices.ts` |

## What gets locked, and what never does

Signing a contract (`sign-contract.ts`) calls `src/domain/contract.ts`'s `lockContract`,
which in turn reuses `src/domain/pricing.ts`'s `quoteNetRent` — the exact same calculation
the live price quote (Spine #2) uses, minus VAT. The result — `financed_cents`,
`monthly_net_rent_cents`, `buyout_cents` — is written once to the `Contract` row and never
recalculated. A later change to `price-lists.json` or `coefficient-table.json` cannot touch
an existing contract.

VAT is the opposite: it is never stored on the `Contract`, and it is **not** computed once.
Every invoice looks up `vatRateOn(vatRates, itsOwnDueDate)` independently when it is issued
(`issue-invoices.ts`), and that result is then frozen on the `Invoice` row. This is Smart
Problem #1 ("Lock the price, not the tax"): the net rent is identical on every invoice of a
contract; the VAT rate and amount can differ between invoices issued before and after a rate
change (the fictional 25.5% → 26% change on 1 Jan 2027 in `vat-rates.json`).

## How an invoice is born

An `Invoice` row is **not** created in advance for the whole term. `buildInvoiceSchedule`
(domain) can always compute the full projected schedule for a contract on demand, but
nothing is written until an invoice's own due date has actually arrived:

- Invoice #1 is issued the moment the contract is signed, because its due date equals the
  signing date (`sign-contract.ts` calls `issueDueInvoices` right after creating the
  contract row).
- Every later invoice is issued lazily, by calling `issueDueInvoices(db, contractId, asOfDate)`
  again with a date on or after its due date. This happens automatically whenever:
  - someone asks for a contract's invoices (`get-invoices.ts` calls it first), or
  - the daily sweep runs (`issue-all-due-invoices.ts`, wired to Vercel Cron via
    `vercel.json` — see `GET /api/system/issue-due-invoices`).

`issueDueInvoices` is idempotent: it only creates rows for sequence numbers that don't exist
yet, so calling it twice for the same date is harmless, and an already-issued invoice is
never recomputed (its VAT rate stays whatever it was when issued, even if the rate later
changes again).

`get-invoices.ts` shows the full term either way: invoices already issued (or paid) come
back with their real `id` and frozen values; invoices not yet due come back with
`id: null, status: 'upcoming'` and a live-computed preview. This is what lets a freshly
signed contract still show "the first 3 invoices" (CHALLENGE.md scenario card 1) even though
only invoice #1 actually exists as a database row that early.

Once `Contract.status` is no longer `'active'` (bought out or returned — see
[`../end-of-term/README.md`](../end-of-term/README.md)), `issueDueInvoices` stops creating
new invoice rows for that contract, even past due dates: the rent clock has stopped.
Invoices issued before that point are left exactly as they were.

## Payment term

Every invoice's `paymentDeadline` is its due date + `PAYMENT_TERM_DAYS` (currently 14 days,
`src/domain/invoicing.ts`). This number is not specified anywhere in `CHALLENGE.md`,
`RULES.md` or `data/DATA.md` — it is this feature's own design decision, same as the
early-exit formula (Smart Problem #2) will be.

## Files

| File                        | What it does                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `sign-contract.ts`          | Looks up today's net list price, locks the net rent/buyout, writes the `Contract` row, issues invoice #1. |
| `issue-invoices.ts`         | For one contract: issues every invoice whose due date has arrived and doesn't have a row yet.             |
| `issue-all-due-invoices.ts` | Runs `issue-invoices.ts` across every contract — the daily sweep.                                         |
| `get-invoices.ts`           | The full invoice view for one contract: issued/paid rows merged with a preview of what's still upcoming.  |
| `pay-invoice.ts`            | Marks one issued invoice `paid`.                                                                          |

## API routes that call these

| Route                                      | Calls                       |
| ------------------------------------------ | --------------------------- |
| `POST /api/contracts`                      | `sign-contract.ts`          |
| `GET /api/contracts/:id/invoices?asOf=`    | `get-invoices.ts`           |
| `POST /api/invoices/:id/pay`               | `pay-invoice.ts`            |
| `GET /api/system/issue-due-invoices?asOf=` | `issue-all-due-invoices.ts` |

`asOf` defaults to `todayIso()` everywhere it's optional. Passing it explicitly is also how
to fast-forward a demo past real days without waiting for them.

## Every write is audited

`sign-contract.ts`, `issue-invoices.ts` and `pay-invoice.ts` each call `withAudit` (see
`src/server/audit.ts`) for their own write, so `GET /api/audit-log` always shows a full,
ordered history: `contract.signed`, `invoices.issued` (one row per batch, listing the new
invoice ids), `invoice.paid`.
