// Orchestration for the daily invoice run (CHALLENGE.md Spine #5): goes through every
// contract and issues whatever has become due by `asOfDate`, via issueDueInvoices. Meant
// to be called once a day by a scheduler (see vercel.json) — but also safe to call by hand
// with a later `asOfDate` to fast-forward a demo without waiting for real days to pass.
import { issueDueInvoices } from './issue-invoices';
import type { PrismaClient } from '@/generated/prisma/client';

export type IssueAllDueInvoicesResult = {
  contractsChecked: number;
  invoicesIssued: number;
};

export async function issueAllDueInvoices(
  db: PrismaClient,
  asOfDate: string
): Promise<IssueAllDueInvoicesResult> {
  const contracts = await db.contract.findMany({ select: { id: true } });

  let invoicesIssued = 0;
  for (const contract of contracts) {
    const before = await db.invoice.count({ where: { contract_id: contract.id } });
    const result = await issueDueInvoices(db, contract.id, asOfDate);
    if (result.ok) invoicesIssued += result.invoices.length - before;
  }

  return { contractsChecked: contracts.length, invoicesIssued };
}
