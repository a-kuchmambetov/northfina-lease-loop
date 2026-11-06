# Known validation/authorization gaps

Found in a full validation audit on 2026-11-06. Read this before assuming a check exists
around auth, customer identity, or asset reservation — and update this file (don't just
fix silently) if you close one.

## 1. UI/API routes don't use the signed-in session's actual customer — they fake it (FIXED, 2026-11-06)

**Status: fixed by Artem on `staging` (`find-customer-for-user.ts`, part of the
`feat/ui-rest-features` merge).** Originally, `applicantCustomerId()`
(`src/domain/catalogue.ts:51-53`) always returned the **first** customer in
`data/customers.json`, regardless of who was signed in — every customer account saw and
acted as the same one persona.

All 8 call sites now resolve the real customer first:

```ts
const profile = await findCustomerForUser(db, session.user.id); // db.customer.findUnique({ where: { user_id } })
const customerId = profile?.id ?? applicantCustomerId(await loadCustomers());
```

`applicantCustomerId` is kept only as a **fallback** for an account that doesn't have a
linked `Customer` profile yet (e.g. a freshly signed-up user who hasn't called
`POST /api/customers`) — at that point the fallback is a deliberate, known
"demo-friendly" default, not the authorization gap this item originally tracked.
**Residual risk, worth confirming before the pitch:** that fallback still means an
account with no profile acts as the first persona until one exists — fine for a demo
script that knows this, misleading if judges create a fresh account and expect it to act
as "nobody" rather than "cust-aino". Worth a quick live check, not a code change
necessarily.

## 2. Asset reservation has a TOCTOU race (medium)

`changeAssetStatus()` (`src/server/assets.ts:56-75`) does `findUnique` then
`update({ where: { id } })` — the update has no `status: 'available'` guard, so it isn't
an atomic compare-and-swap. `sign-contract.ts` checks `asset.status !== 'available'` in
an earlier, separate query before locking the contract, then calls
`changeAssetStatus` afterward. Two concurrent `POST /api/contracts` for the same
`assetId` can both pass the earlier check before either write lands.

Note: **this hole is already closed for application-based signing** —
`Contract.application_id` is `@unique` and `sign-application-contract.ts` catches the
`P2002` race on that constraint (`tests/features/contracts/sign-application-contract.test.ts`
covers it). It is **not** closed for a direct `POST /api/contracts` without an
`applicationId`.

**A fix** would change the update to
`tx.asset.updateMany({ where: { id, status: 'available' }, data: { status } })` and check
`count === 1`, or rely on a DB-level unique partial index — either way it needs its own
test for the race, not just the happy path.

## 3. Business-id check digit isn't validated until eligibility, not at answer time (low)

`isValidAnswerFormat()` (`src/domain/question-flow.ts`) only checks the **shape** of a
`q_business_id` answer (`\d{7}-\d` via `BUSINESS_ID_FORMAT`), not the check digit. The
check digit (`isValidFinnishBusinessId()`, `src/domain/business-id.ts`) is only applied
later, inside `resolveEligibility()`. This is partly deliberate — CHALLENGE.md's
"wrong-check-digit trap" scenario relies on the application still accepting the answer
and only rejecting at decision time — but it does mean an application can sit with a
format-valid-but-mathematically-invalid business ID stored as an accepted answer in the
meantime. Leave as-is unless the "trap" scenario is reinterpreted.

## 4. `emailVerified` exists but is never checked (low)

`prisma/auth.prisma:6` has `emailVerified Boolean @default(false)` (better-auth's own
field), but nothing in the app reads it as a gate before letting a customer apply, sign,
or do anything else. Either wire it in or accept that email verification is cosmetic for
this hackathon scope.

## 5. `resets_usage` (battery replacement) uses one usage counter, not two (medium, found 2026-11-06)

A mentor clarified (`#ask-a-mentor`) that `resets_usage: true` on a refurbishment fixed
cost (e.g. an e-bike battery) should reset **two separate numbers** differently:

- **Total/lifetime usage** (odometer, total hours) — never resets. Should feed the asset
  passport and circular-impact (CO2) numbers.
- **Usage since the last battery replacement** — resets to 0 on `resets_usage`. Should
  feed (a) the usage adjustment in the market-value formula, and (b) the next
  replacement trigger (≥15,000 km / ≥500 cycles).

