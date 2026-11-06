// Orchestration for signing a contract (CHALLENGE.md Spine #4): checks the asset is free
// to lease, looks up the net list price on the signing date, locks the net rent and
// buyout with src/domain/contract.ts, and persists the contract (see persist-contract.ts).
// No business rules live here — see src/domain/contract.ts for those.
import { loadCoefficientTable, loadPriceLists } from '@/data/load';
import { lockContract, type LockContractResult } from '@/domain/contract';
import { listPriceInVersion, listPriceOn, type ListPriceResult } from '@/domain/price-list';
import { transitionAssetStatus } from '@/server/assets';
import {
  addCustomerCreditEntryInTx,
  getCustomerCreditBalanceCents,
} from '@/server/customer-credit';
import {
  persistContract,
  type ContractSignature,
  type PersistContractOptions,
  type PersistContractResult,
} from './persist-contract';
import type { PrismaClient } from '@/generated/prisma/client';

export type SignContractInput = {
  assetId: string;
  customerId: string;
  termMonths: number;
  downPaymentCents: number;
  /** How much of the customer's credit balance (src/server/customer-credit.ts, e.g. a
   *  pass_on bonus) to put toward the down payment, on top of `downPaymentCents`. */
  creditCentsToApply?: number;
  /** `YYYY-MM-DD`. Also locks which price-list version applies. */
  signDate: string;
  /** The approved `Application` (CHALLENGE.md Spine #3) this signing is for. Optional —
   *  see src/server/features/contracts/README.md for why — but when given, it must be
   *  `'approved'` and for this same customer/asset/term, and its own
   *  `answers_json.q_can_sign` decides whether the contract starts `'active'` or
   *  `'pending_signature'` (scenario card 6, "Who can sign?"). */
  applicationId?: string;
  /** Set when signing an approved application (see sign-application-contract.ts): the
   *  price comes from the price-list version the application locked, not from the list
   *  valid on `signDate`, and the contract records the application and the typed name. */
  fromApplication?: ContractSignature & { priceListVersion: number };
};

type LockFailureReason = Extract<LockContractResult, { ok: false }>['reason'];
type ListPriceFailureReason = Extract<ListPriceResult, { ok: false }>['reason'];
type PersistFailureReason = Extract<PersistContractResult, { ok: false }>['reason'];

export type SignContractResult =
  | Extract<PersistContractResult, { ok: true }>
  | {
      ok: false;
      reason:
        | 'asset_not_found'
        | 'asset_not_available'
        | 'unknown_customer'
        | 'insufficient_credit'
        | 'application_not_found'
        | 'application_not_approved'
        | 'application_mismatch'
        | LockFailureReason
        | ListPriceFailureReason
        | PersistFailureReason;
    };

export async function signContract(
  db: PrismaClient,
  input: SignContractInput
): Promise<SignContractResult> {
  const asset = await db.asset.findUnique({ where: { id: input.assetId } });
  if (!asset) return { ok: false, reason: 'asset_not_found' };
  // Fast path only: it spares the lookups below when the item is plainly taken. It is NOT
  // what prevents a double booking — two requests can both pass it. The atomic
  // available → reserved swap inside the signing transaction (below) is.
  if (asset.status !== 'available') return { ok: false, reason: 'asset_not_available' };

  const [priceLists, coefficientTable, customer] = await Promise.all([
    loadPriceLists(),
    loadCoefficientTable(),
    db.customer.findUnique({ where: { id: input.customerId } }),
  ]);
  if (!customer) return { ok: false, reason: 'unknown_customer' };

  const creditCentsToApply = input.creditCentsToApply ?? 0;
  if (creditCentsToApply > 0) {
    const balance = await getCustomerCreditBalanceCents(db, input.customerId);
    if (creditCentsToApply > balance) return { ok: false, reason: 'insufficient_credit' };
  }

  let pendingSignatoryEmail: string | undefined;
  if (input.applicationId) {
    const application = await db.application.findUnique({ where: { id: input.applicationId } });
    if (!application) return { ok: false, reason: 'application_not_found' };
    if (application.decision !== 'approved') {
      return { ok: false, reason: 'application_not_approved' };
    }
    if (
      application.customer_id !== input.customerId ||
      application.asset_id !== input.assetId ||
      application.term_months !== input.termMonths
    ) {
      return { ok: false, reason: 'application_mismatch' };
    }

    const answers: Record<string, unknown> = JSON.parse(application.answers_json);
    if (answers['q_can_sign'] === 'no') {
      const signatoryEmail = answers['q_signatory_email'];
      pendingSignatoryEmail = typeof signatoryEmail === 'string' ? signatoryEmail : undefined;
    }
  }

  const { fromApplication } = input;
  const listPrice = fromApplication
    ? listPriceInVersion(priceLists, input.assetId, fromApplication.priceListVersion)
    : listPriceOn(priceLists, input.assetId, input.signDate);
  if (!listPrice.ok) return listPrice;

  const lockResult = lockContract(coefficientTable, {
    assetId: input.assetId,
    customerId: input.customerId,
    startDate: input.signDate,
    termMonths: input.termMonths,
    // Cash and credit are both "paid upfront" from the pricing formula's point of view —
    // only src/server/customer-credit.ts's ledger remembers the split.
    downPaymentCents: input.downPaymentCents + creditCentsToApply,
    listPriceCents: listPrice.priceCents,
    priceListVersion: listPrice.priceListVersion,
  });
  if (!lockResult.ok) return lockResult;

  const persistOptions: PersistContractOptions = {
    status: pendingSignatoryEmail ? 'pending_signature' : 'active',
    pendingSignatoryEmail,
    ...(fromApplication && {
      applicationId: fromApplication.applicationId,
      signedName: fromApplication.signedName,
    }),
    // Same transaction as the contract row and its audit entry: if the asset was taken
    // between the check above and now, none of it commits — no contract, no credit spent.
    // Reserved, not "leased": the data pack's AssetStatus has no dedicated state for "under
    // an active lease", and 'reserved' already means "not available for a new lease".
    inTransaction: async (tx, contractId) => {
      const reserved = await transitionAssetStatus(tx, {
        id: input.assetId,
        from: 'available',
        to: 'reserved',
        actor: 'customer',
      });
      if (!reserved.ok) return { ok: false, reason: 'asset_not_available' };

      if (creditCentsToApply > 0) {
        await addCustomerCreditEntryInTx(tx, {
          customerId: input.customerId,
          amountCents: -creditCentsToApply,
          reason: 'applied_to_down_payment',
          relatedContractId: contractId,
          actor: 'customer',
        });
      }
      return { ok: true };
    },
  };
  const persisted = await persistContract(
    db,
    lockResult.contract,
    'contract.signed',
    persistOptions
  );
  if (!persisted.ok) return persisted;

  return persisted;
}
