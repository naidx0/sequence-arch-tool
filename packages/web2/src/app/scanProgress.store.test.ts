import { describe, expect, it } from 'vitest';

import { createStore } from '../state/store';

describe('repo/scan-progress', () => {
  it('updates progress only while a scan is in flight', () => {
    const store = createStore();
    store.dispatch({
      type: 'repo/scanning',
      root: '/tmp/shop',
      repoName: 'shop',
      at: 1_000,
    });
    store.dispatch({
      type: 'repo/scan-progress',
      progress: { done: 1, total: 3, phase: 'analyze' },
    });
    expect(store.getState().repo).toMatchObject({
      phase: 'scanning',
      progress: { done: 1, total: 3, phase: 'analyze' },
    });

    store.dispatch({ type: 'repo/detached' });
    store.dispatch({
      type: 'repo/scan-progress',
      progress: { done: 2, total: 3, phase: 'detail' },
    });
    expect(store.getState().repo.phase).toBe('unattached');
  });
});
