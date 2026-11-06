// Building blocks for settling a contract (buy out, return, extend, pass on) in ONE
// transaction together with the asset's status change (KNOWN_ISSUES.md item 2). Every step
// is a compare-and-swap: the contract moves out of `'active'` only if it still is, and the
// asset moves out of `'reserved'` (leased out) only if it still is. A step that loses throws,
// so the surrounding `withAudit` / `persistContract` transaction rolls back everything —
// no half-settled contract, no stray audit rows — and `catchSettlementConflict` turns the
// throw into a result the API route maps to 409. No business rules live here.
import {
  AssetStatusConflictError,
  transitionAssetStatus,
  writeAssetWearInTx,
  type WriteAssetWearInput,
} from '@/server/assets';
import type { AssetStatus } from '@/data/schemas';
import type { TransactionClient } from '@/server/audit';

/** Thrown inside a transaction when the contract was no longer `'active'`. */
export class ContractAlreadySettledError extends Error {
  constructor(readonly contractId: string) {
    super(`Contract ${contractId} is no longer active`);
    this.name = 'ContractAlreadySettledError';
  }
}

export type SettlementConflictReason = 'contract_already_settled' | 'asset_status_conflict';

/** The status a leased item sits in (see sign-contract.ts): out on lease, will come back. */
const LEASED: AssetStatus = 'reserved';

/** Atomically moves a contract from `'active'` to `to`; throws if it was no longer active. */
export async function settleContractInTx(
  tx: TransactionClient,
  input: { contractId: string; to: 'bought' | 'returned' | 'extended' }
): Promise<void> {
  const { count } = await tx.contract.updateMany({
    where: { id: input.contractId, status: 'active' },
    data: { status: input.to },
  });
  if (count !== 1) throw new ContractAlreadySettledError(input.contractId);
}

/** Atomically moves a leased (`'reserved'`) asset to `to`; throws if it was in any other status. */
export async function transitionLeasedAssetInTx(
  tx: TransactionClient,
  input: { id: string; to: AssetStatus; actor: string }
): Promise<void> {
  // A contract cannot outlive its asset row, so "not found" here only means the asset
  // changed under us — the same conflict as a different status.
  const moved = await transitionAssetStatus(tx, { ...input, from: LEASED });
  if (!moved.ok) throw new AssetStatusConflictError(input.id);
}

/** Records a leased asset's wear and new status; throws if it was no longer `'reserved'`. */
export async function writeLeasedAssetWearInTx(
  tx: TransactionClient,
  input: Omit<WriteAssetWearInput, 'expectedStatus'>
): Promise<void> {
  const written = await writeAssetWearInTx(tx, { ...input, expectedStatus: LEASED });
  if (!written.ok) throw new AssetStatusConflictError(input.id);
}

export type SettlementAttempt<T> =
  { ok: true; value: T } | { ok: false; reason: SettlementConflictReason };

/**
 * Runs `work` (a transaction that uses the helpers above) and turns a lost race into
 * `{ ok: false, reason }`. Any other error is rethrown. The transaction has already rolled
 * back by the time the throw reaches here.
 */
export async function catchSettlementConflict<T>(
  work: () => Promise<T>
): Promise<SettlementAttempt<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (error instanceof ContractAlreadySettledError) {
      return { ok: false, reason: 'contract_already_settled' };
    }
    if (error instanceof AssetStatusConflictError) {
      return { ok: false, reason: 'asset_status_conflict' };
    }
    throw error;
  }
}
