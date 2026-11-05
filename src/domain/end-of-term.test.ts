import { describe, expect, it } from 'vitest';
import { resolveEndOfTerm } from './end-of-term';

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
