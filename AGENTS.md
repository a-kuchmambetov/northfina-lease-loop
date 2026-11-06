# Instructions for AI coding agents

You are helping a hackathon team build **Lease Loop**. The challenge is in `CHALLENGE.md`; the engineering rules in `RULES.md` are judged and must be followed. The short version:

- **No AI inside the product.** Never add an AI, ML or LLM SDK, model or API call to the app. All product logic is rules, data and algorithms. `npm run check:no-ai` enforces this.
- **Business logic goes in `src/domain/`** as pure functions: no I/O, no database, no `fetch`, no `Date.now()` / `new Date()` / `Math.random()`. Pass dates (ISO `YYYY-MM-DD`) and data in as arguments. Every function gets Vitest tests next to it, including edge cases.
- **Server-side orchestration for one Spine step or Smart Problem goes in `src/server/features/<name>/`** (one folder per feature): load the data pack and/or the database, call the pure functions in `src/domain/`, and return a result the API route turns into a response. No business rules live here — if you're deciding something, that decision belongs in `src/domain/`. Tests for files under `src/server/features/` live in `tests/features/<name>/`, mirroring the path, instead of next to the file. (`src/domain/` and the rest of `src/server/` keep tests next to the code, per the rule above — this mirrored-tests convention is only for `src/server/features/`.) See `src/server/README.md`.
- **Money is integer euro cents.** Never use floating-point euros for amounts. Round once, deliberately, and document the rule.
- **API routes** use `ok()` / `fail()` / `handleRoute()` from `src/server/api-response.ts`. Never return raw error messages or stack traces.
- **Every data change** goes through `withAudit()` in `src/server/audit.ts`. Use the `tx` it gives you for every write in that change.
- **Database changes:** edit the relevant `prisma/*.prisma` file, then run `npm run db:migrate`. Never hand-write migration SQL.
- **UI strings** go in `src/i18n/messages/{en,fi,sv,et}.json`, with the same keys in all four.
- **Files stay under 600 lines.** Split by responsibility.
- **Commits** use conventional messages: `type(scope): subject`. Never use `git commit --no-verify` or `git push --no-verify`. If a hook fails, fix the cause.
- Before saying a change is done, run `npm run check:all`; it's what CI runs.
- Read `data/DATA.md` before using the data pack. Schemas for every data file are in `src/data/schemas.ts`.
- **Read `KNOWN_ISSUES.md` before touching auth, customer identity, or asset reservation.** It lists validation/authorization gaps found in a 2026-11-06 audit that are not yet fixed — check it before assuming a check exists.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

Figma source - https://www.figma.com/design/xt68Zuy36C07zFHtdBahb8/LeaseFlow-%E2%80%94-Equipment-catalog?node-id=0-1&t=QkUVxu3bnoyju3rC-1
