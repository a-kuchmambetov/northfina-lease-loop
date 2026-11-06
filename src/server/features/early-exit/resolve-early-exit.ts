// Orchestration for ending a contract before its term is over (CHALLENGE.md Smart Problem
// #2, "Fair early exit"): loads the locked contract and the asset's current condition and
// usage, then asks src/domain/early-exit.ts what buying or returning early should cost.
// No business rules live here — see src/domain/early-exit.ts and
// src/domain/residual-value.ts for those.
import { randomUUID } from 'node:crypto';
import { loadResidualCurves, loadVatRates } from '@/data/load';
import type { AssetCategory } from '@/data/schemas';
import { daysBetween } from '@/domain/calendar';
import { isWithinWithdrawalWindow } from '@/domain/consumer-withdrawal';
import { leaseMonthsElapsed } from '@/domain/lease-return';
import { buildFeeInvoice, feeInvoiceSequenceNumber, type FeeInvoice } from '@/domain/fee-invoice';
import {
  isRentCoveredByReturnFee,
  resolveEarlyExit,
  type EarlyExitAction,
  type EarlyExitResult,
} from '@/domain/early-exit';
import { residualValueCents } from '@/domain/residual-value';
import { previewAssetWear } from '@/server/assets';
import { withAudit } from '@/server/audit';
import {
  catchSettlementConflict,
  settleContractInTx,
  transitionLeasedAssetInTx,
  writeLeasedAssetWearInTx,
  type SettlementConflictReason,
} from '../contracts/settle-contract';
import type { PrismaClient } from '@/generated/prisma/client';

export type ResolveEarlyExitInput = {
  contractId: string;
  action: EarlyExitAction;
  /** `YYYY-MM-DD`, the day the customer wants out. */
  asOfDate: string;
  /** Work out what it would cost, but change nothing: no status, no audit row. */
  dryRun?: boolean;
};

type OutcomeFailureReason = Extract<EarlyExitResult, { ok: false }>['reason'];

export type ResolveEarlyExitResult =
  | { ok: true; outcome: 'bought_early'; amountCents: number }
  | {
      ok: true;
      outcome: 'returned_early';
      feeCents: number;
      /** The invoice the fee is charged on (VAT added); `null` when there is no fee. */
      feeInvoice: FeeInvoice | null;
      /** Unpaid rent invoices the fee already covers, cancelled by the return (or, for a
       *  dry run, the ones it would cancel). */
      cancelledInvoices: { id: string; sequenceNumber: number; grossCents: number }[];
    }
  | {
      ok: false;
      reason:
        | 'contract_not_found'
        | 'contract_pending_signature'
        | 'contract_already_settled'
        | 'term_already_over'
        | 'asset_not_found'
        | SettlementConflictReason
        | OutcomeFailureReason
        | Extract<ReturnType<typeof buildFeeInvoice>, { ok: false }>['reason'];
    };

