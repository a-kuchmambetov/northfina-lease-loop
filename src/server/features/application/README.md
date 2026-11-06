# application: the question flow and the eligibility decision (Spine #3, Smart Problem #4)

This feature covers everything from "start an application" to "yes / manual review /
rejected". Read [`src/domain/README.md`](../../../domain/README.md) first for the pure
functions this calls: `question-flow.ts` (which question to ask next, and what to do with a
now-stale answer) and `eligibility.ts` (the six rules in `data/questions.json`'s
`eligibility_rules`).

## Data sources

| Source                                                                        | What for                                                                                                                     | Read by                                                  |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `Customer` table                                                              | Just `customerId` existence and the applicant's type, as the context's starting default before `q_customer_type` is answered | `start-application.ts`, `answer-application-question.ts` |
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

The `Customer` table is seeded from `data/customers.json`'s 10 personas (so every existing
scenario card keeps working) but is a real, growable table — `src/server/features/
customers/create-customer.ts` is how a genuinely new applicant (not one of the 10) gets a
`customerId` at all, by creating their own profile after signing up. Either way, the
eligibility decision never reads that record directly: each question's own `why_we_ask` in
`data/questions.json` says exactly which rule it
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

## Questions the profile already answers are not asked

A signed-up account's profile (`Customer.user_id` set) already holds its name, e-mail, birth
date, country, business ID and so on. `start-application.ts` copies what the profile covers
into the new application's answers (`answersFromProfile()`, `src/domain/profile-answers.ts`),
so the decision still reads only the application's own answers. Those questions are then
hidden: `profile-answers.ts`'s `visibleQuestions()` takes them out of what the page asks,
counts in the progress bar and offers as "back", and `answer-application-question.ts` refuses
an answer to one (`question_not_applicable`). Because the profile's answers can already
decide the deal, `start-application.ts` also applies `earlyRejectionReason()` to them (an
under-18 profile is rejected at once) and resolves the decision straight away if nothing is
left to ask. Never taken from the profile: `q_pep`/`q_pep_details` (a declaration per lease),
`q_signatory_email` (another person), `q_usage_purpose`/`q_farm_registry` (about the item).
The 10 data-pack personas have no account, so they are still asked everything.

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
| `get-application-flow.ts`        | Everything the question page shows: the application, its asset, the question to show now. |
| `cancel-application.ts`          | Cancels a `pending` or `approved` application for the signed-in customer.                 |
| `application-decision.ts`        | Shared by start and answer: reaches the decision from the answers and stores it.          |
| `profile-answers.ts`             | Copies the answers a customer's profile already holds into a new application.             |

## API routes that call these

| Route                                 | Calls                                    |
| ------------------------------------- | ---------------------------------------- |
| `POST /api/applications`              | `start-application.ts`                   |
| `POST /api/applications/:id/answers`  | `answer-application-question.ts`         |
| `GET /api/applications/:id`           | `get-application.ts`                     |
| `POST /api/applications/:id/cancel`   | `cancel-application.ts`                  |
| `POST /api/applications/:id/contract` | `contracts/sign-application-contract.ts` |

## The question page

`/[locale]/applications/[id]` calls `get-application-flow.ts` directly and posts each answer
to `POST /api/applications/:id/answers`. `?question=<id>` reopens an answered question, and
answering it goes through the same route, so stale answers are dropped as described above.
The page is limited to logged-in customer accounts. An application starts under the
account's own `Customer` profile (`customers/find-customer-for-user.ts`). An account that
hasn't created a profile yet falls back to the first persona in `data/customers.json`
(`KNOWN_ISSUES.md` item 1); the decision still comes only from the answers.

## Cancelling

`POST /api/applications/:id/cancel` (`cancel-application.ts`) lets a signed-in customer cancel
an application while it is `pending` or `approved`, from the account page or the application
page. A rejected or manual-review application stays as it is
(`src/domain/application-cancellation.ts`). It is stored as `decision: 'cancelled'` with the
reason `customer_cancelled`, and the update is conditional, so a decision that lands at the
same moment is kept. Nothing else changes: applying reserves no asset. A `signed` application
(below) can't be cancelled, and cancelling never touches a contract.

## Forming a contract

An `approved` application shows a **Form a contract** button on its page. The customer
checks the deal and signs by typing their name, which calls
`POST /api/applications/:id/contract` (`contracts/sign-application-contract.ts`, see
[`../contracts/README.md`](../contracts/README.md)). The application then becomes
`decision: 'signed'` with the reason `contract_signed`, so it can't be cancelled or signed a
second time.

## Every write is audited

`start-application.ts`, and each write inside `answer-application-question.ts`, call
`withAudit` (see `src/server/audit.ts`), so the audit table gets `application.started`,
`application.answered` (one row per answer, naming the question id) and
`application.decided` (with the decision and reason, if any). `cancel-application.ts` adds
`application.cancelled`, naming the signed-in user and the decision it replaced.
