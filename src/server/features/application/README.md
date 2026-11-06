# application: the question flow and the eligibility decision (Spine #3, Smart Problem #4)

This feature covers everything from "start an application" to "yes / manual review /
rejected". Read [`src/domain/README.md`](../../../domain/README.md) first for the pure
functions this calls: `question-flow.ts` (which question to ask next, and what to do with a
now-stale answer) and `eligibility.ts` (the six rules in `data/questions.json`'s
`eligibility_rules`).

## Data sources

| Source                                                                        | What for                                                                                                                     | Read by                                                  |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `data/customers.json`                                                         | Just `customerId` existence and the applicant's type, as the context's starting default before `q_customer_type` is answered | `start-application.ts`, `answer-application-question.ts` |
| `data/assets.json`                                                            | The asset's category, for `ask_when` conditions keyed on `category`                                                          | `start-application.ts`, `answer-application-question.ts` |
| `data/questions.json`                                                         | The question list and their `ask_when` conditions                                                                            | `start-application.ts`, `answer-application-question.ts` |
| `data/price-lists.json`, `data/coefficient-table.json`, `data/vat-rates.json` | The quote locked onto the application at start (via `pricing/get-quote.ts`)                                                  | `start-application.ts`                                   |
| `Application` table                                                           | One row per application: the quote it was started with, its answers so far, its decision once it has one                     | all three files                                          |

## Why the application is persisted, not stateless

A `manual_review` decision needs a durable record for a human to review later, the
multi-step question flow needs state across separate HTTP requests, and this mirrors the
`Contract` lifecycle already established elsewhere in the codebase. `financed_amount_cents`,
`monthly_rent_with_vat_cents` and `price_list_version` are locked onto the `Application` row
the moment it starts — the same "lock the price, not the tax" idea `contracts/` uses for a
signed contract — so a price-list change mid-application can never change the deal being
decided underneath the applicant.

## The decision is built entirely from the application's own answers

There is no `Customer` table — `data/customers.json` is read-only, synthetic test data,
and its personas exist so a demo operator has something true to type into the form for a
given scenario card, not so the backend can read the "real" answer behind the applicant's
back. Each question's own `why_we_ask` in `data/questions.json` says exactly which rule it
feeds (`q_birth_date`: "You must be 18 or older to sign a lease"; `q_pep`: "Required by AML
law for leases of 10,000 EUR or more"), and the amount thresholds on `q_monthly_income` and
`q_pep` only make sense if the check itself depends on whether that question was actually
asked. So:

- `DealContext.customerType` (which drives every `customer_type`-gated `ask_when`) is the
  applicant's own answer to `q_customer_type` once given — `effectiveCustomerType()`
  (`src/domain/question-flow.ts`) — not the persona's real `type`. That's what makes "the
  applicant goes back and changes customer_type" (CHALLENGE.md Smart Problem #4) actually
  reachable through the live API, not just in `src/domain/question-flow.test.ts`'s isolated
  tests.
- `resolveEligibility`'s applicant (`applicantFromAnswers()`, `src/domain/eligibility.ts`)
  is built from the collected answers: `birth_date`/`country` from `q_birth_date`/
  `q_country`, `business_id` from `q_business_id`, `monthly_net_income_cents` from
  `q_monthly_income` (0 if never asked — then the caller also omits
  `monthlyRentWithVatCents`, so `resolveEligibility` skips `affordability` rather than
  comparing against a meaningless 0), `is_pep` from `q_pep === 'yes'` (`false` if never
  asked, matching the amount threshold that decided not to ask it).
- `customerId` is only used to confirm it refers to something real, and as the context's
  starting default before `q_customer_type` has an answer.

## Two ways an application ends in `rejected`, one way it ends in `manual_review`

`data/questions.json` attaches `blocks_application_when` directly to `q_birth_date` (under 18) and `q_country` (not FI/SE/EE): `earlyRejectionReason()` (`src/domain/eligibility.ts`)
checks a question's own block rule against the very answer just given, and
`answer-application-question.ts` ends the application right there if it fires — this is
CHALLENGE.md scenario card 5's "Be kind and clear": Mikko (17) hears he can't lease
immediately after his birth date, not after also typing his e-mail, country, employment and
income. `q_business_id` has no such block (only a `validation.format` hint); a business ID
that's shaped right but has the wrong check digit is accepted as an answer and only caught
by `resolveEligibility`'s `business_id` rule once the whole flow completes, alongside
`affordability` and `financed_limits`. `pep_manual_review` never short-circuits early — a
PEP's application still collects everything a human reviewer would need (CHALLENGE.md
scenario card 7: the full set of questions for Haapalan Tila still appears before it ends in
manual review).

