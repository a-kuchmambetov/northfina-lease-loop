// A reward for passing an item on in good shape (CHALLENGE.md Spine #6's "pass it on"):
// without this, a customer has no reason to pick `pass_on` over `return` — both cost them
// nothing, but `pass_on` can be rejected (src/domain/end-of-term.ts) while `return` never
// is. Not in the data pack — our own design decision, same as the early-exit formula.
import type { AssetCondition } from '@/data/schemas';
import { conditionRank } from './wear';

/** Percent of `buyoutCents` earned just for a successful pass_on (already "at least good"). */
const BASE_BONUS_PERCENT = 2;
/** Extra percent per condition step better than the "good" minimum (like_new, new). */
const EXTRA_PERCENT_PER_CONDITION_STEP = 3;

/**
 * Rewards a better-maintained item more: exactly `'good'` (the bar `pass_on` requires)
 * earns the base percent of the end-of-term buyout; each condition step better than that
 * (`'like_new'`, `'new'`) adds more. Rounded once, at the end.
 */
export function passOnBonusCents(buyoutCents: number, conditionAfterWear: AssetCondition): number {
  if (!Number.isInteger(buyoutCents)) {
    throw new RangeError('buyoutCents must be whole cents');
  }

  const stepsBetterThanGood = Math.max(
    0,
    conditionRank('good') - conditionRank(conditionAfterWear)
  );
  const percent = BASE_BONUS_PERCENT + EXTRA_PERCENT_PER_CONDITION_STEP * stepsBetterThanGood;
  return Math.round((buyoutCents * percent) / 100);
}
