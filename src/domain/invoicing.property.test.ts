// Property-based tests for the invoice schedule (CHALLENGE.md Smart Problem #5, "Money
// that adds up": "every invoice must be rounded, yet all invoices must add up exactly to
// the contract total" — the gold standard it names is thousands of random contracts, not
// a handful of hand-picked ones (see invoicing.test.ts for those).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { VatRates } from '@/data/schemas';
import { buildInvoiceSchedule } from './invoicing';

// A fixed, always-valid rate table so every generated date in this file's range
// (2015-01-01 to the start of 2035, well within 2013-01-01..no end) resolves — the
// property under test is the schedule's own arithmetic, not vat.ts's date lookup
// (invoicing.test.ts already covers that with the real data pack).
const vatRates: VatRates = {
  country: 'FI',
  note: 'fixed rate for property testing',
  rates: [{ rate_percent: 25.5, valid_from: '2013-01-01', valid_to: null }],
};

const isoDate = fc
  .date({
    min: new Date('2015-01-01T00:00:00Z'),
    max: new Date('2035-01-01T00:00:00Z'),
    noInvalidDate: true,
  })
  .map((date) => date.toISOString().slice(0, 10));

const contractArbitrary = fc.record({
  startDate: isoDate,
  termMonths: fc.integer({ min: 1, max: 60 }),
  monthlyNetRentCents: fc.integer({ min: 0, max: 100_000_000 }),
});

describe('buildInvoiceSchedule (property-based)', () => {
  it('always produces exactly termMonths invoices whose net lines sum to the contract total', () => {
    fc.assert(
      fc.property(contractArbitrary, (input) => {
        const result = buildInvoiceSchedule(vatRates, input);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.invoices).toHaveLength(input.termMonths);
        const totalNetCents = result.invoices.reduce((sum, invoice) => sum + invoice.netCents, 0);
        expect(totalNetCents).toBe(input.monthlyNetRentCents * input.termMonths);
      }),
      { numRuns: 2000 }
    );
  });

  it('numbers invoices 1..termMonths in order, with strictly increasing due dates', () => {
    fc.assert(
      fc.property(contractArbitrary, (input) => {
        const result = buildInvoiceSchedule(vatRates, input);
        if (!result.ok) return;

        result.invoices.forEach((invoice, index) => {
          expect(invoice.sequenceNumber).toBe(index + 1);
          if (index > 0) {
            expect(invoice.invoiceDate > result.invoices[index - 1]!.invoiceDate).toBe(true);
          }
        });
      }),
      { numRuns: 2000 }
    );
  });

  it('every invoice is internally consistent: gross = net + vat, vat rounded half up', () => {
    fc.assert(
      fc.property(contractArbitrary, (input) => {
        const result = buildInvoiceSchedule(vatRates, input);
        if (!result.ok) return;

        for (const invoice of result.invoices) {
          expect(invoice.netCents).toBe(input.monthlyNetRentCents);
          expect(invoice.grossCents).toBe(invoice.netCents + invoice.vatCents);
          expect(invoice.vatCents).toBe(
            Math.round((invoice.netCents * invoice.vatRatePercent) / 100)
          );
          expect(Number.isInteger(invoice.netCents)).toBe(true);
          expect(Number.isInteger(invoice.vatCents)).toBe(true);
          expect(Number.isInteger(invoice.grossCents)).toBe(true);
        }
      }),
      { numRuns: 2000 }
    );
  });

  it('each due date is exactly its payment deadline minus the fixed payment term', () => {
    fc.assert(
      fc.property(contractArbitrary, (input) => {
        const result = buildInvoiceSchedule(vatRates, input);
        if (!result.ok) return;

        for (const invoice of result.invoices) {
          const dueMs = Date.parse(invoice.invoiceDate);
          const deadlineMs = Date.parse(invoice.paymentDeadline);
          expect((deadlineMs - dueMs) / (24 * 60 * 60 * 1000)).toBe(14);
        }
      }),
      { numRuns: 2000 }
    );
  });
});
