# src/server: everything that touches the outside world

Business rules live in `src/domain/` as pure functions (see
[`src/domain/README.md`](../domain/README.md)). This folder is where those rules meet I/O:
the data pack (`src/data/`), the database (Prisma), the request/response cycle, the clock.

## Layout

- `api-response.ts`, `audit.ts`, `db.ts`, `today.ts`, `assets.ts`, … — flat, shared server
  utilities. Tests sit next to the file, same as `src/domain/`.
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

| Feature      | What it does                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `pricing/`   | Spine #2: turns an asset + term + down payment into a live monthly price quote.                  |
| `contracts/` | Spine #4/#5: signs a contract, locking its net rent and buyout, and builds its invoice schedule. |

## What teams are expected to add

One folder per Spine step or Smart Problem you build the server side of, for example:
`application/`, `contract/`, `invoicing/`, `end-of-term/`, `second-life/`. Do not commit
empty folders — add a feature folder when you have its first file.
