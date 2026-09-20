import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GetArchGraphResponse } from '@sequence/api-types';

import { createStore } from '../state/store';
import { seqdFromGraph } from '../canvas/seqdFromGraph';
import { summarizeGraph } from '../boot';
import { readShellPersisted, readShellTokens } from '../shell';
import { startExternalStaleProbe } from './externalStaleProbe';

const GRAPH = {
  repoName: 'shop',
  scannedAt: '2026-01-01T00:00:00.000Z',
  nodes: [{ id: 'svc:api', label: 'api', kind: 'service', file: 'src/api.ts', line: 1 }],
  edges: [],
  nodeDetail: {},
} as unknown as GetArchGraphResponse;

function attachedStore() {
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({
    type: 'repo/loaded',
    draft: {
      root: '/tmp/shop',
      repoName: 'shop',
      graph: GRAPH,
      summary: summarizeGraph(GRAPH),
      scannedAt: '2026-01-01T00:00:00.000Z',
    },
    at: 1,
  });
  return store;
}

describe('P5 external stale probe', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('dispatches repo/stale reason=external when /api/status reports stale', async () => {
    vi.useFakeTimers();
    const store = attachedStore();
    expect(store.getState().repo.phase).toBe('attached');

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        attached: true,
        repoName: 'shop',
        root: '/tmp/shop',
        stale: true,
        staleSince: '2026-01-01T00:01:00.000Z',
        stalePaths: ['src/x.ts'],
      }),
    })) as unknown as typeof fetch;

    const stop = startExternalStaleProbe({
      store,
      fetchImpl,
      pollMs: 50,
      now: () => 99,
    });

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    const repo = store.getState().repo;
    expect(repo.phase).toBe('stale');
    if (repo.phase !== 'stale') throw new Error('unreachable');
    expect(repo.reason).toBe('external');
    expect(repo.changedPaths).toEqual(['src/x.ts']);
    expect(repo.since).toBe(99);

    stop();
  });

  it('does not overwrite a file-written stale reason', async () => {
    vi.useFakeTimers();
    const store = attachedStore();
    store.dispatch({
      type: 'repo/stale',
      reason: 'file-written',
      changedPaths: ['a.ts'],
      at: 2,
    });

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        attached: true,
        repoName: 'shop',
        root: '/tmp/shop',
        stale: true,
        stalePaths: ['b.ts'],
      }),
    })) as unknown as typeof fetch;

    const stop = startExternalStaleProbe({ store, fetchImpl, pollMs: 50, now: () => 3 });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    const repo = store.getState().repo;
    expect(repo.phase).toBe('stale');
    if (repo.phase !== 'stale') throw new Error('unreachable');
    expect(repo.reason).toBe('file-written');
    expect(repo.changedPaths).toEqual(['a.ts']);
    stop();
  });
});
