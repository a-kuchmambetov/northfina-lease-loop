// Orchestration for the supplier's Requests page: the leases whose item has been given back,
// newest first, with the equipment, the renter and how and when it came back. Read-only.
// No business rules live here.
import { loadAssets, loadCustomers } from '@/data/load';
import type { Asset } from '@/data/schemas';
import { RETURN_AUDIT_ACTIONS, returnKindOfAction, type ReturnKind } from '@/domain/return-request';
import type { PrismaClient } from '@/generated/prisma/client';
import { todayIso } from '@/server/today';

export type ReturnRequest = {
  contractId: string;
  assetId: string;
  assetName: string;
  category: Asset['category'] | null;
  renter: string;
  /** `YYYY-MM-DD`. */
  startDate: string;
  termMonths: number;
  /** `YYYY-MM-DD`, in Finnish time; `null` when no audit row records the return. */
  returnedOn: string | null;
  kind: ReturnKind | null;
};

export async function getReturnRequests(db: PrismaClient): Promise<ReturnRequest[]> {
  const contracts = await db.contract.findMany({ where: { status: 'returned' } });
  if (contracts.length === 0) return [];

  const [assets, customers, audit] = await Promise.all([
    loadAssets(),
    loadCustomers(),
    db.auditLog.findMany({
      where: {
        entity_type: 'contract',
        entity_id: { in: contracts.map((contract) => contract.id) },
        action: { in: [...RETURN_AUDIT_ACTIONS] },
      },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    }),
  ]);
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const customersById = new Map(customers.map((customer) => [customer.id, customer]));
  // A contract is returned once, so one row each; if there were more, the last one wins.
  const returnedBy = new Map(audit.map((row) => [row.entity_id, row]));

  const requests = contracts.map((contract): ReturnRequest => {
    const asset = assetsById.get(contract.asset_id);
    const returned = returnedBy.get(contract.id);
    return {
      contractId: contract.id,
      assetId: contract.asset_id,
      // A row stays on the page even if its asset has left the data pack.
      assetName: asset ? `${asset.make} ${asset.model}` : contract.asset_id,
      category: asset?.category ?? null,
      // The name typed at signing, or the data pack's, like on an invoice.
      renter:
        contract.signed_name ??
        customersById.get(contract.customer_id)?.name ??
        contract.customer_id,
      startDate: contract.start_date,
      termMonths: contract.term_months,
      returnedOn: returned ? todayIso(returned.created_at) : null,
      kind: returned ? returnKindOfAction(returned.action) : null,
    };
  });

  // Newest returns first; ones with no recorded date last.
  return requests.sort((a, b) => (b.returnedOn ?? '').localeCompare(a.returnedOn ?? ''));
}
