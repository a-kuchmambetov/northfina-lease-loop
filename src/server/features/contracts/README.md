# contracts: signing, invoicing and payment (Spine #4/#5, Smart Problem #1)

This feature covers everything from "sign a contract" to "mark an invoice paid". It is the
one place that ties the pricing domain logic to the database. Read
[`src/domain/README.md`](../../../domain/README.md) first for the pure functions this calls.

## Data sources

| Source                        | What for                                                          | Read by                                                                               |
| ----------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `data/price-lists.json`       | The net list price on the signing date                            | `sign-contract.ts`                                                                    |
| `data/coefficient-table.json` | The monthly factor and buyout % for the financed amount/term      | `sign-contract.ts`                                                                    |
| `data/vat-rates.json`         | The VAT rate on each invoice's own invoice date                   | `issue-invoices.ts`, `get-invoices.ts`                                                |
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

## Signing reserves the asset

`sign-contract.ts` rejects `assetId`s that don't exist (`asset_not_found`) or aren't
`'available'` (`asset_not_available`), and `customerId`s that don't exist in the
`Customer` table (`unknown_customer` — see
[`../customers/README.md`](../customers/README.md) for where that table's rows come
from). The initial availability read is only a fast rejection. `persist-contract.ts` then
creates the contract inside `withAudit`, and its `inTransaction` hook calls
`transitionAssetStatus` (`src/server/assets.ts`) to atomically compare-and-swap
`'available'` → `'reserved'`. Any credit debit and its audit row use that same transaction.
If another signing took the item first, the whole transaction rolls back and signing
returns `asset_not_available`: no contract, credit debit or audit rows survive.
`'reserved'` means "leased out, but will come back", as opposed to `'sold'`
(see [`../end-of-term/README.md`](../end-of-term/README.md)), which never does. Invoice #1
is issued after the signing transaction commits. The credit balance check
(`insufficient_credit`) is still outside the transaction, so two simultaneous signings could
spend the same credit; see `KNOWN_ISSUES.md` item 2.

**The rest of the lifecycle uses the same pattern.** `settle-contract.ts` holds the
compare-and-swap steps — contract `'active'` → settled, asset `'reserved'` → `'sold'` /
`'returned'` / wear update — which end-of-term (`buy`, `return`, `extend`, `pass_on`) and
early-exit run inside one transaction with the contract change (for `extend`/`pass_on`, via
`persistContract`'s `inTransaction` hook, which may also throw to roll back). A lost race
rolls everything back and answers `contract_already_settled` / `asset_status_conflict`
(409). Second-life resolution does the same from `'returned'`.

## Linking an application, and waiting on a co-signer (scenario card 6)

`sign-contract.ts`'s `applicationId` is **optional** — signing still works exactly as
before without one, which is what every other feature's own internal re-signing (`extend`,
`pass_on`, see [`../end-of-term/README.md`](../end-of-term/README.md)) and most of this
feature's own tests rely on. When a caller does pass one, it is enforced, not just
recorded:

