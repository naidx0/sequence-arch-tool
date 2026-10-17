import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

import { summarizeGraph } from '../boot';
import { readShellPersisted, readShellTokens } from '../shell';
import { StoreProvider, createStore } from '../state';
import { CanvasProvider } from './canvasChannel';
import { ConnectedBoard } from './ConnectedBoard';
import { DocProvider } from './docChannel';
import { seqdFromGraph } from './seqdFromGraph';
import { installResizeObserver } from './testResizeObserver';
import type { GetArchGraphResponse } from '@sequence/api-types';

installResizeObserver();

/* The board draws each view through React.lazy(() => import('./views/...')): load them before a test waits on one. */
beforeAll(async () => {
  await Promise.all([import('./views/GridView.js'), import('./views/FlowView.js'), import('./views/DiffView.js'), import('./views/HotspotsView.js'), import('../worktree/worktreeModel.js')]);
}, 120_000);

/* STREAM 3b, SLICE B: the hash's view token opens a view over the board;
   a view that lost its A/B (Flow) falls back to the Map. */

const GRAPH = {
  repoName: 'views',
  scannedAt: '2026-10-05T00:00:00.000Z',
  nodes: [
    { id: 'svc:a', label: 'a', kind: 'service', file: 'a', line: 1, path: 'svc/a' },
    { id: 'svc:b', label: 'b', kind: 'service', file: 'b', line: 1, path: 'svc/b' },
    { id: 'f:a', label: 'x.ts', kind: 'file', parentId: 'svc:a', file: 'a/x.ts', line: 1, path: 'svc/a/x.ts' },
  ],
  edges: [
    { id: 'i1', srcId: 'f:a', dstId: 'svc:b', kind: 'import', confidence: 1, origin: 'deterministic', evidence: [{ file: 'a/x.ts', line: 1, snippet: 'import b' }] },
  ],
  nodeDetail: {},
} as unknown as GetArchGraphResponse;

function mount() {
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({
    type: 'repo/loaded',
    draft: { root: '/tmp/views', repoName: 'views', graph: GRAPH, summary: summarizeGraph(GRAPH), scannedAt: GRAPH.scannedAt! },
    at: 0,
  });
  render(
    <StoreProvider store={store}>
      <CanvasProvider>
        <DocProvider>
          <ConnectedBoard />
        </DocProvider>
      </CanvasProvider>
    </StoreProvider>,
  );
}

afterEach(() => {
  window.location.hash = '';
  vi.unstubAllGlobals();
});

describe('board views by hash', () => {
  it('#grid draws the dependency grid over the board, with the package import as a cell', async () => {
    window.location.hash = '#grid';
    mount();
    await screen.findByTestId('grid-view');
    expect(document.querySelector('td[data-src="svc:a"][data-dst="svc:b"]')!.textContent).toBe('1');
  });

  it('#flow (discarded) falls back to the Map', async () => {
    window.location.hash = '#flow';
    mount();
    expect(screen.getAllByTestId('board-node').length).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('flow-view')).toBeNull();
  });

  const BRANCH = { files: [{ path: 'svc/a/x.ts', status: 'modified' }, { path: 'svc/gone/y.ts', status: 'deleted' }] };

  it('#diff keeps the Map beside its panel: a badge on the changed box, a ghost for a deleted module', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('branch-files') ? new Response(JSON.stringify(BRANCH)) : new Response('{}', { status: 404 }),
      ),
    );
    window.location.hash = '#diff';
    mount();
    await screen.findByTestId('diff-view');
    await waitFor(() => expect(document.querySelector('[data-node-id="svc:a"][data-change="changed"]')).not.toBeNull());
    expect(document.querySelector('[data-node-id="svc:b"]')!.getAttribute('data-change')).toBeNull();
    const ghost = await waitFor(() => {
      const g = document.querySelector('[data-node-id="removed:svc/gone"]');
      expect(g).not.toBeNull();
      return g!;
    });
    expect(ghost.getAttribute('data-change')).toBe('removed');
    expect(ghost.textContent).toMatch(/gone/i);
  });

  it('leaving #diff takes the badges and the ghost off the Map', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(BRANCH))));
    window.location.hash = '#diff';
    mount();
    await waitFor(() => expect(document.querySelector('[data-change="removed"]')).not.toBeNull());
    window.location.hash = '#map';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await waitFor(() => expect(document.querySelector('[data-change]')).toBeNull());
    expect(screen.queryByTestId('diff-view')).toBeNull();
  });
});
