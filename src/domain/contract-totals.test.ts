import { describe, expect, it } from 'vitest';
import { contractTotals } from './contract-totals';

describe('contractTotals', () => {
  it('adds the down payment and original net rents, and only paid gross invoices', () => {
    expect(
      contractTotals({
        downPaymentCents: 5000,
        monthlyNetRentCents: 1001,
        termMonths: 12,
        invoices: [
          { status: 'paid', grossCents: 1256 },
          { status: 'paid', grossCents: 400 },
          { status: 'issued', grossCents: 1256 },
          { status: 'cancelled', grossCents: 1256 },
        ],
      })
    ).toEqual({ agreedNetCents: 17012, paidInvoicesCents: 1656 });
  });

  it('handles no down payment or paid invoices', () => {
    expect(
      contractTotals({ downPaymentCents: 0, monthlyNetRentCents: 100, termMonths: 1, invoices: [] })
    ).toEqual({ agreedNetCents: 100, paidInvoicesCents: 0 });
  });
});
