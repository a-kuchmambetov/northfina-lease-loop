import { describe, expect, it } from 'vitest';
import { passOnBonusCents } from './pass-on-bonus';

describe('passOnBonusCents', () => {
  it('gives the base percent for exactly the minimum passable condition', () => {
    expect(passOnBonusCents(100_000, 'good')).toBe(2_000); // 2% of 100000
  });

  it('gives more for a better condition', () => {
    expect(passOnBonusCents(100_000, 'like_new')).toBe(5_000); // (2 + 3)%
    expect(passOnBonusCents(100_000, 'new')).toBe(8_000); // (2 + 3 + 3)%
  });

  it('is monotonically larger for a better condition', () => {
    const good = passOnBonusCents(58_350, 'good');
    const likeNew = passOnBonusCents(58_350, 'like_new');
    const brandNew = passOnBonusCents(58_350, 'new');
    expect(likeNew).toBeGreaterThan(good);
    expect(brandNew).toBeGreaterThan(likeNew);
  });

  it('throws on a fraction of a cent, because that is a bug in the caller', () => {
    expect(() => passOnBonusCents(100_000.5, 'good')).toThrow(RangeError);
  });
});
