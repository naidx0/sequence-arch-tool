import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { followGitEvents } from './boardReload';
import type { GitServerEvent } from './gitClient';
import { onGitEvent, REOPEN_BACKOFF_MS, resetGitEvents } from './gitEvents';
import { StatusBar } from '../shell2/StatusBar';
import { StoreProvider, createStore } from '../state';

/* A stream that failed at boot (the engine was still starting, or answered text/html) is CLOSED for good in the
   browser. Every later subscriber used to join that dead stream. */

class FakeSource {
  static all: FakeSource[] = [];
  readyState = 0;
  private handlers = new Map<string, Array<(e: { data: string }) => void>>();
  constructor(public url: string) {
    FakeSource.all.push(this);
  }
  addEventListener(type: string, fn: (e: { data: string }) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  close() {
    this.readyState = 2;
  }
  emit(type: string, data = '') {
    for (const fn of this.handlers.get(type) ?? []) fn({ data });
  }
  fail() {
    this.readyState = 2;
    this.emit('error');
  }
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
let attached = false;
const statusCalls: string[] = [];

const HEAD = {
  type: 'git:head',
  branch: 'throwaway-a',
  sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  detached: false,
  previous: { branch: 'main', sha: '0000000000000000000000000000000000000000' },
  rescan: true,
};

beforeEach(() => {
  vi.useFakeTimers();
  FakeSource.all = [];
  statusCalls.length = 0;
  attached = false;
  vi.stubGlobal('EventSource', FakeSource);
  vi.stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/status') {
      statusCalls.push(url);
      return json({ attached });
    }
    return json({ branches: [], current: 'main' });
  }) as typeof fetch);
});
afterEach(() => {
  cleanup();
  resetGitEvents();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('gitEvents reopens a stream that failed', () => {
  it('reopens after backoff once the engine is attached, and a later git:head reaches every listener', async () => {
    const a: GitServerEvent[] = [];
    const b: GitServerEvent[] = [];
    onGitEvent((e) => a.push(e));
    onGitEvent((e) => b.push(e));
    expect(FakeSource.all).toHaveLength(1);
    FakeSource.all[0]!.fail();

    /* The engine has not answered yet: backoff elapses, nothing is reopened, nothing spins. */
    await vi.advanceTimersByTimeAsync(REOPEN_BACKOFF_MS[0]!);
    expect(FakeSource.all).toHaveLength(1);

    attached = true;
    await vi.advanceTimersByTimeAsync(REOPEN_BACKOFF_MS[1]!);
    expect(FakeSource.all).toHaveLength(2);
    expect(FakeSource.all[1]!.readyState).toBe(0);

    a.length = 0;
    b.length = 0;
    FakeSource.all[1]!.emit('git:head', JSON.stringify(HEAD));
    expect(a.map((e) => e.type)).toEqual(['git:head']);
    expect(b.map((e) => e.type)).toEqual(['git:head']);
  });

  it('never reopens while no repo is attached, and stops after the bounded attempts', async () => {
    onGitEvent(() => undefined);
    FakeSource.all[0]!.fail();
    await vi.advanceTimersByTimeAsync(REOPEN_BACKOFF_MS.reduce((x, y) => x + y, 0) + 60_000);
    expect(FakeSource.all).toHaveLength(1);
    expect(statusCalls.length).toBe(REOPEN_BACKOFF_MS.length);
  });

  it('does not reopen once the last listener has left', async () => {
    attached = true;
    const off = onGitEvent(() => undefined);
    FakeSource.all[0]!.fail();
    off();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSource.all).toHaveLength(1);
    expect(statusCalls).toHaveLength(0);
  });

  it('a browser-retried error (still connecting) is left alone', async () => {
    attached = true;
    onGitEvent(() => undefined);
    FakeSource.all[0]!.emit('error');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSource.all).toHaveLength(1);
  });

  it('a stream dead at boot is replaced, and the chip, a switcher-style listener and the board follower all hear git:head', async () => {
    const seed = createStore({}).getState();
    const store = createStore({ hydrate: { ...seed, repo: { phase: 'attached', repo: { root: 'C:/work/app', repoName: 'app' } } as typeof seed.repo } });
    store.dispatch({ type: 'session/git-branch', branch: 'main' });
    const preload = onGitEvent(() => undefined);
    FakeSource.all[0]!.fail();
    attached = true;

    const switcher: GitServerEvent[] = [];
    render(<StoreProvider store={store}><StatusBar /></StoreProvider>);
    onGitEvent((e) => switcher.push(e));
    const stopFollow = followGitEvents(store, { fetchImpl: (async () => json({})) as typeof fetch, subscribe: (on) => onGitEvent(on) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REOPEN_BACKOFF_MS[0]! + 10);
    });

    const live = FakeSource.all.filter((s) => s.readyState !== 2);
    expect(live).toHaveLength(1);
    switcher.length = 0;
    act(() => live[0]!.emit('git:head', JSON.stringify(HEAD)));
    expect(screen.getByTestId('s2-status-branch').textContent).toBe('throwaway-a');
    expect(switcher.map((e) => e.type)).toEqual(['git:head']);
    stopFollow();
    preload();
  });
});
