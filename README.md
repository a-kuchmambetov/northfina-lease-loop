# Lease Loop · Northfina × Hive Helsinki hackathon

A circular-economy leasing app built for the **Lease Loop** challenge (5–6 November 2026, Hive Helsinki): one e-bike, laptop or tractor, three lives. A customer picks an item, gets a live price, applies, signs, pays monthly invoices and, at the end, buys, returns, passes on or extends. A returned item is refurbished (or not) and leased again to the next person on the waiting list.

All seven Spine steps are built and all seven Smart Problems are tackled. No AI is used inside the product: every decision is a rule, a table lookup or an algorithm.

- 📋 **The challenge:** [CHALLENGE.md](CHALLENGE.md)
- 📐 **Engineering rules (35 % of the score):** [RULES.md](RULES.md)
- 🗂️ **The data pack:** [data/DATA.md](data/DATA.md)
- 🎤 **Pitch recap and demo script:** [PITCH_PREP.md](PITCH_PREP.md)
- 🧮 **Every backend algorithm, step by step:** [BACKEND_ALGORITHMS.md](BACKEND_ALGORITHMS.md)
- ⚠️ **Known gaps and how they were closed:** [KNOWN_ISSUES.md](KNOWN_ISSUES.md)

**Northfina** is a Helsinki-based leasing platform. It started as Etufillari, a bike-leasing service, and now leases any kind of asset. Dealers, banks and customers use it to get from a price quote to a signed contract, then through monthly invoices to the end of the lease. This repo is a small, independent playground, not their product code.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Prisma 7 on SQLite (better-sqlite3) · better-auth · Zod · Tailwind 4 · `pdf-lib` · Vitest + fast-check. The UI is available in English, Finnish, Swedish and Estonian.

---

## What the app does

| Spine step     | Where it lives                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1. Catalogue   | Home page and `GET /api/assets`; serial numbers are shown only to signed-in customers                                         |
| 2. Price       | Live quote and term comparison: `GET /api/pricing/quote`, `GET /api/pricing/compare`                                          |
| 3. Application | Persisted question flow with an eligibility decision: `/applications/[id]`, `/api/applications/**`                            |
| 4. Contract    | Typed-name signing that locks net rent and buyout, plus a co-signer flow: `/api/applications/[id]/contract`, `/api/contracts` |
| 5. Invoices    | Issued on their own date with that date's VAT; pay and PDF: `/leases/[id]/invoices`, `/invoices`, `/api/invoices/**`          |
| 6. End of term | Buy, return, pass on or extend: `POST /api/contracts/[id]/end-of-term`                                                        |
| 7. Second life | Refurbish-or-not, waiting-list match, asset passport and fleet CO₂: `/api/assets/[id]/**`, `/fleet`                           |

Beyond the Spine: fair early exit with a 14-day consumer withdrawal window, a customer credit ledger, customer profiles, a supplier "Your equipment" catalogue, return requests, an audited operations log, and a daily invoice sweep. [PITCH_PREP.md](PITCH_PREP.md) maps each Smart Problem to the code.

**Two kinds of account.** A _customer_ browses, applies, signs, pays and returns (pages: `/leases`, `/invoices`, `/profile`, `/applications/[id]`). A _supplier_ (matched to items by brand name) sees their equipment in place of the catalogue, plus `/requests`, `/fleet` and `/operations`.

---

## Quick start

