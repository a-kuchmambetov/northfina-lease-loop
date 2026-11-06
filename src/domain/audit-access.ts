// Who may read the audit trail, and which rows a supplier may see. Pure: the caller loads the
// ids and passes them in (src/server/features/audit-log/).
//
// The trail holds every customer's applications, decisions and contracts, so it is never
// public and never system-wide:
//  - a supplier sees only the rows about their own equipment (matched by brand, see
//    `suppliesAsset` in catalogue.ts), and never the rows' `details` (applicant data such as
//    review flags, signed names and amounts);
//  - a customer has no access: the trail is an operations view and a customer's own history
//    is on their account pages. Rows about customers (`customer`, `customer_credit`) are
//    personal data and are never part of a supplier's scope.

export type AuditAccess = 'supplier' | 'denied';

/** Only a supplier account may read the audit trail; every other account type is denied. */
export function auditAccess(accountType: string | undefined): AuditAccess {
  return accountType === 'supplier' ? 'supplier' : 'denied';
}

/** The ids, already resolved, of everything that belongs to one supplier's equipment. */
export type SupplierAuditScope = {
  assetIds: readonly string[];
  contractIds: readonly string[];
  applicationIds: readonly string[];
  invoiceIds: readonly string[];
};

export type AuditTarget = { entityType: string; entityIds: readonly string[] };

/**
 * The `(entity_type, entity_id)` pairs a supplier may see, one target per entity type that has
 * any ids. A type missing here (`customer`, `customer_credit`, anything new) is invisible to
 * suppliers by default.
 */
export function supplierAuditTargets(scope: SupplierAuditScope): AuditTarget[] {
  const targets: AuditTarget[] = [
    { entityType: 'asset', entityIds: scope.assetIds },
    { entityType: 'contract', entityIds: scope.contractIds },
    { entityType: 'application', entityIds: scope.applicationIds },
    { entityType: 'invoice', entityIds: scope.invoiceIds },
  ];
  return targets.filter((target) => target.entityIds.length > 0);
}
