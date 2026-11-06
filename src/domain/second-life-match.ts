// Matching a returned item to the waiting list (CHALLENGE.md Smart Problem #3): who is
// eligible, who wins when more than one person qualifies, and whether refurbishing the
// item first is worth it. Pricing itself (what rent a term/list-price combination gets) is
// computed by the caller with src/domain/pricing.ts and passed in here as plain numbers —
// this file only decides, it does not price.
import type { AssetCategory, AssetCondition, SecondLifeRequest } from '@/data/schemas';
import { conditionRank } from './wear';

export type SecondLifeOffer = {
  category: AssetCategory;
  condition: AssetCondition;
  /** `YYYY-MM-DD`. A request whose `needed_by` has already passed is not eligible. */
  asOfDate: string;
};

export type SecondLifeMatch = {
  request: SecondLifeRequest;
  rentCents: number;
  totalRevenueCents: number;
};

/** Whether `request` could be served by `offer` at `rentCents` (the monthly net rent
 *  already quoted for `request.preferred_term_months`; `undefined` if that term could not
 *  be quoted at all, e.g. below the coefficient table's minimum). */
export function isEligibleForSecondLife(
  request: SecondLifeRequest,
  offer: SecondLifeOffer,
  rentCents: number | undefined
): boolean {
  return (
    request.category === offer.category &&
    conditionRank(offer.condition) <= conditionRank(request.min_condition) &&
    offer.asOfDate <= request.needed_by &&
    rentCents !== undefined &&
    rentCents <= request.max_monthly_net_rent_cents
  );
}

/**
 * Every eligible request, ranked by the revenue it would bring (monthly rent × its own
 * preferred term) — highest first. Ties (CHALLENGE.md: "two people on the list have the
 * same needs: who wins, and why?") go to whoever is earlier in `requests`: the data pack
 * has no signup-date field, so list order is this app's own documented stand-in for it
 * (`data/second-life-demand.json`'s `wait-06`/`wait-14` pair is worded "signed up one day
 * later", implying the order itself carries that meaning).
 */
export function rankSecondLifeCandidates(
  requests: readonly SecondLifeRequest[],
  offer: SecondLifeOffer,
  rentByTerm: Readonly<Record<number, number | undefined>>
): SecondLifeMatch[] {
  return requests
    .map((request, index) => ({
      request,
      index,
      rentCents: rentByTerm[request.preferred_term_months],
    }))
    .filter(({ request, rentCents }) => isEligibleForSecondLife(request, offer, rentCents))
    .map(({ request, index, rentCents }) => ({
      request,
      index,
      rentCents: rentCents!,
      totalRevenueCents: rentCents! * request.preferred_term_months,
    }))
    .sort((a, b) => b.totalRevenueCents - a.totalRevenueCents || a.index - b.index)
    .map(({ request, rentCents, totalRevenueCents }) => ({
      request,
      rentCents,
      totalRevenueCents,
    }));
}

export type SecondLifeOutcome = 'refurbish' | 'as_is' | 'no_match';

/**
 * Refurbishing to `'good'` (src/domain/refurbishment.ts) is worth it only if the best match
 * it unlocks earns more, net of its cost, than the best match available as-is. A tie keeps
 * the item as-is — no reason to spend money for the same result.
 */
export function decideSecondLifeOutcome(
  bestWithoutRefurb: SecondLifeMatch | undefined,
  bestWithRefurb: SecondLifeMatch | undefined,
  refurbishCostCents: number
): SecondLifeOutcome {
  const netValueWithoutRefurb = bestWithoutRefurb?.totalRevenueCents ?? 0;
  const netValueWithRefurb = (bestWithRefurb?.totalRevenueCents ?? 0) - refurbishCostCents;

  if (netValueWithRefurb > netValueWithoutRefurb) return 'refurbish';
  if (netValueWithoutRefurb > 0) return 'as_is';
  return 'no_match';
}
