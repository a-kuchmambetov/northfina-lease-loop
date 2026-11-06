import { describe, expect, it } from 'vitest';
import { auditAccess, supplierAuditTargets } from './audit-access';

describe('auditAccess', () => {
  it('lets a supplier read the audit trail', () => {
    expect(auditAccess('supplier')).toBe('supplier');
  });

  it.each(['customer', 'admin', '', 'Supplier'])('denies a %j account', (accountType) => {
    expect(auditAccess(accountType)).toBe('denied');
  });

  it('denies an account with no type', () => {
    expect(auditAccess(undefined)).toBe('denied');
  });
});

describe('supplierAuditTargets', () => {
  it('has one target per entity type that has ids', () => {
    expect(
      supplierAuditTargets({
        assetIds: ['a1'],
        contractIds: ['c1', 'c2'],
        applicationIds: ['p1'],
        invoiceIds: ['i1'],
      })
    ).toEqual([
      { entityType: 'asset', entityIds: ['a1'] },
      { entityType: 'contract', entityIds: ['c1', 'c2'] },
      { entityType: 'application', entityIds: ['p1'] },
      { entityType: 'invoice', entityIds: ['i1'] },
    ]);
  });

  it('leaves out entity types with no ids', () => {
    expect(
      supplierAuditTargets({
        assetIds: ['a1'],
        contractIds: [],
        applicationIds: [],
        invoiceIds: [],
      })
    ).toEqual([{ entityType: 'asset', entityIds: ['a1'] }]);
  });

  it('is empty for a supplier with nothing', () => {
    expect(
      supplierAuditTargets({ assetIds: [], contractIds: [], applicationIds: [], invoiceIds: [] })
    ).toEqual([]);
  });

  it('never targets customer rows', () => {
    const types = supplierAuditTargets({
      assetIds: ['a'],
      contractIds: ['c'],
      applicationIds: ['p'],
      invoiceIds: ['i'],
    }).map((target) => target.entityType);
    expect(types).not.toContain('customer');
    expect(types).not.toContain('customer_credit');
  });
});
