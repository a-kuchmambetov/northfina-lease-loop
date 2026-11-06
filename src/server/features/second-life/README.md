# second-life: refurbish-or-not, waiting-list matchmaking and the passport (Spine #7, Smart Problem #3)

A returned item (`Asset.status === 'returned'`) has a condition and usage already assessed
at return time (`src/server/assets.ts`'s `writeAssetWearInTx`). This feature
decides what happens to it next: refurbish it to `'good'` or not, who on the waiting list
(`data/second-life-demand.json`) wins it, and at what rent — then writes that outcome. It
also reads an item's full history across lives, the Spine #7 bonus (scenario card 10).

## Data sources

| Source                          | What for                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| `Asset` row                     | Current condition/usage (already post-wear from the return itself)                      |
| Its `Contract` rows             | `list_price_cents`/`start_date` for pricing; the full ordered set for the passport      |
| `data/refurbishment-costs.json` | Cost to reach `'good'`, and the mandatory-regardless-of-condition costs                 |
| `data/residual-curves.json`     | What the item is worth today, as-is and if refurbished                                  |
| `data/coefficient-table.json`   | The monthly rent a given term/residual-value combination quotes to                      |
| `data/second-life-demand.json`  | Who is waiting, their budget, minimum condition, term and deadline                      |
| `data/co2-factors.json`         | Fictional, indicative manufacturing/avoided-car-km figures for the passport's CO2 total |

## Why this only recommends, and does not sign a contract

`data/second-life-demand.json`'s entries have no `customer_id` — there's no real customer
behind `wait-02` to sign a `Contract` for automatically. This feature decides the match
and updates the asset (condition, usage, back to `'available'`) and logs the decision;
actually leasing it to the winner needs a real `customerId` first — the winner signs up
and creates one via `POST /api/customers`
([`../customers/README.md`](../customers/README.md)) — then a separate, already-built
`POST /api/contracts` or `pass_on` call uses it.

A **different**, already-wired path exists for the organizers' own framing — "the item
moves directly to the next person... who starts a new lease (its second life)": `end-of-
term`'s `pass_on` action (CHALLENGE.md Spine #6) signs a brand new contract for a named
`nextCustomerId` straight away, skipping the queue this feature manages
([`../end-of-term/README.md`](../end-of-term/README.md)'s "Who `pass_on` goes to"). It
always takes a known customer, though — it does not look up the waiting list itself. A
caller that wants to honor `data/second-life-demand.json` calls `GET /api/assets/:id/
second-life-match` first to find the winner, then passes their id to `pass_on` — there is
no real `customer_id` behind a waiting-list entry for `pass_on` to use automatically.

## How the refurbish decision works

1. If the asset is already `'good'` or better, there is no refurbishment path to consider
   — only the as-is one.
2. Otherwise, `src/domain/refurbishment.ts`'s `refurbishToGoodCostCents` prices getting it
   to `'good'` (never further — `data/refurbishment-costs.json`'s own bar): every
   condition-ladder step from the current condition to `'good'`, plus every `fixed` cost
   whose `when` applies (`"always"`, a crossed `usage.value` threshold, or — for farm
   machinery's "per started 1000 engine hours since last service" — this app's own
   documented simplification: nothing tracks _when_ a machine was last serviced, so it
   charges for `ceil(usageValueBefore / 1000)` services off the item's whole lifetime
   usage every time).
3. For both paths (as-is, and refurbished-to-`'good'` if applicable), the item's residual
   value (`src/domain/residual-value.ts`) is priced at today's age/condition/usage, then
   quoted (`src/domain/pricing.ts`'s `quoteNetRent`) at every distinct
   `preferred_term_months` the waiting list actually asks for.
4. `src/domain/second-life-match.ts`'s `rankSecondLifeCandidates` filters each path's
   waiting-list requests to the eligible ones (category, condition floor, deadline,
   budget) and ranks them by total revenue (`rent × their own term`); ties go to whoever
   is earlier in `data/second-life-demand.json` — the file has no signup-date field, so
   list order is this app's documented stand-in for it (the `wait-06`/`wait-14` pair is
   explicitly worded "signed up one day later").
5. `decideSecondLifeOutcome` refurbishes only if the best match it unlocks earns more, net
   of the refurbishment cost, than the best match available as-is. A tie keeps the item
   as-is.

## What gets written

`resolve-second-life-match.ts` always sets the asset back to `'available'` — refurbished
or not, it's ready for its next lease either way — and writes one audit row:
`second_life.refurbished`, `second_life.matched_as_is`, or `second_life.no_match`, with the
winning candidate (if any), the quoted rent, and the full cost breakdown.

The write is a compare-and-swap from `'returned'`: if the asset was resolved or leased again
after the computation read it, nothing is written (no asset change, no audit row) and the
answer is `asset_status_conflict` (409), so a stale resolution can't reopen a leased asset.

## The passport (Spine #7 bonus, scenario card 10)

`get-asset-passport.ts` reads an asset's full history instead of deciding anything: every
`Contract` row for it, oldest first, is one "life". A life counts as refurbished into if a
`second_life.refurbished` audit row's timestamp falls between the previous life's signing
and this one's — the very first life is never "refurbished into" (there's no earlier life
to have come from).

CO2 saved (`src/domain/co2-impact.ts`, reading the explicitly fictional
`data/co2-factors.json`) is credited once per **second** life (every life after the
first): the full `manufacturing_new_kg` for that category if it was matched as-is, or that
figure discounted by `refurbishment_share_of_new` if it took a refurbishment to get there.
An e-bike additionally credits avoided car km off its **lifetime** km
(`Asset.lifetime_usage_value`). An asset keeps two usage counters: `usage_value` (since the
last `resets_usage` refurbishment, e.g. a battery replacement — feeds the market-value
usage adjustment and the next-replacement trigger) and `lifetime_usage_value` (total
odometer/hours — never reset, feeds this passport and the CO2 number). Wear
(`src/domain/wear.ts`) adds the same usage to both; only `usage_value` is zeroed by a reset.

Money saved follows the same "every life after the first" rule: CHALLENGE.md asks for
"money saved by second and third lives", and this app's own reading is each such life's
full contract revenue (`monthly_net_rent_cents × term_months`) — money the item earned
that it never would have if it had simply been scrapped after its first life, since there
is no money figure in the data pack for what a replacement new item would have cost.

## The fleet-wide total (Smart Problem #7's "for the whole fleet")

`get-fleet-impact.ts` runs `get-asset-passport.ts` for every asset and sums the two
totals — a direct, line-by-line rollup, not a separate calculation of its own.

## Files

| File                           | What it does                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `compute-second-life-match.ts` | The whole refurbish/match decision, with no writes — safe to call as a preview. |
| `resolve-second-life-match.ts` | Runs the above, then persists the asset's new state and the audit row.          |
| `get-asset-passport.ts`        | One asset's full life-by-life history, CO2 and money saved — read-only.         |
| `get-fleet-impact.ts`          | The same totals, summed across every asset.                                     |

## API routes that call these

| Route                                         | Calls                          |
| --------------------------------------------- | ------------------------------ |
| `GET /api/assets/:id/second-life-match?asOf=` | `compute-second-life-match.ts` |
| `POST /api/assets/:id/second-life-match`      | `resolve-second-life-match.ts` |
| `GET /api/assets/:id/passport`                | `get-asset-passport.ts`        |
| `GET /api/fleet/impact`                       | `get-fleet-impact.ts`          |

`asOf`/`asOfDate` default to `todayIso()`, same convention as every other feature.
