# Lease Loop — Project Recap & Pitch Prep

As of 2026-11-06. Mirrors the online doc's main tab; see `BACKEND_ALGORITHMS.md` for the
step-by-step technical deep dive and `KNOWN_ISSUES.md` for tracked gaps.

## Overview

Lease Loop is a circular-economy equipment-leasing app for e-bikes, laptops and farm
machines, covering the full loop from catalogue through price, application, contract,
invoices and end of term, back into a second life. Built on Next.js 16 (App Router),
Prisma 7 with better-sqlite3, better-auth, Zod, Vitest + fast-check (property-based
tests), pdf-lib and Tailwind 4.

A three-person team: Vitali's scope grew from the Price step alone to the entire backend
except auth; Artem built authentication plus the full customer/supplier UI on top of it.
128+ commits total across `main` and `staging`.

```
  catalogue → price → application → contract → invoices → end of term
      ↑                                                         │
      └──────────── second life (refurbish, re-price, re-lease) ┘
```

## The Spine — 7/7 built

| #   | Step        | How                                                                                                                                         |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Catalogue   | `GET /api/assets`, `src/domain/catalogue.ts` — access control strips `serial_number` for non-customers                                      |
| 2   | Price       | `get-quote.ts` → `quoteMonthlyRent`/`quoteNetRent` (coefficient × financed amount + VAT); sliders call the API once, not per drag           |
| 3   | Application | `start-application.ts` → `answer-application-question.ts` loop → `resolveEligibility`; a real persisted `Application`, not a stateless form |
| 4   | Contract    | `sign-contract.ts` + `persist-contract.ts`: `lockContract` freezes net rent/buyout once, immune to later price-list changes                 |
| 5   | Invoices    | `issue-invoices.ts` (lazy, idempotent, issued on due date) + a daily Vercel Cron sweep + `pay-invoice.ts`                                   |
| 6   | End of term | `resolve-end-of-term.ts` — all four real actions: buy, return, pass on, extend                                                              |
| 7   | Second life | refurbish-or-not + waiting-list matching + an asset passport                                                                                |

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
- A full audit log on every write (`GET /api/audit-log`).

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
| Farm-machine service cost from whole-lifetime usage                       | Nothing tracks the last service date                                              |
| Business-id check digit validated at eligibility, not at answer time      | Preserves the "wrong check digit" trap scenario                                   |
| `is_pep` is never a signup field                                          | Only the application's own `q_pep` answer should ever set risk flags              |

## Engineering

Pure domain functions (`src/domain/` — no I/O, no `Date.now()`, no `Math.random()`,
ESLint-enforced) are separated from server orchestration
(`src/server/features/<name>/`), with tests mirrored under `tests/features/`. **825+
tests passing**, coverage above threshold on every metric. Money is always integer
cents. Every API response goes through a single `ok()`/`fail()` envelope — no raw
errors ever leak. Every write is audited (`GET /api/audit-log`). Conventional commits
enforced by husky hooks, `npm run check:no-ai` gates CI against any AI/ML dependency
sneaking into the app, and no file exceeds 600 lines.

## Known gaps (for honest Q&A)

See `KNOWN_ISSUES.md` for the full, maintained list — it states each item's status
(fixed / open) and the file/line it lives at. **Before saying any of these out loud in
Q&A, check `KNOWN_ISSUES.md` first — statuses change as agents fix them during prep.**
Headline items as of this recap:

- **Fixed:** account/catalogue routes resolving "which customer" — `findCustomerForUser`
  now resolves the real signed-in customer, with a documented fallback only for accounts
  with no linked profile yet.
- **Open, high severity:** `GET /api/audit-log` has no authentication or role check at
  all — not just a supplier-scoping gap, the route is wide open to anyone, logged in or
  not. Confirmed by reading the route directly: no session check, no filtering. If asked
  "who can see what" in Q&A, don't claim this is scoped — it isn't yet.
- **Open, medium severity:** `resets_usage` (battery replacement) uses one usage counter
  instead of two, which leaks into the CO2/circular-impact numbers after a reset — see
  `KNOWN_ISSUES.md`'s item 5 for the mentor clarification, the verified-correct math
  (checked against their own worked example, exact to the cent), and the fix plan.
- **Open, medium severity:** a TOCTOU race on direct asset reservation (already closed
  for application-based signing, not yet for a plain `POST /api/contracts`).
- **Open, low severity:** `emailVerified` exists on the user model but isn't gated on
  anywhere yet; business-ID check digit is validated late by design (preserves a
  CHALLENGE.md trap scenario, not a bug).

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
6. **2:45–3:00 — Close.** "825+ tests, money in cents, full audit log. Ready for
   questions."
