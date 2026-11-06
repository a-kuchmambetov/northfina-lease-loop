// Money helpers. Amounts are always integer euro cents; only format at the edge (the UI).

/**
 * Formats cents as euros for a locale, e.g. 189900 → "1 899,00 €" (fi) or "€1,899.00" (en).
 * `locale` is a BCP 47 tag such as "fi", "fi-FI" or "en-GB".
 */
export function formatEuro(cents: number, locale: string): string {
  if (!Number.isInteger(cents)) {
    throw new RangeError(`cents must be a whole number, got ${cents}`);
  }
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

/**
 * Reads what someone typed into a euro field as cents, or `null` if it isn't an amount.
 * Accepts a comma or a point (Finnish, Swedish and Estonian use a comma) and spaces between
 * thousands. Works on the digits as text, so no floating-point rounding is involved; more
 * than two decimals is refused rather than rounded.
 */
export function parseEuroInput(input: string): number | null {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(input.replace(/\s/g, ''));
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

/**
 * The reverse of `parseEuroInput`: cents as an editable euro string with a point and two
 * decimals, e.g. 250050 → "2500.50". Works on the digits as text, so no floating point.
 */
export function centsToEuroInput(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError(`cents must be a non-negative whole number, got ${cents}`);
  }
  const digits = String(cents).padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
