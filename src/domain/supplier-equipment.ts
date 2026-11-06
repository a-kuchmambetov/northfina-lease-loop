// The supplier's "Your equipment" table (Figma "Suppliers / My equipment"): what state each
// item is in, which ones need the supplier's attention, and how the list is filtered,
// searched and paged. Pure: the caller passes in what it has read from the database.
import type { AssetStatus } from '@/data/schemas';

export const SUPPLIER_ITEM_STATUSES = [
  'available',
  'leased',
  'contract_ended',
  'returned',
  'manual_approval',
  'reserved',
  'sold',
] as const;
export type SupplierItemStatus = (typeof SUPPLIER_ITEM_STATUSES)[number];

export type SupplierItemStatusInput = {
  assetStatus: AssetStatus;
  /** The item's running lease, if it has one. `termOver` once its term has ended. */
  activeLease: { termOver: boolean } | null;
  /** An application for this item is waiting for a person to review it. */
  applicationInReview: boolean;
};

/**
 * One state per item. A running lease decides first: still going is `leased`, past its term
 * but not yet bought, returned or extended is `contract_ended`. Without one, the item's own
 * status says whether it was `sold` or came back (`returned`, waiting to be refurbished); an
 * item with an application in review is `manual_approval`; one marked reserved with no
 * lease behind it is `reserved`; everything else is `available`.
 */
export function supplierItemStatus(input: SupplierItemStatusInput): SupplierItemStatus {
  if (input.activeLease) return input.activeLease.termOver ? 'contract_ended' : 'leased';
  if (input.assetStatus === 'sold') return 'sold';
  if (input.assetStatus === 'returned') return 'returned';
  if (input.applicationInReview) return 'manual_approval';
  if (input.assetStatus === 'reserved') return 'reserved';
  return 'available';
}

/** The states where something is waiting for the supplier. */
export function needsAction(status: SupplierItemStatus): boolean {
  return status === 'contract_ended' || status === 'returned' || status === 'manual_approval';
}

export type EquipmentSummary = {
  items: number;
  activeLeases: number;
  contractsEnded: number;
  requestsToReview: number;
  needsAction: number;
};

/** The counts shown above the table. */
export function summarizeEquipment(statuses: readonly SupplierItemStatus[]): EquipmentSummary {
  const count = (wanted: SupplierItemStatus) =>
    statuses.filter((status) => status === wanted).length;
  return {
    items: statuses.length,
    activeLeases: count('leased'),
    contractsEnded: count('contract_ended'),
    requestsToReview: count('manual_approval'),
    needsAction: statuses.filter(needsAction).length,
  };
}

export type EquipmentFilter = 'all' | 'needs_action' | 'active_leases';

export type FilterableEquipment = {
  status: SupplierItemStatus;
  /** Everything a search should look in: name, serial number, contract code. */
  searchText: string;
};

/**
 * Keeps the items that pass the quick filter and the status choice, and contain every word
 * of the search. A search ignores capitals and extra spaces; an empty one keeps everything.
 */
export function filterEquipment<T extends FilterableEquipment>(
  items: readonly T[],
  options: { filter: EquipmentFilter; status: SupplierItemStatus | 'all'; query: string }
): T[] {
  const words = options.query.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    if (options.filter === 'needs_action' && !needsAction(item.status)) return false;
    if (options.filter === 'active_leases' && item.status !== 'leased') return false;
    if (options.status !== 'all' && item.status !== options.status) return false;
    const text = item.searchText.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** The reference shown for a contract, e.g. `LL-3F2A9C`: its id is long, this is its start. */
export function contractCode(contractId: string): string {
  return `LL-${contractId.slice(0, 6).toUpperCase()}`;
}

/** The reference shown for an application, e.g. `AP-3F2A9C`. */
export function applicationCode(applicationId: string): string {
  return `AP-${applicationId.slice(0, 6).toUpperCase()}`;
}

/**
 * Which page buttons to show: all of them up to 7 pages, otherwise the first and last page
 * with a gap in between, and a few pages around the current one. `'gap'` is the "…".
 * With 10 pages, page 1 gives `1 2 3 4 5 … 10`, like the design.
 */
export function pageWindow(current: number, total: number): (number | 'gap')[] {
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, index) => from + index);
  if (total <= 7) return range(1, total);
  if (current <= 4) return [...range(1, 5), 'gap', total];
  if (current >= total - 3) return [1, 'gap', ...range(total - 4, total)];
  return [1, 'gap', current - 1, current, current + 1, 'gap', total];
}
