# Lease Loop — Project Recap & Pitch Prep

As of 2026-11-06. Mirrors the online doc's main tab; see `BACKEND_ALGORITHMS.md` for the
step-by-step technical deep dive and `KNOWN_ISSUES.md` for tracked gaps.

## Overview

Lease Loop is a circular-economy equipment-leasing app for e-bikes, laptops and farm
machines, covering the full loop from catalogue through price, application, contract,
invoices and end of term, back into a second life. Built on Next.js 16 (App Router),
Prisma 7 with better-sqlite3, better-auth, Zod, Vitest + fast-check (property-based
tests), pdf-lib and Tailwind 4. It deploys as a single Docker image (Coolify) with a
persistent SQLite volume, and `vercel.json` schedules the daily invoice sweep.

A three-person team: Vitali's scope grew from the Price step alone to the entire backend
except auth; Artem built authentication plus the full customer/supplier UI on top of it.
120 commits on `staging`, which is the branch this recap describes.

```
  catalogue → price → application → contract → invoices → end of term
      ↑                                                         │
      └──────────── second life (refurbish, re-price, re-lease) ┘
```

## The Spine — 7/7 built

| #   | Step        | How                                                                                                                                                                        |
| --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Catalogue   | `GET /api/assets`, `src/domain/catalogue.ts` — access control strips `serial_number` for non-customers                                                                     |
| 2   | Price       | `get-quote.ts` → `quoteMonthlyRent`/`quoteNetRent` (coefficient × financed amount + VAT); sliders call the API once, not per drag                                          |
| 3   | Application | `start-application.ts` → `answer-application-question.ts` loop → `resolveEligibility`; a real persisted `Application`, not a stateless form                                |
| 4   | Contract    | `sign-contract.ts` + `persist-contract.ts`: `lockContract` freezes net rent/buyout once, immune to later price-list changes; the asset is reserved in the same transaction |
| 5   | Invoices    | `issue-invoices.ts` (lazy, idempotent, issued on due date) + a daily Vercel Cron sweep + `pay-invoice.ts`                                                                  |
| 6   | End of term | `resolve-end-of-term.ts` — all four real actions: buy, return, pass on, extend                                                                                             |
| 7   | Second life | refurbish-or-not + waiting-list matching + an asset passport                                                                                                               |

## Smart Problems — all 7 tackled (brief asks for 2+)

1. **Lock the price, not the tax.** Net rent is frozen on the contract; VAT is never
   stored there — every invoice looks up the rate on its own invoice date and freezes it
   on the invoice row. The fictional 25.5%→26% change on 1 Jan 2027 hits only invoices
   issued after that date.
2. **Fair early exit.** Our own formula: an early buyout is a straight line from the full
   financed amount (day 0) to the end-of-term buyout (day "term"); an early return costs
   the remaining rent minus the gain from handing back a less-worn item. We added a free
   14-day consumer withdrawal window on top, modeled on EU consumer law.
3. **Second-life matchmaking.** Refurbish only when it unlocks a better match than the
   item's as-is value; ties go to list order, our documented stand-in for "who signed up
   first" (the data has no signup date). Bonus: a full item passport — CO2 and money
   saved, every life after the first.
4. **The smart question flow.** Which question applies, and which earlier answers go
   stale, follows `data/questions.json`'s own rules. Eligibility is decided purely from
   what the applicant answered, never from the hidden customer record — a deliberate fix
   so "go back and change customer type" actually works live, not just in isolated tests.
5. **Money that adds up.** Property-based tests (2,000 random contracts via fast-check) on
   invoice schedules; calendar math with no `Date` object, so a lease starting 31 Jan or
   spanning a leap February still rounds exactly.
6. **Explain my price.** Full breakdown (list price → financed → coefficient → VAT →
   buyout → total cost) plus a side-by-side term comparison read straight off the
   coefficient table, never hardcoded.
7. **Circular impact.** CO2 and money saved are counted from the second life onward —
   never the first — with a fleet-wide rollup across every asset.

## Wildcard / bonus

- Printable, localized invoice PDF (`pdf-lib`), numbered and frozen at issue time.
- A customer credit ledger: passing an item on instead of just returning it earns a
  bonus, spendable on a future down payment.
- A pending-signature / co-signer flow (scenario card 6): a company whose applicant can't
  self-sign gets a contract that waits for the named signatory to confirm.
- A real, growable `Customer` table (`POST /api/customers`) replacing the static
  10-persona file, so a genuinely new applicant — including a second-life waiting-list
  winner — can get a real identity.
- A full audit log on every write. `GET /api/audit-log` is for suppliers only and shows
  just the rows about their own equipment, without the `details` JSON.
- A supplier side: "Your equipment" catalogue with per-item state, a Requests page for
  returned items, fleet impact and an operations log.
- Customer profiles that prefill the application, so a signed-up customer is not asked
  for their birth date or business ID twice.

## Our own decisions (nothing in the brief specifies these)

