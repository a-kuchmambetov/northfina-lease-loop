import { beforeAll, describe, expect, it } from 'vitest';
import { loadAssets } from '@/data/load';
import {
  applicantCustomerId,
  catalogueAsset,
  isLeasable,
  isSupplier,
  suppliesAsset,
  leaseAccess,
  selectCatalogue,
  type CatalogueFilters,
  type CatalogueItem,
} from './catalogue';

let items: CatalogueItem[];
const defaults: CatalogueFilters = {
  category: 'all',
  condition: 'all',
  sort: 'recommended',
};
beforeAll(async () => {
  items = (await loadAssets()).map((asset) => ({
    asset,
    image: '',
    estimate: null,
    price: { ok: false, reason: 'unknown_asset' },
  }));
});

describe('leaseAccess', () => {
  it('tells guests, customers and other accounts apart', () => {
    expect(leaseAccess(undefined)).toBe('guest');
    expect(leaseAccess('customer')).toBe('customer');
    expect(leaseAccess('supplier')).toBe('not_customer');
    expect(leaseAccess('')).toBe('not_customer');
  });
});

describe('isSupplier', () => {
  it('is true only for a supplier account', () => {
    expect(isSupplier('supplier')).toBe(true);
    expect(isSupplier('customer')).toBe(false);
    expect(isSupplier('Supplier')).toBe(false);
    expect(isSupplier('')).toBe(false);
    expect(isSupplier(undefined)).toBe(false);
  });
});

describe('suppliesAsset', () => {
  it('matches an account named after the make', () => {
    expect(suppliesAsset('Kettu Bikes', 'Kettu Bikes')).toBe(true);
  });

  it('ignores capitals and extra or surrounding spaces', () => {
    expect(suppliesAsset('  kettu   BIKES ', 'Kettu Bikes')).toBe(true);
    expect(suppliesAsset('Kettu Bikes', ' kettu bikes')).toBe(true);
  });

  it('does not match another brand, or a brand that only shares a word or a prefix', () => {
    expect(suppliesAsset('Kettu Bikes', 'Saimaa Cycles')).toBe(false);
    expect(suppliesAsset('Saimaa', 'Saimaa Cycles')).toBe(false);
    expect(suppliesAsset('Saimaa Cycles', 'Saimaa Systems')).toBe(false);
    expect(suppliesAsset('Kettu', 'Kettu Bikes')).toBe(false);
  });

  it('owns nothing for a blank name', () => {
    expect(suppliesAsset('', 'Kettu Bikes')).toBe(false);
    expect(suppliesAsset('   ', 'Kettu Bikes')).toBe(false);
    expect(suppliesAsset('', '')).toBe(false);
  });

  it('splits the data pack: every item has at most one supplying brand', () => {
    const brands = [...new Set(items.map(({ asset }) => asset.make))];
    for (const { asset } of items) {
      expect(brands.filter((brand) => suppliesAsset(brand, asset.make))).toEqual([asset.make]);
    }
  });
});

describe('applicantCustomerId', () => {
  it('is the first customer, or nobody when there are none', () => {
    expect(applicantCustomerId([{ id: 'first' }, { id: 'second' }])).toBe('first');
    expect(applicantCustomerId([])).toBeUndefined();
  });
});

describe('catalogueAsset', () => {
  it('keeps the serial number for customers only', async () => {
    const [asset] = await loadAssets();
    expect(catalogueAsset(asset!, 'customer').serial_number).toBe(asset!.serial_number);
    for (const access of ['guest', 'not_customer'] as const) {
      expect(catalogueAsset(asset!, access)).not.toHaveProperty('serial_number');
    }
  });
  it('does not change the original asset', async () => {
    const [asset] = await loadAssets();
    catalogueAsset(asset!, 'guest');
    expect(asset).toHaveProperty('serial_number');
  });
});

describe('isLeasable', () => {
  const priced = { ok: true, priceCents: 100_00, priceListVersion: 1 } as const;
  const withStatus = (status: CatalogueItem['asset']['status']) => ({
    ...items[0]!.asset,
    status,
  });

  it('accepts available equipment with a price today', () => {
    expect(isLeasable({ asset: withStatus('available'), price: priced })).toBe(true);
  });
  it('rejects reserved and returned equipment even when priced', () => {
    expect(isLeasable({ asset: withStatus('reserved'), price: priced })).toBe(false);
    expect(isLeasable({ asset: withStatus('returned'), price: priced })).toBe(false);
  });
  it('rejects available equipment without a price', () => {
    for (const reason of ['unknown_asset', 'no_price_list_on_date'] as const) {
      expect(isLeasable({ asset: withStatus('available'), price: { ok: false, reason } })).toBe(
        false
      );
    }
  });
});

describe('selectCatalogue', () => {
  it('interleaves categories without dropping or duplicating any inventory', () => {
    const selected = selectCatalogue(items, defaults);
    expect(selected.slice(0, 6).map(({ asset }) => asset.category)).toEqual([
      'e_bike',
      'laptop',
      'farm_machine',
      'e_bike',
      'laptop',
      'farm_machine',
    ]);
    expect(selected).toHaveLength(items.length);
    expect(new Set(selected.map(({ asset }) => asset.id)).size).toBe(items.length);
  });
  it('combines category and condition filters', () => {
    const selected = selectCatalogue(items, {
      ...defaults,
      category: 'e_bike',
      condition: 'new',
    });
    expect(selected.length).toBeGreaterThan(0);
    expect(
      selected.every(({ asset }) => asset.category === 'e_bike' && asset.condition === 'new')
    ).toBe(true);
  });
  it('sorts all condition levels best first without mutating inputs', () => {
    const original = [...items];
    const ranks = ['new', 'like_new', 'good', 'fair', 'poor'];
    const selected = selectCatalogue(items, { ...defaults, sort: 'condition' }).map(({ asset }) =>
      ranks.indexOf(asset.condition)
    );
    expect(selected).toEqual([...selected].sort((a, b) => a - b));
    expect(items).toEqual(original);
  });
  it('handles empty inventory, empty matches and uneven categories', () => {
    expect(selectCatalogue([], defaults)).toEqual([]);
    expect(
      selectCatalogue(items, {
        ...defaults,
        category: 'laptop',
        condition: 'poor',
      })
    ).toEqual([]);
    const bikes = items.filter(({ asset }) => asset.category === 'e_bike');
    expect(selectCatalogue(bikes, defaults)).toEqual(bikes);
  });
});
