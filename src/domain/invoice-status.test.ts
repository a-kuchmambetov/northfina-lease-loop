import { describe, expect, it } from 'vitest';
import { invoiceDisplayStatus } from './invoice-status';

describe('invoiceDisplayStatus', () => {
  it('is to pay while the payment deadline is ahead', () => {
    expect(invoiceDisplayStatus('issued', '2026-12-29', '2026-12-15')).toBe('issued');
  });

  it('is still to pay on the deadline day itself', () => {
    expect(invoiceDisplayStatus('issued', '2026-12-29', '2026-12-29')).toBe('issued');
  });

  it('has expired from the day after the deadline', () => {
    expect(invoiceDisplayStatus('issued', '2026-12-29', '2026-12-30')).toBe('expired');
    expect(invoiceDisplayStatus('issued', '2026-12-29', '2030-01-01')).toBe('expired');
  });

  it('compares across a month and a year end', () => {
    expect(invoiceDisplayStatus('issued', '2027-01-08', '2026-12-31')).toBe('issued');
    expect(invoiceDisplayStatus('issued', '2026-12-31', '2027-01-01')).toBe('expired');
  });

  it('never expires a paid invoice', () => {
    expect(invoiceDisplayStatus('paid', '2026-12-29', '2030-01-01')).toBe('paid');
    expect(invoiceDisplayStatus('paid', '2026-12-29', '2026-12-15')).toBe('paid');
  });

  it('keeps a cancelled invoice cancelled, before and after its payment deadline', () => {
    expect(invoiceDisplayStatus('cancelled', '2026-12-29', '2026-12-15')).toBe('cancelled');
    expect(invoiceDisplayStatus('cancelled', '2026-12-29', '2030-01-01')).toBe('cancelled');
  });
});
