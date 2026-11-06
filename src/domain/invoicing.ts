// A locked contract's monthly invoices (CHALLENGE.md Spine #5). The net rent on every
// invoice is whatever was locked at signing (see src/domain/contract.ts) — it never
// changes — but the VAT rate is looked up again for each invoice's own invoice date, so a
// mid-contract rate change (CHALLENGE.md Smart Problem "Lock the price, not the tax")
// changes the VAT line, never the net rent.
import type { VatRates } from '@/data/schemas';
import { addCalendarMonths, addDays } from './calendar';
import { vatRateOn, type VatRateOnResult } from './vat';

/**
 * Days from an invoice's date to its payment deadline, the day it is actually due. Not in
 * data/DATA.md or RULES.md — our own choice, same as the early-exit formula: a common B2B leasing term.
 */
export const PAYMENT_TERM_DAYS = 14;

export type InvoiceScheduleInput = {
  /** `YYYY-MM-DD`, the contract's start date. Also invoice #1's invoice date. */
  startDate: string;
  termMonths: number;
  /** The rent locked at signing; the same on every invoice. */
  monthlyNetRentCents: number;
};

export type Invoice = {
  /** 1-based: invoice 1 is dated `startDate`. */
  sequenceNumber: number;
  invoiceDate: string;
  /** `invoiceDate` + `PAYMENT_TERM_DAYS`. */
  paymentDeadline: string;
  netCents: number;
  vatRatePercent: number;
  vatCents: number;
  grossCents: number;
};

export type InvoiceScheduleResult =
  | { ok: true; invoices: Invoice[] }
  | { ok: false; reason: Extract<VatRateOnResult, { ok: false }>['reason'] };

/**
 * Builds the full monthly invoice schedule for a locked contract.
 *
 * Invoice dates: invoice 1 is dated `startDate`; each later invoice is dated the same day of a
 * later calendar month, clamped to that month's last day when it is shorter (31 Jan -> 28
 * or 29 Feb) — see src/domain/calendar.ts.
 *
 * Rounding: VAT and the gross total are rounded on each invoice separately, half a cent
 * rounding up, the same rule as src/domain/pricing.ts. Because the net rent is a fixed
 * whole-cent amount on every invoice, the net lines always add up exactly to
 * `monthlyNetRentCents * termMonths`.
 */
export function buildInvoiceSchedule(
  vatRates: VatRates,
  input: InvoiceScheduleInput
): InvoiceScheduleResult {
  const invoices: Invoice[] = [];

  for (let i = 0; i < input.termMonths; i++) {
    const invoiceDate = addCalendarMonths(input.startDate, i);
    const vatResult = vatRateOn(vatRates, invoiceDate);
    if (!vatResult.ok) return vatResult;

    const vatCents = Math.round((input.monthlyNetRentCents * vatResult.ratePercent) / 100);
    invoices.push({
      sequenceNumber: i + 1,
      invoiceDate,
      paymentDeadline: addDays(invoiceDate, PAYMENT_TERM_DAYS),
      netCents: input.monthlyNetRentCents,
      vatRatePercent: vatResult.ratePercent,
      vatCents,
      grossCents: input.monthlyNetRentCents + vatCents,
    });
  }

  return { ok: true, invoices };
}
