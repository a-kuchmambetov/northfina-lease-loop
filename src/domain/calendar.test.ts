import { describe, expect, it } from 'vitest';
import { addCalendarMonths } from './calendar';

describe('addCalendarMonths', () => {
  it('keeps the same day for an ordinary month', () => {
    expect(addCalendarMonths('2026-11-05', 1)).toBe('2026-12-05');
  });

  it('crosses a year boundary', () => {
    expect(addCalendarMonths('2026-12-05', 1)).toBe('2027-01-05');
  });

  it('clamps 31 Jan to 28 Feb in a common year', () => {
    expect(addCalendarMonths('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('clamps 31 Jan to 29 Feb in a leap year', () => {
    expect(addCalendarMonths('2026-01-31', 25)).toBe('2028-02-29');
  });

  it('returns the same date for 0 months', () => {
    expect(addCalendarMonths('2026-05-15', 0)).toBe('2026-05-15');
  });

  it('rejects a malformed date', () => {
    expect(() => addCalendarMonths('2026/05/15', 1)).toThrow(RangeError);
  });

  it('rejects a non-integer month count', () => {
    expect(() => addCalendarMonths('2026-05-15', 1.5)).toThrow(RangeError);
  });
});
