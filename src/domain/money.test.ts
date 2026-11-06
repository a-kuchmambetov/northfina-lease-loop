import { describe, expect, it } from 'vitest';
import { formatEuro, parseEuroInput } from './money';

// Intl uses no-break spaces; compare with plain spaces so the tests are readable.
const plain = (text: string) => text.replace(/\s/g, ' ');

describe('formatEuro', () => {
  it('formats Finnish style: space as thousands separator, comma decimals, € after', () => {
    expect(plain(formatEuro(189_900, 'fi'))).toBe('1 899,00 €');
    expect(plain(formatEuro(25_000_000, 'fi-FI'))).toBe('250 000,00 €');
  });

  it('formats English style: € first, comma thousands, dot decimals', () => {
    expect(formatEuro(189_900, 'en')).toBe('€1,899.00');
    expect(formatEuro(28_900, 'en-GB')).toBe('€289.00');
  });

  it('shows single cents and zero correctly', () => {
    expect(plain(formatEuro(5, 'fi'))).toBe('0,05 €');
    expect(formatEuro(0, 'en')).toBe('€0.00');
  });

  it('formats negative amounts such as credit notes', () => {
    expect(formatEuro(-1_250, 'en')).toBe('-€12.50');
  });

  it('throws on fractions of a cent', () => {
    expect(() => formatEuro(10.5, 'en')).toThrow(RangeError);
  });
});

describe('parseEuroInput', () => {
  it.each([
    ['2500', 250_000],
    ['2500.5', 250_050],
    ['2500,50', 250_050],
    ['2 500,05', 250_005],
    ['0', 0],
    ['0.01', 1],
    [' 12 ', 1_200],
  ])('reads %j as %i cents', (input, cents) => {
    expect(parseEuroInput(input)).toBe(cents);
  });

  it.each(['', 'abc', '-5', '1.234', '1,2,3', '12.', '1e3', '€5'])('refuses %j', (input) => {
    expect(parseEuroInput(input)).toBeNull();
  });

  it('refuses an amount too large to hold exactly', () => {
    expect(parseEuroInput('9'.repeat(20))).toBeNull();
  });
});
