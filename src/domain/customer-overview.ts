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

/** A contract stays active until it is settled, even after its term has run out: bought,
 *  returned and extended contracts are finished, and an extension continues as a new one. */
export function leaseGroup(contractStatus: string): 'active' | 'past' {
  return contractStatus === 'active' ? 'active' : 'past';
}

/** The first invoice due on or after `today`, or `null` once none is left. */
export function nextInvoiceOn(invoices: readonly Invoice[], today: string): Invoice | null {
  return invoices.find((invoice) => invoice.dueDate >= today) ?? null;
}

export type LeaseSchedule = {
  endDate: string;
  termOver: boolean;
  nextInvoice: Pick<Invoice, 'dueDate' | 'grossCents'> | null;
};

/** Where a lease stands on `today`. The next invoice is left out, rather than the lease
 *  failing, when the VAT rates don't cover it. */
export function leaseSchedule(
  vatRates: VatRates,
  lease: InvoiceScheduleInput,
  today: string
): LeaseSchedule {
  const endDate = termEndDate(lease.startDate, lease.termMonths);
  const schedule = buildInvoiceSchedule(vatRates, lease);
  const next = schedule.ok ? nextInvoiceOn(schedule.invoices, today) : null;
  return {
    endDate,
    termOver: today >= endDate,
    nextInvoice: next && { dueDate: next.dueDate, grossCents: next.grossCents },
  };
}

/** Whether a lease's invoices were charged at more than one VAT rate. When they were, the
 *  invoice page explains why the totals differ while the net rent stayed locked. */
export function hasVatRateChange(invoices: readonly Pick<Invoice, 'vatRatePercent'>[]): boolean {
  return new Set(invoices.map((invoice) => invoice.vatRatePercent)).size > 1;
}