export async function resolveContractEarlyExit(
  db: PrismaClient,
  input: ResolveEarlyExitInput
): Promise<ResolveEarlyExitResult> {
  const contract = await db.contract.findUnique({ where: { id: input.contractId } });
  if (!contract) return { ok: false, reason: 'contract_not_found' };
  // Not a settled contract — it just hasn't started: still waiting on the named
  // signatory from scenario card 6 ("Who can sign?"). Distinct from the generic
  // "already settled" rejection below, which is about contracts that are *finished*.
  if (contract.status === 'pending_signature') {
    return { ok: false, reason: 'contract_pending_signature' };
  }
  if (contract.status !== 'active') return { ok: false, reason: 'contract_already_settled' };

  const monthsElapsed = leaseMonthsElapsed(
    contract.start_date,
    contract.term_months,
    input.asOfDate
  );
  // The term is already over — this is what src/server/features/end-of-term is for, not
  // an "early" exit.
  if (monthsElapsed >= contract.term_months) return { ok: false, reason: 'term_already_over' };

  if (input.action === 'buy') {
    const outcome = resolveEarlyExit({
      financedCents: contract.financed_cents,
      buyoutCents: contract.buyout_cents,
      monthlyNetRentCents: contract.monthly_net_rent_cents,
      termMonths: contract.term_months,
      monthsElapsed,
      action: 'buy',
    });
    if (!outcome.ok) return outcome;
    if (outcome.outcome !== 'bought_early') throw new Error('an early buy came back as a return');
    if (input.dryRun) return outcome;

    // One transaction: the contract leaves 'active' and the asset leaves 'reserved' for
    // good (it never comes back, unlike 'reserved') — or neither does, if a concurrent
    // request settled the contract or changed the asset first.
    const settled = await catchSettlementConflict(() =>
      withAudit(
        db,
        {
          actor: 'customer',
          action: 'contract.bought_early',
          entityType: 'contract',
          entityId: input.contractId,
          details: { amountCents: outcome.amountCents, monthsElapsed },
        },
        async (tx) => {
          await settleContractInTx(tx, { contractId: input.contractId, to: 'bought' });
          await transitionLeasedAssetInTx(tx, {
            id: contract.asset_id,
            to: 'sold',
            actor: 'customer',
          });
        }
      )
    );
    if (!settled.ok) return settled;
    return outcome;
  }

  const asset = await db.asset.findUnique({ where: { id: contract.asset_id } });
  if (!asset) return { ok: false, reason: 'asset_not_found' };

  // asset.condition/usage_value are never updated mid-lease — they still hold whatever
  // the item was before this contract started. Assess what monthsElapsed of this lease
  // has actually done before treating that as "now".
  const wearNow = await previewAssetWear(db, {
    id: contract.asset_id,
    category: asset.category as AssetCategory,
    monthsLeased: monthsElapsed,
  });
  if (!wearNow.ok) return { ok: false, reason: 'asset_not_found' };

  // A consumer's 14-day right of withdrawal (see src/domain/consumer-withdrawal.ts) always
  // wins over the ordinary early-exit fee formula below — it is free, not priced.
  const customer = await db.customer.findUnique({ where: { id: contract.customer_id } });
  const withinWithdrawalWindow =
    customer?.type === 'consumer' &&
    isWithinWithdrawalWindow(daysBetween(contract.start_date, input.asOfDate));

  let outcome: EarlyExitResult;
  if (withinWithdrawalWindow) {
    outcome = { ok: true, outcome: 'returned_early', feeCents: 0 };
  } else {
    const residualCurves = await loadResidualCurves();
    const residualInput = {
      category: asset.category as AssetCategory,
      netListPriceAtFirstLeaseCents: contract.list_price_cents,
      condition: wearNow.wear.conditionAfter,
      usageValue: wearNow.wear.usageValueAfter,
    };
    const residualValueNowCents = residualValueCents(residualCurves, {
      ...residualInput,
      ageMonths: monthsElapsed,
    });
    // An approximation, documented in src/server/features/early-exit/README.md: holds the
    // item's condition and usage as they are *right now* (just assessed above) fixed, and
    // only projects the age curve forward to the natural end of the term — since nobody can
    // know how much more it would really be used between now and then.
    const residualValueAtFullTermCents = residualValueCents(residualCurves, {
      ...residualInput,
      ageMonths: contract.term_months,
    });

    outcome = resolveEarlyExit({
      financedCents: contract.financed_cents,
      buyoutCents: contract.buyout_cents,
      monthlyNetRentCents: contract.monthly_net_rent_cents,
      termMonths: contract.term_months,
      monthsElapsed,
      action: 'return',
      residualValueNowCents,
      residualValueAtFullTermCents,
    });
  }
  if (!outcome.ok || outcome.outcome !== 'returned_early') return outcome;

  // The fee is charged on an invoice of its own. Worked out before anything is written, and
  // before the dry run returns, so a quote fails exactly when the real return would.
  let feeInvoice: FeeInvoice | null = null;
  if (outcome.feeCents > 0) {
    const built = buildFeeInvoice(await loadVatRates(), {
      feeCents: outcome.feeCents,
      returnDate: input.asOfDate,
    });
    if (!built.ok) return built;
    feeInvoice = built.invoice;
  }
  // The return gives up the months still to run, the month in progress included — whether
  // or not that comes with a fee (a fee of 0 still means those months are being given up,
  // not that they're still owed; see the withdrawal-window case above, where it's always
  // 0). An unpaid invoice for one of those months would otherwise be charged on top, so it
  // is cancelled either way.
  const cancelledInvoices = (
    await db.invoice.findMany({
      where: { contract_id: input.contractId, kind: 'rent', status: 'issued' },
      orderBy: { sequence_number: 'asc' },
    })
  )
    .filter((row) => isRentCoveredByReturnFee(row.sequence_number, monthsElapsed))
    .map((row) => ({
      id: row.id,
      sequenceNumber: row.sequence_number,
      grossCents: row.gross_cents,
    }));
  const result = { ...outcome, feeInvoice, cancelledInvoices };
  if (input.dryRun) return result;

  const feeInvoiceId = feeInvoice ? randomUUID() : null;
  // The contract's settlement, the asset's wear and the fee/cancelled invoices are one
  // transaction: a concurrent settlement or asset change rolls all of it back.
  const settled = await catchSettlementConflict(() =>
    withAudit(
      db,
      {
        actor: 'customer',
        action: 'contract.returned_early',
        entityType: 'contract',
        entityId: input.contractId,
        details: {
          feeCents: outcome.feeCents,
          monthsElapsed,
          feeInvoiceId,
          cancelledInvoiceIds: cancelledInvoices.map((invoice) => invoice.id),
        },
      },
      async (tx) => {
        await settleContractInTx(tx, { contractId: input.contractId, to: 'returned' });
        await writeLeasedAssetWearInTx(tx, {
          id: contract.asset_id,
          status: 'returned',
          wear: wearNow.wear,
          monthsLeased: monthsElapsed,
          actor: 'customer',
        });
        if (cancelledInvoices.length > 0) {
          // Conditional on still being unpaid: a payment that lands after the read above is
          // never overwritten. If one did, the whole return is rolled back and can be retried.
          const { count } = await tx.invoice.updateMany({
            where: { id: { in: cancelledInvoices.map((invoice) => invoice.id) }, status: 'issued' },
            data: { status: 'cancelled' },
          });
          if (count !== cancelledInvoices.length) throw new Error('an invoice was paid meanwhile');
        }
        if (feeInvoice && feeInvoiceId) {
          await tx.invoice.create({
            data: {
              id: feeInvoiceId,
              contract_id: input.contractId,
              sequence_number: feeInvoiceSequenceNumber(contract.term_months),
              kind: 'early_return_fee',
              invoice_date: feeInvoice.invoiceDate,
              payment_deadline: feeInvoice.paymentDeadline,
              net_cents: feeInvoice.netCents,
              vat_rate_percent: feeInvoice.vatRatePercent,
              vat_cents: feeInvoice.vatCents,
              gross_cents: feeInvoice.grossCents,
              status: 'issued',
            },
          });
        }
      }
    )
  );
  if (!settled.ok) return settled;

  return result;
}