| Decision                                                                  | Why                                                                               |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 14-day invoice payment term                                               | Not in the data pack; a reasonable default                                        |
| Extend/pass-on priced off today's residual value, not original list price | Charging original-list rent on a renewal would be unfair to the customer          |
| Pass-on bonus scales with condition above 'good'                          | Otherwise `pass_on` is strictly worse than a free return                          |
| Early-exit fee = remaining rent − residual-value gain                     | No official formula; kept consistent with the end-of-term buyout at the boundary  |
| Free 14-day consumer withdrawal, binary not pro-rated                     | Modeled on EU consumer law; our wear model has no usage signal finer than a month |
| 'Pass it on' signs a brand-new lease immediately                          | Organizers clarified mid-hackathon what the phrase meant                          |
| CO2/money saved counted from the second life onward, never the first      | Our own reading of "saved by second and third lives"                              |
| Farm-machine service cost from the machine's whole usage counter          | Nothing tracks the last service date                                              |
| Two usage counters: since-last-battery-replacement and lifetime           | A mentor clarified that CO2 must keep km ridden before a battery swap             |
| Audit trail visible to suppliers only, scoped to their own equipment      | The trail holds applicant data; customers have their own history pages            |
| Business-id check digit validated at eligibility, not at answer time      | Preserves the "wrong check digit" trap scenario                                   |
| `is_pep` is never a signup field                                          | Only the application's own `q_pep` answer should ever set risk flags              |

## Engineering

Pure domain functions (`src/domain/` — no I/O, no `Date.now()`, no `Math.random()`,
ESLint-enforced) are separated from server orchestration
(`src/server/features/<name>/`), with tests mirrored under `tests/features/`. **935
tests passing in 96 files** (coverage: 96.5% statements, 92.3% branches, 99.0% functions,
98.3% lines, against a 60% gate). Money is always integer
cents. Every API response goes through a single `ok()`/`fail()` envelope — no raw
errors ever leak. Every write is audited. Status changes that reserve, sell or return an
asset are atomic compare-and-swaps inside the same transaction as the contract change, so
two simultaneous signings or settlements cannot both win. Conventional commits
enforced by husky hooks, `npm run check:no-ai` gates CI against any AI/ML dependency
sneaking into the app, and no file exceeds 600 lines.

## Known gaps (for honest Q&A)

See `KNOWN_ISSUES.md` for the full, maintained list — it states each item's status
(fixed / open / accepted) and the files involved. **Before saying any of these out loud in
Q&A, check `KNOWN_ISSUES.md` first — statuses change as the code does.** Headline items
as of this recap:

- **Fixed, with one fallback left:** routes resolve the real signed-in customer through
  `findCustomerForUser`. An account that has not created a customer profile yet still acts
  as the first persona in the data pack, so it does not fail closed. Say this honestly if
  asked about customer isolation.
- **Fixed:** `GET /api/audit-log` now requires a supplier session (guest 401, customer 403)
  and returns only rows about that supplier's own equipment, without `details`. Scoping is
  by brand name, the same ownership rule used everywhere for suppliers.
- **Fixed:** battery replacement (`resets_usage`) resets only the since-replacement counter.
  A separate lifetime counter (`Asset.lifetime_usage_value`) feeds the passport and CO2.
  Items whose battery was replaced before the migration have lost that earlier history.
- **Fixed, with caveats:** asset reservation and every settlement (buy, return, extend,
  pass on, early exit, second-life resolution) are atomic compare-and-swaps in one
  transaction. Still open: the credit-balance check sits outside the signing transaction,
  invoice #1 is issued just after the commit, the guards compare status only, and
  `PATCH /api/assets/:id/status` is an unrestricted operator override.
- **Accepted for scope:** `emailVerified` exists on the user model but nothing sends or
  checks verification email. The business-ID check digit is validated at the eligibility
  decision, not at answer time, by design (it preserves a CHALLENGE.md trap scenario).

## Demo script (3 minutes of live demo, after 1 minute of slides)

Pre-open every screen in its own browser tab beforehand — no live typing, no page loads
during the pitch.

1. **0:00–0:25 — Catalogue → Price.** Move a slider once; the quote updates live, no
   per-drag API calls.
2. **0:25–0:55 — Application / smart question flow.** Change one earlier answer, show a
   later question change or disappear as a result.
3. **0:55–1:35 — Contract + Explain my price.** Show the locked price breakdown on an
   already-signed contract; mention VAT is looked up per invoice date, not frozen at
   signing.
4. **1:35–2:10 — Fair early exit + 14-day withdrawal.** Show a pre-computed early-exit
   quote; mention the free withdrawal window as the team's own addition.
5. **2:10–2:45 — Second life + passport + CO2.** Show an asset passport with multiple
   lives and its CO2/money-saved totals.
6. **2:45–3:00 — Close.** "935 tests, money in cents, full audit log. Ready for
   questions."
