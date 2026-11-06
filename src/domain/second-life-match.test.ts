import { beforeAll, describe, expect, it } from 'vitest';
import { loadSecondLifeDemand } from '@/data/load';
import type { SecondLifeRequest } from '@/data/schemas';
import {
  decideSecondLifeOutcome,
  isEligibleForSecondLife,
  rankSecondLifeCandidates,
  type SecondLifeOffer,
} from './second-life-match';

let requests: readonly SecondLifeRequest[];
beforeAll(async () => {
  requests = await loadSecondLifeDemand();
});

function request(id: string): SecondLifeRequest {
  const found = requests.find((r) => r.id === id);
  if (!found) throw new Error(`setup: no request ${id} in the data pack`);
  return found;
}

describe('isEligibleForSecondLife', () => {
  const offer: SecondLifeOffer = { category: 'e_bike', condition: 'good', asOfDate: '2026-11-05' };

  it('rejects a different category', () => {
    expect(isEligibleForSecondLife(request('wait-06'), offer, 1000)).toBe(false);
  });

  it('rejects a condition worse than the request will accept', () => {
    const wait03 = request('wait-03'); // min_condition: like_new
    expect(isEligibleForSecondLife(wait03, offer, 1000)).toBe(false);
    expect(isEligibleForSecondLife(wait03, { ...offer, condition: 'like_new' }, 1000)).toBe(true);
  });

  it('rejects a passed deadline', () => {
    const wait05 = request('wait-05'); // needed_by: 2026-11-08
    expect(isEligibleForSecondLife(wait05, { ...offer, asOfDate: '2026-11-09' }, 1000)).toBe(false);
    expect(isEligibleForSecondLife(wait05, { ...offer, asOfDate: '2026-11-08' }, 1000)).toBe(true);
  });

  it('rejects a rent above budget, and an unquoteable term', () => {
    const wait01 = request('wait-01'); // max_monthly_net_rent_cents: 4500
    expect(isEligibleForSecondLife(wait01, offer, 4501)).toBe(false);
    expect(isEligibleForSecondLife(wait01, offer, undefined)).toBe(false);
    expect(isEligibleForSecondLife(wait01, offer, 4500)).toBe(true);
  });
});

describe('rankSecondLifeCandidates', () => {
  it('ranks by total revenue, highest first', () => {
    const offer: SecondLifeOffer = {
      category: 'e_bike',
      condition: 'good',
      asOfDate: '2026-11-05',
    };
    // At this rent, every 24-month candidate (wait-04, wait-13) outearns every 12-month
    // one (wait-02, wait-05): 24 months of rent beats 12, so a 24-month request leads.
    const result = rankSecondLifeCandidates(requests, offer, { 12: 9000, 24: 9000 });
    expect(result[0]!.totalRevenueCents).toBe(9000 * 24);
    expect(requests.find((r) => r.id === result[0]!.request.id)!.preferred_term_months).toBe(24);
  });

  it("breaks an exact tie by list order (wait-06 before wait-14, 'signed up one day later')", () => {
    const offer: SecondLifeOffer = {
      category: 'laptop',
      condition: 'good',
      asOfDate: '2026-11-05',
    };
    // wait-06 and wait-14 are identical: same budget, condition, term, deadline.
    const result = rankSecondLifeCandidates(requests, offer, { 24: 2500 });
    const ids = result.map((m) => m.request.id);
    expect(ids.indexOf('wait-06')).toBeLessThan(ids.indexOf('wait-14'));
    expect(result[0]!.totalRevenueCents).toBe(result[1]!.totalRevenueCents);
  });

  it('excludes requests that are not eligible', () => {
    const offer: SecondLifeOffer = {
      category: 'e_bike',
      condition: 'fair',
      asOfDate: '2026-11-05',
    };
    // wait-13 needs at least 'good'; only wait-02 accepts 'fair' (scenario card 9's setup).
    const result = rankSecondLifeCandidates(requests, offer, { 12: 9000, 24: 9000 });
    expect(result.map((m) => m.request.id)).toEqual(['wait-02']);
  });
});

describe('decideSecondLifeOutcome', () => {
  let asIsMatch: { request: SecondLifeRequest; rentCents: number; totalRevenueCents: number };
  let refurbMatch: { request: SecondLifeRequest; rentCents: number; totalRevenueCents: number };
  beforeAll(() => {
    asIsMatch = { request: request('wait-02'), rentCents: 9000, totalRevenueCents: 9000 * 12 };
    refurbMatch = { request: request('wait-13'), rentCents: 9000, totalRevenueCents: 9000 * 24 };
  });

  it('refurbishes when the unlocked match earns more, net of the cost', () => {
    // Without: 108000. With: 216000 - 50000 = 166000 > 108000.
    expect(decideSecondLifeOutcome(asIsMatch, refurbMatch, 50_000)).toBe('refurbish');
  });

  it('stays as-is when refurbishing costs more than it earns', () => {
    // Without: 108000. With: 216000 - 150000 = 66000 < 108000.
    expect(decideSecondLifeOutcome(asIsMatch, refurbMatch, 150_000)).toBe('as_is');
  });

  it('stays as-is on an exact tie', () => {
    // Without: 108000. With: 216000 - 108000 = 108000, not strictly more.
    expect(decideSecondLifeOutcome(asIsMatch, refurbMatch, 108_000)).toBe('as_is');
  });

  it('is no_match when neither path has an eligible candidate', () => {
    expect(decideSecondLifeOutcome(undefined, undefined, 50_000)).toBe('no_match');
  });

  it('refurbishes when only the refurbished path has any match at all', () => {
    expect(decideSecondLifeOutcome(undefined, refurbMatch, 50_000)).toBe('refurbish');
  });
});
