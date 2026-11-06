// Which applications a customer can still cancel. A rejection or a manual review stays on
// record: cancelling is for walking away from a deal that is open, not for removing a
// decision that has gone against the customer or that a person is about to review.
const CANCELLABLE_DECISIONS = ['pending', 'approved'];

/** The `decision` and `decision_reason` a cancelled application is stored with. */
export const CANCELLED = { decision: 'cancelled', reason: 'customer_cancelled' } as const;

export function cancellableDecisions(): string[] {
  return [...CANCELLABLE_DECISIONS];
}

export function canCancelApplication(decision: string): boolean {
  return CANCELLABLE_DECISIONS.includes(decision);
}
