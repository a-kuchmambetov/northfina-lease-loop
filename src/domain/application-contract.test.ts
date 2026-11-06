import { describe, expect, it } from 'vitest';
import {
  canFormContract,
  downPaymentOfQuote,
  normalizeSignature,
  SIGNATURE_MAX_LENGTH,
} from './application-contract';

describe('canFormContract', () => {
  it('allows an approved application', () => {
    expect(canFormContract('approved')).toBe(true);
  });

  it.each(['pending', 'rejected', 'manual_review', 'cancelled', 'signed', '', 'APPROVED'])(
    'refuses a %j application',
    (decision) => {
      expect(canFormContract(decision)).toBe(false);
    }
  );
});

describe('normalizeSignature', () => {
  it('accepts a plain name', () => {
    expect(normalizeSignature('Aino Virtanen')).toEqual({ ok: true, name: 'Aino Virtanen' });
  });

  it('trims the name and collapses repeated whitespace, tabs and new lines', () => {
    expect(normalizeSignature('  Aino \t  Virtanen\n')).toEqual({
      ok: true,
      name: 'Aino Virtanen',
    });
  });

  it('keeps accents and non-Latin letters', () => {
    expect(normalizeSignature('Åsa Öberg')).toEqual({ ok: true, name: 'Åsa Öberg' });
    expect(normalizeSignature('Анна')).toEqual({ ok: true, name: 'Анна' });
  });

  it('accepts a name of exactly two characters', () => {
    expect(normalizeSignature('Li')).toEqual({ ok: true, name: 'Li' });
  });

  it.each(['', '   ', 'A', ' A ', '12', '--', '. .'])('refuses %j as too short', (typed) => {
    expect(normalizeSignature(typed)).toEqual({ ok: false, reason: 'signature_too_short' });
  });

  it('accepts a name of exactly the maximum length and refuses one character more', () => {
    expect(normalizeSignature('a'.repeat(SIGNATURE_MAX_LENGTH)).ok).toBe(true);
    expect(normalizeSignature('a'.repeat(SIGNATURE_MAX_LENGTH + 1))).toEqual({
      ok: false,
      reason: 'signature_too_long',
    });
  });

  it('counts letters, not UTF-16 units, towards the maximum', () => {
    expect(normalizeSignature('😀'.repeat(SIGNATURE_MAX_LENGTH) + 'a').ok).toBe(false);
    expect(normalizeSignature('😀'.repeat(SIGNATURE_MAX_LENGTH - 1) + 'a').ok).toBe(true);
  });
});

describe('downPaymentOfQuote', () => {
  it('is the part of the list price that was not financed', () => {
    expect(downPaymentOfQuote(389_000, 289_000)).toBe(100_000);
  });

  it('is 0 when the whole list price was financed', () => {
    expect(downPaymentOfQuote(389_000, 389_000)).toBe(0);
  });

  it('is null when more was financed than the list price', () => {
    expect(downPaymentOfQuote(389_000, 389_001)).toBeNull();
  });
});
