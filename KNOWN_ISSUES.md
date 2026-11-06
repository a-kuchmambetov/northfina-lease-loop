# Known validation/authorization gaps

Found in a full validation audit on 2026-11-06. None of these are fixed yet. Read this
before assuming a check exists around auth, customer identity, or asset reservation —
and update this file (don't just fix silently) if you close one.

## 1. UI/API routes don't use the signed-in session's actual customer — they fake it (high)

`applicantCustomerId()` (`src/domain/catalogue.ts:51-53`) always returns the **first**
customer in `data/customers.json` (`customers[0]?.id`), regardless of who is signed in.
Its own doc comment says so outright: _"Accounts aren't linked to data-pack customers
yet, so every customer account acts as the first one: it applies as that customer and
sees that customer's applications and leases."_

It is called from 7 places, all of which should instead be resolving the real customer
behind `session.user.id`:

- `src/app/[locale]/page.tsx:78` (catalogue page)
- `src/app/[locale]/invoices/page.tsx:29`
- `src/app/[locale]/leases/page.tsx:30`
- `src/app/[locale]/leases/[id]/invoices/page.tsx:31`
- `src/app/api/invoices/[id]/pdf/route.ts:27`
- `src/app/api/applications/[id]/cancel/route.ts:20`
- `src/app/api/leases/[id]/return/route.ts:29`
- `src/app/api/applications/[id]/contract/route.ts:27`

**Why this matters:** every signed-in customer account sees and acts as the _same_ one
customer (whichever is first in the data pack) — not themselves. A customer can cancel,
sign, return or download the PDF for a lease that isn't theirs, as long as it belongs to
that first persona. This is a real authorization gap, not a cosmetic one.

**The fix already exists and isn't wired up.** This same session built a real, growable
`Customer` table (`prisma/customers.prisma`) and `POST /api/customers`
(`src/server/features/customers/create-customer.ts`) specifically so a signed-up `User`
can get a real `Customer` row keyed on `user_id`. Nothing in the frontend calls
`POST /api/customers` — grep `src/app/[locale]` for `api/customers` and you'll find
nothing. The fix for all 8 call sites above is the same shape:

```ts
// instead of:
const customerId = applicantCustomerId(await loadCustomers());
// do:
const customer = await db.customer.findUnique({ where: { user_id: session.user.id } });
const customerId = customer?.id;
```

...and the signup/account flow needs to actually call `POST /api/customers` at some
point (right after signup, or on first "Apply" click) so a real row exists to find.

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

---

Items 3 and 4 are low-severity/arguably in-scope-as-is. **Item 1 is the one worth fixing
before a demo or submission** — it's the difference between "the login screen works" and
"accounts actually mean something." Item 2 matters if the demo ever does concurrent
signing, which is unlikely in a live demo but worth knowing about.
