# Known validation/authorization gaps

Found in a full validation audit on 2026-11-06. Read this before assuming a check exists
around auth, customer identity, or asset reservation — and update this file (don't just
fix silently) if you close one.

## 1. UI/API routes don't use the signed-in session's actual customer — they fake it (FIXED for linked profiles, fallback remains — 2026-11-06)

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
"demo-friendly" default. **Residual authorization gap:** an account with no profile
still acts as the first persona until one exists. The fallback remains in all eight
call sites, including application signing/cancellation, lease returns and invoice PDFs;
those accounts can read or change that persona's data. Linked profiles are fixed, but
unlinked accounts do not yet fail closed. This is a demo concession, not customer
isolation for newly registered accounts.

## 2. Asset reservation has a TOCTOU race (DIRECT SIGNING FIXED; other paths remain — 2026-11-06)

**Status: fixed for concurrent direct signings, incomplete across the full lifecycle.**
Originally `changeAssetStatus()` did `findUnique` then an unguarded
`update`, and `sign-contract.ts` checked `asset.status !== 'available'` in an earlier,
separate query, so two concurrent direct `POST /api/contracts` for the same `assetId`
(no `applicationId`) could both pass the check and both sign.

What changed:

- `src/server/assets.ts`: new `transitionAssetStatus(tx, { id, from, to, actor })` — an
  atomic compare-and-swap (`tx.asset.updateMany({ where: { id, status: from } })`, success
  only if `count === 1`) that writes `asset.status_changed` in the caller's transaction.
  `changeAssetStatus()` now also writes through a guarded `updateMany` (status must still
  be what it read), accepts an optional `expectedStatus`, and answers
  `{ ok: false, reason: 'status_conflict' }` instead of silently overwriting. The
  `PATCH /api/assets/:id/status` route maps that to `409 ASSET_STATUS_CONFLICT`.
- `sign-contract.ts` now reserves the asset (`available → reserved`) **inside the same
  `withAudit` transaction as the contract row**, via a new `inTransaction` hook on
  `persistContract` (`persist-contract.ts`), together with the credit debit
  (`addCustomerCreditEntryInTx` in `customer-credit.ts`). If the swap loses, the
  transaction rolls back — no contract, no credit spent, no audit rows — and signing
  answers `asset_not_available` (409). The earlier `status` check stays as a fast path
  only.
- Tests: `tests/features/contracts/sign-contract-race.test.ts` (concurrent signings: exactly
  one wins; stale-read case where the loss happens after the early check and nothing is
  committed) and new cases in `src/server/assets.test.ts`.

Residual: invoice #1 is still issued right after the signing transaction commits
(`issueDueInvoices`), and the `insufficient_credit` balance check is still outside the
transaction (two simultaneous signings spending the same credit are not guarded here).

Review confirmed additional reservation gaps:

- `resolve-end-of-term.ts`'s `extend` and `pass_on` call `persistContract` without an
  `inTransaction` guard and settle the old contract separately. Concurrent renewals can
  both succeed and create two active contracts for the same item.
- `resolve-second-life-match.ts` checks `returned` during computation, then writes
  `available` unconditionally later. A stale computation can overwrite a new signing's
  `reserved` status and allow another contract. `writeAssetWear` also writes status
  without a guard.
- The buyout branches in `resolve-end-of-term.ts` and `resolve-early-exit.ts` settle the
  contract before calling `changeAssetStatus`, then ignore its result. A
  `status_conflict` can therefore return success with the contract `bought` but the asset
  still in its conflicting status (even `available`). Handling this requires one
  transaction for settlement and the guarded asset transition.

## 3. Business-id check digit isn't validated until eligibility, not at answer time (INTENTIONAL, covered by tests — 2026-11-06)

`isValidAnswerFormat()` (`src/domain/question-flow.ts`) only checks the **shape** of a
`q_business_id` answer (`\d{7}-\d` via `BUSINESS_ID_FORMAT`). The check digit
(`isValidFinnishBusinessId()`, `src/domain/business-id.ts`) is applied in
`resolveEligibility()`, which returns `{ decision: 'rejected', reason: 'business_id' }`.

