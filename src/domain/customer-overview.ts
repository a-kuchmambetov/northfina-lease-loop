// What a customer's account page shows about their leases: which group a contract belongs
// to, when an active lease ends, and which invoice comes next. Pure: the caller passes in
// the contract, the VAT rates and today's date.
import type { VatRates } from '@/data/schemas';
import { termEndDate } from './end-of-term';
import { buildInvoiceSchedule, type Invoice, type InvoiceScheduleInput } from './invoicing';

export const overviewViews = ['all', 'applications', 'active', 'past'] as const;
export type OverviewView = (typeof overviewViews)[number];

/** Reads the page's `?view=` value. Anything unknown shows everything. */
export function overviewView(value: unknown): OverviewView {
  return overviewViews.find((view) => view === value) ?? 'all';
}

/** Ongoing contracts include those awaiting signature. A contract stays here until it is
 *  settled, even after its term has run out; an extension continues as a new contract. */
export function leaseGroup(contractStatus: string): 'active' | 'past' {
  return contractStatus === 'active' || contractStatus === 'pending_signature' ? 'active' : 'past';
}

/** The first invoice dated on or after `today`, or `null` once none is left. */
export function nextInvoiceOn(invoices: readonly Invoice[], today: string): Invoice | null {
  return invoices.find((invoice) => invoice.invoiceDate >= today) ?? null;
}

export type LeaseSchedule = {
  endDate: string;
  termOver: boolean;
  nextInvoice: Pick<Invoice, 'invoiceDate' | 'grossCents'> | null;
};

/** Where a lease stands on `today`. The next invoice is left out, rather than the lease
 *  failing, when the VAT rates don't cover it. Unsigned contracts have no upcoming invoice
 *  or end-of-term actions, even if their planned end date has passed. */
export function leaseSchedule(
  vatRates: VatRates,
  lease: InvoiceScheduleInput,
  today: string,
  contractStatus = 'active'
): LeaseSchedule {
  const endDate = termEndDate(lease.startDate, lease.termMonths);
  if (contractStatus === 'pending_signature') {
    return { endDate, termOver: false, nextInvoice: null };
  }
  const schedule = buildInvoiceSchedule(vatRates, lease);
  const next = schedule.ok ? nextInvoiceOn(schedule.invoices, today) : null;
  return {
    endDate,
    termOver: today >= endDate,
    nextInvoice: next && { invoiceDate: next.invoiceDate, grossCents: next.grossCents },
  };
}

/** Whether a lease's invoices were charged at more than one VAT rate. When they were, the
 *  invoice page explains why the totals differ while the net rent stayed locked. */
export function hasVatRateChange(invoices: readonly Pick<Invoice, 'vatRatePercent'>[]): boolean {
  return new Set(invoices.map((invoice) => invoice.vatRatePercent)).size > 1;
}
