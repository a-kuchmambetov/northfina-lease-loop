# application: the question flow and the eligibility decision (Spine #3, Smart Problem #4)

This feature covers everything from "start an application" to "yes / manual review /
rejected". Read [`src/domain/README.md`](../../../domain/README.md) first for the pure
functions this calls: `question-flow.ts` (which question to ask next, and what to do with a
now-stale answer) and `eligibility.ts` (the six rules in `data/questions.json`'s
`eligibility_rules`).

## Data sources

| Source                                                                        | What for                                                                                                 | Read by                                                  |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `data/customers.json`                                                         | The authoritative applicant record — birth date, country, business ID, income, PEP status                | `start-application.ts`, `answer-application-question.ts` |
| `data/assets.json`                                                            | The asset's category, for `ask_when` conditions keyed on `category`                                      | `start-application.ts`, `answer-application-question.ts` |
| `data/questions.json`                                                         | The question list and their `ask_when` conditions                                                        | `start-application.ts`, `answer-application-question.ts` |
| `data/price-lists.json`, `data/coefficient-table.json`, `data/vat-rates.json` | The quote locked onto the application at start (via `pricing/get-quote.ts`)                              | `start-application.ts`                                   |
| `Application` table                                                           | One row per application: the quote it was started with, its answers so far, its decision once it has one | all three files                                          |

## Why the application is persisted, not stateless

A `manual_review` decision needs a durable record for a human to review later, the
multi-step question flow needs state across separate HTTP requests, and this mirrors the
`Contract` lifecycle already established elsewhere in the codebase. `financed_amount_cents`,
`monthly_rent_with_vat_cents` and `price_list_version` are locked onto the `Application` row
the moment it starts — the same "lock the price, not the tax" idea `contracts/` uses for a
signed contract — so a price-list change mid-application can never change the deal being
decided underneath the applicant.

## Answers drive the question flow; the customer record decides eligibility

`data/customers.json`'s personas already carry typed, validated fields (`birth_date`,
`country`, `business_id`, `is_pep`, `monthly_net_income_cents`). The eligibility decision
(`resolveEligibility`) reads those fields straight from the customer record looked up by
`customerId`, not from the applicant's free-text answers — there's no need to re-parse a
date or re-validate a business ID's format out of an answer string when the data pack
already has it in typed form.

The answers collected through the question flow (`q_customer_type`, `q_birth_date`, …) exist
to drive the _interview itself_: which question is applicable next, and which earlier
answers become stale and get dropped once a dependent answer changes
(`src/domain/question-flow.ts`'s `isQuestionApplicable` / `dropStaleAnswers`). The deal
context (`customer_type`, `category`, `financed_amount_cents`, `term_months`) that
`ask_when` conditions are checked against is always built from the authoritative customer
and asset records plus the locked quote — never from an answer — so the question flow can't
be steered somewhere the real deal doesn't support.

## How an application is decided

1. `start-application.ts` looks up the customer and asset, quotes the deal
   (`pricing/get-quote.ts`), creates the `Application` row (`decision: 'pending'`), and
   returns the first applicable question.
2. `answer-application-question.ts` is called once per answer. It merges the new answer in,
   drops anything that's no longer applicable, and either:
   - returns the next question to ask (`status: 'in_progress'`), or
   - once nothing is left to ask, calls `resolveEligibility` and persists the final
     `decision` / `decision_reason` / `decided_at` (`status: 'decided'`).
3. `get-application.ts` is a plain read of the current state — answers so far, decision if
   any — for a client that needs to resume or display an application.

Answering a question that is not currently applicable, or answering an application that
already has a decision, is rejected rather than silently accepted — these are state-machine
integrity checks, not business rules (the business rule — which question applies when — is
entirely `isQuestionApplicable`'s call).

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
