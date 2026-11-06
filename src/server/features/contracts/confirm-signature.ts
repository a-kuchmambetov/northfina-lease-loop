// Orchestration for confirming a contract that was waiting on a named signatory
// (CHALLENGE.md scenario card 6, "Who can sign?"): flips it from 'pending_signature' to
// 'active' and, now that it is, issues whatever invoices are already due. No business
// rules live here.
import { issueDueInvoices, type IssueDueInvoicesResult } from './issue-invoices';
import { withAudit } from '@/server/audit';
import type { PrismaClient } from '@/generated/prisma/client';

type IssueFailureReason = Extract<IssueDueInvoicesResult, { ok: false }>['reason'];

export type ConfirmContractSignatureResult =
  | { ok: true; invoices: Extract<IssueDueInvoicesResult, { ok: true }>['invoices'] }
  | { ok: false; reason: 'contract_not_found' | 'not_pending_signature' | IssueFailureReason };

export async function confirmContractSignature(
  db: PrismaClient,
  contractId: string,
  asOfDate: string
): Promise<ConfirmContractSignatureResult> {
  const contract = await db.contract.findUnique({ where: { id: contractId } });
  if (!contract) return { ok: false, reason: 'contract_not_found' };
  if (contract.status !== 'pending_signature') {
    return { ok: false, reason: 'not_pending_signature' };
  }

  await withAudit(
    db,
    {
      actor: 'customer',
      action: 'contract.signature_confirmed',
      entityType: 'contract',
      entityId: contractId,
      details: { pendingSignatoryEmail: contract.pending_signatory_email },
    },
    (tx) => tx.contract.update({ where: { id: contractId }, data: { status: 'active' } })
  );

  const issued = await issueDueInvoices(db, contractId, asOfDate);
  if (!issued.ok) return issued;
  return { ok: true, invoices: issued.invoices };
}
