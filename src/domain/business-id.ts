// Finnish business ID (Y-tunnus) check digit (CHALLENGE.md: "Finnish Y-tunnus check
// digits follow a public algorithm" — data/DATA.md's wrong-check-digit trap). Format:
// 7 digits, a hyphen, then the check digit — e.g. `1234567-1`.
/** 7 digits, a hyphen, the check digit — the *shape* only, regardless of whether the check
 *  digit is actually correct. Exported so format validation (is this even shaped like a
 *  business ID?) can stay separate from the check-digit decision below. */
export const BUSINESS_ID_FORMAT = /^(\d{7})-(\d)$/;
const WEIGHTS = [7, 9, 10, 5, 8, 4, 2];

/**
 * The public algorithm: multiply each of the 7 digits by its weight, sum them, and take
 * the sum mod 11. A remainder of 0 means check digit 0; a remainder of 1 has no valid
 * check digit at all (such an ID can never be valid); otherwise the check digit is
 * `11 - remainder`.
 */
function checkDigitFor(sevenDigits: string): number | null {
  const sum = sevenDigits
    .split('')
    .reduce((total, digit, index) => total + Number(digit) * WEIGHTS[index]!, 0);
  const remainder = sum % 11;
  if (remainder === 0) return 0;
  if (remainder === 1) return null;
  return 11 - remainder;
}

/** Whether `businessId` is a correctly formatted Finnish business ID with a valid check digit. */
export function isValidFinnishBusinessId(businessId: string): boolean {
  const match = BUSINESS_ID_FORMAT.exec(businessId);
  if (!match) return false;

  const expected = checkDigitFor(match[1]!);
  return expected !== null && expected === Number(match[2]);
}
