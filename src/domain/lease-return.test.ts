import { describe, expect, it } from 'vitest';
import { leaseReturnKind } from './lease-return';

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
