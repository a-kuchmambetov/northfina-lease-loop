// Orchestration for signing a contract (CHALLENGE.md Spine #4): looks up the net list
// price on the signing date, locks the net rent and buyout with src/domain/contract.ts,
// and persists the contract (see persist-contract.ts). No business rules live here — see
// src/domain/contract.ts for those.
import { loadCoefficientTable, loadPriceLists } from '@/data/load';
import { lockContract, type LockContractResult } from '@/domain/contract';
import { listPriceOn, type ListPriceResult } from '@/domain/price-list';
import { persistContract, type PersistContractResult } from './persist-contract';
import type { PrismaClient } from '@/generated/prisma/client';

export type SignContractInput = {
  assetId: string;
  customerId: string;
  termMonths: number;
  downPaymentCents: number;
  /** `YYYY-MM-DD`. Also locks which price-list version applies. */
  signDate: string;
};

type LockFailureReason = Extract<LockContractResult, { ok: false }>['reason'];
type ListPriceFailureReason = Extract<ListPriceResult, { ok: false }>['reason'];
type PersistFailureReason = Extract<PersistContractResult, { ok: false }>['reason'];

export type SignContractResult =
  | Extract<PersistContractResult, { ok: true }>
  | { ok: false; reason: LockFailureReason | ListPriceFailureReason | PersistFailureReason };

export async function signContract(
  db: PrismaClient,
  input: SignContractInput
): Promise<SignContractResult> {
  const [priceLists, coefficientTable] = await Promise.all([
    loadPriceLists(),
    loadCoefficientTable(),
  ]);

  const listPrice = listPriceOn(priceLists, input.assetId, input.signDate);
  if (!listPrice.ok) return listPrice;

  const lockResult = lockContract(coefficientTable, {
    assetId: input.assetId,
    customerId: input.customerId,
    startDate: input.signDate,
    termMonths: input.termMonths,
    downPaymentCents: input.downPaymentCents,
    listPriceCents: listPrice.priceCents,
    priceListVersion: listPrice.priceListVersion,
  });
  if (!lockResult.ok) return lockResult;

  return persistContract(db, lockResult.contract, 'contract.signed');
}
