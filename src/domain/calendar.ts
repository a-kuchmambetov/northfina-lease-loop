// Calendar-month arithmetic for invoice invoice dates (CHALLENGE.md Smart Problem "Money that
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

// Days-since-epoch conversion (Howard Hinnant's algorithm), so `addDays` never touches the
// host's `Date` object — see the file header for why.
function daysFromCivil(year: number, month1: number, day: number): number {
  const y = month1 <= 2 ? year - 1 : year;
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400;
  const mp = (month1 + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(epochDay: number): { year: number; month1: number; day: number } {
  const z = epochDay + 719468;
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month1 = mp < 10 ? mp + 3 : mp - 9;
  return { year: month1 <= 2 ? y + 1 : y, month1, day };
}

/** Adds whole days to an ISO date (`YYYY-MM-DD`). `days` may be negative. */
export function addDays(isoDate: string, days: number): string {
  const match = ISO_DATE.exec(isoDate);
  if (!match) {
    throw new RangeError(`isoDate must look like YYYY-MM-DD, got "${isoDate}"`);
  }
  if (!Number.isInteger(days)) {
    throw new RangeError(`days must be a whole number, got ${days}`);
  }

  const year = Number(match[1]);
  const month1 = Number(match[2]);
  const day = Number(match[3]);

  const target = civilFromDays(daysFromCivil(year, month1, day) + days);
  return `${String(target.year).padStart(4, '0')}-${String(target.month1).padStart(2, '0')}-${String(target.day).padStart(2, '0')}`;
}

/**
 * Whole days between two ISO dates (`toDate` minus `fromDate`), for example to find how
 * many days into a lease a consumer withdrawal request is (src/domain/consumer-
 * withdrawal.ts). Never negative — a `toDate` before `fromDate` returns 0.
 */
export function daysBetween(fromDate: string, toDate: string): number {
  const from = ISO_DATE.exec(fromDate);
  const to = ISO_DATE.exec(toDate);
  if (!from) throw new RangeError(`fromDate must look like YYYY-MM-DD, got "${fromDate}"`);
  if (!to) throw new RangeError(`toDate must look like YYYY-MM-DD, got "${toDate}"`);

  const fromDays = daysFromCivil(Number(from[1]), Number(from[2]), Number(from[3]));
  const toDays = daysFromCivil(Number(to[1]), Number(to[2]), Number(to[3]));
  return Math.max(toDays - fromDays, 0);
}

/**
 * Age in completed years on `onDate` — the birthday has to have actually happened that
 * year to count, same spirit as a calendar age anywhere else. Never negative.
 */
export function ageInYearsOn(birthDate: string, onDate: string): number {
  const birth = ISO_DATE.exec(birthDate);
  const on = ISO_DATE.exec(onDate);
  if (!birth) throw new RangeError(`birthDate must look like YYYY-MM-DD, got "${birthDate}"`);
  if (!on) throw new RangeError(`onDate must look like YYYY-MM-DD, got "${onDate}"`);

  const birthYear = Number(birth[1]);
  const birthMonth = Number(birth[2]);
  const birthDay = Number(birth[3]);
  const onYear = Number(on[1]);
  const onMonth = Number(on[2]);
  const onDay = Number(on[3]);

  let age = onYear - birthYear;
  if (onMonth < birthMonth || (onMonth === birthMonth && onDay < birthDay)) age -= 1;
  return Math.max(age, 0);
}

/**
 * Whole calendar months between two ISO dates (`toDate` minus `fromDate`), for example to
 * find an asset's age for src/domain/residual-value.ts. Counts complete months only: the
 * day-of-month still has to have passed, so 2026-01-31 to 2026-03-01 is 1 month, not 2.
 * Never negative — a `toDate` before `fromDate` returns 0.
 */
export function monthsBetween(fromDate: string, toDate: string): number {
  const from = ISO_DATE.exec(fromDate);
  const to = ISO_DATE.exec(toDate);
  if (!from) throw new RangeError(`fromDate must look like YYYY-MM-DD, got "${fromDate}"`);
  if (!to) throw new RangeError(`toDate must look like YYYY-MM-DD, got "${toDate}"`);

  const fromYear = Number(from[1]);
  const fromMonth = Number(from[2]);
  const fromDay = Number(from[3]);
  const toYear = Number(to[1]);
  const toMonth = Number(to[2]);
  const toDay = Number(to[3]);

  let months = (toYear - fromYear) * 12 + (toMonth - fromMonth);
  if (toDay < fromDay) months -= 1;
  return Math.max(months, 0);
}
