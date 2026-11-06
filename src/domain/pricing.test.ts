import { beforeAll, describe, expect, it } from 'vitest';
import { loadCoefficientTable, loadVatRates } from '@/data/load';
import type { CoefficientTable, VatRates } from '@/data/schemas';
import { quoteMonthlyRent } from './pricing';
import { buildInvoiceSchedule } from './invoicing';

let coefficientTable: CoefficientTable;
let vatRates: VatRates;
beforeAll(async () => {
  coefficientTable = await loadCoefficientTable();
  vatRates = await loadVatRates();
});

describe('quoteMonthlyRent', () => {
  it('rounds a half-cent VAT line up and quotes exactly what the first invoice charges', () => {
    const result = quoteMonthlyRent(coefficientTable, vatRates, {
      listPriceCents: 38_411,
      downPaymentCents: 0,
      termMonths: 36,
      quoteDate: '2026-11-05',
    });
    expect(result).toMatchObject({
      ok: true,
      quote: { monthlyNetRentCents: 1_100, monthlyRentWithVatCents: 1_381 },
    });
    if (!result.ok) throw new Error('expected a quote');
    const schedule = buildInvoiceSchedule(vatRates, {
      startDate: '2026-11-05',
      termMonths: 36,
      monthlyNetRentCents: result.quote.monthlyNetRentCents,
    });
    if (!schedule.ok) throw new Error('expected invoices');
    expect(result.quote.monthlyRentWithVatCents).toBe(schedule.invoices[0]!.grossCents);
  });

  it('reproduces the worked example in data/DATA.md', () => {
    const result = quoteMonthlyRent(coefficientTable, vatRates, {
      listPriceCents: 389_000,
      downPaymentCents: 0,
      termMonths: 36,
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
        totalCostWithVatCents: 13_466 * 36,
      },
    });
  });

  it('finances the list price minus the down payment', () => {
    const result = quoteMonthlyRent(coefficientTable, vatRates, {
      listPriceCents: 389_000,
      downPaymentCents: 89_000,
      termMonths: 36,
      quoteDate: '2026-11-05',
    });
    expect(result).toMatchObject({ ok: true, quote: { financedCents: 300_000 } });
  });

  it('the total cost is the down payment plus every VAT-included monthly rent, not the buyout', () => {
    const result = quoteMonthlyRent(coefficientTable, vatRates, {
      listPriceCents: 389_000,
      downPaymentCents: 89_000,
      termMonths: 36,
      quoteDate: '2026-11-05',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote.totalCostWithVatCents).toBe(
      result.quote.downPaymentCents + result.quote.monthlyRentWithVatCents * 36
    );
  });

  it('charges the VAT rate on the quote date, not a later or earlier one', () => {
    const result = quoteMonthlyRent(coefficientTable, vatRates, {
      listPriceCents: 389_000,
      downPaymentCents: 0,
      termMonths: 36,
      quoteDate: '2027-01-01',
    });
    expect(result).toMatchObject({ ok: true, quote: { vatRatePercent: 26.0 } });
  });

  it('rejects a negative down payment', () => {
    const result = quoteMonthlyRent(coefficientTable, vatRates, {
      listPriceCents: 389_000,
      downPaymentCents: -1,
      termMonths: 36,
      quoteDate: '2026-11-05',
    });
    expect(result).toEqual({ ok: false, reason: 'down_payment_negative' });
  });

  it('rejects a down payment bigger than the list price', () => {
    const result = quoteMonthlyRent(coefficientTable, vatRates, {
      listPriceCents: 389_000,
      downPaymentCents: 389_001,
      termMonths: 36,
      quoteDate: '2026-11-05',
    });
    expect(result).toEqual({ ok: false, reason: 'down_payment_exceeds_list_price' });
  });

  it('allows a down payment equal to the whole list price (financed amount of zero)', () => {
    const result = quoteMonthlyRent(coefficientTable, vatRates, {
      listPriceCents: 389_000,
      downPaymentCents: 389_000,
      termMonths: 36,
      quoteDate: '2026-11-05',
    });
    expect(result).toEqual({ ok: false, reason: 'below_minimum' });
  });

  it('passes through a term the coefficient table does not have', () => {
    const result = quoteMonthlyRent(coefficientTable, vatRates, {
      listPriceCents: 389_000,
      downPaymentCents: 0,
      termMonths: 18,
      quoteDate: '2026-11-05',
    });
    expect(result).toEqual({ ok: false, reason: 'unknown_term' });
  });

  it('passes through a financed amount outside every band', () => {
    const result = quoteMonthlyRent(coefficientTable, vatRates, {
      listPriceCents: 10_000,
      downPaymentCents: 0,
      termMonths: 36,
      quoteDate: '2026-11-05',
    });
    expect(result).toEqual({ ok: false, reason: 'below_minimum' });
  });

  it('reports a date with no VAT rate', () => {
    const result = quoteMonthlyRent(coefficientTable, vatRates, {
      listPriceCents: 389_000,
      downPaymentCents: 0,
      termMonths: 36,
      quoteDate: '1999-01-01',
    });
    expect(result).toEqual({ ok: false, reason: 'no_vat_rate_on_date' });
  });

  it('throws on a fraction of a cent, because that is a bug in the caller', () => {
    expect(() =>
      quoteMonthlyRent(coefficientTable, vatRates, {
        listPriceCents: 389_000.5,
        downPaymentCents: 0,
        termMonths: 36,
        quoteDate: '2026-11-05',
      })
    ).toThrow(RangeError);
  });
});
