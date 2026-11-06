# Backend algorithms — deep dive

Step by step: what actually happens on the backend for every feature, read straight off
the domain-function source, not a summary. Each item names the CHALLENGE.md Spine step
or Smart Problem it answers and the specific trap it handles. Mirrors the online doc's
"Backend algorithms" tab. See `PITCH_PREP.md` for the pitch-facing summary and
`KNOWN_ISSUES.md` for tracked gaps.

## Catalogue, pricing & term comparison

**Catalogue & access control** (Spine #1). Trap: a public catalogue must not leak serial
numbers to strangers, and the data pack has no real "who owns this item" field.

1. `leaseAccess`: no session → `guest`; `accountType: 'customer'` → `customer`; anything
   else → `not_customer`.
2. `catalogueAsset`: a customer sees the asset untouched; everyone else gets a clone with
   `serial_number` deleted.
3. `suppliesAsset`: normalizes the supplier's account name and the asset's `make` (trim,
   collapse spaces, lowercase) and compares them — "Kettu Bikes" owns every Kettu Bikes
   item; a blank name owns nothing.
4. `isLeasable`: only true when `status === 'available'` AND a price quote actually
   succeeds for it.

**Price quoting** (Spine #2). Trap: rounding VAT by multiplying rent by `1 + rate/100`
can silently round a half-cent down on binary floats.

1. Find the coefficient band whose financed-amount range contains the deal — below/above
   range is rejected outright.
2. `financedCents = listPrice − downPayment`;
   `monthlyNetRentCents = round(financedCents × factor)`.
3. `buyoutCents = round(financedCents × buyoutPercentForTerm / 100)`.
4. VAT is rounded as its **own line** — `round(monthlyNetRentCents × vatRate / 100)` —
   then added; never computed by multiplying rent by `(1 + rate/100)`.
5. `totalCostWithVatCents = downPayment + monthlyRentWithVat × termMonths` —
   deliberately excludes the buyout, shown as its own line.

**Term comparison** (Smart Problem #6). Trap: never hardcode which terms exist.

1. Read every term key actually present in the coefficient table, sorted — not a fixed
   `[12,24,36,48]`.
2. Quote each term independently, so one term failing (e.g. below the minimum) never
   breaks the others.

## Application: question flow, eligibility, business ID

**Question flow engine** (Spine #3 / Smart Problem #4). Trap: changing an earlier answer
can invalidate a whole chain of later answers, not just the next one.

1. `isQuestionApplicable`: every one of a question's `ask_when` conditions must hold
   (against customer type, asset category, financed amount, term, or an earlier answer)
   — an empty condition list is always true.
2. `nextQuestion`: scan `data/questions.json` in file order, return the first question
   with no answer yet that's currently applicable.
3. Going back: if the requested question is already answered and still applicable, show
   that one instead of jumping to the next unanswered one.
4. `dropStaleAnswers`: a fixed-point loop — repeatedly scan all questions and drop any
   answer whose question is no longer applicable given the shrinking answer set, until
   one full pass changes nothing. This is what cascades a `q_can_sign: no → yes` edit
   into also dropping the now-pointless `q_signatory_email`.
5. `isValidAnswerFormat`: per question type — `choice` must be a listed option, `date`
   matches `YYYY-MM-DD`, `email` a basic regex, `money` a non-negative integer,
   `text`/business-ID just the right shape (not yet the check digit).

**Eligibility decision** (Spine #3). Trap: hard disqualifiers must be checked before the
softer "needs a human" one, and only from the application's own answers — never a hidden
customer record.

1. Financed-amount band check first — below/above the coefficient table's range →
   rejected `financed_limits`.
2. Consumer/sole_trader only: age on the contract start date **< 18** → rejected
   `min_age`.
3. Same two types: country not in **FI / SE / EE** → rejected `residency`.
4. Sole_trader/company: business ID fails its check digit → rejected `business_id`.
5. Consumer only, once a rent quote exists: monthly rent with VAT **> 30%** of monthly
   net income → rejected `affordability`.
6. Last of all: `is_pep === true` → `manual_review`, never auto-rejected and never
   auto-approved.
7. Nothing triggered → `approved`. An early version of this read fields straight off the
   `Customer` DB row — fixed mid-session so it only ever reads the application's own
   collected answers, which is also what makes "go back and change customer type"
   actually work live.

**Business-ID check digit** (the Y-tunnus trap).

1. Must be exactly 7 digits, a hyphen, 1 digit.
2. Multiply the 7 digits by fixed weights **[7,9,10,5,8,4,2]**, sum them.
3. `remainder = sum mod 11`: `0` → expected digit `0`; `1` → no valid digit exists for
   those 7 digits at all; otherwise expected digit `= 11 − remainder`.
4. Valid only if the typed check digit matches the computed one.

## Contracts: signing, locking, co-signer flow, customer accounts

**Signing + price-locking** (Spine #4). Trap: a later price-list change must never
retroactively touch an existing contract.

1. Load the asset — missing → `asset_not_found`; not `'available'` →
   `asset_not_available`.
2. Load the customer by id from the DB — missing → `unknown_customer`.
3. If credit is being applied, check it doesn't exceed the customer's ledger balance →
   else `insufficient_credit`.
4. If an `applicationId` is given: it must exist, be `approved`, and match this exact
   customer/asset/term; if its `q_can_sign` answer was `'no'`, capture the named
   signatory's email.
5. Resolve the list price — from the application's own locked price-list version if
   signing from one, otherwise today's list price.
6. Lock the quote (same formula as pricing) into
   `financedCents`/`monthlyNetRentCents`/`buyoutCents` on the contract row, forever.
7. In one transaction (`withAudit`): persist the contract as `pending_signature` if a
   signatory is waiting, else `active`; flip the asset `available → reserved` as a
   compare-and-swap (`updateMany` where the status is still `available`); if credit was
   spent, write a negative ledger row. A lost swap rolls everything back and answers
   `asset_not_available`.
8. After the commit, issue invoice #1 immediately.

**Application-link / co-signer flow** (scenario card 6: "Who can sign?"). Trap: a
company's own applicant may not be allowed to sign for it.

1. Down payment is deliberately **not** checked against the application — price may
   legitimately differ between application and signing (scenario card 2).
2. `q_can_sign === 'no'` → the contract is `pending_signature`, not `active`; invoice #1
   is automatically withheld since invoicing only ever fires for active contracts.
3. `POST .../confirm-signature`: the contract must exist and be exactly
   `pending_signature`; flips it to `active`, then issues whatever is now due —
   including invoice #1 — in the same action.

**Customer accounts** (fixes "only 10 fixed personas"). Trap: one signed-up user must
map to at most one customer identity.

1. If a `userId` is given, check no `Customer` row already has that `user_id` → else
   `already_a_customer`.
2. Insert a new `Customer` row with a fresh id; `is_pep` is hardcoded `false` at
   creation — never a signup field, only the application's own `q_pep` answer ever sets
   it.
3. One transaction: create the row + write the `customer.created` audit entry.

## Invoicing & payment

**Invoicing** (Spine #5). Trap: money must round per invoice yet sum exactly to the
contract total; VAT must follow each invoice's own date, not the signing date.

1. For month `i` (0 to termMonths−1): `invoiceDate = addCalendarMonths(startDate, i)`,
   clamped to shorter months — 31 Jan + 1 month lands on 28 or 29 Feb.
2. Look up the VAT rate independently **per invoice date** — a rate change mid-contract
   only touches invoices dated after it.
3. `vatCents = round(netCents × vatRate / 100)`; `grossCents = net + vat`;
   `paymentDeadline = invoiceDate + 14 days`.
4. Issuing is lazy and idempotent: recompute the full schedule, diff against existing
   rows by sequence number, insert only the ones due by `asOfDate` that don't exist yet —
   never touches an already-issued row.
5. Once a contract leaves `'active'`, no new invoice rows are ever created for it again,
   even for past-due months — the rent clock has stopped.
6. Double-guarded against a race: an in-transaction re-check right before insert, plus a
   DB unique constraint on `(contract_id, sequence_number)`.

**Payment** (Spine #5). A pure status transition.

1. The invoice must exist and still be `'issued'` — already `paid` or `cancelled` is
   rejected with its own reason.
2. Otherwise: `status → 'paid'`, `paid_at → now`, audited as `invoice.paid`.

## End of term: buy, return, pass-on, extend, credit

**Buy** (Spine #6). Trivial by design — the price was fixed at signing. Term must be
over; charge exactly the stored `buyout_cents`; contract `active → bought` and asset
`reserved → sold` (terminal, never reused) as two compare-and-swaps in one transaction, so
a lost race rolls both back.

**Return — the wear model** (Spine #6/#7). Trap: condition must reflect _this lease's_
real wear, not stay frozen at whatever it was before.

1. `usageAfter = usageBefore + assumedMonthlyUsage[category] × monthsLeased` — fixed
   assumed rates: **400 km/month** (e-bike), **25 cycles/month** (laptop), **80
   engine-hours/month** (farm machine). The same added usage goes onto both the
   since-last-reset counter (`usage_value`) and the never-reset `lifetime_usage_value`.
2. Map the new usage onto a category-specific condition ladder (`new → like_new → good →
fair → poor`) to get what usage alone implies.
3. Final condition = the **worse** of the old condition and what usage implies —
   condition never improves on its own.
4. Contract → `'returned'` (`active → returned` compare-and-swap) and asset
   `reserved → returned` with its new wear, in one transaction; the asset carries this
   assessed condition/usage into the refurbishment queue.

**Pass-on** (Spine #6). Trap: must never be a strictly-worse choice than a free return.

1. Assess wear for the full term; gate: condition must be **`'good'` or better**, else
   rejected — must `return` instead.
2. Requires a real, existing next customer and term; checked against the DB, not the
   static file.
3. Prices the new lease off **today's residual value**, not the original list price.
4. In one transaction, persists the new contract, marks the old one `'returned'`
   (compare-and-swap, so two simultaneous pass-ons cannot both win) and writes the
   asset's wear; the asset goes straight into the new lease, never idle.
5. Credits a bonus to the first customer (below).

**Extend** (Spine #6). Trap: charging original rent on a renewal would ignore real
depreciation.

1. Assess real wear for the full elapsed term (not the stale pre-lease row).
2. Residual value at that age/condition/usage becomes the "fresh list price" fed into the
   same locking formula, for the additional term.
3. Old contract → `'extended'` (compare-and-swap), pointing at the new contract's id;
   asset stays `'reserved'`. New contract, settlement and wear commit together.

**Pass-on bonus** (our own invention — rewards exceeding the minimum, not just meeting
it).

1. `stepsBetterThanGood = max(0, rank('good') − rank(actualCondition))` — 0 for exactly
   good, 1 for like-new, 2 for new.
2. `percent = 2 + 3 × stepsBetterThanGood`.
3. `bonusCents = round(buyoutCents × percent / 100)`.

**Customer credit ledger.** No single mutable balance — append-only, same philosophy as
the audit log. Balance = the sum of every ledger row for that customer (positive earned,
negative spent); each change is one new row + one audit row in the same transaction.

## Early exit & the 14-day withdrawal window

**Early buy** (Smart Problem #2). Trap: must agree exactly with end-of-term's buyout at
the boundary.

1. `amountCents = round(buyoutCents + (financedCents − buyoutCents) × monthsRemaining /
termMonths)` — a straight line from ≈`financedCents` at month 0 down to exactly
   `buyoutCents` at the natural term end.

**Early return** (Smart Problem #2). Trap: fair to both sides — the company loses future
rent but gets a less-worn item back sooner.

1. `remainingRent = monthlyNetRent × monthsRemaining`.
2. Residual value **now** (age = months elapsed) vs residual value **at full term** (age
   = termMonths), both using the condition/usage assessed right now — only the age
   differs between the two.
3. `gain = residualValueNow − residualValueAtFullTerm`.
4. `feeCents = max(0, round(remainingRent − gain))`.
5. Any unpaid rent invoice for a month the fee already covers — including the month in
   progress — is cancelled in the same transaction, fee amount or not.
6. A fee above zero is itself invoiced (`kind: early_return_fee`): net fee plus VAT at the
   return date's rate, rounded once, due 14 days later.

**Consumer 14-day withdrawal window** (our own addition, modeled on EU consumer law).
Trap: the wear model has no usage signal finer than a month, so it can't fairly pro-rate
inside 14 days.

1. Only applies when the customer's type is `'consumer'` — never `sole_trader`/`company`.
2. `daysSinceSigning = daysBetween(startDate, asOfDate)`; window = **0 to 14 days
   inclusive**.
3. Inside the window: override entirely — `feeCents = 0`, skip the whole formula above
   and its residual-value lookups.
4. Still cancels whatever invoice the return gives up, exactly like a normal return with
   a fee — free does not mean the rent is still owed.

## Residual value, refurbishment, second-life matching

**Residual value model** (shared by early-exit, end-of-term and second-life — "what's it
worth today").

1. Interpolate the category's age-vs-percent curve (linear between points; hold the last
   value past the final point).
2. Multiply by a condition multiplier (direct lookup by current condition).
3. Multiply by a usage multiplier — `1 + usageAdjustment%`, where the adjustment is
   floored at a maximum total percent.
4. `valueCents = round(listPriceAtFirstLease × curve% × conditionMult × usageMult)` —
   one rounding, at the end.

**Refurbishment cost** (Smart Problem #3). Trap: refurbish only ever targets `'good'`,
never further; farm machines have no "last service date" to go by.

1. Already `'good'` or better → nothing to compute.
2. Sum the condition-ladder step costs from the current condition up to `'good'`.
3. Add every fixed cost whose `when` condition applies — "always", a crossed usage
   threshold, or (farm machines) **our own simplification**:
   `ceil(usageValue / 1000) × cost`, since nothing tracks the real last-service date.
4. A cost marked `resets_usage` (e.g. a battery swap) zeroes only the since-reset usage
   counter (`usage_value`). The `lifetime_usage_value` counter is never reset, per a
   mentor clarification (`KNOWN_ISSUES.md` item 5).

**Second-life matchmaking** (Smart Problem #3). Trap: the data has no signup-date field
for a genuine tie-break.

1. Filter the waiting list to requests whose category matches, whose condition floor the
   item clears, whose deadline hasn't passed, and whose budget the quoted rent fits.
2. Rank the survivors by `rent × their own preferred term` (total revenue), descending.
3. Ties go to earlier position in the waiting-list file — our documented stand-in for
   "signed up first".
4. Run that whole ranking twice — once for the item as-is, once as if refurbished to
   `'good'` — since refurbishing changes both condition and eligibility.
5. Refurbish only if the refurbished path's best revenue minus its cost beats the as-is
   path's best revenue; a tie keeps it as-is; no match on either path → `no_match`.
6. Persist with a compare-and-swap `returned → available`; a stale resolution answers
   `asset_status_conflict` and writes nothing.

## Passport, CO2/fleet impact, and the engineering mechanisms

**Asset passport** (Spine #7 bonus). Trap: the very first life was never "refurbished
into" — nothing comes before it.

1. Load every contract for the asset, oldest first — each one is a "life".
2. A life after the first counts as refurbished-into if a refurbish audit row's
   timestamp falls between the previous life's signing and this one's.
3. CO2 and money are credited **only from the second life onward**; life 0 always shows
   0 for both.

**CO2 impact formula** (Smart Problem #7). Trap: a usage-resetting refurbishment (e.g. a
battery swap) must not erase the km already ridden, so CO2 reads a separate lifetime
counter.

1. Avoided manufacturing = the category's base figure, discounted if refurbished, full
   value if matched as-is.
2. E-bikes additionally credit avoided car-km off the asset's **lifetime** km
   (`lifetime_usage_value`), which a battery replacement never zeroes. Assets whose
   battery was replaced before that column existed were backfilled from the since-reset
   value, so their earlier history is lost.

**Fleet-wide rollup.** No separate logic — run the passport for every asset and sum the
totals.

**Audit log** (engineering rule, every Spine item). Guarantees no write ever exists
untracked, and that only the right people can read the trail.

1. One DB transaction wraps both the actual write and one `AuditLog` insert (`actor`,
   `action`, `entityType`, `entityId`, `details`).
2. Either both succeed or the whole transaction rolls back — a change can never exist
   without its audit row, or vice versa.
3. Reading it (`GET /api/audit-log`): guests get 401, customers 403. A supplier gets the
   newest 50 rows about their own equipment (asset rows for their items, plus the
   contract, application and invoice rows behind them), matched by brand, and never the
   `details` JSON. Customer and credit rows and `auth.*` rows are never shown.

**API envelope.** Guarantees no raw error or stack trace ever reaches a client. Every
response is `{success, data}` or `{success:false, error:{code, message}}`; a thrown
validation error becomes a 400 with field-level detail; anything else is logged
server-side only and surfaces as a generic 500 with no message leak.

**Validation, everywhere it happens, consolidated:**

- **Shape:** Zod on every API body (extra fields rejected); per-question-type
  answer-format checks; business-ID shape only at answer time.
- **Identity:** unknown customer/asset/application checks before anything is locked.
- **Business rules:** the 6 eligibility rules in strict order (financed limits → age →
  residency → business ID → affordability → PEP).
- **State machine:** contract-status guards before every money-moving action
  (`pending_signature`, `already_settled`, `term_not_finished`/`already_over`), invoice
  status before payment.
- **Balance:** credit-ledger balance checked before it's spent.
- **Concurrency:** a DB unique constraint plus in-transaction re-check on invoice
  issuance; a unique constraint plus race catch on application-based signing;
  compare-and-swap status updates (`updateMany` with the expected status, success only if
  one row changed) for every asset reservation and contract settlement, inside the same
  transaction as the related change, mapped to `409` when lost.
