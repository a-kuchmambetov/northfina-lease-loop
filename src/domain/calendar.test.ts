import { describe, expect, it } from 'vitest';
import { addCalendarMonths, addDays, ageInYearsOn, daysBetween, monthsBetween } from './calendar';

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

describe('addDays', () => {
  it('adds days within the same month', () => {
    expect(addDays('2026-11-05', 14)).toBe('2026-11-19');
  });

  it('crosses a month boundary', () => {
    expect(addDays('2026-11-20', 14)).toBe('2026-12-04');
  });

  it('crosses a leap-year February', () => {
    expect(addDays('2028-02-20', 14)).toBe('2028-03-05');
  });

  it('crosses a year boundary', () => {
    expect(addDays('2026-12-25', 14)).toBe('2027-01-08');
  });

  it('accepts 0 days unchanged', () => {
    expect(addDays('2026-11-05', 0)).toBe('2026-11-05');
  });

  it('accepts negative days', () => {
    expect(addDays('2026-11-05', -5)).toBe('2026-10-31');
  });

  it('rejects a malformed date', () => {
    expect(() => addDays('2026/11/05', 14)).toThrow(RangeError);
  });

  it('rejects a non-integer day count', () => {
    expect(() => addDays('2026-11-05', 1.5)).toThrow(RangeError);
  });
});

describe('ageInYearsOn', () => {
  it('counts a birthday that already happened this year', () => {
    expect(ageInYearsOn('1997-04-12', '2026-11-05')).toBe(29);
  });

  it("does not count a birthday that hasn't happened yet this year", () => {
    expect(ageInYearsOn('1997-12-04', '2026-11-05')).toBe(28);
  });

  it('counts the exact birthday itself', () => {
    expect(ageInYearsOn('1997-11-05', '2026-11-05')).toBe(29);
  });

  it('is one day short of the birthday', () => {
    expect(ageInYearsOn('1997-11-05', '2026-11-04')).toBe(28);
  });

  it('matches the data pack: cust-mikko is 17 on 2026-11-05', () => {
    expect(ageInYearsOn('2009-03-10', '2026-11-05')).toBe(17);
  });

  it('never goes negative for an onDate before the birth date', () => {
    expect(ageInYearsOn('2026-11-05', '2020-01-01')).toBe(0);
  });

  it('rejects malformed dates', () => {
    expect(() => ageInYearsOn('1997/04/12', '2026-11-05')).toThrow(RangeError);
    expect(() => ageInYearsOn('1997-04-12', '2026/11/05')).toThrow(RangeError);
  });
});

describe('monthsBetween', () => {
  it('counts whole years as months', () => {
    expect(monthsBetween('2026-11-05', '2027-11-05')).toBe(12);
  });

  it('is one short when the day-of-month has not quite arrived yet', () => {
    expect(monthsBetween('2026-11-05', '2027-11-04')).toBe(11);
  });

  it('is exact when the day-of-month has just passed', () => {
    expect(monthsBetween('2026-11-05', '2027-11-06')).toBe(12);
  });

  it('is 0 for the same date', () => {
    expect(monthsBetween('2026-11-05', '2026-11-05')).toBe(0);
  });

  it('never goes negative when toDate is before fromDate', () => {
    expect(monthsBetween('2026-11-05', '2026-01-01')).toBe(0);
  });

  it('handles a short month start date', () => {
    expect(monthsBetween('2026-01-31', '2026-03-01')).toBe(1);
  });

  it('rejects a malformed date', () => {
    expect(() => monthsBetween('2026/11/05', '2027-11-05')).toThrow(RangeError);
    expect(() => monthsBetween('2026-11-05', '2027/11/05')).toThrow(RangeError);
  });
});

describe('daysBetween', () => {
  it('is 0 for the same date', () => {
    expect(daysBetween('2026-11-05', '2026-11-05')).toBe(0);
  });

  it('counts whole days, including across a month boundary', () => {
    expect(daysBetween('2026-11-05', '2026-11-06')).toBe(1);
    expect(daysBetween('2026-11-30', '2026-12-01')).toBe(1);
  });

  it('counts across a leap day', () => {
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
  });

  it('never goes negative when toDate is before fromDate', () => {
    expect(daysBetween('2026-11-05', '2026-11-01')).toBe(0);
  });

  it('rejects a malformed date', () => {
    expect(() => daysBetween('2026/11/05', '2026-11-06')).toThrow(RangeError);
    expect(() => daysBetween('2026-11-05', '2026/11/06')).toThrow(RangeError);
  });
});
