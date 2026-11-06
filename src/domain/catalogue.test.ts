import { beforeAll, describe, expect, it } from 'vitest';
import { loadAssets } from '@/data/load';
import { selectCatalogue, type CatalogueFilters, type CatalogueItem } from './catalogue';

let items: CatalogueItem[];
const defaults: CatalogueFilters = {
  category: 'all',
  status: 'all',
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
  it('combines category, status and condition filters', () => {
    const selected = selectCatalogue(items, {
      ...defaults,
      category: 'e_bike',
      status: 'available',
      condition: 'new',
    });
    expect(selected.length).toBeGreaterThan(0);
    expect(
      selected.every(
        ({ asset }) =>
          asset.category === 'e_bike' && asset.status === 'available' && asset.condition === 'new'
      )
    ).toBe(true);
  });
  it('sorts available equipment first and breaks ties by recommendation order', () => {
    const selected = selectCatalogue(items, { ...defaults, sort: 'availability' });
    expect(selected[0]!.asset.status).toBe('available');
    const order = { available: 0, returned: 1, reserved: 2 };
    const ranks = selected.map(({ asset }) => order[asset.status]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(selected.filter(({ asset }) => asset.status === 'available')).toEqual(
      selectCatalogue(items, { ...defaults, status: 'available' })
    );
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
        status: 'reserved',
      })
    ).toEqual([]);
    const bikes = items.filter(({ asset }) => asset.category === 'e_bike');
    expect(selectCatalogue(bikes, defaults)).toEqual(bikes);
  });
});
