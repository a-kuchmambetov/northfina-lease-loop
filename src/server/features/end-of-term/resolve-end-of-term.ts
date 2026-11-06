// Orchestration for ending a contract's term (CHALLENGE.md Spine #6): loads the locked
// contract, asks src/domain/end-of-term.ts what buying, returning, passing on or
// extending means for it, then persists the outcome. No business rules live here — see
// src/domain/end-of-term.ts and src/domain/residual-value.ts for those.
import { loadCoefficientTable, loadCustomers, loadResidualCurves } from '@/data/load';
import type { AssetCategory, AssetCondition } from '@/data/schemas';
import {
  resolveEndOfTerm,
  type EndOfTermAction,
  type EndOfTermOutcome,
} from '@/domain/end-of-term';
import { lockContract, type LockContractResult, type LockedContract } from '@/domain/contract';
import { monthsBetween } from '@/domain/calendar';
import { passOnBonusCents } from '@/domain/pass-on-bonus';
import { residualValueCents } from '@/domain/residual-value';
import {
  changeAssetStatus,
  previewAssetWear,
  returnAsset,
  writeAssetWear,
  type PreviewAssetWearResult,
} from '@/server/assets';
import { withAudit } from '@/server/audit';
import { addCustomerCreditEntry } from '@/server/customer-credit';
import { persistContract, type PersistContractResult } from '../contracts/persist-contract';
import type { PrismaClient } from '@/generated/prisma/client';

export type ResolveEndOfTermInput = {
  contractId: string;
  action: EndOfTermAction;
  /** `YYYY-MM-DD`, the day the customer is making this choice. */
  asOfDate: string;
  additionalTermMonths?: number;
  /** Required, and only used, when `action` is `'pass_on'`: who the item goes straight to
   *  next — an existing customer the first customer (or the app) names, since
   *  `data/second-life-demand.json`'s waiting list has no `customer_id` to sign a real
   *  contract for (see src/server/features/second-life/README.md). */
  nextCustomerId?: string;
  /** Required, and only used, when `action` is `'pass_on'`: the new lease's term. */
  nextTermMonths?: number;
};

type OutcomeFailureReason = Extract<EndOfTermOutcome, { ok: false }>['reason'];
type LockFailureReason = Extract<LockContractResult, { ok: false }>['reason'];
type PersistFailureReason = Extract<PersistContractResult, { ok: false }>['reason'];

export type ResolveEndOfTermResult =
  | { ok: true; outcome: 'bought'; amountCents: number }
  | { ok: true; outcome: 'returned' }
  | {
      ok: true;
      outcome: 'passed_on';
      bonusCents: number;
      newContract: LockedContract & { id: string; signedAt: string };
    }
  | {
      ok: true;
      outcome: 'extended';
      newContract: LockedContract & { id: string; signedAt: string };
    }
  | {
      ok: false;
      reason:
        | 'contract_not_found'
        | 'contract_pending_signature'
        | 'contract_already_settled'
        | 'asset_not_found'
        | 'next_customer_required'
        | 'unknown_customer'
        | OutcomeFailureReason
        | LockFailureReason
        | PersistFailureReason;
    };

