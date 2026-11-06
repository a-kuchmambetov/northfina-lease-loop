# src/server: everything that touches the outside world

Business rules live in `src/domain/` as pure functions (see
[`src/domain/README.md`](../domain/README.md)). This folder is where those rules meet I/O:
the data pack (`src/data/`), the database (Prisma), the request/response cycle, the clock.

## Layout

- Flat, shared server utilities. Tests sit next to the file, same as `src/domain/`:
  - `api-response.ts` (the `ok()` / `fail()` / `handleRoute()` envelope), `audit.ts`
    (`withAudit()`), `db.ts`, `prisma-client.ts`, `today.ts` (the only clock);
  - `assets.ts` (asset rows, guarded status transitions, wear), `customers.ts`,
    `customer-credit.ts` (the append-only credit ledger);
  - `auth*.ts` (better-auth setup, rate limits and the auth route wrapper);
  - `invoice-pdf.ts` and `pdf-response.ts` (the printable invoice).
- `features/<name>/` — orchestration for **one Spine step or Smart Problem**. A feature
  folder loads whatever data or database rows it needs, calls `src/domain/` functions to make
  the actual decision, and returns a result shaped for an API route. It owns no business
  logic itself.

## Tests for `features/`

Tests for `src/server/features/<name>/<file>.ts` live in `tests/features/<name>/<file>.test.ts`
— the same relative path, under `tests/` instead of next to the file. This is the one place
in the codebase that does **not** follow "tests next to the code": everything else
(`src/domain/**`, and the rest of `src/server/**`) keeps its tests next to the file, per
`RULES.md` §4 and `AGENTS.md`.

Why the exception: a feature folder is glue, not a single pure function, so its test suite
reads better as its own file tree than interleaved with the orchestration code, and it keeps
`tests/` as the one place to look for "does the whole feature work end to end".

## What is here

| Feature               | What it does                                                                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pricing/`            | Spine #2: turns an asset + term + down payment into a live monthly price quote; also compares every term side by side (Smart Problem #6).                                                                 |
| `contracts/`          | Spine #4/#5: signs a contract (locking its net rent and buyout), issues invoices once they're due, and marks them paid. See [`contracts/README.md`](features/contracts/README.md) for the full data flow. |
| `application/`        | Spine #3 / Smart Problem #4: runs the question flow and the eligibility decision for one application. See [`application/README.md`](features/application/README.md) for the full data flow.               |
| `customer-overview/`  | The customer's account page: their applications, and their active and past leases. Read-only.                                                                                                             |
| `customer-invoices/`  | The customer's My invoices page: every invoice across all their leases, newest first. Issues whatever is due, like a lease's own invoice page.                                                            |
| `end-of-term/`        | Spine #6: buys, returns, passes on or extends a contract once its term is over. See [`end-of-term/README.md`](features/end-of-term/README.md) for the full data flow.                                     |
| `supplier-equipment/` | The supplier's Catalog, "Your equipment": their items, each item's state, contract and what needs attention. Read-only. See [`supplier-equipment/README.md`](features/supplier-equipment/README.md).      |
| `return-requests/`    | The supplier's Requests page: the leases whose item customers have given back, and how and when. Read-only.                                                                                               |
| `return-lease/`       | The customer's "Return item" button: quotes and carries out a return, free at the end of the term and with a fee before. See [`return-lease/README.md`](features/return-lease/README.md).                 |
| `early-exit/`         | Smart Problem #2: buys out or returns a contract before its term is over, for a fair price. See [`early-exit/README.md`](features/early-exit/README.md) for the full data flow.                           |
| `second-life/`        | Spine #7 / Smart Problem #3: refurbish-or-not and waiting-list matchmaking for a returned item. See [`second-life/README.md`](features/second-life/README.md) for the full data flow and known gaps.      |
| `customers/`          | Turns a signed-up `User` into a real `Customer` profile — the missing link for a genuinely new applicant. See [`customers/README.md`](features/customers/README.md).                                      |
| `audit-log/`          | The supplier's operations audit trail: only rows about their own equipment, never `details`; customers and guests are refused. See `GET /api/audit-log`. Read-only.                                       |