You need **Git** and **Node.js 22** (with [nvm](https://github.com/nvm-sh/nvm): `nvm install` reads `.nvmrc`).

```bash
git clone https://github.com/<your-team>/northfina-lease-loop.git
cd northfina-lease-loop
nvm install          # Node 22
npm ci               # installs dependencies and the Git hooks
npm run db:setup     # creates .env and a local SQLite database with the data pack
npm run dev          # http://localhost:3000
```

`npm run go` does the database setup and starts the dev server in one command, from whatever branch you are on. It is safe to run again.

`npm run build && npm start` uses production authentication requirements, even on
your laptop. The generated localhost `.env` is for `npm run dev`. To test the
production build locally, use an HTTPS reverse proxy, set `BETTER_AUTH_URL` to
its exact origin, configure the trusted IP header and single process settings
under [Authentication deployment](#authentication-deployment), and block direct
access to the Node port. Otherwise auth intentionally fails closed.

You should see the asset catalogue in English. Switch to Finnish, Swedish or Estonian in the header.

**Demo accounts.** The seed loads the 31 assets and the 10 personas from the data pack, and creates two accounts if they are missing:

| Account                | Type     | Notes                                                                |
| ---------------------- | -------- | -------------------------------------------------------------------- |
| `customer@example.com` | customer | Can apply, sign, pay and return                                      |
| `supplier@example.com` | supplier | Named Kettu Bikes, so it sees the Kettu Bikes items in the data pack |

Both use the fixed password `test-pswd-123`, which setup prints as `Test login: …`. Running the seed again preserves existing accounts and passwords. These accounts are for local testing and demos only; change or delete them on any public host.

| Command                 | What it does                                                   |
| ----------------------- | -------------------------------------------------------------- |
| `npm run dev`           | Start the app with hot reload                                  |
| `npm run go`            | Set up the database, then start the dev server                 |
| `npm test`              | Run all tests once (`npm run test:watch` to keep them running) |
| `npm run test:coverage` | Tests with the 60 % coverage gate                              |
| `npm run check:all`     | **Everything CI runs.** Run it before you push                 |
| `npm run db:migrate`    | After you change `prisma/*.prisma`: creates a migration        |
| `npm run db:reset`      | Wipe the local database and seed it again                      |
| `npm run db:studio`     | Browse the database in your browser                            |

---

## 15-minute tour

New to TypeScript, Next.js or Prisma? Read these files in this order:

1. **`data/`**: the synthetic data pack. Open `assets.json` and `coefficient-table.json`, then the worked example in [DATA.md](data/DATA.md).
2. **`src/data/`**: Zod schemas that load and type-check every data file. If you want to know a field's type, look here.
3. **`src/domain/coefficient.ts`** and its test: a pure function that finds the pricing factor, and how we test it. All business logic lives in `src/domain/`, written the same way; [src/domain/README.md](src/domain/README.md) lists every file.
4. **`src/domain/price-list.ts`**: picks the right price for a date. The price list changes on Friday.
5. **`src/app/[locale]/page.tsx`**: the catalogue page. Next.js App Router: every folder under `src/app/` is a URL.
6. **`src/app/api/assets/`**: API routes. They use the response envelope (`src/server/api-response.ts`), and the status change writes an audit row in the same transaction (`src/server/audit.ts`).
7. **`src/server/features/`**: one folder per Spine step or Smart Problem. It loads the data pack and the database, calls the pure functions, and returns a result for the API route. Each larger feature has its own README. See [src/server/README.md](src/server/README.md).
8. **`prisma/`**: the database schema. `schema.prisma` holds the generator and datasource; the models are grouped by responsibility in `auth.prisma` (User, Session, Account, Verification), `assets.prisma`, `customers.prisma`, `application.prisma`, `contracts.prisma` (Contract, Invoice, CustomerCredit) and `audit.prisma`. Change a model, then run `npm run db:migrate`.

Handy docs: [Next.js App Router](https://nextjs.org/docs/app), [TypeScript for programmers who know C](https://www.typescriptlang.org/docs/handbook/typescript-in-5-minutes.html), [Prisma](https://www.prisma.io/docs), [Vitest](https://vitest.dev/guide/), [Tailwind CSS](https://tailwindcss.com/docs).

The rules in [RULES.md](RULES.md) apply to all of it: pure domain functions with tests, money in integer cents, every write through `withAudit()`, every response through `ok()` / `fail()`, UI strings in all four languages, and files under 600 lines.

---

## Submitting

You can't push to this repo. You work in **your own fork** and send us a **pull request**.

1. **One person per team forks** this repo (the **Fork** button, top right) and adds the other two as collaborators in the fork (_Settings → Collaborators_).
2. **Enable Actions in the fork**: open the fork's **Actions** tab and click _"I understand my workflows, go ahead and enable them"_. Now CI runs on every push.
3. Everyone clones the fork and commits as usual. Small, conventional commits; the hooks help.
4. **Before Friday 6 November 16:00**, open a pull request from your fork to `etufillari/northfina-lease-loop` `main`.
   - Title: `Team <name>: <your product name>`.
   - Fill in the template: members, the Smart Problems you picked, and how to demo.
   - You can open it early and keep pushing until the deadline.
5. **At 16:00 we record the latest commit of every open pull request.** That commit is what we judge. Anything pushed later is ignored, and pull requests opened after 16:00 don't count.

We won't merge pull requests. They're only how you hand in your work.

**Heads-up:** forks of a public repo are public, so other teams can see your fork. Your commit history shows who built what, and copying another team's work disqualifies both copies.

---

## Your code is yours

The starter code in this repo is MIT-licensed (see [LICENSE](LICENSE)); use it however you like.

**Your team owns the code you write.** Opening a pull request gives Northfina permission to read and run your code for judging and for interviews with your team. Nothing more: we won't merge it, reuse it or publish it elsewhere without asking you first.

## Help

- During the hackathon: **#ask-a-mentor** on the hackathon Discord.
- A bug in this starter repo: open a GitHub issue here.
- Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Deployment

- **Docker / Coolify.** The `Dockerfile` builds one image (build pack: Dockerfile, port 3000). Mount a persistent volume at `/data` for the SQLite file and run **one instance only**. Set `BETTER_AUTH_URL` (exact public HTTPS origin) and `BETTER_AUTH_SECRET` (`openssl rand -base64 32`) as runtime variables. On every start the container applies pending migrations and, unless `RUN_SEED=false`, runs the idempotent seed. The image defaults to `AUTH_SINGLE_INSTANCE=true` and `AUTH_TRUSTED_IP_HEADER=x-real-ip`; see the next section for what the proxy must guarantee.
- **Daily invoice sweep.** `GET /api/system/issue-due-invoices` issues every invoice whose date has arrived. `vercel.json` schedules it for 04:00 daily on Vercel. If `CRON_SECRET` is set, the route requires it; without it the route is open, which suits a laptop but not a public host. Invoices are also issued lazily whenever someone opens a lease's invoices.

## Authentication deployment

`npm run db:setup` generates a unique random local `BETTER_AUTH_SECRET` in the
ignored `.env` on first setup. Existing `.env` files are preserved; replace any
old example secret yourself with `openssl rand -base64 32`. Production rejects
missing, short, repetitive or known placeholder secrets. Set `BETTER_AUTH_URL`
to the explicit public HTTPS origin (no path); host and forwarded-host headers
are never used to choose the authentication origin.

This SQLite deployment supports **one Node process**, not multiple workers or
serverless instances. Set `AUTH_SINGLE_INSTANCE=true` to acknowledge this and
`AUTH_TRUSTED_IP_HEADER=x-lease-loop-client-ip`. The ingress proxy must strip
any client-supplied value of that header and overwrite it with one verified
client IP (not a comma-separated chain). Block direct access to the Node port.
Missing or invalid trusted IPs fail closed in production. Unconfigured forwarding
headers are ignored; development without a proxy limits accounts independently.

Login allows 5 submissions per normalized email + IP, 100 per email across IPs,
and 30 per trusted IP in fixed 60-second windows. Signup has separate limits
of 5 per email + IP, 20 per email, and 10 per IP. Logout has its own 60 per IP
limit; session reads consume no credential limits. IPv6 addresses share a /64
bucket (IPv4-mapped addresses share their IPv4 bucket). Each operation and scope
has a separate table of 16,384 secret-hashed slots; collisions conservatively
share limits without table exhaustion causing global denial.
For these limits, rejected credentials count,
and success does not reset a window. A 429 includes `Retry-After`. Limits are
bounded and in memory: configure persistent ingress rate limits as well to
cover restarts, malformed submissions and distributed abuse. Do not deploy
multiple instances until a shared atomic limiter and a multi-writer database
replace this setup. Auth writes queue before opening SQLite transactions;
signup hashing still runs within its transaction but cannot overlap another
auth write in this process.

Auth audits store the actual user ID for signup and actual session ID and user
actor for login/logout; automatic session expiry uses `system` and
`auth.session_expired`, atomically with each change. Public audit queries omit
all `auth.*` activity. No public auth audit viewer is provided.

Email delivery is not configured. Accounts remain unverified and signup currently
creates a session immediately. Duplicate signup has a generic message but its
status/cookie behavior still reveals whether the email is registered. Fully
concealing that distinction while proving ownership requires a verification
email flow (and delivery configuration); do not use these unverified addresses
as evidence of identity or automatically link them to customer records.