export async function resolveContractEndOfTerm(
  db: PrismaClient,
  input: ResolveEndOfTermInput
): Promise<ResolveEndOfTermResult> {
  const contract = await db.contract.findUnique({ where: { id: input.contractId } });
  if (!contract) return { ok: false, reason: 'contract_not_found' };
  // Not a settled contract — it just hasn't started: still waiting on the named
  // signatory from scenario card 6 ("Who can sign?"). Distinct from the generic
  // "already settled" rejection below, which is about contracts that are *finished*.
  if (contract.status === 'pending_signature') {
    return { ok: false, reason: 'contract_pending_signature' };
  }
  if (contract.status !== 'active') return { ok: false, reason: 'contract_already_settled' };

  // 'pass_on' needs the item's condition *after* this lease's wear before the domain
  // function can decide whether it's good enough to skip the refurbishment queue —
  // everything else can go straight through.
  let conditionAfterWear: AssetCondition | undefined;
  let wearPreview: Extract<PreviewAssetWearResult, { ok: true }> | undefined;
  if (input.action === 'pass_on') {
    const asset = await db.asset.findUnique({ where: { id: contract.asset_id } });
    if (!asset) return { ok: false, reason: 'asset_not_found' };

    const preview = await previewAssetWear(db, {
      id: contract.asset_id,
      category: asset.category as AssetCategory,
      monthsLeased: contract.term_months,
    });
    if (!preview.ok) return { ok: false, reason: 'asset_not_found' };
    wearPreview = preview;
    conditionAfterWear = preview.wear.conditionAfter;
  }

  const outcome = resolveEndOfTerm({
    startDate: contract.start_date,
    termMonths: contract.term_months,
    buyoutCents: contract.buyout_cents,
    action: input.action,
    asOfDate: input.asOfDate,
    additionalTermMonths: input.additionalTermMonths,
    conditionAfterWear,
  });
  if (!outcome.ok) return outcome;

  if (outcome.outcome === 'bought') {
    await withAudit(
      db,
      {
        actor: 'customer',
        action: 'contract.bought',
        entityType: 'contract',
        entityId: input.contractId,
        details: { amountCents: outcome.amountCents },
      },
      (tx) => tx.contract.update({ where: { id: input.contractId }, data: { status: 'bought' } })
    );
    // The item leaves the fleet for good — it never comes back, unlike 'reserved'.
    await changeAssetStatus(db, { id: contract.asset_id, status: 'sold', actor: 'customer' });
    return outcome;
  }

  if (outcome.outcome === 'returned') {
    const asset = await db.asset.findUnique({ where: { id: contract.asset_id } });
    if (!asset) return { ok: false, reason: 'asset_not_found' };

    await withAudit(
      db,
      {
        actor: 'customer',
        action: 'contract.returned',
        entityType: 'contract',
        entityId: input.contractId,
      },
      (tx) => tx.contract.update({ where: { id: input.contractId }, data: { status: 'returned' } })
    );
    // Into the refurbishment queue, assessed for wear (CHALLENGE.md Spine #7, not built
    // yet — see src/domain/wear.ts).
    await returnAsset(db, {
      id: contract.asset_id,
      category: asset.category as AssetCategory,
      monthsLeased: contract.term_months,
      actor: 'customer',
    });
    return outcome;
  }

  if (outcome.outcome === 'passed_on') {
    if (!input.nextCustomerId || !input.nextTermMonths) {
      return { ok: false, reason: 'next_customer_required' };
    }

    // wearPreview was computed above to validate the request — reuse it instead of
    // asking the database the same question again.
    const preview = wearPreview!;
    const bonusCents = passOnBonusCents(contract.buyout_cents, preview.wear.conditionAfter);

    const asset = await db.asset.findUnique({ where: { id: contract.asset_id } });
    if (!asset) return { ok: false, reason: 'asset_not_found' };

    const [coefficientTable, residualCurves, customers] = await Promise.all([
      loadCoefficientTable(),
      loadResidualCurves(),
      loadCustomers(),
    ]);
    if (!customers.some((customer) => customer.id === input.nextCustomerId)) {
      return { ok: false, reason: 'unknown_customer' };
    }

    // "Pass it on" means the item goes straight to its next lease, not back to the shop —
    // priced off what it is worth right now (src/domain/residual-value.ts), same as an
    // extend, but for a new customer instead of the same one.
    const ageMonths = monthsBetween(contract.start_date, input.asOfDate);
    const valueCents = residualValueCents(residualCurves, {
      category: asset.category as AssetCategory,
      netListPriceAtFirstLeaseCents: contract.list_price_cents,
      ageMonths,
      condition: preview.wear.conditionAfter,
      usageValue: preview.wear.usageValueAfter,
    });

    const lockResult = lockContract(coefficientTable, {
      assetId: contract.asset_id,
      customerId: input.nextCustomerId,
      startDate: input.asOfDate,
      termMonths: input.nextTermMonths,
      downPaymentCents: 0,
      listPriceCents: valueCents,
      // Not from data/price-lists.json — priced off a residual valuation instead. 0 flags
      // that; see src/server/features/contracts/README.md.
      priceListVersion: 0,
    });
    if (!lockResult.ok) return lockResult;

    const persisted = await persistContract(db, lockResult.contract, 'contract.pass_on_leased');
    if (!persisted.ok) return persisted;

    await withAudit(
      db,
      {
        actor: 'customer',
        action: 'contract.passed_on',
        entityType: 'contract',
        entityId: input.contractId,
        details: {
          bonusCents,
          nextContractId: persisted.contract.id,
          residualValueCents: valueCents,
        },
      },
      (tx) => tx.contract.update({ where: { id: input.contractId }, data: { status: 'returned' } })
    );
    // Straight into the next lease — never idle in the pool, same as an extend.
    await writeAssetWear(db, {
      id: contract.asset_id,
      status: 'reserved',
      wear: preview.wear,
      monthsLeased: contract.term_months,
      actor: 'customer',
    });
    // The reward for passing it on well-maintained: a credit the customer can put toward
    // the down payment on a future lease (src/server/features/contracts/sign-contract.ts).
    await addCustomerCreditEntry(db, {
      customerId: contract.customer_id,
      amountCents: bonusCents,
      reason: 'pass_on_bonus',
      relatedContractId: input.contractId,
      actor: 'system',
    });
    return { ok: true, outcome: 'passed_on', bonusCents, newContract: persisted.contract };
  }

  // 'extend_approved': really a brand new lease of the same item for a new term, priced
  // off what it is worth today (src/domain/residual-value.ts) — not its original price.
  const asset = await db.asset.findUnique({ where: { id: contract.asset_id } });
  if (!asset) return { ok: false, reason: 'asset_not_found' };

  const [coefficientTable, residualCurves] = await Promise.all([
    loadCoefficientTable(),
    loadResidualCurves(),
  ]);

  // The item has genuinely aged over this term, whether or not it's extended — price the
  // renewal off its real wear, not whatever it looked like before this lease even started.
  const extendWearPreview = await previewAssetWear(db, {
    id: contract.asset_id,
    category: asset.category as AssetCategory,
    monthsLeased: contract.term_months,
  });
  if (!extendWearPreview.ok) return { ok: false, reason: 'asset_not_found' };

  const ageMonths = monthsBetween(contract.start_date, input.asOfDate);
  const valueCents = residualValueCents(residualCurves, {
    category: asset.category as AssetCategory,
    netListPriceAtFirstLeaseCents: contract.list_price_cents,
    ageMonths,
    condition: extendWearPreview.wear.conditionAfter,
    usageValue: extendWearPreview.wear.usageValueAfter,
  });

  const lockResult = lockContract(coefficientTable, {
    assetId: contract.asset_id,
    customerId: contract.customer_id,
    startDate: input.asOfDate,
    termMonths: outcome.additionalTermMonths,
    downPaymentCents: 0,
    listPriceCents: valueCents,
    // Not from data/price-lists.json — this contract's price came from a residual
    // valuation instead. 0 flags that; see src/server/features/contracts/README.md.
    priceListVersion: 0,
  });
  if (!lockResult.ok) return lockResult;

  const persisted = await persistContract(db, lockResult.contract, 'contract.renewed');
  if (!persisted.ok) return persisted;

  await withAudit(
    db,
    {
      actor: 'customer',
      action: 'contract.extended',
      entityType: 'contract',
      entityId: input.contractId,
      details: { renewedAsContractId: persisted.contract.id, residualValueCents: valueCents },
    },
    (tx) => tx.contract.update({ where: { id: input.contractId }, data: { status: 'extended' } })
  );
  // The wear is real whether or not the lease continues — record it now that the renewal
  // (which was priced off it) has actually gone through. Still 'reserved': the same item
  // keeps going straight into the new contract, never idle in the pool.
  await writeAssetWear(db, {
    id: contract.asset_id,
    status: 'reserved',
    wear: extendWearPreview.wear,
    monthsLeased: contract.term_months,
    actor: 'customer',
  });

  return { ok: true, outcome: 'extended', newContract: persisted.contract };
}