## Answer format vs. eligibility

`isValidAnswerFormat()` (`src/domain/question-flow.ts`) checks that an answer is even
_shaped_ right for its question's `type` — a date that looks like a date, a choice that is
one of its own listed `options`, a business ID shaped like `1234567-8`
(`data/questions.json`'s own `q_business_id.validation`) — before it's ever accepted or
stored. An invalid answer is rejected outright (`reason: 'invalid_answer_format'`, with that
question's own `hint` if it has one) rather than being merged in. This is deliberately
separate from whether the answer is _eligible_: a business ID that matches the shape but has
the wrong check digit passes format validation and is accepted, and only fails later, in
`resolveEligibility`'s own rule.

## How an application is decided

1. `start-application.ts` looks up the customer and asset, quotes the deal
   (`pricing/get-quote.ts`), creates the `Application` row (`decision: 'pending'`), and
   returns the first applicable question.
2. `answer-application-question.ts` is called once per answer. It validates the answer's
   format, merges it in, drops anything that's no longer applicable, and either:
   - ends the application immediately if `earlyRejectionReason()` fires,
   - returns the next question to ask (`status: 'in_progress'`), or
   - once nothing is left to ask, calls `resolveEligibility` and persists the final
     `decision` / `decision_reason` / `decided_at` (`status: 'decided'`).
3. `get-application.ts` is a plain read of the current state — answers so far, decision if
   any — for a client that needs to resume or display an application.

Answering a question that is not currently applicable, answering with the wrong format, or
answering an application that already has a decision, is rejected rather than silently
accepted — these are state-machine/input integrity checks, not business rules (the business
rule — which question applies when, and whether the applicant is eligible — is entirely
`isQuestionApplicable`'s and `resolveEligibility`'s call).

## What an `'approved'` application unlocks

`src/server/features/contracts/sign-contract.ts` optionally takes this application's own
`id` and enforces it — `decision: 'approved'`, and for the exact same
customer/asset/term — before signing. It also reads this application's own `q_can_sign`
answer: a company that answered `'no'` gets a contract that starts `'pending_signature'`,
not `'active'`, until the named `q_signatory_email` confirms it
(`src/server/features/contracts/README.md`'s "Linking an application, and waiting on a
co-signer" — CHALLENGE.md scenario card 6). Signing without an `applicationId` still works
exactly as before (used internally by `end-of-term`'s `extend`/`pass_on`, which re-sign
the same item without a fresh application) — this is additive, not a new requirement.

## Files

| File                             | What it does                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| `start-application.ts`           | Quotes the deal, creates the `Application` row, returns the first question.               |
| `answer-application-question.ts` | Records one answer, drops stale answers, returns the next question or the final decision. |
| `get-application.ts`             | Reads one application's current state.                                                    |

## API routes that call these

| Route                                | Calls                            |
| ------------------------------------ | -------------------------------- |
| `POST /api/applications`             | `start-application.ts`           |
| `POST /api/applications/:id/answers` | `answer-application-question.ts` |
| `GET /api/applications/:id`          | `get-application.ts`             |

## Every write is audited

`start-application.ts`, and each write inside `answer-application-question.ts`, call
`withAudit` (see `src/server/audit.ts`), so `GET /api/audit-log` shows `application.started`,
`application.answered` (one row per answer, naming the question id) and
`application.decided` (with the decision and reason, if any).