**Decision: leave as-is.** What the briefs actually say: `data/DATA.md` ("One business ID
has a wrong check digit") and CHALLENGE.md §4 ("a broken business ID" among the traps)
only require that the app _catch_ the bad ID — neither states _when_. So "accept the
answer, reject at decision time" is a design choice, not a mandate, but it's a sound one:
`resolveEligibility()` is the single decision point (one auditable `application.decided`
row with a clear reason), and validating the checksum mid-interview would split that rule
across two places. The cost is only that a format-valid-but-wrong-checksum ID sits as an
accepted answer until the interview ends; it cannot lead to approval through that
application flow. The legacy direct `POST /api/contracts` path accepts no application
and does not run eligibility, so it does not provide that guarantee. (If the team wants
early feedback, the existing `earlyRejectionReason`
mechanism is the place to add it — it is driven by `blocks_application_when` in
`data/questions.json`, which `q_business_id` doesn't have, so it would need a rule there.)

Test coverage for both halves:

- Answer time accepts it: `src/domain/question-flow.test.ts` ("accepts a business ID
  shaped like one, even with the wrong check digit").
- Decision time rejects it, from typed answers: `src/domain/eligibility.test.ts`
  ("rejects a typed, format-valid business ID answer with a wrong check digit at decision
  time" — company and sole trader, and the corrected digit passes), plus the record-based
  `cust-broken-id` case and `src/domain/business-id.test.ts`.
- End to end through the real flow (every answer accepted, then decided `rejected` /
  `business_id`): `tests/features/application/answer-application-question.test.ts`.

## 4. `emailVerified` exists but is never checked (ACCEPTED, out of scope — 2026-11-06)

`prisma/auth.prisma` has `emailVerified Boolean @default(false)` (better-auth's own
field) and nothing in the app reads it.

**Decision: do not gate applying/signing on it.** Email verification cannot work in this
codebase today, so a gate would lock everyone out rather than add security:

- `src/server/auth.ts` configures only `emailAndPassword: { enabled, min/max length }`.
  There is **no** `sendVerificationEmail`, no `requireEmailVerification`, no
  `emailVerification` block, and no mail transport/SDK anywhere in `src/` or
  `package.json`. No verification email is ever sent, so no user can reach
  `emailVerified = true`.
- Sign-up deliberately rejects client-supplied `emailVerified` (`src/server/auth.test.ts`,
  "rejects privileged and unexpected signup fields"), so a user can't self-verify either.
- Seeded demo accounts (`prisma/seed-accounts.ts`) are created without `emailVerified`,
  i.e. `false`. Gating would block them too unless the seed were changed — and any fresh
  account a judge signs up (the demo flow) would still be permanently blocked.

Wiring it in would not need a Prisma schema change (the column and `Verification` table
already exist), but would need: (1) a mail transport (SMTP/provider + secrets, env-driven)
and `emailVerification.sendVerificationEmail` + `emailAndPassword.requireEmailVerification`
(or `sendOnSignUp`) in `src/server/auth.ts`; (2) a pure `canTransact(user)` predicate in
`src/domain/` and a 403 `fail()` code (i18n'd in all four locale files) in the
application-start and contract-signing routes; (3) seeds set `emailVerified: true` and
test fixtures updated; (4) a dev/test bypass so e2e flows don't need a real inbox.
Not worth it for hackathon scope; the product's identity checks that matter for the
challenge (age, residency, business-ID, signer authority) are in the eligibility rules.

## 5. `resets_usage` (battery replacement) used one usage counter, not two (FIXED, 2026-11-06)

**Status: fixed on `staging`.** A mentor clarified (`#ask-a-mentor`) that `resets_usage:
true` on a refurbishment fixed cost (e.g. an e-bike battery) should reset **two separate
numbers** differently:

- **Total/lifetime usage** (odometer, total hours) — never resets. Feeds the asset
  passport and circular-impact (CO2) numbers.
- **Usage since the last battery replacement** — resets to 0 on `resets_usage`. Feeds (a)
  the usage adjustment in the market-value formula, and (b) the next replacement trigger
  (≥15,000 km / ≥500 cycles).

Originally `prisma/assets.prisma` stored a single `usage_value`, zeroed on `resets_usage`,
so the passport/CO2 number lost every km ridden before a battery replacement.

**What changed:**

1. `Asset.lifetime_usage_value Int @default(0)` added (`prisma/assets.prisma`, migration
   `20261106125222_add_lifetime_usage_value`). The migration backfills
   `lifetime_usage_value = usage_value` for existing rows (the best available
   approximation — pre-reset history isn't recoverable). The backfill is a one-line
   `UPDATE` appended to the generated migration, since a column default can't copy
   another column.
2. `assessWearAfterLease` (`src/domain/wear.ts`) takes `lifetimeUsageValueBefore` and
   returns `lifetimeUsageValueAfter`: the same per-month wear is added to both counters.
   `writeAssetWear` persists both (and audits `lifetimeUsageValue` from/to).
   `toAssetRowData`/`seedAssets` seed `lifetime_usage_value` from the data pack's
   `usage.value`.
3. `refurbishToGoodCostCents` still resets `usageValueAfter` exactly as before;
   `resolveSecondLifeMatch` writes only `usage_value`, so lifetime is never zeroed.
   Market-value (`residual-value.ts`) and replacement-trigger code still read
   `usage_value`.
4. `get-asset-passport.ts` now passes `lifetime_usage_value` to `co2-impact.ts`'s
   `avoidedCarKmKgForEbike` instead of `usage.value`.

The data-pack `assetSchema` / `Asset` API shape is unchanged (`usage` is still
`{ unit, value }`, the since-reset counter); `lifetime_usage_value` is a DB-column-only
field read by the passport. No UI shows it. The ebike-007 worked example (€5,490 list, 46
months, 'fair', 18,400 km: €927.81 → €1,159.76 after reset → €1,516.61 fair→good) is now
pinned to the cent in `src/domain/residual-value.test.ts`.

**Caveat:** existing rows whose battery was already replaced before this migration have
lifetime = since-reset (history is lost); only wear and resets from now on are tracked
correctly.

## 6. `GET /api/audit-log` had no authorization check at all (FIXED, 2026-11-06)

**Status: fixed on 2026-11-06.** The route (`src/app/api/audit-log/route.ts`) was a bare
`handleRoute(async () => ok(await listAuditLog(db, 50)))`: no session, no role, no scoping,
so anyone — logged in or not — got the 50 newest audit rows system-wide, with full `details`
JSON (applicant data such as PEP review flags, signed names, credit amounts). The `/operations`
page gated the _page_ for suppliers, but its `<AuditLog>` component called the unscoped API.

**What changed:**

- The route now requires a session (guest → `401 UNAUTHORIZED`) and a supplier account
  (anything else, customers included → `403 FORBIDDEN`). Successful responses are
  `private, no-store`.
- A supplier gets only the rows whose entity resolves to **their own equipment**:
  `asset` rows for their items, and the `contract`, `application` and `invoice` rows behind
  those items. "Their items" is the same brand match as `supplier-equipment/`
  (`suppliesAsset`). `customer` and `customer_credit` rows (personal data) and any entity
  type not listed are never visible. `auth.*` rows stay excluded.
- `details` is **not returned at all** (not selected from the database). The UI never showed
  it, and it carries applicant data even on a supplier's own rows.
- Customers get **no access** rather than "own rows only": the trail is an operations view,
  nothing customer-facing uses it, and a customer's own history is on their account pages.
  That is the simplest safe choice; a customer-scoped view can be added later if wanted.
- Logic: `src/domain/audit-access.ts` (`auditAccess`, `supplierAuditTargets`, tested in
  `audit-access.test.ts`). Loading: `src/server/features/audit-log/get-audit-log.ts`. Tests:
  `tests/features/audit-log/get-audit-log.test.ts` (customer denied, supplier scoping, one
  supplier not seeing another's rows, no `details`, customer/auth rows excluded) and
  `tests/audit-log-route.test.ts` (401 guest, 403 customer, 200 supplier).
- `AuditLog` (`src/components/audit-log.tsx`) now types its rows as `SupplierAuditEntry`; no
  visible UI change for suppliers other than seeing only their own rows.

**Residual notes:** `listAuditLog()` in `src/server/audit.ts` is still an unscoped helper
(used by tests); don't call it from a route. Scoping is by brand name, so it is only as
strong as the brand-as-owner rule used everywhere else for suppliers. Rows about a
different supplier's asset that a customer touched (e.g. `invoice.paid` on someone else's
invoice) are correctly excluded; rows whose entity can no longer be resolved (e.g. a
deleted contract) are not shown to anyone.

---

Items 3 and 4 are intentional demo-scope decisions: checksum validation happens at
eligibility, and email verification is not required. Item 5's separate lifetime counter
and item 6's scoped audit-log endpoint are implemented. Item 1 still has the unlinked-profile
fallback described above. Item 2 protects direct signing, but lifecycle races and ignored
status conflicts remain; do not treat asset reservation as fully closed.
