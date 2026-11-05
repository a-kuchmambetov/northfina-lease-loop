import { describe, expect, it } from 'vitest';
import { isValidFinnishBusinessId } from './business-id';

describe('isValidFinnishBusinessId', () => {
  it('accepts real valid business IDs from the data pack', () => {
    expect(isValidFinnishBusinessId('3012456-5')).toBe(true); // cust-pekka
    expect(isValidFinnishBusinessId('3187650-7')).toBe(true); // cust-kettukoodi
    expect(isValidFinnishBusinessId('2876543-5')).toBe(true); // cust-haapala
    expect(isValidFinnishBusinessId('3299871-7')).toBe(true); // cust-norvi
  });

  it("rejects the data pack's deliberately broken business ID", () => {
    // cust-broken-id: 1234567-8 — the correct check digit is 1, not 8.
    expect(isValidFinnishBusinessId('1234567-8')).toBe(false);
  });

  it('accepts the correct check digit for that same number', () => {
    expect(isValidFinnishBusinessId('1234567-1')).toBe(true);
  });

  it('rejects a malformed string', () => {
    expect(isValidFinnishBusinessId('123456-1')).toBe(false); // too few digits
    expect(isValidFinnishBusinessId('12345678')).toBe(false); // missing hyphen
    expect(isValidFinnishBusinessId('1234567-10')).toBe(false); // two-digit check
    expect(isValidFinnishBusinessId('')).toBe(false);
  });

  it('rejects a number whose remainder is 1 (no valid check digit exists)', () => {
    // 0000000: sum = 0, remainder 0 -> check digit 0, not this case directly, so pick one
    // that lands on remainder 1. 0000001 x weights sums to 2 (remainder 2); try 1000000:
    // 1*7=7, remainder 7. Easiest: construct from the formula directly.
    // 1111111: weights sum = 7+9+10+5+8+4+2=45, 45 % 11 = 1 -> no valid check digit.
    expect(isValidFinnishBusinessId('1111111-0')).toBe(false);
    expect(isValidFinnishBusinessId('1111111-9')).toBe(false);
  });

  it('accepts a check digit of 0 when the remainder is 0', () => {
    // 0000000: sum = 0, 0 % 11 = 0 -> check digit 0.
    expect(isValidFinnishBusinessId('0000000-0')).toBe(true);
  });
});
