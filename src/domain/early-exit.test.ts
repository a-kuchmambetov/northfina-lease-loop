import { describe, expect, it } from 'vitest';
import { isRentCoveredByReturnFee, resolveEarlyExit } from './early-exit';

describe('resolveEarlyExit', () => {
  describe('buy', () => {
    it('is close to the full financed amount on day 0 (nothing paid off yet)', () => {
      const result = resolveEarlyExit({
        financedCents: 389_000,
        buyoutCents: 58_350,
        monthlyNetRentCents: 10_730,
        termMonths: 36,
        monthsElapsed: 0,
        action: 'buy',
      });
      expect(result).toEqual({ ok: true, outcome: 'bought_early', amountCents: 389_000 });
    });

    it('matches the ordinary end-of-term buyout exactly at the boundary', () => {
      const result = resolveEarlyExit({
        financedCents: 389_000,
        buyoutCents: 58_350,
        monthlyNetRentCents: 10_730,
        termMonths: 36,
        monthsElapsed: 36,
        action: 'buy',
      });
      expect(result).toEqual({ ok: true, outcome: 'bought_early', amountCents: 58_350 });
    });

    it('is a straight line between day 0 and the end of the term', () => {
      // Month 7 of 36: 29 months remaining out of 36.
      const result = resolveEarlyExit({
        financedCents: 389_000,
        buyoutCents: 58_350,
        monthlyNetRentCents: 10_730,
        termMonths: 36,
        monthsElapsed: 7,
        action: 'buy',
      });
      // 58350 + (389000 - 58350) x (29/36) = 324707.08... -> 324707
      expect(result).toEqual({ ok: true, outcome: 'bought_early', amountCents: 324_707 });
    });

    it('decreases monotonically as more months pass', () => {
      const amountAt = (monthsElapsed: number) => {
        const result = resolveEarlyExit({
          financedCents: 389_000,
          buyoutCents: 58_350,
          monthlyNetRentCents: 10_730,
          termMonths: 36,
          monthsElapsed,
          action: 'buy',
        });
        if (!result.ok || result.outcome !== 'bought_early')
          throw new Error('expected a buy result');
        return result.amountCents;
      };
      expect(amountAt(7)).toBeGreaterThan(amountAt(20));
      expect(amountAt(20)).toBeGreaterThan(amountAt(35));
    });
  });

  describe('return', () => {
    it('has no fee at the boundary — the same as an ordinary end-of-term return', () => {
      const result = resolveEarlyExit({
        financedCents: 389_000,
        buyoutCents: 58_350,
        monthlyNetRentCents: 10_730,
        termMonths: 36,
        monthsElapsed: 36,
        action: 'return',
        residualValueNowCents: 100_000,
        residualValueAtFullTermCents: 100_000,
      });
      expect(result).toEqual({ ok: true, outcome: 'returned_early', feeCents: 0 });
    });

    it('charges the lost rent minus the gain from getting the item back sooner', () => {
      // Month 7 of 36: 29 months of rent at stake.
      const result = resolveEarlyExit({
        financedCents: 389_000,
        buyoutCents: 58_350,
        monthlyNetRentCents: 10_730,
        termMonths: 36,
        monthsElapsed: 7,
        action: 'return',
        residualValueNowCents: 250_000,
        residualValueAtFullTermCents: 150_000,
      });
      // 10730 x 29 = 311170; gain = 250000 - 150000 = 100000; fee = 211170
      expect(result).toEqual({ ok: true, outcome: 'returned_early', feeCents: 211_170 });
    });

    it('floors the fee at 0 when the early-return gain outweighs the lost rent', () => {
      const result = resolveEarlyExit({
        financedCents: 389_000,
        buyoutCents: 58_350,
        monthlyNetRentCents: 1_000,
        termMonths: 36,
        monthsElapsed: 35,
        action: 'return',
        residualValueNowCents: 300_000,
        residualValueAtFullTermCents: 100_000,
      });
      // 1000 x 1 = 1000 of rent at stake, but a 200000-cent gain — way more than enough.
      expect(result).toEqual({ ok: true, outcome: 'returned_early', feeCents: 0 });
    });

    it('rejects a return without both residual values', () => {
      const result = resolveEarlyExit({
        financedCents: 389_000,
        buyoutCents: 58_350,
        monthlyNetRentCents: 10_730,
        termMonths: 36,
        monthsElapsed: 7,
        action: 'return',
      });
      expect(result).toEqual({ ok: false, reason: 'residual_values_required_for_return' });
    });
  });

  it('rejects monthsElapsed outside [0, termMonths]', () => {
    expect(
      resolveEarlyExit({
        financedCents: 389_000,
        buyoutCents: 58_350,
        monthlyNetRentCents: 10_730,
        termMonths: 36,
        monthsElapsed: -1,
        action: 'buy',
      })
    ).toEqual({ ok: false, reason: 'months_elapsed_out_of_range' });

    expect(
      resolveEarlyExit({
        financedCents: 389_000,
        buyoutCents: 58_350,
        monthlyNetRentCents: 10_730,
        termMonths: 36,
        monthsElapsed: 37,
        action: 'buy',
      })
    ).toEqual({ ok: false, reason: 'months_elapsed_out_of_range' });
  });
});

describe('isRentCoveredByReturnFee', () => {
  it('covers the month in progress: on day 0 the first invoice is covered', () => {
    expect(isRentCoveredByReturnFee(1, 0)).toBe(true);
  });

  it('covers the invoice of the month in progress and every later one, in month 7', () => {
    // 7 months used: invoices 1 to 7 are for months already used, invoice 8 is this month's.
    expect(isRentCoveredByReturnFee(7, 7)).toBe(false);
    expect(isRentCoveredByReturnFee(8, 7)).toBe(true);
    expect(isRentCoveredByReturnFee(36, 7)).toBe(true);
  });

  it('leaves every used month payable', () => {
    for (let sequence = 1; sequence <= 7; sequence++) {
      expect(isRentCoveredByReturnFee(sequence, 7)).toBe(false);
    }
  });

  it('agrees with the fee: the covered invoices are exactly the months the fee charges', () => {
    const termMonths = 36;
    const monthsElapsed = 7;
    const covered = Array.from({ length: termMonths }, (_, index) => index + 1).filter((sequence) =>
      isRentCoveredByReturnFee(sequence, monthsElapsed)
    );
    expect(covered).toHaveLength(termMonths - monthsElapsed);
  });
});
