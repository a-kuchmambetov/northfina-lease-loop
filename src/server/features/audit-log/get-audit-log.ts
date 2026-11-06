// Orchestration for GET /api/audit-log: who may read the trail and which rows they get.
// The decisions (role, which entity types belong to a supplier) are in
// src/domain/audit-access.ts; this file resolves a supplier's assets to the contracts,
// applications and invoices behind them and reads the matching audit rows. Read-only.
import { auditAccess, supplierAuditTargets, type SupplierAuditScope } from '@/domain/audit-access';
import { suppliesAsset } from '@/domain/catalogue';
import type { PrismaClient } from '@/generated/prisma/client';

/** An audit row as a supplier sees it. There is no `details`: it carries applicant data. */
export type SupplierAuditEntry = {
  id: number;
  created_at: string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
};

export type AuditLogResult =
  { ok: true; entries: SupplierAuditEntry[] } | { ok: false; reason: 'forbidden' };

export async function getAuditLog(
  db: PrismaClient,
  input: { accountType: string | undefined; accountName: string; limit?: number }
): Promise<AuditLogResult> {
  if (auditAccess(input.accountType) !== 'supplier') return { ok: false, reason: 'forbidden' };

  const scope = await loadSupplierScope(db, input.accountName);
  const targets = supplierAuditTargets(scope);
  if (targets.length === 0) return { ok: true, entries: [] };

  const rows = await db.auditLog.findMany({
    where: {
      NOT: { action: { startsWith: 'auth.' } },
      OR: targets.map((target) => ({
        entity_type: target.entityType,
        entity_id: { in: [...target.entityIds] },
      })),
    },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: input.limit ?? 50,
    // `details_json` is deliberately not selected.
    select: {
      id: true,
      created_at: true,
      actor: true,
      action: true,
      entity_type: true,
      entity_id: true,
    },
  });
  return {
    ok: true,
    entries: rows.map((row) => ({ ...row, created_at: row.created_at.toISOString() })),
  };
}

async function loadSupplierScope(
  db: PrismaClient,
  supplierName: string
): Promise<SupplierAuditScope> {
  const assets = await db.asset.findMany({ select: { id: true, make: true } });
  const assetIds = assets
    .filter((asset) => suppliesAsset(supplierName, asset.make))
    .map((asset) => asset.id);
  if (assetIds.length === 0) {
    return { assetIds, contractIds: [], applicationIds: [], invoiceIds: [] };
  }
  const [contracts, applications] = await Promise.all([
    db.contract.findMany({ where: { asset_id: { in: assetIds } }, select: { id: true } }),
    db.application.findMany({ where: { asset_id: { in: assetIds } }, select: { id: true } }),
  ]);
  const contractIds = contracts.map((contract) => contract.id);
  const invoices =
    contractIds.length === 0
      ? []
      : await db.invoice.findMany({
          where: { contract_id: { in: contractIds } },
          select: { id: true },
        });
  return {
    assetIds,
    contractIds,
    applicationIds: applications.map((application) => application.id),
    invoiceIds: invoices.map((invoice) => invoice.id),
  };
}
