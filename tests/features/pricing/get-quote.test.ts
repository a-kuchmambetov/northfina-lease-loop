// Mirrors src/server/features/pricing/get-quote.ts — see AGENTS.md and src/server/README.md
// for why tests for src/server/features/** live here instead of next to the code.
// Runs against the real data pack, so it also catches a changed data file.
import { describe, expect, it } from 'vitest';
import { getPriceQuote } from '@/server/features/pricing/get-quote';

describe('getPriceQuote', () => {
  it('reproduces the worked example in data/DATA.md', async () => {
    const result = await getPriceQuote({
      assetId: 'ebike-003',
      termMonths: 36,
      downPaymentCents: 0,
      quoteDate: '2026-11-05',
    });

    expect(result).toEqual({
      ok: true,
      quote: {
        listPriceCents: 389_000,
        downPaymentCents: 0,
        financedCents: 389_000,
        band: 'B',
        monthlyFactor: 0.027584,
        monthlyNetRentCents: 10_730,
        vatRatePercent: 25.5,
        monthlyRentWithVatCents: 13_466,
        buyoutCents: 58_350,
        priceListVersion: 1,
        totalCostWithVatCents: 13_466 * 36,
      },
    });
  });

  it('switches to price list 2 the day it starts', async () => {
    const result = await getPriceQuote({
      assetId: 'ebike-003',
      termMonths: 36,
      downPaymentCents: 0,
      quoteDate: '2026-11-06',
    });
    expect(result).toMatchObject({ ok: true, quote: { priceListVersion: 2 } });
  });

  it('rejects an asset that is not in the price list', async () => {
    const result = await getPriceQuote({
      assetId: 'nope',
      termMonths: 36,
      downPaymentCents: 0,
      quoteDate: '2026-11-05',
    });
    expect(result).toEqual({ ok: false, reason: 'unknown_asset' });
  });

  it('rejects a down payment bigger than the list price', () =>
    expect(
      getPriceQuote({
        assetId: 'ebike-003',
        termMonths: 36,
        downPaymentCents: 500_000,
        quoteDate: '2026-11-05',
      })
    ).resolves.toEqual({ ok: false, reason: 'down_payment_exceeds_list_price' }));

  it('passes through a term the coefficient table does not have', () =>
    expect(
      getPriceQuote({
        assetId: 'ebike-003',
        termMonths: 18,
        downPaymentCents: 0,
        quoteDate: '2026-11-05',
      })
    ).resolves.toEqual({ ok: false, reason: 'unknown_term' }));
});
