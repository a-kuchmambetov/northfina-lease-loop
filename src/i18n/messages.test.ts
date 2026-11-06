import { describe, expect, it } from 'vitest';
import { loadQuestions } from '@/data/load';
import { messages } from './get-t';
import { locales } from './locales';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('translation files', () => {
  const englishKeys = Object.keys(messages.en).sort();

  it.each(locales)('%s has exactly the same keys as en', (locale) => {
    expect(Object.keys(messages[locale]).sort()).toEqual(englishKeys);
  });

  it.each(locales)('%s has no empty messages', (locale) => {
    for (const [key, text] of Object.entries(messages[locale])) {
      expect(text.trim(), `${locale}: ${key}`).not.toBe('');
    }
  });

  it.each(locales)('%s uses the same {placeholders} as en', (locale) => {
    for (const key of englishKeys) {
      const english = messages.en[key as keyof typeof messages.en];
      const translated = messages[locale][key as keyof typeof messages.en];
      expect(placeholders(translated), `${locale}: ${key}`).toEqual(placeholders(english));
    }
  });

  // The application page builds these keys from data, so the type checker can't see them.
  it('has a label for every question option', async () => {
    const { questions } = await loadQuestions();
    const options = questions.flatMap((question) => question.options ?? []);
    for (const option of options) {
      expect(englishKeys, option).toContain(`application.option.${option}`);
    }
  });

  it.each(['approved', 'rejected', 'manual_review', 'cancelled', 'signed'])(
    'names the decision %s',
    (decision) => {
      expect(englishKeys).toContain(`application.decision.${decision}`);
    }
  );

  it.each(['issued', 'paid', 'expired', 'cancelled'])('labels the invoice status %s', (status) => {
    expect(englishKeys).toContain(`invoices.status.${status}`);
  });

  it.each([
    'available',
    'leased',
    'contract_ended',
    'returned',
    'manual_approval',
    'reserved',
    'sold',
  ])('explains the supplier item status %s', (status) => {
    expect(englishKeys).toContain(`supplier.status.${status}`);
    expect(englishKeys).toContain(`supplier.next.${status}.title`);
    expect(englishKeys).toContain(`supplier.next.${status}.text`);
  });

  it.each(['end_of_term', 'early', 'passed_on'])('names the return kind %s', (kind) => {
    expect(englishKeys).toContain(`requests.kind.${kind}`);
  });

  it.each([
    'pending',
    'approved',
    'rejected',
    'manual_review',
    'active',
    'bought',
    'returned',
    'extended',
    'cancelled',
    'signed',
  ])('labels the status %s on the account page', (status) => {
    expect(englishKeys).toContain(`account.status.${status}`);
  });

  it.each([
    'financed_limits',
    'min_age',
    'residency',
    'business_id',
    'affordability',
    'pep_manual_review',
    'customer_cancelled',
    'contract_signed',
  ])('explains the reason %s', (reason) => {
    expect(englishKeys).toContain(`application.reason.${reason}`);
  });
});
