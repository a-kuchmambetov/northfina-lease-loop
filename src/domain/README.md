# src/domain: the business rules

This folder holds the rules of Lease Loop as plain functions. Most of your
hackathon work belongs here.

## Rules for this folder

1. **Pure.** No database, no files, no network, no `process.env`, no framework imports.
   A function gets everything it needs as arguments and returns a value.
2. **Deterministic.** No `Date.now()`, `new Date()` or `Math.random()`. Dates come in as
   ISO strings (`YYYY-MM-DD`) chosen by the caller. The same input always gives the same output.
3. **Money is integer cents.** `189900` means 1 899,00 €. Do not use floats for money, and
   decide on purpose where you round (and say so in a comment).
4. **Expected failures are values, not exceptions.** "This amount cannot be financed" is an
   answer the UI must show, so return a result such as
   `{ ok: false, reason: 'below_minimum' }`. Throw only for bugs (for example, a fraction of
   a cent).
5. **Every function has tests.** Put them next to the code (`pricing.ts` → `pricing.test.ts`)
   and test the edges: band limits, the first and last day of a date range, zero, empty lists.

ESLint enforces rules 1 and 2 for this folder (see `eslint.config.mjs`).

## What is here

| File                | What it does                                                                                                                                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `coefficient.ts`    | Worked example: finds the monthly factor for a financed amount and term.                                                                                                                                                          |
| `price-list.ts`     | Worked example: finds the net list price of an asset on a date.                                                                                                                                                                   |
| `money.ts`          | Formats cents as euros for a locale. Use it only in the UI.                                                                                                                                                                       |
| `vat.ts`            | Which VAT rate applies on a given day.                                                                                                                                                                                            |
| `pricing.ts`        | Monthly net rent, VAT and the end-of-term buyout for a term + down payment.                                                                                                                                                       |
| `contract.ts`       | Locks a contract's net rent and buyout at signing; later price-list changes don't touch it.                                                                                                                                       |
| `calendar.ts`       | Calendar-month and day arithmetic for invoice due dates and payment deadlines, plus age-on-a-date and whole months between two dates.                                                                                             |
| `invoicing.ts`      | A locked contract's monthly invoice schedule, VAT recomputed per invoice date.                                                                                                                                                    |
| `end-of-term.ts`    | Buy, return, pass on or extend once a contract's term is over.                                                                                                                                                                    |
| `residual-value.ts` | What a used item is worth today, by age, condition and usage.                                                                                                                                                                     |
| `early-exit.ts`     | What it should cost to buy out or return a contract before its term is over.                                                                                                                                                      |
| `pass-on-bonus.ts`  | The credit a customer earns for passing on a well-maintained item instead of just returning it.                                                                                                                                   |
| `wear.ts`           | What a lease does to an item's usage and condition by the time it comes back.                                                                                                                                                     |
| `business-id.ts`    | Validates a Finnish business ID (Y-tunnus) check digit (and its shape alone, for format checks).                                                                                                                                  |
| `question-flow.ts`  | Which application question to ask next, from `data/questions.json`'s `ask_when`; which earlier answers go stale when one changes; which customer type currently applies; whether an answer is even shaped right for its question. |
| `eligibility.ts`    | The application's yes / manual-review / rejected decision, built from the application's own answers — `data/questions.json`'s `eligibility_rules` and per-question `blocks_application_when`.                                     |

## What teams are expected to add

Create these as you need them. Do not commit empty files.

- `second-life`: refurbishment cost, matching a returned item to the waiting list, CO2 saved.
