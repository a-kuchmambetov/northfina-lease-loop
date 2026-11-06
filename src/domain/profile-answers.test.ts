import { beforeAll, describe, expect, it } from 'vitest';
import { loadQuestions } from '@/data/load';
import type { Question } from '@/data/schemas';
import { answersFromProfile, type ProfileFacts } from './profile-answers';

let questions: readonly Question[];
beforeAll(async () => {
  questions = (await loadQuestions()).questions;
});

const consumer: ProfileFacts = {
  type: 'consumer',
  name: 'Aino Virtanen',
  country: 'FI',
  email: 'aino@example.com',
  birth_date: '1997-04-12',
  employment: 'employed',
  monthly_net_income_cents: 320_000,
};

const company: ProfileFacts = {
  type: 'company',
  name: 'Kettu Koodi Oy',
  country: 'FI',
  email: 'it@kettukoodi.example.com',
  business_id: '3187650-7',
  vat_registered: true,
  annual_revenue_cents: 180_000_000,
  applicant_can_sign: false,
  beneficial_owners: ['Kati Kettu (100 %)'],
};

describe('answersFromProfile', () => {
  it('answers every consumer question the profile covers', () => {
    expect(answersFromProfile(consumer, questions)).toEqual({
      q_customer_type: 'consumer',
      q_full_name: 'Aino Virtanen',
      q_birth_date: '1997-04-12',
      q_email: 'aino@example.com',
      q_country: 'FI',
      q_employment: 'employed',
      q_monthly_income: 320_000,
    });
  });

  it('answers the company questions, using the name as the company name', () => {
    expect(answersFromProfile(company, questions)).toEqual({
      q_customer_type: 'company',
      q_email: 'it@kettukoodi.example.com',
      // Answered too, though it is not asked of a company: dropStaleAnswers removes it.
      q_country: 'FI',
      q_business_id: '3187650-7',
      q_company_name: 'Kettu Koodi Oy',
      q_can_sign: 'no',
      q_vat_registered: 'yes',
      q_annual_revenue: 180_000_000,
      q_beneficial_owners: ['Kati Kettu (100 %)'],
    });
  });

  it('answers the sole trader questions with the person name and business details', () => {
    const answers = answersFromProfile(
      {
        type: 'sole_trader',
        name: 'Pekka Korhonen',
        country: 'FI',
        email: 'pekka@example.com',
        birth_date: '1988-01-22',
        business_id: '3012456-5',
        vat_registered: false,
      },
      questions
    );
    expect(answers).toMatchObject({
      q_full_name: 'Pekka Korhonen',
      q_business_id: '3012456-5',
      q_vat_registered: 'no',
    });
    expect(answers).not.toHaveProperty('q_company_name');
  });

  it('never answers what is about this lease or another person, or a PEP declaration', () => {
    const ids = Object.keys(answersFromProfile(company, questions));
    for (const id of ['q_pep', 'q_pep_details', 'q_signatory_email', 'q_usage_purpose']) {
      expect(ids).not.toContain(id);
    }
  });

  it('maps a country outside FI/SE/EE to the "other" answer', () => {
    expect(answersFromProfile({ ...consumer, country: 'DE' }, questions)).toMatchObject({
      q_country: 'other',
    });
    expect(answersFromProfile({ ...consumer, country: 'SE' }, questions)).toMatchObject({
      q_country: 'SE',
    });
  });

  it('leaves out a missing value, so the applicant is asked', () => {
    const answers = answersFromProfile(
      { ...consumer, birth_date: null, monthly_net_income_cents: undefined },
      questions
    );
    expect(answers).not.toHaveProperty('q_birth_date');
    expect(answers).not.toHaveProperty('q_monthly_income');
  });

  it('leaves out a value that is not a valid answer', () => {
    const answers = answersFromProfile(
      { ...company, business_id: 'not-an-id', beneficial_owners: [] },
      questions
    );
    expect(answers).not.toHaveProperty('q_business_id');
    expect(answers).not.toHaveProperty('q_beneficial_owners');
  });

  it('still answers a business ID with a wrong check digit (that is the eligibility rule)', () => {
    expect(answersFromProfile({ ...company, business_id: '1234567-8' }, questions)).toMatchObject({
      q_business_id: '1234567-8',
    });
  });
});
