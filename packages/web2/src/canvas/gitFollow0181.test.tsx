import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seqdFromGraph } from '../canvas';
import { resetGitEvents } from '../git/gitEvents';
import { readShellPersisted, readShellTokens } from '../shell';
import { summarizeGraph } from '../boot/bootSequence';
import { createStore } from '../state';
import { V3App } from '../v3/V3App';

/*
 * 0.1.8.1 e2e (shell-boot "boots with no console error"): with no project open the board opened GET /api/git/events,
 * which a static host answers with index.html ("EventSource's response has a MIME type text/html"). Present at
 * fe705ddb too. With nothing attached there is no branch to follow, so no stream is opened.
 */

const opened: string[] = [];
beforeEach(() => {
  opened.length = 0;
  resetGitEvents();
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  vi.stubGlobal(
    'EventSource',
    class {
      onmessage = null;
      onerror = null;
      constructor(url: string) {
        opened.push(String(url));
      }
      addEventListener() {}
      removeEventListener() {}
      close() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the board follows git only with a project open', () => {
  it('a boot with nothing attached opens no /api/git/events stream', async () => {
    const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail), tokens: readShellTokens(document.documentElement), persisted: readShellPersisted() });
    await act(async () => {
      render(<V3App appStore={store} />);
    });
    expect(store.getState().repo.phase).not.toBe('attached');
    expect(opened.filter((u) => u.includes('/api/git/events'))).toEqual([]);
  });
});

const GRAPH = { nodes: [], edges: [], warnings: [], repoName: 'shop', repoRoot: '/home/me/shop', scannedAt: '2026-10-14T00:00:00Z', nodeDetail: {} };
function attachedStore() {
  const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail), tokens: readShellTokens(document.documentElement), persisted: readShellPersisted() });
  store.dispatch({
    type: 'repo/loaded',
    draft: { root: '/home/me/shop', repoName: 'shop', graph: GRAPH as never, summary: summarizeGraph(GRAPH as never), scannedAt: GRAPH.scannedAt },
    at: Date.now(),
  });
  return store;
}
const statusAnswer = (body: unknown, status = 200) =>
  vi.fn(async (url: RequestInfo | URL) =>
    String(url) === '/api/status'
      ? new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
      : new Promise<Response>(() => {}),
  );

describe('a graph with no engine behind it (board-grounded e2e: a static host serving archgraph.json)', () => {
  it('opens no stream when /api/status is not an engine with a project', async () => {
    vi.stubGlobal('fetch', statusAnswer({ error: 'this origin does not serve /api/status' }, 404));
    await act(async () => {
      render(<V3App appStore={attachedStore()} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(opened.filter((u) => u.includes('/api/git/events'))).toEqual([]);
  });

  it('opens it when the engine says a project is attached', async () => {
    vi.stubGlobal('fetch', statusAnswer({ attached: true, repoName: 'shop', root: '/home/me/shop' }));
    await act(async () => {
      render(<V3App appStore={attachedStore()} />);
    });
    await waitFor(() => expect(opened.filter((u) => u.includes('/api/git/events'))).toHaveLength(1));
  });
});
