import { assetCategorySchema, assetConditionSchema, type Asset } from '@/data/schemas';
import type { ListPriceResult } from './price-list';
import type { LeaseEstimate } from './lease-estimate';

/** The catalogue is public, so a serial number is only present for customers. */
export type CatalogueAsset = Omit<Asset, 'serial_number'> & { serial_number?: string };

export type CatalogueItem = {
  asset: CatalogueAsset;
  price: ListPriceResult;
  estimate: LeaseEstimate | null;
  image: string;
};

export type CatalogueFilters = {
  category: Asset['category'] | 'all';
  condition: Asset['condition'] | 'all';
  sort: 'recommended' | 'condition';
};

/** Who is looking at the catalogue, which decides what "Start contract" does. */
export type LeaseAccess = 'guest' | 'customer' | 'not_customer';

export function leaseAccess(accountType: string | undefined): LeaseAccess {
  if (accountType === undefined) return 'guest';
  return accountType === 'customer' ? 'customer' : 'not_customer';
}

/** Removes what the public must not see before an asset is sent to the browser. */
export function catalogueAsset(asset: Asset, access: LeaseAccess): CatalogueAsset {
  if (access === 'customer') return asset;
  const visible: CatalogueAsset = { ...asset };
  delete visible.serial_number;
  return visible;
}

/** Customers can only lease what is available and has a list price today. */
export function isLeasable({ asset, price }: Pick<CatalogueItem, 'asset' | 'price'>) {
  return asset.status === 'available' && price.ok;
}

/** Round-robin categories keep a mixed catalogue on each page. Original order is the
 * tie-breaker, so recommendations and equal-condition items remain deterministic. */
export function selectCatalogue(items: readonly CatalogueItem[], filters: CatalogueFilters) {
  const groups = assetCategorySchema.options.map((category) =>
    items.filter((item) => item.asset.category === category)
  );
  const mixed: CatalogueItem[] = [];
  for (let index = 0; index < Math.max(0, ...groups.map((group) => group.length)); index++) {
    for (const group of groups) {
      const item = group[index];
      if (item) mixed.push(item);
    }
  }
  const selected = mixed.filter(
    ({ asset }) =>
      (filters.category === 'all' || asset.category === filters.category) &&
      (filters.condition === 'all' || asset.condition === filters.condition)
  );
  if (filters.sort === 'condition') {
    selected.sort(
      (a, b) =>
        assetConditionSchema.options.indexOf(a.asset.condition) -
        assetConditionSchema.options.indexOf(b.asset.condition)
    );
  }
  return selected;
}
