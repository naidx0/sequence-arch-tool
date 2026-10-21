import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GitServerEvent } from '../git/gitClient';

/* A branch switch made outside the in-app switcher (a terminal `git checkout`) reaches the status-bar chip
   through the server's `git:head` event alone. The shape below is what gitBranchRoutes.ts really emits. */

const captured: { onEvent: ((e: GitServerEvent) => void) | null; opened: number } = { onEvent: null, opened: 0 };
vi.mock('../git/gitCalls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../git/gitCalls')>()),
  subscribeGitEventsSafe: (onEvent: (e: GitServerEvent) => void) => {
    captured.onEvent = onEvent;
    captured.opened += 1;
    return () => undefined;
  },
}));

const { StoreProvider, createStore } = await import('../state');
const { StatusBar } = await import('./StatusBar');
const { resetGitEvents } = await import('../git/gitEvents');

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

function mount(fetchImpl: typeof fetch) {
  vi.stubGlobal('fetch', fetchImpl);
  const seed = createStore({}).getState();
  const store = createStore({ hydrate: { ...seed, repo: { phase: 'attached', repo: { root: 'C:/work/app', repoName: 'app' } } as typeof seed.repo } });
  store.dispatch({ type: 'session/git-branch', branch: 'main' });
  render(<StoreProvider store={store}><StatusBar /></StoreProvider>);
  return store;
}

const HEAD_MOVE = {
  type: 'git:head',
  branch: 'feature/outside-switch',
  sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  detached: false,
  previous: { branch: 'main', sha: '0000000000000000000000000000000000000000' },
  rescan: true,
} as GitServerEvent;

describe('the status-bar branch chip follows git:head', () => {
  beforeEach(() => {
    captured.onEvent = null;
    captured.opened = 0;
  });
  afterEach(() => {
    cleanup();
    resetGitEvents();
    vi.unstubAllGlobals();
  });

  it('shows the new branch as soon as a git:head arrives from a switch made outside the app', async () => {
    mount((async () => json({ branches: [], current: 'main' })) as typeof fetch);
    expect(screen.getByTestId('s2-status-branch').textContent).toBe('main');
    await waitFor(() => expect(captured.onEvent).not.toBeNull());

    act(() => {
      captured.onEvent?.(HEAD_MOVE);
    });

    expect(screen.getByTestId('s2-status-branch').textContent).toBe('feature/outside-switch');
  });

  it('does not open the event stream before the engine has answered for the repository', async () => {
    let answer: (r: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      answer = resolve;
    });
    mount((async () => pending) as typeof fetch);
    await act(async () => {
      await Promise.resolve();
    });
    expect(captured.opened).toBe(0);

    await act(async () => {
      answer(json({ branches: [], current: 'main' }));
      await pending;
    });
    await waitFor(() => expect(captured.opened).toBe(1));
  });

  it('never opens the stream when the engine answers something that is not the branches route (a static host)', async () => {
    mount((async () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(captured.opened).toBe(0);
  });
});