- The `Application` (CHALLENGE.md Spine #3, [`../application/README.md`](../application/README.md))
  must exist (`application_not_found`), be `decision: 'approved'`
  (`application_not_approved`), and be for this exact `customerId`/`assetId`/`termMonths`
  (`application_mismatch`). Deliberately **not** checked: `downPaymentCents` — the price
  itself is allowed to differ between application and signing (scenario card 2's whole
  point), so only the identity of the approved deal is enforced, not its price.
- The application's own collected answer to `q_can_sign` decides what happens next. If
  the applicant answered `'no'` (a company whose own authorized signatory is someone
  else — scenario card 6, "Who can sign?"), the new contract is created
  `status: 'pending_signature'` with `pending_signatory_email` set to the application's
  `q_signatory_email` answer — **not** `'active'`. `issue-invoices.ts`'s existing
  "only an active contract gets new invoices" rule already withholds invoice #1 for free;
  nothing else had to change for that. `POST /api/contracts/:id/confirm-signature`
  (`confirm-signature.ts`) is how the named signatory actually confirms it: flips the
  status to `'active'` and issues whatever is now due.
- A `'pending_signature'` contract is not `'active'`, so `early-exit`/`end-of-term` both
  already refuse it via their own `!== 'active'` guard — given its own distinct
  `contract_pending_signature` reason (not the misleading `contract_already_settled`,
  which means _finished_, not _not started yet_).

## Signing from an application

`sign-application-contract.ts` is how a customer's approved application becomes a contract
(`POST /api/applications/:id/contract`, body `{ signedName }`). It checks that the
application is the signed-in customer's and is `approved` (`src/domain/application-contract.ts`),
that the typed name is a usable signature, and then calls `signContract` with two differences
from a plain signing:

- **The price is the one the application locked.** The list price comes from the
  `price_list_version` stored on the application, not from the list valid on the signing
  day, so a customer approved on 5 Nov (v1) who signs on 6 Nov (v2) gets the v1 price
  (CHALLENGE.md scenario card 2). The application stores what it financed, not its down
  payment, so the down payment is the list price minus the financed amount.
- **The contract remembers where it came from.** `Contract.application_id` (unique, so one
  application can become one contract) and `Contract.signed_name` hold the application and the
  typed name. Both are also in the `contract.signed` audit row.

Afterwards the application is marked `signed` (`application.signed` audit row). The signature
is only a typed name: it is cleaned up (spaces, 2 to 100 characters, must contain a letter)
but not compared to anything, because a customer account isn't linked to a legal name.

## Expired invoices and the fee invoice

An invoice that is still unpaid after its payment deadline is shown as **Expired**
(`src/domain/invoice-status.ts`). Expiry is worked out from today's date whenever an invoice
is shown or printed, never stored, so nothing has to flip it, and the deadline day itself is
still payable. A paid invoice never expires. The invoices page and the PDF both use it.

`Invoice.kind` is `rent` or `early_return_fee`. The fee invoice that an early return creates
is described in [`../early-exit/README.md`](../early-exit/README.md); `get-invoices.ts` adds it
after the schedule's months, and the invoices page lists it newest first like any other.

## Invoice PDF

`GET /api/invoices/:id/pdf?locale=` lets a signed-in customer download one of their own
issued or paid invoices (the **Download PDF** button on the invoices page; an invoice that
isn't issued yet has no PDF). With `&disposition=inline` the same file is sent to be shown
in the page, which is what the **Preview** button's dialog does (`src/server/pdf-response.ts`). `get-invoice-document.ts` loads the invoice, its contract,
the equipment and the customer name, and `src/domain/invoice-document.ts` turns them into
the document: it numbers the invoice (`<first 8 characters of the contract id>-<sequence>`)
and refuses to print one whose net rent and VAT don't add up to its total. The page itself is
drawn by `src/server/invoice-pdf.ts` with `pdf-lib`, in the customer's language. Nothing is
recalculated: the PDF shows the amounts and VAT rate frozen on the invoice when it was
issued. It deliberately has no seller address, bank account or payment reference, because
the data pack has none. The name is the one typed when signing, falling back to the data
pack's. The bytes depend only on the invoice (its invoice date is the file's creation date).

## Customer credit

`sign-contract.ts` accepts an optional `creditCentsToApply`, spent from
`src/server/customer-credit.ts`'s ledger (`getCustomerCreditBalanceCents` to check it's
available, `insufficient_credit` if not) and added straight onto `downPaymentCents` before
`lockContract` ever sees it — cash and credit are the same "paid upfront" to the pricing
formula. Only the ledger remembers the split: one row earned it (currently only
`end-of-term`'s `pass_on`, see [`../end-of-term/README.md`](../end-of-term/README.md)'s
"Why pick `pass_on` over `return`"), another spends it, both tied to a `related_contract_id`
and their own audit action (`customer_credit.earned` / `customer_credit.spent`). A
customer's balance is just the sum of their rows — there is no separate mutable balance
column — checkable via `GET /api/customers/:id/credit`.

## How an invoice is born

An `Invoice` row is **not** created in advance for the whole term. `buildInvoiceSchedule`
(domain) can always compute the full projected schedule for a contract on demand, but
nothing is written until an invoice's own invoice date has actually arrived:

- Invoice #1 is issued the moment the contract is signed, because its invoice date equals the
  signing date (`sign-contract.ts` calls `issueDueInvoices` right after creating the
  contract row).
- Every later invoice is issued lazily, by calling `issueDueInvoices(db, contractId, asOfDate)`
  again with a date on or after its invoice date. This happens automatically whenever:
  - someone asks for a contract's invoices (`get-invoices.ts` calls it first), or
  - the daily sweep runs (`issue-all-due-invoices.ts`, wired to Vercel Cron via
    `vercel.json` — see `GET /api/system/issue-due-invoices`).

`issueDueInvoices` is idempotent: it only creates rows for sequence numbers that don't exist
yet, so calling it twice for the same date is harmless, and an already-issued invoice is
never recomputed (its VAT rate stays whatever it was when issued, even if the rate later
changes again).

