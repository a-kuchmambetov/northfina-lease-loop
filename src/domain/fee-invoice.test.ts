import { beforeAll, describe, expect, it } from 'vitest';
import { loadVatRates } from '@/data/load';
import type { VatRates } from '@/data/schemas';
import { buildFeeInvoice, feeInvoiceSequenceNumber } from './fee-invoice';

let vatRates: VatRates;
beforeAll(async () => {
  vatRates = await loadVatRates();
});

describe('buildFeeInvoice', () => {
  it('adds the VAT of the return day to the net fee and is due that day', () => {
    // 25.5 % in 2026: 10000 x 25.5 % = 2550.
    expect(buildFeeInvoice(vatRates, { feeCents: 10_000, returnDate: '2026-12-15' })).toEqual({
      ok: true,
      invoice: {
        invoiceDate: '2026-12-15',
        paymentDeadline: '2026-12-29',
        netCents: 10_000,
        vatRatePercent: 25.5,
        vatCents: 2_550,
        grossCents: 12_550,
      },
    });
  });

  it('uses the new rate from 1 Jan 2027 and the old one on 31 Dec 2026', () => {
    const before = buildFeeInvoice(vatRates, { feeCents: 10_000, returnDate: '2026-12-31' });
    const after = buildFeeInvoice(vatRates, { feeCents: 10_000, returnDate: '2027-01-01' });

    expect(before).toMatchObject({ ok: true, invoice: { vatRatePercent: 25.5, vatCents: 2_550 } });
    expect(after).toMatchObject({ ok: true, invoice: { vatRatePercent: 26, vatCents: 2_600 } });
  });

  it('gives a payment deadline that crosses a month and a year end', () => {
    expect(buildFeeInvoice(vatRates, { feeCents: 100, returnDate: '2026-12-25' })).toMatchObject({
      ok: true,
      invoice: { paymentDeadline: '2027-01-08' },
    });
  });

  it('rounds the VAT once, half a cent up, and the total is exactly net plus VAT', () => {
    // 3 x 25.5 % = 0.765 -> 1; 2 x 25.5 % = 0.51 -> 1; 1 x 25.5 % = 0.255 -> 0.
    const cases: [number, number][] = [
      [3, 1],
      [2, 1],
      [1, 0],
      [199, 51], // 50.745 -> 51
    ];
    for (const [feeCents, vatCents] of cases) {
      expect(buildFeeInvoice(vatRates, { feeCents, returnDate: '2026-12-15' })).toMatchObject({
        ok: true,
        invoice: { vatCents, grossCents: feeCents + vatCents },
      });
    }
  });

  it.each([0, -1, 12.5, Number.NaN])('has nothing to invoice for a fee of %s', (feeCents) => {
    expect(buildFeeInvoice(vatRates, { feeCents, returnDate: '2026-12-15' })).toEqual({
      ok: false,
      reason: 'no_fee_to_invoice',
    });
  });

  it('fails when no VAT rate covers the day', () => {
    expect(buildFeeInvoice(vatRates, { feeCents: 100, returnDate: '1900-01-01' })).toEqual({
      ok: false,
      reason: 'no_vat_rate_on_date',
    });
  });
});

describe('feeInvoiceSequenceNumber', () => {
  it('comes after the last rent invoice of the term', () => {
    expect(feeInvoiceSequenceNumber(36)).toBe(37);
    expect(feeInvoiceSequenceNumber(12)).toBe(13);
  });
});
