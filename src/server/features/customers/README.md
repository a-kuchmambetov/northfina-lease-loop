# customers: turning a signed-up user into a real customer profile

A `User` (better-auth, `prisma/auth.prisma`, signup/password) and a `Customer`
(`prisma/customers.prisma`, the business profile — birth date, business ID, income, PEP
status — everything `src/domain/eligibility.ts` and `src/server/features/contracts/
sign-contract.ts` need) are two different things. `User.accountType` is only a
`'customer' | 'supplier'` role flag for catalogue access; it has no business fields at
all. This feature is the missing link between them.

## Why this exists

`data/customers.json`'s 10 personas seed the `Customer` table (`seedCustomers`,
`src/server/customers.ts`) so every scenario card and existing feature keeps working
exactly as before — but it's a real, growable table now, not a read-only file. Without
this feature, a `customerId` could only ever be one of those 10 fixed personas: a
genuinely new applicant — including the real person
[`../second-life/README.md`](../second-life/README.md)'s matching recommends from the
waiting list — would have no way to get one at all.

## How it works

`POST /api/customers` reads the caller's session the same way `GET /api/assets` already
does (`getAuth().api.getSession(...)`) — a signed-up `User` with `accountType: 'customer'`
creates their own profile. `create-customer.ts` inserts one `Customer` row (one per
`userId` — a second call for the same user rejects with `already_a_customer`) and audits
it (`customer.created`). `is_pep` is never part of the request body: a self-declared PEP
status is `q_pep`'s job during the application
([`../application/README.md`](../application/README.md)), not a signup field — the row
starts `is_pep: false` and only the application's own answer ever feeds that into
`resolveEligibility`.

Once a `Customer` row exists (seeded or freshly created), it works everywhere a
`customerId` already did: `start-application.ts`, `sign-contract.ts`,
`end-of-term`'s `pass_on` — all of them just check it exists and, for applications, read
its `type` as a starting default before `q_customer_type` has an answer. None of them read
any other field off it; see `../application/README.md`'s "The decision is built entirely
from the application's own answers" for why.

## Files

| File                 | What it does                                                            |
| -------------------- | ----------------------------------------------------------------------- |
| `create-customer.ts` | Inserts one `Customer` row for a signed-up user, or for no user at all. |

## API routes that call these

| Route                 | Calls                |
| --------------------- | -------------------- |
| `POST /api/customers` | `create-customer.ts` |
