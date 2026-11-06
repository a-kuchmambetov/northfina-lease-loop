// Locking a contract (CHALLENGE.md Spine #4): signing fixes the net rent and the
// end-of-term buyout for good. A price-list change after this point must never touch them —
// only VAT stays unlocked, because it is charged at the rate on each invoice's own date
// (CHALLENGE.md Smart Problem "Lock the price, not the tax"; see src/domain/invoicing.ts).
import type { CoefficientTable } from '@/data/schemas';
import { quoteNetRent, type NetRentFailureReason } from './pricing';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type ContractInput = {
  assetId: string;
  customerId: string;
  /** `YYYY-MM-DD`. The day the contract is signed; also invoice #1's invoice date. */
  startDate: string;
  termMonths: number;
  downPaymentCents: number;
  /** The net list price on `startDate` — the caller looks this up, see src/domain/price-list.ts. */
  listPriceCents: number;
  /** Which price-list version `listPriceCents` came from, kept for the audit trail. */
  priceListVersion: number;
};

export type LockedContract = {
  assetId: string;
  customerId: string;
  startDate: string;
  termMonths: number;
  priceListVersion: number;
  listPriceCents: number;
  downPaymentCents: number;
  financedCents: number;
  monthlyNetRentCents: number;
  buyoutCents: number;
};

export type LockContractResult =
  { ok: true; contract: LockedContract } | { ok: false; reason: NetRentFailureReason };

/** Locks a contract's net rent and buyout at signing. See the file header for what "locked" means. */
export function lockContract(
  coefficientTable: CoefficientTable,
  input: ContractInput
): LockContractResult {
  if (!ISO_DATE.test(input.startDate)) {
    throw new RangeError(`startDate must look like YYYY-MM-DD, got "${input.startDate}"`);
  }

  const netRentResult = quoteNetRent(coefficientTable, {
    listPriceCents: input.listPriceCents,
    downPaymentCents: input.downPaymentCents,
    termMonths: input.termMonths,
  });
  if (!netRentResult.ok) return netRentResult;

  const { netRent } = netRentResult;
  return {
    ok: true,
    contract: {
      assetId: input.assetId,
      customerId: input.customerId,
      startDate: input.startDate,
      termMonths: input.termMonths,
      priceListVersion: input.priceListVersion,
      listPriceCents: netRent.listPriceCents,
      downPaymentCents: netRent.downPaymentCents,
      financedCents: netRent.financedCents,
      monthlyNetRentCents: netRent.monthlyNetRentCents,
      buyoutCents: netRent.buyoutCents,
    },
  };
}