**We only have one.** `prisma/assets.prisma` stores a single `usage_value Int` column.
`refurbishToGoodCostCents` (`src/domain/refurbishment.ts`) zeroes it on `resets_usage`,
and that single column is then read by three different consumers:

- Market-value usage adjustment (`residual-value.ts`) — _should_ see the reset. Correct
  today, by accident of sharing the field.
- Next-replacement trigger (`refurbishment.ts`'s `usage.value >= N` check) — _should_ see
  the reset. Correct today, same reason.
- Passport / circular-impact CO2 (`co2-impact.ts`'s `avoidedCarKmKgForEbike`, called from
  `get-asset-passport.ts` with `asset.usage.value`) — _should NOT_ see the reset; it
  should use lifetime total km. **This is wrong today**: after a battery replacement,
  every km ridden before the reset is invisible to the CO2/circular-impact number.

The underlying math is verified exactly correct — re-ran the mentor's own worked example
(ebike-007: €5,490 list, 46 months, 'fair', 18,400 km) through `residual-value.ts` and
every intermediate number matched to the cent (32.5% age curve, 0.65 condition
multiplier, −20% usage cap, €927.81 → €1,159.76 after reset, €1,516.61 for fair→good).
Condition and age are correctly left untouched by a usage reset.

**The fix, if we want two counters:**

1. Add `Asset.lifetime_usage_value Int` — incremented by the same per-month wear
   assumption as `usage_value` (`src/domain/wear.ts`), but never zeroed by
   `resets_usage`.
2. Keep `refurbishToGoodCostCents` resetting `usageValueAfter` (the market-value/trigger
   counter) exactly as now.
3. Switch `get-asset-passport.ts` and `co2-impact.ts`'s `avoidedCarKmKgForEbike` from
   `asset.usage.value` to `asset.lifetime_usage_value`.
4. Migration backfills `lifetime_usage_value = usage_value` for existing rows (the best
   available approximation, since pre-reset history isn't recoverable from today's single
   column).

**Not fixed yet.** The mentor also said a one-counter reading is acceptable "if you
document it and explain it in the pitch" — which this entry now does — but the
two-counter model is their stated preferred reading.

## 6. `GET /api/audit-log` has no authorization check at all (high, found 2026-11-06)

`src/app/api/audit-log/route.ts` is a bare `handleRoute(async () => ok(await
listAuditLog(db, 50)))` — no session check, no role check, no filtering. `listAuditLog`
(`src/server/audit.ts:58-73`) excludes `auth.*` actions but otherwise returns the 50
newest audit rows **system-wide**, full `details` JSON included, to **anyone who hits the
URL** — not just suppliers, not just logged-in users. No authentication at all.

The supplier-facing `/operations` page (`src/app/[locale]/operations/page.tsx`) does
correctly gate the _page_ behind `isSupplier(session.user.accountType)` — but the
`<AuditLog>` component on it calls this same unscoped API route client-side, so a
supplier sees every customer's contract signings, application decisions (including PEP
manual-review flags), credit-ledger movements and early-exit fees, not just their own
equipment's activity. And because the API itself checks nothing, the same data is
reachable by `curl`ing the route directly with no account at all.

**Why this matters:** `details_json` on several audit actions carries real business
data — e.g. `contract.signed`'s `applicationId`/`signedName`, `customer_credit.earned`'s
amounts, `application.decision_reason` touching `pep_manual_review`. This is a
confidentiality leak, not just an authorization formality — worse in kind than item 1's
original gap, since there's no fallback-to-the-wrong-persona here, just no check
whatsoever.

**A fix** needs two things: (a) require a session on the route at all (guest → 401), and
(b) scope what a non-admin role sees — at minimum, a supplier's view should filter to
audit rows whose `entity_id` resolves to an asset/contract they actually supply
(`suppliesAsset`, same logic `supplier-equipment/` already uses), not every row in the
table. Easiest safe interim fix if time is short: require a session and restrict the
route to accounts that aren't `'customer'`/`'supplier'` at all (i.e. no public audit view
for either role) until real scoping exists — worse UX, but closes the leak.

---

Items 3 and 4 are low-severity/arguably in-scope-as-is. Item 1 is fixed (see above, with
a residual fallback worth a quick live check). **Items 5 and 6 are the ones worth fixing
before a demo or submission if time allows** — item 6 especially, since it's a real data
leak a judge could stumble into by just clicking around the supplier view, not something
that needs probing to find. Item 2 matters if the demo ever does concurrent signing,
which is unlikely in a live demo but worth knowing about.
