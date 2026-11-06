import { describe, expect, it } from 'vitest';
import { assessWearAfterLease } from './wear';

describe('assessWearAfterLease', () => {
  it('adds the assumed monthly usage for the category', () => {
    const result = assessWearAfterLease({
      category: 'e_bike',
      conditionBefore: 'new',
      usageValueBefore: 0,
      monthsLeased: 12,
    });
    expect(result.usageValueAfter).toBe(4_800); // 400 km/month x 12
  });

  it('downgrades condition when the new usage crosses a threshold', () => {
    const result = assessWearAfterLease({
      category: 'e_bike',
      conditionBefore: 'new',
      usageValueBefore: 0,
      monthsLeased: 36, // 14400 km -> past the 8000 "like_new" ceiling
    });
    expect(result).toEqual({ usageValueAfter: 14_400, conditionAfter: 'good' });
  });

  it('never improves condition, even if the usage scale would imply a better one', () => {
    const result = assessWearAfterLease({
      category: 'laptop',
      conditionBefore: 'fair', // already worse than what 0 extra usage would imply
      usageValueBefore: 0,
      monthsLeased: 0,
    });
    expect(result).toEqual({ usageValueAfter: 0, conditionAfter: 'fair' });
  });

  it('starts from whatever usage the item already had', () => {
    const result = assessWearAfterLease({
      category: 'farm_machine',
      conditionBefore: 'good',
      usageValueBefore: 4_200,
      monthsLeased: 12, // +960 engine hours
    });
    expect(result.usageValueAfter).toBe(5_160);
  });

  it('holds the worst condition band beyond the last threshold', () => {
    const result = assessWearAfterLease({
      category: 'laptop',
      conditionBefore: 'new',
      usageValueBefore: 0,
      monthsLeased: 1_000,
    });
    expect(result.conditionAfter).toBe('poor');
  });

  it('rejects a negative lease length', () => {
    expect(() =>
      assessWearAfterLease({
        category: 'e_bike',
        conditionBefore: 'new',
        usageValueBefore: 0,
        monthsLeased: -1,
      })
    ).toThrow(RangeError);
  });
});
