import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { GetArchGraphResponse } from '@sequence/api-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { summarizeGraph } from '../boot';
import { seqdFromGraph } from '../canvas/seqdFromGraph';
import { readShellPersisted, readShellTokens } from '../shell';
import { AutoRefreshSetting } from '../settings/AutoRefreshSetting';
import { AUTO_REFRESH_KEY, readAutoRefreshEnabled, resetAutoRefreshForTest } from '../settings/autoRefreshPreference';
import { StoreProvider } from '../state/connect';
import { createStore } from '../state/store';
import { RescanStrip } from './RescanStrip';
import { startRescanController } from './RescanController';
import { AutoRefresh, getRescanState, rescanNow, resetRescanForTest } from './rescanRun';
import type { RescanResult } from './rescanClient';

/*
 * 019-rescan-ui. The engine says the graph is stale (GET /api/status, "stale": true); the page shows a notice with
 * Rescan, or, with "Refresh the board automatically when files change" on (the default), rescans by itself once the
 * burst of edits is over. The board re-reads on graph:updated (git/boardReload.ts); this is the half that makes the
 * page ask.
 */

const GRAPH = {
  repoName: 'shop',
  repoRoot: '/tmp/shop',
  warnings: [],
  scannedAt: '2026-01-01T00:00:00.000Z',
  nodes: [{ id: 'svc:api', label: 'api', kind: 'service', file: 'src/api.ts', line: 1 }],
  edges: [],
  nodeDetail: {},
} as unknown as GetArchGraphResponse;

const draft = (scannedAt: string) => ({
  root: '/tmp/shop',
  repoName: 'shop',
  graph: { ...GRAPH, scannedAt } as GetArchGraphResponse,
  summary: summarizeGraph(GRAPH),
  scannedAt,
});

function attachedStore() {
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({ type: 'repo/loaded', draft: draft('2026-01-01T00:00:00.000Z'), at: 1 });
  return store;
}

const makeStale = (store: ReturnType<typeof attachedStore>, paths: string[], at = 2) =>
  store.dispatch({ type: 'repo/stale', reason: 'external', changedPaths: paths, at });

const okRescan = (scannedAt = '2026-01-01T00:05:00.000Z') =>
  vi.fn(async (): Promise<RescanResult> => ({ outcome: 'ok', draft: draft(scannedAt) }));

beforeEach(() => {
  localStorage.clear();
  resetAutoRefreshForTest();
  resetRescanForTest();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the notice (auto-refresh off)', () => {
  it('stale status: the notice renders, Rescan calls the client and the board takes the new graph', async () => {
    localStorage.setItem(AUTO_REFRESH_KEY, 'off');
    const store = attachedStore();
    const rescan = okRescan();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).startsWith('/api/scan')) {
          const r = await rescan();
          return new Response(JSON.stringify(r.outcome === 'ok' ? r.draft.graph : {}), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response('{}', { status: 404 });
      }),
    );
    render(
      <StoreProvider store={store}>
        <RescanStrip />
      </StoreProvider>,
    );
    expect(screen.queryByTestId('rescan-strip')).toBeNull();
    act(() => makeStale(store, ['src/api.ts']));
    const strip = screen.getByTestId('rescan-strip');
    expect(strip.textContent).toContain('Files changed');
    await act(async () => {
      fireEvent.click(screen.getByTestId('rescan-strip-button'));
    });
    await vi.waitFor(() => expect(rescan).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(store.getState().repo.phase).toBe('attached'));
    expect(screen.queryByTestId('rescan-strip')).toBeNull();
  });

  it('a failed rescan says why and offers Rescan again', async () => {
    localStorage.setItem(AUTO_REFRESH_KEY, 'off');
    const store = attachedStore();
    makeStale(store, ['a.ts']);
    render(
      <StoreProvider store={store}>
        <RescanStrip />
      </StoreProvider>,
    );
    const failing = vi.fn(async (): Promise<RescanResult> => ({ outcome: 'failed', status: 500, message: 'the scan crashed' }));
    await act(async () => {
      await rescanNow(store, { rescan: failing });
    });
    expect(screen.getByTestId('rescan-strip').textContent).toContain('the scan crashed');
    expect(screen.getByTestId('rescan-strip-button').textContent).toBe('Rescan');
    expect(store.getState().repo.phase).toBe('stale');
  });

  it('with auto-refresh on, a stale board is not announced by the notice', () => {
    const store = attachedStore();
    makeStale(store, ['a.ts']);
    render(
      <StoreProvider store={store}>
        <RescanStrip />
      </StoreProvider>,
    );
    expect(screen.queryByTestId('rescan-strip')).toBeNull();
  });
});

