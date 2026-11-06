import { describe, expect, it } from 'vitest';
import { RETURN_AUDIT_ACTIONS, returnKindOfAction } from './return-request';

describe('returnKindOfAction', () => {
  it('names the kind of every action that records a return', () => {
    expect(returnKindOfAction('contract.returned')).toBe('end_of_term');
    expect(returnKindOfAction('contract.returned_early')).toBe('early');
    expect(returnKindOfAction('contract.passed_on')).toBe('passed_on');
  });

  it('knows every action in RETURN_AUDIT_ACTIONS', () => {
    for (const action of RETURN_AUDIT_ACTIONS) expect(returnKindOfAction(action)).not.toBeNull();
  });

  it.each(['contract.signed', 'contract.bought', 'contract.bought_early', 'invoice.paid', ''])(
    'is not a return: %j',
    (action) => {
      expect(returnKindOfAction(action)).toBeNull();
    }
  );
});
