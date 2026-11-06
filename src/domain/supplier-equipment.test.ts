import { describe, expect, it } from 'vitest';
import {
  applicationCode,
  contractCode,
  filterEquipment,
  needsAction,
  pageWindow,
  summarizeEquipment,
  supplierItemStatus,
  SUPPLIER_ITEM_STATUSES,
  type SupplierItemStatus,
} from './supplier-equipment';

const none = { activeLease: null, applicationInReview: false } as const;

describe('supplierItemStatus', () => {
  it('is leased while a lease is running and its term is not over', () => {
    expect(
      supplierItemStatus({ ...none, assetStatus: 'reserved', activeLease: { termOver: false } })
    ).toBe('leased');
  });

  it('is contract_ended once the running lease is past its term', () => {
    expect(
      supplierItemStatus({ ...none, assetStatus: 'reserved', activeLease: { termOver: true } })
    ).toBe('contract_ended');
  });

  it('lets a running lease decide over the item status', () => {
    expect(
      supplierItemStatus({
        assetStatus: 'available',
        activeLease: { termOver: false },
        applicationInReview: true,
      })
    ).toBe('leased');
  });

  it('is sold or returned from the item status when no lease is running', () => {
    expect(supplierItemStatus({ ...none, assetStatus: 'sold' })).toBe('sold');
    expect(supplierItemStatus({ ...none, assetStatus: 'returned' })).toBe('returned');
  });

  it('is manual_approval for an available item with an application in review', () => {
    expect(
      supplierItemStatus({ ...none, assetStatus: 'available', applicationInReview: true })
    ).toBe('manual_approval');
  });

  it('keeps a returned item returned even with an application in review', () => {
    expect(
      supplierItemStatus({ ...none, assetStatus: 'returned', applicationInReview: true })
    ).toBe('returned');
  });

  it('is reserved when marked so with no lease behind it, and available otherwise', () => {
    expect(supplierItemStatus({ ...none, assetStatus: 'reserved' })).toBe('reserved');
    expect(supplierItemStatus({ ...none, assetStatus: 'available' })).toBe('available');
  });
});

describe('needsAction', () => {
  it('is true for an ended contract, a returned item and an application to review only', () => {
    const waiting = SUPPLIER_ITEM_STATUSES.filter(needsAction);
    expect(waiting).toEqual(['contract_ended', 'returned', 'manual_approval']);
  });
});

describe('summarizeEquipment', () => {
  it('counts each group, and the items that need action', () => {
    const statuses: SupplierItemStatus[] = [
      'leased',
      'leased',
      'contract_ended',
      'manual_approval',
      'returned',
      'available',
      'sold',
    ];
    expect(summarizeEquipment(statuses)).toEqual({
      items: 7,
      activeLeases: 2,
      contractsEnded: 1,
      requestsToReview: 1,
      needsAction: 3,
    });
  });

  it('is all zeros for no equipment', () => {
    expect(summarizeEquipment([])).toEqual({
      items: 0,
      activeLeases: 0,
      contractsEnded: 0,
      requestsToReview: 0,
      needsAction: 0,
    });
  });
});

describe('filterEquipment', () => {
  const items = [
    { id: 1, status: 'available' as const, searchText: 'Kettu Bikes Urban 1 LL-EB-240000' },
    {
      id: 2,
      status: 'leased' as const,
      searchText: 'Kettu Bikes Trail 500 LL-EB-240274 LL-AAAAAA',
    },
    { id: 3, status: 'contract_ended' as const, searchText: 'Kettu Bikes Urban 2 LL-EB-240137' },
    { id: 4, status: 'returned' as const, searchText: 'Kettu Bikes Cargo LL-EB-240999' },
  ];
  const all = { filter: 'all', status: 'all', query: '' } as const;
  const ids = (list: { id: number }[]) => list.map((item) => item.id);

  it('keeps everything with no filter and an empty search', () => {
    expect(ids(filterEquipment(items, all))).toEqual([1, 2, 3, 4]);
    expect(ids(filterEquipment(items, { ...all, query: '   ' }))).toEqual([1, 2, 3, 4]);
  });

  it('keeps what needs action', () => {
    expect(ids(filterEquipment(items, { ...all, filter: 'needs_action' }))).toEqual([3, 4]);
  });

  it('keeps the active leases only, not the ended ones', () => {
    expect(ids(filterEquipment(items, { ...all, filter: 'active_leases' }))).toEqual([2]);
  });

  it('keeps one status', () => {
    expect(ids(filterEquipment(items, { ...all, status: 'returned' }))).toEqual([4]);
  });

  it('searches every word, ignoring capitals and spacing', () => {
    expect(ids(filterEquipment(items, { ...all, query: '  urban' }))).toEqual([1, 3]);
    expect(ids(filterEquipment(items, { ...all, query: 'KETTU   urban 137' }))).toEqual([3]);
    expect(ids(filterEquipment(items, { ...all, query: 'aaaaaa' }))).toEqual([2]);
  });

  it('finds nothing for a word that is nowhere', () => {
    expect(filterEquipment(items, { ...all, query: 'zzz' })).toEqual([]);
  });

  it('combines the quick filter, the status and the search', () => {
    expect(
      ids(filterEquipment(items, { filter: 'needs_action', status: 'returned', query: 'cargo' }))
    ).toEqual([4]);
    expect(
      filterEquipment(items, { filter: 'active_leases', status: 'returned', query: '' })
    ).toEqual([]);
  });
});

describe('codes', () => {
  it('shortens an id to its first six characters, in capitals', () => {
    expect(contractCode('3f2a9c1d-0000')).toBe('LL-3F2A9C');
    expect(applicationCode('3f2a9c1d-0000')).toBe('AP-3F2A9C');
  });
});

describe('pageWindow', () => {
  it('shows every page up to 7', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('shows no pages when there are none', () => {
    expect(pageWindow(1, 0)).toEqual([]);
  });

  it('matches the design on page 1 of 10', () => {
    expect(pageWindow(1, 10)).toEqual([1, 2, 3, 4, 5, 'gap', 10]);
    expect(pageWindow(4, 10)).toEqual([1, 2, 3, 4, 5, 'gap', 10]);
  });

  it('puts a gap on both sides in the middle', () => {
    expect(pageWindow(5, 10)).toEqual([1, 'gap', 4, 5, 6, 'gap', 10]);
    expect(pageWindow(6, 10)).toEqual([1, 'gap', 5, 6, 7, 'gap', 10]);
  });

  it('keeps the last pages together near the end', () => {
    expect(pageWindow(7, 10)).toEqual([1, 'gap', 6, 7, 8, 9, 10]);
    expect(pageWindow(10, 10)).toEqual([1, 'gap', 6, 7, 8, 9, 10]);
  });

  it('always includes the current page, the first and the last', () => {
    for (let total = 1; total <= 30; total++) {
      for (let current = 1; current <= total; current++) {
        const pages = pageWindow(current, total);
        expect(pages).toContain(current);
        expect(pages).toContain(1);
        expect(pages).toContain(total);
      }
    }
  });
});
