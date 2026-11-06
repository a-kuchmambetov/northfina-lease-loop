import { describe, expect, it } from 'vitest';
import { buildInvoiceDocument, invoiceNumber, type InvoiceDocumentInput } from './invoice-document';

const input: InvoiceDocumentInput = {
  contractId: '3f2a9c1d-0000-4000-8000-000000000000',
  sequenceNumber: 7,
  kind: 'rent',
  termMonths: 36,
  contractStartDate: '2026-11-05',
  assetName: 'Trek FX 2',
  customerName: 'Aino Virtanen',
  invoiceDate: '2027-05-05',
  paymentDeadline: '2027-05-19',
  netCents: 10_730,
  vatRatePercent: 26,
  vatCents: 2_790,
  grossCents: 13_520,
  status: 'issued',
  paidOn: null,
};

describe('invoiceNumber', () => {
  it('is the upper-cased start of the contract id and the padded sequence number', () => {
    expect(invoiceNumber('3f2a9c1d-0000-4000-8000-000000000000', 7)).toBe('3F2A9C1D-007');
  });

  it('keeps three digits up to the last invoice of the longest term', () => {
    expect(invoiceNumber('abcdef12-x', 1)).toBe('ABCDEF12-001');
    expect(invoiceNumber('abcdef12-x', 48)).toBe('ABCDEF12-048');
  });

  it('ends a fee invoice in FEE, whatever its sequence number', () => {
    expect(invoiceNumber('3f2a9c1d-0000', 37, 'early_return_fee')).toBe('3F2A9C1D-FEE');
    expect(invoiceNumber('3f2a9c1d-0000', 13, 'early_return_fee')).toBe('3F2A9C1D-FEE');
  });

  it('differs between invoices of one lease and between leases', () => {
    expect(invoiceNumber('aaaaaaaa-1', 1)).not.toBe(invoiceNumber('aaaaaaaa-1', 2));
    expect(invoiceNumber('aaaaaaaa-1', 1)).not.toBe(invoiceNumber('bbbbbbbb-1', 1));
  });
});

describe('buildInvoiceDocument', () => {
  it('returns the invoice as stored, with its number', () => {
    expect(buildInvoiceDocument(input)).toEqual({
      ok: true,
      document: { ...input, number: '3F2A9C1D-007' },
    });
  });

  it('keeps the kind, and numbers a fee invoice as one', () => {
    expect(
      buildInvoiceDocument({ ...input, kind: 'early_return_fee', sequenceNumber: 37 })
    ).toMatchObject({
      ok: true,
      document: { kind: 'early_return_fee', number: '3F2A9C1D-FEE' },
    });
  });

  it('keeps an expired invoice as expired', () => {
    expect(buildInvoiceDocument({ ...input, status: 'expired' })).toMatchObject({
      ok: true,
      document: { status: 'expired' },
    });
  });

  it('keeps a paid invoice and its paid date', () => {
    const result = buildInvoiceDocument({ ...input, status: 'paid', paidOn: '2027-05-06' });
    expect(result).toMatchObject({ ok: true, document: { status: 'paid', paidOn: '2027-05-06' } });
  });

  it('refuses amounts that do not add up, by one cent either way', () => {
    for (const grossCents of [13_519, 13_521]) {
      expect(buildInvoiceDocument({ ...input, grossCents })).toEqual({
        ok: false,
        reason: 'amounts_do_not_add_up',
      });
    }
  });
});
