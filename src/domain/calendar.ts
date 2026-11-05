// Calendar-month arithmetic for invoice due dates (CHALLENGE.md Smart Problem "Money that
// adds up" calendar traps, e.g. starting 31 Jan). No `Date` object is used here: domain
// code must stay deterministic, and `Date` reads the host's clock/time zone rules.
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, monthIndex0: number): number {
  if (monthIndex0 === 1 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[monthIndex0] as number;
}

/**
 * Adds whole calendar months to an ISO date (`YYYY-MM-DD`). The day of month is kept, but
 * clamped to the target month's last day when it is shorter — 31 Jan + 1 month = 28 Feb in a
 * common year, 29 Feb in a leap year. `months` may be 0 (returns `isoDate` unchanged).
 */
export function addCalendarMonths(isoDate: string, months: number): string {
  const match = ISO_DATE.exec(isoDate);
  if (!match) {
    throw new RangeError(`isoDate must look like YYYY-MM-DD, got "${isoDate}"`);
  }
  if (!Number.isInteger(months)) {
    throw new RangeError(`months must be a whole number, got ${months}`);
  }

  const year = Number(match[1]);
  const month0 = Number(match[2]) - 1;
  const day = Number(match[3]);

  const totalMonths = year * 12 + month0 + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth0 = ((totalMonths % 12) + 12) % 12;
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth0));

  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth0 + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
}
