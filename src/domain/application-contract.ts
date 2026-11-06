// Turning an approved application into a contract. The customer signs by typing their
// name; this file holds the rules for that: which applications may be signed, what a
// usable signature looks like, and the down payment the application's quote was based on.
// Pure: the caller passes in the decision, the typed name and the quote's figures.

/** The `decision` and `decision_reason` an application is stored with once its contract is signed. */
export const SIGNED = { decision: 'signed', reason: 'contract_signed' } as const;

/** Only an approved application can become a contract: a pending one has no answer yet,
 *  and a rejected, manual-review or cancelled one has an answer that says no. */
export function canFormContract(decision: string): boolean {
  return decision === 'approved';
}

export const SIGNATURE_MIN_LENGTH = 2;
export const SIGNATURE_MAX_LENGTH = 100;

export type SignatureResult =
  { ok: true; name: string } | { ok: false; reason: 'signature_too_short' | 'signature_too_long' };

/**
 * Checks the name typed as a signature and tidies it: leading, trailing and repeated
 * spaces are removed, so "  Aino   Virtanen " is stored as "Aino Virtanen". It must be
 * 2 to 100 characters and contain a letter, so "  ", "7" and "--" are not signatures.
 * Whether the name matches the customer is deliberately not checked: a typed name is the
 * whole signature, and an account is not linked to one person's legal name.
 */
export function normalizeSignature(typed: string): SignatureResult {
  const name = typed.replace(/\s+/g, ' ').trim();
  const characters = [...name].length;
  if (characters > SIGNATURE_MAX_LENGTH) return { ok: false, reason: 'signature_too_long' };
  if (characters < SIGNATURE_MIN_LENGTH || !/\p{L}/u.test(name)) {
    return { ok: false, reason: 'signature_too_short' };
  }
  return { ok: true, name };
}

/**
 * The down payment an application's quote was made with. An application stores what was
 * financed, not the down payment, and financed = list price - down payment, so the
 * down payment is what is left of the list price (in the price-list version the quote
 * locked). `null` means the figures cannot belong together (financed more than the list
 * price), which a quote never produces.
 */
export function downPaymentOfQuote(listPriceCents: number, financedCents: number): number | null {
  const downPaymentCents = listPriceCents - financedCents;
  return downPaymentCents >= 0 ? downPaymentCents : null;
}
