// How a leased item came back, as a supplier sees it in the list of returns. The kind is
// read from the audit action that recorded the return (src/server/features/end-of-term/
// and early-exit/), because the contract itself only says `returned`.

export type ReturnKind = 'end_of_term' | 'early' | 'passed_on';

/** The audit actions that mean "the item was given back", and the kind each one is. */
export const RETURN_AUDIT_ACTIONS = [
  'contract.returned',
  'contract.returned_early',
  'contract.passed_on',
] as const;

export function returnKindOfAction(action: string): ReturnKind | null {
  switch (action) {
    case 'contract.returned':
      return 'end_of_term';
    case 'contract.returned_early':
      return 'early';
    case 'contract.passed_on':
      return 'passed_on';
    default:
      return null;
  }
}
