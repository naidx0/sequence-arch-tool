import { describe, expect, it } from 'vitest';

import { sessionHomeContextFrom } from './sessionHomeModel';

describe('sessionHomeContextFrom', () => {
  it('names repo, branch and model on an attached empty thread', () => {
    const ctx = sessionHomeContextFrom({
      repo: 'sequence',
      branch: 'main',
      modelLabel: 'claude-sonnet-4',
    });
    expect(ctx.chips.map((c) => c.id)).toEqual(['repo', 'branch', 'model']);
    expect(ctx.chips[0]?.label).toBe('sequence');
    expect(ctx.chips[1]?.label).toBe('main');
  });

  it('omits branch chip when no repo is attached', () => {
    const ctx = sessionHomeContextFrom({
      repo: null,
      branch: null,
      modelLabel: 'choose a model in Settings',
    });
    expect(ctx.chips.map((c) => c.id)).toEqual(['repo', 'model']);
    expect(ctx.chips[0]?.label).toBe('local workspace');
  });
});
