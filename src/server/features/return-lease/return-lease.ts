// Orchestration for a customer giving their leased item back. The customer asks to "return
// it"; src/domain/lease-return.ts decides from the date whether that is the free end-of-term
// return or an early return with a fee, and the matching feature does the work
// (end-of-term/ or early-exit/). Without `confirm` nothing is changed: the customer is
// shown what returning would cost first. No business rules live here.
import { leaseMonthsElapsed, leaseReturnKind, type LeaseReturnKind } from '@/domain/lease-return';
import type { PrismaClient } from '@/generated/prisma/client';
import { resolveContractEarlyExit } from '../early-exit/resolve-early-exit';
import { resolveContractEndOfTerm } from '../end-of-term/resolve-end-of-term';

export type ReturnLeaseInput = {
  contractId: string;
  /** Only this customer's lease can be returned. */
  customerId: string;
  /** `YYYY-MM-DD`, the day the item would be returned. */
  asOfDate: string;
  /** `false` only quotes the return; `true` carries it out. */
  confirm: boolean;
};

type EarlyExitFailure = Extract<
  Awaited<ReturnType<typeof resolveContractEarlyExit>>,
  { ok: false }
>['reason'];
type EndOfTermFailure = Extract<
  Awaited<ReturnType<typeof resolveContractEndOfTerm>>,
  { ok: false }
>['reason'];

export type ReturnLeaseResult =
  | {
      ok: true;
      kind: LeaseReturnKind;
      /** The fee for the return, before VAT, in cents. Always 0 at the end of the term. */
      feeCents: number;
      /** What the fee invoice comes to with VAT, in cents; 0 when there is no fee. */
      feeGrossCents: number;
      /** Unpaid rent invoices the fee already covers, which the return cancels. */
      cancelledInvoiceCount: number;
      cancelledInvoicesGrossCents: number;
      /** Whole months of the term used so far, never more than `termMonths`. */
      monthsElapsed: number;
      termMonths: number;
      /** `false` for a quote, `true` once the item has been returned. */
      returned: boolean;
    }
  | {
      ok: false;
      reason: 'unknown_lease' | 'contract_already_settled' | EarlyExitFailure | EndOfTermFailure;
    };

export async function returnLease(
  db: PrismaClient,
  input: ReturnLeaseInput
): Promise<ReturnLeaseResult> {
  const contract = await db.contract.findUnique({ where: { id: input.contractId } });
  // Someone else's lease reads the same as one that doesn't exist.
  if (contract?.customer_id !== input.customerId) return { ok: false, reason: 'unknown_lease' };
  if (contract.status !== 'active') return { ok: false, reason: 'contract_already_settled' };

  const kind = leaseReturnKind(contract.start_date, contract.term_months, input.asOfDate);
  const summary = {
    kind,
    monthsElapsed: leaseMonthsElapsed(contract.start_date, contract.term_months, input.asOfDate),
    termMonths: contract.term_months,
    returned: input.confirm,
  };

  if (kind === 'end_of_term') {
    if (input.confirm) {
      const result = await resolveContractEndOfTerm(db, {
        contractId: contract.id,
        action: 'return',
        asOfDate: input.asOfDate,
      });
      if (!result.ok) return result;
    }
    return {
      ok: true,
      ...summary,
      feeCents: 0,
      feeGrossCents: 0,
      cancelledInvoiceCount: 0,
      cancelledInvoicesGrossCents: 0,
    };
  }

  const result = await resolveContractEarlyExit(db, {
    contractId: contract.id,
    action: 'return',
    asOfDate: input.asOfDate,
    dryRun: !input.confirm,
  });
  if (!result.ok) return result;
  if (result.outcome !== 'returned_early') throw new Error('an early return came back as a buy');
  return {
    ok: true,
    ...summary,
    feeCents: result.feeCents,
    feeGrossCents: result.feeInvoice?.grossCents ?? 0,
    cancelledInvoiceCount: result.cancelledInvoices.length,
    cancelledInvoicesGrossCents: result.cancelledInvoices.reduce(
      (sum, invoice) => sum + invoice.grossCents,
      0
    ),
  };
}
