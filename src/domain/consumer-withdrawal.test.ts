import { describe, expect, it } from 'vitest';
import { isWithinWithdrawalWindow, WITHDRAWAL_WINDOW_DAYS } from './consumer-withdrawal';

describe('isWithinWithdrawalWindow', () => {
  it('is true from day 0 up to and including day 14', () => {
    expect(isWithinWithdrawalWindow(0)).toBe(true);
    expect(isWithinWithdrawalWindow(WITHDRAWAL_WINDOW_DAYS)).toBe(true);
  });

  it('is false after day 14', () => {
    expect(isWithinWithdrawalWindow(15)).toBe(false);
  });

  it('is false for a negative day count', () => {
    expect(isWithinWithdrawalWindow(-1)).toBe(false);
  });
});
