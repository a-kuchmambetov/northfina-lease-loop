import { describe, expect, it } from 'vitest';
import { banner } from './go.mjs';

describe('banner', () => {
  it('shows the branch name inside the box', () => {
    expect(banner('staging')).toContain('branch staging');
  });

  it('pads every line to the same width, so a long branch name does not wrap the box', () => {
    const lines = banner('feat/a-very-long-branch-name-indeed').split('\n');
    const width = lines[0].length;
    for (const line of lines) expect(line.length).toBe(width);
  });
});
