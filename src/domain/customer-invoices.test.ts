import { describe, expect, it } from 'vitest';
import { listInvoicesByInvoiceDate } from './customer-invoices';

const invoice = (sequenceNumber: number, invoiceDate: string) => ({ sequenceNumber, invoiceDate });

describe('listInvoicesByInvoiceDate', () => {
  it('returns nothing when there are no leases', () => {
    expect(listInvoicesByInvoiceDate([])).toEqual([]);
  });

  it('returns nothing when the leases have no invoices yet', () => {
    expect(listInvoicesByInvoiceDate([{ lease: { id: 'a' }, invoices: [] }])).toEqual([]);
  });

  it('puts the newest invoice date first, across leases', () => {
    const rows = listInvoicesByInvoiceDate([
      { lease: { id: 'a' }, invoices: [invoice(2, '2026-11-05'), invoice(1, '2026-10-05')] },
      { lease: { id: 'b' }, invoices: [invoice(1, '2026-10-20')] },
    ]);
    expect(rows.map((row) => [row.lease.id, row.invoice.invoiceDate])).toEqual([
      ['a', '2026-11-05'],
      ['b', '2026-10-20'],
      ['a', '2026-10-05'],
    ]);
  });

  it('orders same-day invoices by lease id, whatever order the leases came in', () => {
    const leases = [
      { lease: { id: 'b' }, invoices: [invoice(1, '2026-11-05')] },
      { lease: { id: 'a' }, invoices: [invoice(1, '2026-11-05')] },
    ];
    expect(listInvoicesByInvoiceDate(leases).map((row) => row.lease.id)).toEqual(['a', 'b']);
    expect(listInvoicesByInvoiceDate(leases.toReversed()).map((row) => row.lease.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('orders same-day invoices of one lease with the later one first', () => {
    const rows = listInvoicesByInvoiceDate([
      { lease: { id: 'a' }, invoices: [invoice(3, '2026-11-05'), invoice(4, '2026-11-05')] },
    ]);
    expect(rows.map((row) => row.invoice.sequenceNumber)).toEqual([4, 3]);
  });

  it('does not change what it was given', () => {
    const invoices = [invoice(1, '2026-10-05'), invoice(2, '2026-11-05')];
    listInvoicesByInvoiceDate([{ lease: { id: 'a' }, invoices }]);
    expect(invoices.map((entry) => entry.sequenceNumber)).toEqual([1, 2]);
  });
});