describe('rescanNow', () => {
  it('is single-flight: a second ask while one runs joins it', async () => {
    const store = attachedStore();
    let release: (r: RescanResult) => void = () => {};
    const rescan = vi.fn(() => new Promise<RescanResult>((r) => (release = r)));
    const a = rescanNow(store, { rescan });
    const b = rescanNow(store, { rescan });
    expect(rescan).toHaveBeenCalledTimes(1);
    expect(getRescanState().kind).toBe('running');
    release({ outcome: 'ok', draft: draft('2026-02-02T00:00:00.000Z') });
    expect(await a).toBe('ok');
    expect(await b).toBe('ok');
    expect(getRescanState().kind).toBe('idle');
  });

  it('skips when nothing is attached', async () => {
    const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail), tokens: readShellTokens(document.documentElement), persisted: readShellPersisted() });
    const rescan = okRescan();
    expect(await rescanNow(store, { rescan })).toBe('skipped');
    expect(rescan).not.toHaveBeenCalled();
  });
});

describe('auto-refresh', () => {
  const stalePoll = (paths: string[]) =>
    vi.fn(async () => ({ ok: true, json: async () => ({ attached: true, root: '/tmp/shop', stale: true, stalePaths: paths }) })) as unknown as typeof fetch;

  it('the scheduler turns a burst of changes into one run, and never starves past the max wait', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const auto = new AutoRefresh(run, 1500, 6000);
    auto.note('a');
    vi.advanceTimersByTime(1000);
    auto.note('a|b');
    vi.advanceTimersByTime(1000);
    auto.note('a|b|c');
    vi.advanceTimersByTime(1499);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    /* A stream that never pauses still gets its refresh at the max wait. */
    for (let i = 0; i < 10; i += 1) {
      auto.note(`x${i}`);
      vi.advanceTimersByTime(1000);
    }
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('a notice naming the same paths does not push the refresh back (the status poll)', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const auto = new AutoRefresh(run, 1500, 6000);
    auto.note('a');
    vi.advanceTimersByTime(1000);
    auto.note('a');
    vi.advanceTimersByTime(500);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('on: edits arriving in a burst cause ONE rescan, 1.5 s after the last new change', async () => {
    vi.useFakeTimers();
    const store = attachedStore();
    const rescan = okRescan();
    const stop = startRescanController(store, { fetchImpl: stalePoll(['a.ts']), pollMs: 100000, isWorking: () => false, debounceMs: 1500, maxWaitMs: 6000, rescanDeps: { rescan } });
    act(() => makeStale(store, ['a.ts']));
    await vi.advanceTimersByTimeAsync(1000);
    act(() => makeStale(store, ['a.ts', 'b.ts']));
    await vi.advanceTimersByTimeAsync(1000);
    act(() => makeStale(store, ['a.ts', 'b.ts', 'c.ts']));
    await vi.advanceTimersByTimeAsync(1400);
    expect(rescan).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(rescan).toHaveBeenCalledTimes(1);
    expect(store.getState().repo.phase).toBe('attached');
    await vi.advanceTimersByTimeAsync(10000);
    expect(rescan).toHaveBeenCalledTimes(1);
    stop();
  });

  it('off: nothing rescans by itself', async () => {
    vi.useFakeTimers();
    localStorage.setItem(AUTO_REFRESH_KEY, 'off');
    resetAutoRefreshForTest();
    const store = attachedStore();
    const rescan = okRescan();
    const stop = startRescanController(store, { fetchImpl: stalePoll(['a.ts']), pollMs: 100000, isWorking: () => false, debounceMs: 1500, maxWaitMs: 6000, rescanDeps: { rescan } });
    act(() => makeStale(store, ['a.ts']));
    await vi.advanceTimersByTimeAsync(20000);
    expect(rescan).not.toHaveBeenCalled();
    expect(store.getState().repo.phase).toBe('stale');
    stop();
  });

  it('paused while an agent is writing, then catches up once after it stops', async () => {
    vi.useFakeTimers();
    const store = attachedStore();
    const rescan = okRescan();
    let working = true;
    const stop = startRescanController(store, { fetchImpl: stalePoll(['a.ts']), pollMs: 100000, isWorking: () => working, debounceMs: 1500, maxWaitMs: 6000, rescanDeps: { rescan } });
    act(() => makeStale(store, ['a.ts']));
    await vi.advanceTimersByTimeAsync(20000);
    expect(rescan).not.toHaveBeenCalled();
    working = false;
    act(() => makeStale(store, ['a.ts', 'b.ts']));
    await vi.advanceTimersByTimeAsync(1600);
    expect(rescan).toHaveBeenCalledTimes(1);
    stop();
  });

  it('a failed rescan is not retried on a loop for the same change', async () => {
    vi.useFakeTimers();
    const store = attachedStore();
    const rescan = vi.fn(async (): Promise<RescanResult> => ({ outcome: 'failed', status: 500, message: 'boom' }));
    const stop = startRescanController(store, { fetchImpl: stalePoll(['a.ts']), pollMs: 100000, isWorking: () => false, debounceMs: 1500, maxWaitMs: 6000, rescanDeps: { rescan } });
    act(() => makeStale(store, ['a.ts']));
    await vi.advanceTimersByTimeAsync(1600);
    expect(rescan).toHaveBeenCalledTimes(1);
    act(() => makeStale(store, ['a.ts'], 9));
    await vi.advanceTimersByTimeAsync(10000);
    expect(rescan).toHaveBeenCalledTimes(1);
    act(() => makeStale(store, ['a.ts', 'z.ts'], 10));
    await vi.advanceTimersByTimeAsync(1600);
    expect(rescan).toHaveBeenCalledTimes(2);
    stop();
  });

  it('the probe is what sets stale: the engine reports stale, the store follows', async () => {
    vi.useFakeTimers();
    localStorage.setItem(AUTO_REFRESH_KEY, 'off');
    resetAutoRefreshForTest();
    const store = attachedStore();
    const stop = startRescanController(store, { fetchImpl: stalePoll(['src/x.ts']), pollMs: 50, isWorking: () => false });
    await vi.advanceTimersByTimeAsync(200);
    const repo = store.getState().repo;
    expect(repo.phase).toBe('stale');
    expect(repo.phase === 'stale' && repo.changedPaths).toEqual(['src/x.ts']);
    stop();
  });
});

describe('the defaults', () => {
  it('wait a second for the burst to end, and poll the engine once a second, so an edit shows in about three seconds', async () => {
    const { AUTO_REFRESH_DEBOUNCE_MS, AUTO_REFRESH_MAX_WAIT_MS } = await import('./rescanRun');
    const { EXTERNAL_STALE_POLL_MS } = await import('./externalStaleProbe');
    expect(AUTO_REFRESH_DEBOUNCE_MS + EXTERNAL_STALE_POLL_MS).toBeLessThanOrEqual(2000);
    expect(AUTO_REFRESH_MAX_WAIT_MS).toBeGreaterThan(AUTO_REFRESH_DEBOUNCE_MS);
  });
});

describe('the setting', () => {
  it('is on by default, persists as the other settings do, and flips live', () => {
    expect(readAutoRefreshEnabled()).toBe(true);
    render(<AutoRefreshSetting />);
    const sw = screen.getByTestId('settings-auto-refresh-switch') as HTMLInputElement;
    expect(sw.checked).toBe(true);
    expect(screen.getByTestId('settings-auto-refresh').textContent).toContain('Refresh the board automatically when files change');
    fireEvent.click(sw);
    expect(localStorage.getItem(AUTO_REFRESH_KEY)).toBe('off');
    expect(readAutoRefreshEnabled()).toBe(false);
    expect((screen.getByTestId('settings-auto-refresh-switch') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByTestId('settings-auto-refresh-switch'));
    expect(readAutoRefreshEnabled()).toBe(true);
  });
});

describe('Ctrl+K: Rescan project', () => {
  it('is in the command list and runs the rescan', async () => {
    const { SHELL_COMMANDS } = await import('../shell/shellModel');
    const { V3CommandPalette } = await import('../v3/V3CommandPalette');
    expect(SHELL_COMMANDS.find((c) => c.id === 'repo.rescan')?.label).toBe('Rescan project');
    const store = attachedStore();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(GRAPH), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <StoreProvider store={store}>
        <V3CommandPalette />
      </StoreProvider>,
    );
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const row = (await screen.findAllByText('Rescan project'))[0]!;
    await act(async () => {
      fireEvent.click(row);
    });
    await vi.waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith('/api/scan'))).toBe(true));
  });
});
