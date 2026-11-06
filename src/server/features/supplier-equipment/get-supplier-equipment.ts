// Orchestration for the supplier's "Your equipment" page: the items of one supplier (matched
// by brand, see src/domain/catalogue.ts `suppliesAsset`), each with its state
// (src/domain/supplier-equipment.ts), its latest contract and who rents it. Read-only.
// No business rules live here.
import { loadCustomers } from '@/data/load';
import type { Asset } from '@/data/schemas';
import { suppliesAsset } from '@/domain/catalogue';
import { contractTotals } from '@/domain/contract-totals';
import { termEndDate } from '@/domain/end-of-term';
import { RETURN_AUDIT_ACTIONS } from '@/domain/return-request';
import {
  applicationCode,
  contractCode,
  supplierItemStatus,
  type SupplierItemStatus,
} from '@/domain/supplier-equipment';
import type { PrismaClient } from '@/generated/prisma/client';
import { todayIso } from '@/server/today';

export type SupplierContract = {
  id: string;
  code: string;
  renter: string;
  /** `active`, `bought` or `returned`, as stored. */
  status: string;
  startDate: string;
  /** `YYYY-MM-DD`: when the term ends. */
  endDate: string;
  termMonths: number;
  monthlyNetRentCents: number;
  downPaymentCents: number;
  agreedNetCents: number;
  paidInvoicesCents: number;
  buyoutCents: number;
  priceListVersion: number;
  /** `YYYY-MM-DD`, in Finnish time; set for a returned lease with a recorded return. */
  returnedOn: string | null;
};

export type SupplierEquipmentItem = {
  assetId: string;
  name: string;
  serialNumber: string;
  category: Asset['category'];
  status: SupplierItemStatus;
  /** The item's most recent contract, running or settled. */
  contract: SupplierContract | null;
  /** The application waiting for review, when the item is in `manual_approval`. */
  application: { code: string; appliedOn: string } | null;
};

export async function getSupplierEquipment(
  db: PrismaClient,
  input: { supplierName: string; today: string }
): Promise<SupplierEquipmentItem[]> {
  // The database holds the live status of every item.
  const [dbAssets, customers] = await Promise.all([
    db.asset.findMany({ orderBy: { id: 'asc' } }),
    loadCustomers(),
  ]);
  const owned = dbAssets.filter((row) => suppliesAsset(input.supplierName, row.make));
  if (owned.length === 0) return [];
  const assetIds = owned.map((row) => row.id);

  const [contracts, applications] = await Promise.all([
    db.contract.findMany({
      where: { asset_id: { in: assetIds } },
      orderBy: [{ signed_at: 'desc' }, { start_date: 'desc' }],
    }),
    db.application.findMany({
      where: { asset_id: { in: assetIds }, decision: 'manual_review' },
      orderBy: { created_at: 'desc' },
    }),
  ]);
  const latestContract = new Map<string, (typeof contracts)[number]>();
  for (const contract of contracts) {
    if (!latestContract.has(contract.asset_id)) latestContract.set(contract.asset_id, contract);
  }
  const invoices = await db.invoice.findMany({
    where: { contract_id: { in: [...latestContract.values()].map((contract) => contract.id) } },
    select: { contract_id: true, status: true, gross_cents: true },
  });
  const latestApplication = new Map<string, (typeof applications)[number]>();
  for (const application of applications) {
    if (!latestApplication.has(application.asset_id)) {
      latestApplication.set(application.asset_id, application);
    }
  }

  const returnedContractIds = [...latestContract.values()]
    .filter((contract) => contract.status === 'returned')
    .map((contract) => contract.id);
  const returns =
    returnedContractIds.length === 0
      ? []
      : await db.auditLog.findMany({
          where: {
            entity_type: 'contract',
            entity_id: { in: returnedContractIds },
            action: { in: [...RETURN_AUDIT_ACTIONS] },
          },
          orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
        });
  const returnedOn = new Map(returns.map((row) => [row.entity_id, todayIso(row.created_at)]));
  const customersById = new Map(customers.map((customer) => [customer.id, customer]));

  return owned.map((row): SupplierEquipmentItem => {
    const contract = latestContract.get(row.id) ?? null;
    const endDate = contract ? termEndDate(contract.start_date, contract.term_months) : null;
    const running = contract?.status === 'active' ? contract : null;
    const application = latestApplication.get(row.id) ?? null;
    const status = supplierItemStatus({
      assetStatus: packStatus(row.status),
      activeLease: running && endDate ? { termOver: input.today >= endDate } : null,
      applicationInReview: application !== null,
    });
    return {
      assetId: row.id,
      name: `${row.make} ${row.model}`,
      serialNumber: row.serial_number,
      category: row.category as Asset['category'],
      status,
      contract:
        contract && endDate
          ? {
              id: contract.id,
              code: contractCode(contract.id),
              // The name typed at signing, or the data pack's, like on an invoice.
              renter:
                contract.signed_name ??
                customersById.get(contract.customer_id)?.name ??
                contract.customer_id,
              status: contract.status,
              startDate: contract.start_date,
              endDate,
              termMonths: contract.term_months,
              monthlyNetRentCents: contract.monthly_net_rent_cents,
              downPaymentCents: contract.down_payment_cents,
              ...contractTotals({
                downPaymentCents: contract.down_payment_cents,
                monthlyNetRentCents: contract.monthly_net_rent_cents,
                termMonths: contract.term_months,
                invoices: invoices
                  .filter((invoice) => invoice.contract_id === contract.id)
                  .map((invoice) => ({ status: invoice.status, grossCents: invoice.gross_cents })),
              }),
              buyoutCents: contract.buyout_cents,
              priceListVersion: contract.price_list_version,
              returnedOn: returnedOn.get(contract.id) ?? null,
            }
          : null,
      application:
        status === 'manual_approval' && application
          ? {
              code: applicationCode(application.id),
              appliedOn: todayIso(application.created_at),
            }
          : null,
    };
  });
}

function packStatus(status: string): Asset['status'] {
  return status === 'reserved' || status === 'returned' || status === 'sold' ? status : 'available';
}
