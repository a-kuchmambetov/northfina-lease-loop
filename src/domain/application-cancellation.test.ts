import { describe, expect, it } from 'vitest';
import { canCancelApplication, cancellableDecisions } from './application-cancellation';

describe('canCancelApplication', () => {
  it.each(['pending', 'approved'])('allows cancelling a %s application', (decision) => {
    expect(canCancelApplication(decision)).toBe(true);
  });

  it.each(['rejected', 'manual_review', 'cancelled', '', 'APPROVED'])(
    'refuses to cancel a %j application',
    (decision) => {
      expect(canCancelApplication(decision)).toBe(false);
    }
  );
});

describe('cancellableDecisions', () => {
  it('cannot be changed by a caller', () => {
    cancellableDecisions().push('rejected');
    expect(canCancelApplication('rejected')).toBe(false);
  });
});
