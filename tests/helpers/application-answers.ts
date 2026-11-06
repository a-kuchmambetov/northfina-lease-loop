// Test-only helper: a plausible answer for any question in data/questions.json, given the
// customer being interviewed. Not business logic — just enough to drive an application
// through to a decision in a test without hand-writing every branch's answer.
import type { Customer, Question } from '@/data/schemas';
import type { Answer } from '@/domain/question-flow';

export function defaultAnswerFor(question: Question, customer: Customer): Answer {
  switch (question.id) {
    case 'q_customer_type':
      return customer.type;
    case 'q_full_name':
      return customer.name;
    case 'q_birth_date':
      return customer.type === 'company' ? '1990-01-01' : customer.birth_date;
    case 'q_email':
      return customer.email;
    case 'q_country':
      return customer.country;
    case 'q_employment':
      return customer.type === 'consumer' ? customer.employment : 'employed';
    case 'q_monthly_income':
      return customer.type === 'consumer' ? customer.monthly_net_income_cents : 0;
    case 'q_business_id':
      return customer.type === 'sole_trader' || customer.type === 'company'
        ? customer.business_id
        : '';
    case 'q_company_name':
      return customer.name;
    case 'q_can_sign':
      return 'yes';
    case 'q_signatory_email':
      return 'signatory@example.com';
    case 'q_vat_registered':
      return customer.type === 'sole_trader' || customer.type === 'company'
        ? customer.vat_registered
          ? 'yes'
          : 'no'
        : 'no';
    case 'q_usage_purpose':
      return 'commuting';
    case 'q_farm_registry':
      return 'FR-123456';
    case 'q_annual_revenue':
      return customer.type === 'company' ? customer.annual_revenue_cents : 0;
    case 'q_beneficial_owners':
      return ['Owner A'];
    case 'q_pep':
      return customer.is_pep ? 'yes' : 'no';
    case 'q_pep_details':
      return 'Former minister';
    default:
      throw new Error(`setup: no default answer for question ${question.id}`);
  }
}
