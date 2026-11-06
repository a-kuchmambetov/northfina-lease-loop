// Orchestration for forming a contract from an approved application: the customer signs
// with a typed name, the contract locks the price the application was approved at, and the
// application is closed as signed. Which applications may be signed and what counts as a
// signature are src/domain/application-contract.ts's call; the pricing is sign-contract.ts's.
import { loadPriceLists } from '@/data/load';
import {
  canFormContract,
  downPaymentOfQuote,
  normalizeSignature,
  SIGNED,
  type SignatureResult,
} from '@/domain/application-contract';
import { listPriceInVersion } from '@/domain/price-list';
import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { withAudit } from '@/server/audit';
import { signContract, type SignContractResult } from './sign-contract';

export type SignApplicationContractInput = {
  applicationId: string;
  /** Only this customer's application can be signed. */
  customerId: string;
  /** The name typed as the signature. */
  signedName: string;
  /** `YYYY-MM-DD`. The contract's start date, which is also invoice #1's invoice date. */
  signDate: string;
  /** Who is signing, for the audit log. */
  actor: string;
};

type SignatureFailureReason = Extract<SignatureResult, { ok: false }>['reason'];
type SignContractFailureReason = Extract<SignContractResult, { ok: false }>['reason'];

export type SignApplicationContractResult =
  | { ok: true; contractId: string }
  | {
      ok: false;
      reason:
        | 'unknown_application'
        | 'not_approved'
        | 'already_signed'
        | 'quote_unavailable'
        | SignatureFailureReason
        | SignContractFailureReason;
    };

export async function signApplicationContract(
  db: PrismaClient,
  input: SignApplicationContractInput
): Promise<SignApplicationContractResult> {
  const application = await db.application.findUnique({ where: { id: input.applicationId } });
  // Someone else's application reads the same as one that doesn't exist.
  if (application?.customer_id !== input.customerId) {
    return { ok: false, reason: 'unknown_application' };
  }

  // A contract may exist before the decision is updated (see below), so ask for it first.
  const existing = await db.contract.findUnique({ where: { application_id: application.id } });
  if (existing || application.decision === SIGNED.decision) {
    return { ok: false, reason: 'already_signed' };
  }
  if (!canFormContract(application.decision)) return { ok: false, reason: 'not_approved' };

  const signature = normalizeSignature(input.signedName);
  if (!signature.ok) return signature;

  // The application stores what it financed; the down payment it was quoted with is what is
  // left of the list price in the version it locked.
  const listPrice = listPriceInVersion(
    await loadPriceLists(),
    application.asset_id,
    application.price_list_version
  );
  const downPaymentCents = listPrice.ok
    ? downPaymentOfQuote(listPrice.priceCents, application.financed_amount_cents)
    : null;
  if (downPaymentCents === null) return { ok: false, reason: 'quote_unavailable' };

  let signed: SignContractResult;
  try {
    signed = await signContract(db, {
      assetId: application.asset_id,
      customerId: application.customer_id,
      termMonths: application.term_months,
      downPaymentCents,
      signDate: input.signDate,
      fromApplication: {
        applicationId: application.id,
        signedName: signature.name,
        priceListVersion: application.price_list_version,
      },
    });
  } catch (error) {
    // Two requests signing the same application at once: the unique application_id on
    // Contract lets only one contract through, and its transaction is rolled back.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, reason: 'already_signed' };
    }
    throw error;
  }
  if (!signed.ok) return signed;

  // Closes the application, so it can't be cancelled or signed again. Conditional, so a
  // cancellation that landed in between is not overwritten (the contract stands either way).
  await withAudit(
    db,
    {
      actor: input.actor,
      action: 'application.signed',
      entityType: 'application',
      entityId: application.id,
      details: { contractId: signed.contract.id },
    },
    (tx) =>
      tx.application.updateMany({
        where: { id: application.id, decision: 'approved' },
        data: { decision: SIGNED.decision, decision_reason: SIGNED.reason },
      })
  );

  return { ok: true, contractId: signed.contract.id };
}
