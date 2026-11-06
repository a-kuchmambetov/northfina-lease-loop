import { assetCategorySchema, assetConditionSchema, type Asset } from '@/data/schemas';
import type { ListPriceResult } from './price-list';
import type { LeaseEstimate } from './lease-estimate';

export type CatalogueItem = {
  asset: Asset;
  price: ListPriceResult;
  estimate: LeaseEstimate | null;
  image: string;
};

export type CatalogueFilters = {
  category: Asset['category'] | 'all';
  status: Asset['status'] | 'all';
  condition: Asset['condition'] | 'all';
  sort: 'recommended' | 'availability' | 'condition';
};

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
      (filters.status === 'all' || asset.status === filters.status) &&
      (filters.condition === 'all' || asset.condition === filters.condition)
  );
  if (filters.sort === 'availability') {
    const order = { available: 0, returned: 1, reserved: 2 };
    selected.sort((a, b) => order[a.asset.status] - order[b.asset.status]);
  } else if (filters.sort === 'condition') {
    selected.sort(
      (a, b) =>
        assetConditionSchema.options.indexOf(a.asset.condition) -
        assetConditionSchema.options.indexOf(b.asset.condition)
    );
  }
  return selected;
}
