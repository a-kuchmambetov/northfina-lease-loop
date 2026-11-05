// Orchestration for signing a contract (CHALLENGE.md Spine #4): looks up the net list
// price on the signing date, locks the net rent and buyout with src/domain/contract.ts,
// and persists the contract in the same transaction as its audit row. No business rules
// live here — see src/domain/contract.ts for those.
import { randomUUID } from 'node:crypto';
import { loadCoefficientTable, loadPriceLists } from '@/data/load';
import { lockContract, type LockContractResult, type LockedContract } from '@/domain/contract';
import { listPriceOn, type ListPriceResult } from '@/domain/price-list';
import { withAudit } from '@/server/audit';
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

export type SignContractResult =
  | { ok: true; contract: LockedContract & { id: string; signedAt: string } }
  | { ok: false; reason: LockFailureReason | ListPriceFailureReason };

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

  const { contract } = lockResult;
  const id = randomUUID();

  const row = await withAudit(
    db,
    { actor: 'customer', action: 'contract.signed', entityType: 'contract', entityId: id },
    (tx) =>
      tx.contract.create({
        data: {
          id,
          asset_id: contract.assetId,
          customer_id: contract.customerId,
          start_date: contract.startDate,
          term_months: contract.termMonths,
          price_list_version: contract.priceListVersion,
          list_price_cents: contract.listPriceCents,
          down_payment_cents: contract.downPaymentCents,
          financed_cents: contract.financedCents,
          monthly_net_rent_cents: contract.monthlyNetRentCents,
          buyout_cents: contract.buyoutCents,
        },
      })
  );

  return { ok: true, contract: { ...contract, id: row.id, signedAt: row.signed_at.toISOString() } };
}
