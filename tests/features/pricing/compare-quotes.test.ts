// Mirrors src/server/features/pricing/compare-quotes.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here instead of
// next to the code. Runs against the real data pack.
import { describe, expect, it } from 'vitest';
import { getPriceQuoteComparison } from '@/server/features/pricing/compare-quotes';

describe('getPriceQuoteComparison', () => {
  it('quotes ebike-003 at every term the coefficient table offers', async () => {
    const result = await getPriceQuoteComparison({
      assetId: 'ebike-003',
      downPaymentCents: 0,
      quoteDate: '2026-11-05',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.priceListVersion).toBe(1);
    expect(result.quotes.map((q) => q.termMonths)).toEqual([12, 24, 36, 48]);

    // The worked example in data/DATA.md, for the 36-month row of the same comparison.
    const row36 = result.quotes.find((q) => q.termMonths === 36)!;
    expect(row36).toMatchObject({
      ok: true,
      quote: { monthlyNetRentCents: 10_730, buyoutCents: 58_350, monthlyRentWithVatCents: 13_466 },
    });

    // A longer term should cost less per month (the whole point of a side-by-side compare).
    const row12 = result.quotes.find((q) => q.termMonths === 12)!;
    const row48 = result.quotes.find((q) => q.termMonths === 48)!;
    if (row12.ok && row48.ok) {
      expect(row48.quote.monthlyRentWithVatCents).toBeLessThan(row12.quote.monthlyRentWithVatCents);
    }
  });

  it('rejects an unknown asset', async () => {
    const result = await getPriceQuoteComparison({
      assetId: 'ebike-does-not-exist',
      downPaymentCents: 0,
      quoteDate: '2026-11-05',
    });
    expect(result).toEqual({ ok: false, reason: 'unknown_asset' });
  });

  it('marks a term the item is too cheap for as not ok, without failing the whole comparison', async () => {
    // ebike-010 (28900 cents) is below the coefficient table's minimum financed amount
    // (30000) at every term with no down payment — data/DATA.md's "too cheap to lease" trap.
    const result = await getPriceQuoteComparison({
      assetId: 'ebike-010',
      downPaymentCents: 0,
      quoteDate: '2026-11-05',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quotes.every((q) => !q.ok)).toBe(true);
    expect(result.quotes.every((q) => !q.ok && q.reason === 'below_minimum')).toBe(true);
  });
});
