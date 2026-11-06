import { beforeAll, describe, expect, it } from 'vitest';
import { loadVatRates } from '@/data/load';
import type { VatRates } from '@/data/schemas';
import { buildInvoiceSchedule } from './invoicing';

let vatRates: VatRates;
beforeAll(async () => {
  vatRates = await loadVatRates();
});

describe('buildInvoiceSchedule', () => {
  it('builds the first 3 invoices for scenario card 1 (ebike-003, 36 months, 5 Nov 2026)', () => {
    const result = buildInvoiceSchedule(vatRates, {
      startDate: '2026-11-05',
      termMonths: 36,
      monthlyNetRentCents: 10_730,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invoices).toHaveLength(36);
    expect(result.invoices.slice(0, 3)).toEqual([
      {
        sequenceNumber: 1,
        invoiceDate: '2026-11-05',
        paymentDeadline: '2026-11-19',
        netCents: 10_730,
        vatRatePercent: 25.5,
        vatCents: 2_736,
        grossCents: 13_466,
      },
      {
        sequenceNumber: 2,
        invoiceDate: '2026-12-05',
        paymentDeadline: '2026-12-19',
        netCents: 10_730,
        vatRatePercent: 25.5,
        vatCents: 2_736,
        grossCents: 13_466,
      },
      {
        sequenceNumber: 3,
        invoiceDate: '2027-01-05',
        paymentDeadline: '2027-01-19',
        netCents: 10_730,
        vatRatePercent: 26,
        vatCents: 2_790,
        grossCents: 13_520,
      },
    ]);
  });

  it('changes the VAT line but not the net rent across the Jan 2027 rate change (scenario card 3)', () => {
    const result = buildInvoiceSchedule(vatRates, {
      startDate: '2026-09-15',
      termMonths: 24,
      monthlyNetRentCents: 5_000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const decemberInvoice = result.invoices.find((invoice) => invoice.invoiceDate === '2026-12-15');
    const januaryInvoice = result.invoices.find((invoice) => invoice.invoiceDate === '2027-01-15');

    expect(decemberInvoice).toMatchObject({
      netCents: 5_000,
      vatRatePercent: 25.5,
      vatCents: 1_275,
    });
    expect(januaryInvoice).toMatchObject({ netCents: 5_000, vatRatePercent: 26, vatCents: 1_300 });
  });

  it('clamps invoice dates across February in both a common and a leap year (scenario card 4)', () => {
    const result = buildInvoiceSchedule(vatRates, {
      startDate: '2026-01-31',
      termMonths: 36,
      monthlyNetRentCents: 1_000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invoices.at(1)?.invoiceDate).toBe('2026-02-28'); // common year
    expect(result.invoices.at(25)?.invoiceDate).toBe('2028-02-29'); // leap year
  });

  it('keeps the net lines summing exactly to monthlyNetRentCents * termMonths', () => {
    const result = buildInvoiceSchedule(vatRates, {
      startDate: '2026-03-15',
      termMonths: 48,
      monthlyNetRentCents: 7_777,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const totalNet = result.invoices.reduce((sum, invoice) => sum + invoice.netCents, 0);
    expect(totalNet).toBe(7_777 * 48);
  });

  it('gives every invoice a payment deadline 14 days after its invoice date', () => {
    const result = buildInvoiceSchedule(vatRates, {
      startDate: '2026-11-20',
      termMonths: 1,
      monthlyNetRentCents: 1_000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invoices[0]).toMatchObject({
      invoiceDate: '2026-11-20',
      paymentDeadline: '2026-12-04',
    });
  });

  it('reports a date with no VAT rate', () => {
    const result = buildInvoiceSchedule(vatRates, {
      startDate: '1999-01-01',
      termMonths: 1,
      monthlyNetRentCents: 1_000,
    });
    expect(result).toEqual({ ok: false, reason: 'no_vat_rate_on_date' });
  });
});
