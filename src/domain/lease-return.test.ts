import { describe, expect, it } from 'vitest';
import { leaseMonthsElapsed, leaseReturnKind } from './lease-return';

describe('leaseMonthsElapsed', () => {
  it.each([
    ['2025-12-31', 0],
    ['2026-01-30', 0],
    ['2026-01-31', 0],
    ['2026-02-27', 0],
    ['2026-02-28', 1],
    ['2026-03-30', 1],
    ['2026-03-31', 2],
    ['2027-01-31', 12],
    ['2030-01-31', 12],
  ])('counts completed monthly invoice periods on %s as %i', (asOfDate, months) => {
    expect(leaseMonthsElapsed('2026-01-31', 12, asOfDate)).toBe(months);
  });

  it('uses the leap-year February boundary, without drifting later anniversaries', () => {
    expect(leaseMonthsElapsed('2028-01-31', 12, '2028-02-28')).toBe(0);
    expect(leaseMonthsElapsed('2028-01-31', 12, '2028-02-29')).toBe(1);
    expect(leaseMonthsElapsed('2028-01-31', 12, '2028-03-29')).toBe(1);
  });

  it("counts the full term at a leap-day lease's clamped end date", () => {
    expect(leaseMonthsElapsed('2028-02-29', 24, '2030-02-27')).toBe(23);
    expect(leaseMonthsElapsed('2028-02-29', 24, '2030-02-28')).toBe(24);
  });
});

describe('leaseReturnKind', () => {
  it('is an early return on the first day and in the middle of the term', () => {
    expect(leaseReturnKind('2026-11-05', 36, '2026-11-05')).toBe('early');
    expect(leaseReturnKind('2026-11-05', 36, '2027-06-05')).toBe('early');
  });

  it('is still early on the last day before the term ends', () => {
    expect(leaseReturnKind('2026-11-05', 12, '2027-11-04')).toBe('early');
  });

  it('is an end-of-term return from the day the term ends', () => {
    expect(leaseReturnKind('2026-11-05', 12, '2027-11-05')).toBe('end_of_term');
    expect(leaseReturnKind('2026-11-05', 12, '2030-01-01')).toBe('end_of_term');
  });

  it('follows the clamped end date of a term that starts on the 31st', () => {
    // 31 Jan + 1 month ends on 28 Feb (2027 is not a leap year).
    expect(leaseReturnKind('2027-01-31', 1, '2027-02-27')).toBe('early');
    expect(leaseReturnKind('2027-01-31', 1, '2027-02-28')).toBe('end_of_term');
  });

  it('knows a leap-year February', () => {
    expect(leaseReturnKind('2027-12-31', 2, '2028-02-28')).toBe('early');
    expect(leaseReturnKind('2027-12-31', 2, '2028-02-29')).toBe('end_of_term');
  });
});
