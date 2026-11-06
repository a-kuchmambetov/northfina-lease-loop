// Orchestration for the customer's invoices page: every invoice across all of their leases.
// It reuses contracts/get-customer-invoices.ts for each lease, so opening the page issues
// whatever is due today, exactly as a lease's own invoice page does. The ordering lives in
// src/domain/customer-invoices.ts. No business rules live here.
import { listInvoicesByInvoiceDate, type LeaseInvoiceRow } from '@/domain/customer-invoices';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  getCustomerInvoices,
  type CustomerInvoices,
} from '@/server/features/contracts/get-customer-invoices';

export type CustomerInvoiceRow = LeaseInvoiceRow<
  CustomerInvoices['lease'],
  CustomerInvoices['invoices'][number]
>;

export type AllCustomerInvoices = {
  /** Newest invoice date first. */
  rows: CustomerInvoiceRow[];
  /** Leases whose invoices couldn't be worked out (e.g. VAT rates missing for their term).
   *  They are counted, not hidden, so the page can say the list is incomplete. */
  unavailableLeases: number;
};

export async function getAllCustomerInvoices(
  db: PrismaClient,
  input: { customerId: string; asOfDate: string }
): Promise<AllCustomerInvoices> {
  const contracts = await db.contract.findMany({
    where: { customer_id: input.customerId },
    select: { id: true },
    orderBy: { id: 'asc' },
  });

  // One lease at a time: issuing writes to the database.
  const leases: CustomerInvoices[] = [];
  let unavailableLeases = 0;
  for (const { id } of contracts) {
    const result = await getCustomerInvoices(db, {
      contractId: id,
      customerId: input.customerId,
      asOfDate: input.asOfDate,
    });
    if (result.ok) leases.push(result.value);
    else unavailableLeases++;
  }

  return { rows: listInvoicesByInvoiceDate(leases), unavailableLeases };
}
