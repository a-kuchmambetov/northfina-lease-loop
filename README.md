# Lease Loop · Northfina × Hive Helsinki hackathon

Starter repo for the **Lease Loop** challenge, 5–6 November 2026 at Hive Helsinki. Teams of 3 build a circular-economy leasing app: one e-bike, laptop or tractor, three lives.

- 📋 **The challenge:** [CHALLENGE.md](CHALLENGE.md)
- 📐 **Engineering rules (35 % of your score):** [RULES.md](RULES.md)
- 🗂️ **The data pack:** [data/DATA.md](data/DATA.md)

**Northfina** is a Helsinki-based leasing platform. It started as Etufillari, a bike-leasing service, and now leases any kind of asset. Dealers, banks and customers use it to get from a price quote to a signed contract, then through monthly invoices to the end of the lease. This repo is a small, independent playground, not our product code.

---

## Quick start

You need **Git** and **Node.js 22** (with [nvm](https://github.com/nvm-sh/nvm): `nvm install` reads `.nvmrc`).

```bash
git clone https://github.com/<your-team>/northfina-lease-loop.git
cd northfina-lease-loop
nvm install          # Node 22
npm ci               # installs dependencies and the Git hooks
npm run db:setup     # creates .env and a local SQLite database with the 30 assets
npm run dev          # http://localhost:3000
```

`npm run build && npm start` uses production authentication requirements, even on
your laptop. The generated localhost `.env` is for `npm run dev`. To test the
production build locally, use an HTTPS reverse proxy, set `BETTER_AUTH_URL` to
its exact origin, configure the trusted IP header and single process settings
under [Authentication deployment](#authentication-deployment), and block direct
access to the Node port. Otherwise auth intentionally fails closed.

You should see the asset catalogue in English. Switch to Finnish, Swedish or Estonian in the header.

| Command                 | What it does                                                   |
| ----------------------- | -------------------------------------------------------------- |
| `npm run dev`           | Start the app with hot reload                                  |
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
3. **`src/domain/coefficient.ts`** and its test: a pure function that finds the pricing factor, and how we test it. **Your business logic goes in `src/domain/`**, written the same way.
4. **`src/domain/price-list.ts`**: picks the right price for a date. The price list changes on Friday.
5. **`src/app/[locale]/page.tsx`**: the catalogue page. Next.js App Router: every folder under `src/app/` is a URL.
6. **`src/app/api/assets/`**: API routes. They use the response envelope (`src/server/api-response.ts`), and the status change writes an audit row in the same transaction (`src/server/audit.ts`).
7. **`prisma/`**: the database schema. `schema.prisma` holds the generator and datasource; `auth.prisma`, `assets.prisma` and `audit.prisma` group the models by responsibility. Add your own model files (Contract, Invoice, …) here and run `npm run db:migrate`.

Handy docs: [Next.js App Router](https://nextjs.org/docs/app), [TypeScript for programmers who know C](https://www.typescriptlang.org/docs/handbook/typescript-in-5-minutes.html), [Prisma](https://www.prisma.io/docs), [Vitest](https://vitest.dev/guide/), [Tailwind CSS](https://tailwindcss.com/docs).

Everything in the skeleton is replaceable. Keep the rules, not necessarily the code.

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

### Authentication deployment

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
