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

describe('idle poll back-off', () => {
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });
  const quiet = () =>
    vi.fn(async () => ({ ok: true, json: async () => ({ attached: true, root: '/tmp/shop', stale: false }) })) as unknown as typeof fetch;

  it('starts at 1 s, then rises to one ask per 5 s when nothing changes', async () => {
    vi.useFakeTimers();
    const fetchImpl = quiet();
    const stop = startExternalStaleProbe({ store: attachedStore(), fetchImpl, pollMs: 1000, startDelayMs: 0 });
    await vi.advanceTimersByTimeAsync(10_000);
    const early = (fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    await vi.advanceTimersByTimeAsync(50_000);
    const late = (fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length - early;
    expect(early).toBeGreaterThanOrEqual(6);
    expect(late).toBeLessThanOrEqual(11);
    expect(late).toBeGreaterThanOrEqual(9);
    stop();
  });

  it('does not ask while the tab is hidden, and asks at once on return', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    const fetchImpl = quiet();
    const stop = startExternalStaleProbe({ store: attachedStore(), fetchImpl, pollMs: 1000, startDelayMs: 0 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchImpl).toHaveBeenCalledTimes(0);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    stop();
  });

  it('keeps the 3 s quiet start at the real poll rate', async () => {
    vi.useFakeTimers();
    const fetchImpl = quiet();
    const stop = startExternalStaleProbe({ store: attachedStore(), fetchImpl });
    await vi.advanceTimersByTimeAsync(2900);
    expect(fetchImpl).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    stop();
  });
});
