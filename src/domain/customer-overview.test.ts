import { beforeAll, describe, expect, it } from 'vitest';
import { loadVatRates } from '@/data/load';
import type { VatRates } from '@/data/schemas';
import {
  hasVatRateChange,
  leaseGroup,
  leaseSchedule,
  nextInvoiceOn,
  overviewView,
} from './customer-overview';
import { buildInvoiceSchedule } from './invoicing';

let vatRates: VatRates;
beforeAll(async () => {
  vatRates = await loadVatRates();
});

const lease = { startDate: '2026-11-05', termMonths: 12, monthlyNetRentCents: 10730 };

describe('overviewView', () => {
  it('accepts the known views', () => {
    expect(overviewView('applications')).toBe('applications');
    expect(overviewView('active')).toBe('active');
    expect(overviewView('past')).toBe('past');
  });

  it.each([undefined, '', 'ACTIVE', 'nope', ['active']])('falls back to all for %j', (value) => {
    expect(overviewView(value)).toBe('all');
  });
});

describe('leaseGroup', () => {
  it('keeps contracts awaiting signature in the ongoing group', () => {
    expect(leaseGroup('pending_signature')).toBe('active');
  });

  it('keeps only unsettled contracts active', () => {
    expect(leaseGroup('active')).toBe('active');
    for (const status of ['bought', 'returned', 'extended']) {
      expect(leaseGroup(status)).toBe('past');
    }
  });
});

describe('nextInvoiceOn', () => {
  function invoices() {
    const schedule = buildInvoiceSchedule(vatRates, lease);
    if (!schedule.ok) throw new Error(schedule.reason);
    return schedule.invoices;
  }

  it('counts an invoice dated today as the next one', () => {
    expect(nextInvoiceOn(invoices(), '2026-12-05')?.sequenceNumber).toBe(2);
  });

  it('moves on the day after', () => {
    expect(nextInvoiceOn(invoices(), '2026-12-06')?.sequenceNumber).toBe(3);
  });

  it('has nothing left after the last invoice', () => {
    expect(nextInvoiceOn(invoices(), '2027-10-06')).toBeNull();
    expect(nextInvoiceOn([], '2026-11-05')).toBeNull();
  });
});

describe('leaseSchedule', () => {
  it.each(['2026-11-06', '2027-11-05', '2028-01-01'])(
    'offers no invoice or end-of-term actions while awaiting signature on %s',
    (today) => {
      expect(leaseSchedule(vatRates, lease, today, 'pending_signature')).toEqual({
        endDate: '2027-11-05',
        termOver: false,
        nextInvoice: null,
      });
    }
  );

  it('ends the term months after the start', () => {
    expect(leaseSchedule(vatRates, lease, '2026-11-06').endDate).toBe('2027-11-05');
  });

  it('charges the VAT rate of the next invoice, not of today', () => {
    expect(leaseSchedule(vatRates, lease, '2026-12-06').nextInvoice).toEqual({
      invoiceDate: '2027-01-05',
      grossCents: 13520, // 10730 + 26 % VAT; the 25.5 % rate of December would give 13466
    });
  });

  it('treats the end date itself as the term being over', () => {
    expect(leaseSchedule(vatRates, lease, '2027-11-04').termOver).toBe(false);
    expect(leaseSchedule(vatRates, lease, '2027-11-05').termOver).toBe(true);
  });

  it('clamps the end date like the invoices do', () => {
    const endDate = leaseSchedule(
      vatRates,
      { ...lease, startDate: '2027-01-31', termMonths: 13 },
      '2027-02-01'
    ).endDate;
    expect(endDate).toBe('2028-02-29');
  });

  it('leaves the next invoice out when no VAT rate covers it', () => {
    const summary = leaseSchedule(vatRates, { ...lease, startDate: '1990-01-01' }, '1990-01-01');
    expect(summary.nextInvoice).toBeNull();
    expect(summary.endDate).toBe('1991-01-01');
  });
});

describe('hasVatRateChange', () => {
  it('is false for no invoices, one invoice, or one rate throughout', () => {
    expect(hasVatRateChange([])).toBe(false);
    expect(hasVatRateChange([{ vatRatePercent: 25.5 }])).toBe(false);
    expect(hasVatRateChange([{ vatRatePercent: 25.5 }, { vatRatePercent: 25.5 }])).toBe(false);
  });

  it('is true once two invoices have different rates', () => {
    expect(hasVatRateChange([{ vatRatePercent: 25.5 }, { vatRatePercent: 26 }])).toBe(true);
  });

  it('sees the 1 Jan 2027 rate change in a lease that spans it', () => {
    const schedule = buildInvoiceSchedule(vatRates, {
      startDate: '2026-11-05',
      termMonths: 12,
      monthlyNetRentCents: 10730,
    });
    if (!schedule.ok) throw new Error(schedule.reason);
    expect(hasVatRateChange(schedule.invoices)).toBe(true);
    expect(hasVatRateChange(schedule.invoices.filter((i) => i.invoiceDate < '2027-01-01'))).toBe(
      false
    );
  });
});
