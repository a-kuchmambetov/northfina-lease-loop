// Orchestration for signing a contract (CHALLENGE.md Spine #4): checks the asset is free
// to lease, looks up the net list price on the signing date, locks the net rent and
// buyout with src/domain/contract.ts, and persists the contract (see persist-contract.ts).
// No business rules live here — see src/domain/contract.ts for those.
import { loadCoefficientTable, loadPriceLists } from '@/data/load';
import { lockContract, type LockContractResult } from '@/domain/contract';
import { listPriceInVersion, listPriceOn, type ListPriceResult } from '@/domain/price-list';
import { changeAssetStatus } from '@/server/assets';
import { addCustomerCreditEntry, getCustomerCreditBalanceCents } from '@/server/customer-credit';
import {
  persistContract,
  type ContractSignature,
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
        | 'insufficient_credit'
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
  // Already leased, already returned and waiting for refurbishment, or otherwise taken —
  // either way, nothing stopped a second contract from being signed on it before this check.
  if (asset.status !== 'available') return { ok: false, reason: 'asset_not_available' };

  const creditCentsToApply = input.creditCentsToApply ?? 0;
  if (creditCentsToApply > 0) {
    const balance = await getCustomerCreditBalanceCents(db, input.customerId);
    if (creditCentsToApply > balance) return { ok: false, reason: 'insufficient_credit' };
  }

  const [priceLists, coefficientTable] = await Promise.all([
    loadPriceLists(),
    loadCoefficientTable(),
  ]);

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

  const persisted = await persistContract(
    db,
    lockResult.contract,
    'contract.signed',
    fromApplication && {
      applicationId: fromApplication.applicationId,
      signedName: fromApplication.signedName,
    }
  );
  if (!persisted.ok) return persisted;

  // Reserved, not "leased": the data pack's AssetStatus has no dedicated state for "under
  // an active lease", and 'reserved' already means "not available for a new lease".
  await changeAssetStatus(db, { id: input.assetId, status: 'reserved', actor: 'customer' });

  if (creditCentsToApply > 0) {
    await addCustomerCreditEntry(db, {
      customerId: input.customerId,
      amountCents: -creditCentsToApply,
      reason: 'applied_to_down_payment',
      relatedContractId: persisted.contract.id,
      actor: 'customer',
    });
  }

  return persisted;
}
