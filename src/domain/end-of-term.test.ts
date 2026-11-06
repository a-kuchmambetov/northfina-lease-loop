import { describe, expect, it } from 'vitest';
import { renewalAgeMonths, resolveEndOfTerm } from './end-of-term';

describe('renewalAgeMonths', () => {
  it('counts a complete term on the clamped leap-day anniversary', () => {
    expect(renewalAgeMonths('2028-02-29', 24, '2030-02-27')).toBe(23);
    expect(renewalAgeMonths('2028-02-29', 24, '2030-02-28')).toBe(24);
    expect(renewalAgeMonths('2028-02-29', 24, '2031-03-01')).toBe(36);
  });
});

describe('resolveEndOfTerm', () => {
  it('buys for the locked buyout price once the term is over', () => {
    const result = resolveEndOfTerm({
      startDate: '2026-11-05',
      termMonths: 36,
      buyoutCents: 58_350,
      action: 'buy',
      asOfDate: '2029-11-05',
    });
    expect(result).toEqual({ ok: true, outcome: 'bought', amountCents: 58_350 });
  });

  it('returns the item once the term is over', () => {
    const result = resolveEndOfTerm({
      startDate: '2026-11-05',
      termMonths: 36,
      buyoutCents: 58_350,
      action: 'return',
      asOfDate: '2029-11-05',
    });
    expect(result).toEqual({ ok: true, outcome: 'returned' });
  });

  it('passes the item on directly when its condition after wear is still good enough', () => {
    const result = resolveEndOfTerm({
      startDate: '2026-11-05',
      termMonths: 36,
      buyoutCents: 58_350,
      action: 'pass_on',
      asOfDate: '2029-11-05',
      conditionAfterWear: 'good',
    });
    expect(result).toEqual({ ok: true, outcome: 'passed_on' });
  });

  it('rejects passing on an item that needs refurbishment first', () => {
    const result = resolveEndOfTerm({
      startDate: '2026-11-05',
      termMonths: 36,
      buyoutCents: 58_350,
      action: 'pass_on',
      asOfDate: '2029-11-05',
      conditionAfterWear: 'fair',
    });
    expect(result).toEqual({ ok: false, reason: 'item_needs_refurbishment_first' });
  });

  it('throws if pass_on is asked for without a condition to check', () => {
    expect(() =>
      resolveEndOfTerm({
        startDate: '2026-11-05',
        termMonths: 36,
        buyoutCents: 58_350,
        action: 'pass_on',
        asOfDate: '2029-11-05',
      })
    ).toThrow(RangeError);
  });

  it('approves an extension once the term is over, without pricing it', () => {
    const result = resolveEndOfTerm({
      startDate: '2026-11-05',
      termMonths: 36,
      buyoutCents: 58_350,
      action: 'extend',
      asOfDate: '2029-11-05',
      additionalTermMonths: 12,
    });
    expect(result).toEqual({ ok: true, outcome: 'extend_approved', additionalTermMonths: 12 });
  });

  it('rejects any action before the term is actually over', () => {
    const result = resolveEndOfTerm({
      startDate: '2026-11-05',
      termMonths: 36,
      buyoutCents: 58_350,
      action: 'buy',
      asOfDate: '2029-11-04',
    });
    expect(result).toEqual({ ok: false, reason: 'term_not_finished' });
  });

  it('allows the action on the exact day the term ends', () => {
    const result = resolveEndOfTerm({
      startDate: '2026-11-05',
      termMonths: 36,
      buyoutCents: 58_350,
      action: 'return',
      asOfDate: '2029-11-05',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an extension with no additionalTermMonths', () => {
    const result = resolveEndOfTerm({
      startDate: '2026-11-05',
      termMonths: 36,
      buyoutCents: 58_350,
      action: 'extend',
      asOfDate: '2029-11-05',
    });
    expect(result).toEqual({ ok: false, reason: 'extension_must_be_a_positive_whole_number' });
  });

  it('rejects an extension of zero or negative months', () => {
    const result = resolveEndOfTerm({
      startDate: '2026-11-05',
      termMonths: 36,
      buyoutCents: 58_350,
      action: 'extend',
      asOfDate: '2029-11-05',
      additionalTermMonths: 0,
    });
    expect(result).toEqual({ ok: false, reason: 'extension_must_be_a_positive_whole_number' });
  });

  it('rejects a non-integer extension', () => {
    const result = resolveEndOfTerm({
      startDate: '2026-11-05',
      termMonths: 36,
      buyoutCents: 58_350,
      action: 'extend',
      asOfDate: '2029-11-05',
      additionalTermMonths: 1.5,
    });
    expect(result).toEqual({ ok: false, reason: 'extension_must_be_a_positive_whole_number' });
  });

  it('clamps a short month correctly when computing the term end date', () => {
    const result = resolveEndOfTerm({
      startDate: '2026-01-31',
      termMonths: 1,
      buyoutCents: 1_000,
      action: 'buy',
      asOfDate: '2026-02-28',
    });
    expect(result).toEqual({ ok: true, outcome: 'bought', amountCents: 1_000 });
  });
});