`get-invoices.ts` shows the full term either way: invoices already issued (or paid) come
back with their real `id` and frozen values; invoices whose date has not arrived come back with
`id: null` and a live-computed preview, `status: 'upcoming'` while the contract is still
`'active'`. This is what lets a freshly signed contract still show "the first 3 invoices"
(CHALLENGE.md scenario card 1) even though only invoice #1 actually exists as a database
row that early. Once the contract is settled, those same future months come back as
`status: 'cancelled'` instead — they're never going to be issued now, so showing them as
still "upcoming" would be misleading.

Once `Contract.status` is no longer `'active'` (bought out, returned or extended into a new
contract — see [`../end-of-term/README.md`](../end-of-term/README.md)), `issueDueInvoices`
stops creating new invoice rows for that contract, even past their invoice dates: the rent clock has
stopped. Invoices issued before that point are left as they were, except that an early return cancels unpaid ones its fee already covers.

## Payment term

An invoice starts on its `invoiceDate`: it is issued then and its VAT rate is fixed. It is
due on its `paymentDeadline`, which is `invoiceDate` + `PAYMENT_TERM_DAYS` (currently 14 days,
`src/domain/invoicing.ts`). This number is not specified anywhere in `CHALLENGE.md`,
`RULES.md` or `data/DATA.md` — it is this feature's own design decision, same as end-of-
term's extension pricing (see [`../end-of-term/README.md`](../end-of-term/README.md)) and
the early-exit formula (Smart Problem #2, see [`../early-exit/README.md`](../early-exit/README.md)).

## Files

| File                           | What it does                                                                                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sign-contract.ts`             | Looks up today's net list price, locks the net rent/buyout, then calls `persist-contract.ts`. Optionally enforces an approved `Application`.                                           |
| `sign-application-contract.ts` | Forms a contract from an approved application, signed with a typed name; see "Signing from an application" above.                                                                      |
| `settle-contract.ts`           | Guarded (compare-and-swap) contract/asset steps for settling a lease inside one transaction; used by `end-of-term/` and `early-exit/`.                                                 |
| `persist-contract.ts`          | Writes the `Contract` row and issues invoice #1. Shared with `end-of-term/resolve-end-of-term.ts`'s `extend`/`pass_on`, which sign a new contract priced off the item's current value. |
| `confirm-signature.ts`         | The named co-signer confirms a `pending_signature` contract: flips it `active`, issues whatever is now due.                                                                            |
| `issue-invoices.ts`            | For one contract: issues every invoice whose invoice date has arrived and doesn't have a row yet.                                                                                      |
| `issue-all-due-invoices.ts`    | Runs `issue-invoices.ts` across every contract — the daily sweep.                                                                                                                      |
| `get-invoices.ts`              | The full invoice view for one contract: issued/paid rows merged with a preview of what's still upcoming.                                                                               |
| `pay-invoice.ts`               | Marks one issued invoice `paid`.                                                                                                                                                       |
| `get-customer-invoices.ts`     | The signed-in customer's page for one lease: the invoices issued so far, newest first. Later months are not shown.                                                                     |
| `get-invoice-document.ts`      | Loads one invoice with its contract, equipment and customer name, and builds the printable document the PDF route draws.                                                               |

## API routes that call these

| Route                                       | Calls                           |
| ------------------------------------------- | ------------------------------- |
| `POST /api/contracts`                       | `sign-contract.ts`              |
| `POST /api/contracts/:id/confirm-signature` | `confirm-signature.ts`          |
| `GET /api/invoices/:id/pdf?locale=`         | `get-invoice-document.ts`       |
| `POST /api/applications/:id/contract`       | `sign-application-contract.ts`  |
| `GET /api/contracts/:id/invoices?asOf=`     | `get-invoices.ts`               |
| `POST /api/invoices/:id/pay`                | `pay-invoice.ts`                |
| `GET /api/system/issue-due-invoices?asOf=`  | `issue-all-due-invoices.ts`     |
| `GET /api/customers/:id/credit`             | `getCustomerCreditBalanceCents` |

`asOf` defaults to `todayIso()` everywhere it's optional. Passing it explicitly is also how
to fast-forward a demo past real days without waiting for them.

## Every write is audited

`sign-contract.ts`, `issue-invoices.ts` and `pay-invoice.ts` each call `withAudit` (see
`src/server/audit.ts`) for their own write, so the audit table holds a full, ordered
history: `contract.signed`, `invoices.issued` (one row per batch, listing the new invoice
ids), `invoice.paid`. `GET /api/audit-log` shows a signed-in supplier the newest of these
that concern their own equipment (no `details`); customers and guests are refused (see
`KNOWN_ISSUES.md` item 6).
