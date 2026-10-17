/* A LIVE FONT SWITCH RELAYS THE BOARD. Cards are sized by measuring their titles in the interface face, so when
   Settings > Interface font changes (FONT_EVENT) the measure memo is dropped and the board is laid out again. */
vi.mock('./layout.js', async (orig) => {
  const real = await orig<typeof import('./layout.js')>();
  return { ...real, layoutOffThread: vi.fn(real.layoutOffThread) };
});
import { layoutOffThread } from './layout.js';
import { FONT_EVENT } from '../settings/fontPreference';

import { render } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

import { CanvasProvider, useCanvas, type CanvasChannel } from './canvasChannel';
import { ConnectedBoard } from './ConnectedBoard';
import { DocProvider } from './docChannel';
import { seqdFromGraph } from './seqdFromGraph';
import { installResizeObserver } from './testResizeObserver';
import { StoreProvider, createStore, type Store } from '../state';
import { readShellPersisted, readShellTokens } from '../shell';
import { summarizeGraph } from '../boot';
import type { GetArchGraphResponse } from '@sequence/api-types';

installResizeObserver();

/** Two services, one of them with a five-file interior worth opening — the
 *  interior's arrangement has to be genuinely different from the systems
 *  layer's, or 'the camera moved' and 'the camera did not' look the same. */
const GRAPH = {
  repoName: 'refit',
  scannedAt: '2026-08-28T00:00:00.000Z',
  nodes: [
    { id: 'svc:analyzer', label: 'analyzer', kind: 'service', file: 'packages/analyzer', line: 1 },
    { id: 'svc:schema', label: 'schema', kind: 'service', file: 'packages/schema', line: 1 },
    {
      id: 'file:analyzer/scan.ts',
      label: 'scan.ts',
      kind: 'file',
      parentId: 'svc:analyzer',
      file: 'packages/analyzer/src/scan.ts',
      line: 1,
    },
    /* One module inside the service, holding three of its files, so the
       service opens to a modules level and the module opens to a files level
       — two arrangements, each of which the camera has to follow. */
    {
      id: 'mod:analyzer/0',
      label: 'server',
      kind: 'module',
      parentId: 'svc:analyzer',
      path: 'packages/analyzer/src/server',
      meta: { files: 3, description: 'Serves the graph.' },
    },
    ...['server.ts', 'explain.ts', 'cli.ts', 'provider.ts'].map((name, i) => ({
      id: `file:analyzer/${name}`,
      label: name,
      kind: 'file',
      parentId: i < 3 ? 'mod:analyzer/0' : 'svc:analyzer',
      file: `packages/analyzer/src/${name}`,
      line: 1,
    })),
  ],
  edges: [],
  nodeDetail: {},
} as unknown as GetArchGraphResponse;

function storeFor(graph: GetArchGraphResponse): Store {
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({
    type: 'repo/loaded',
    draft: {
      root: '/tmp/refit',
      repoName: 'refit',
      graph,
      summary: summarizeGraph(graph),
      scannedAt: graph.scannedAt,
    },
    at: 0,
  });
  return store;
}

function mounted(): { canvas: () => CanvasChannel; unmount: () => void } {
  let channel: CanvasChannel | null = null;
  function Probe() {
    channel = useCanvas();
    return null;
  }
  const drawn = render(
    <StoreProvider store={storeFor(GRAPH)}>
      <CanvasProvider>
        <DocProvider>
          <Probe />
          <ConnectedBoard />
        </DocProvider>
      </CanvasProvider>
    </StoreProvider>,
  );
  return { canvas: () => channel!, unmount: drawn.unmount };
}


async function settle(ms = 60) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe('the architecture board follows a live interface-font switch', () => {
  it('lays out again when FONT_EVENT fires, and not otherwise', async () => {
    const board = mounted();
    await act(async () => {
      board.canvas().dispatch({ type: 'canvas/frame', width: 800, height: 600 });
    });
    await settle();
    const calls = vi.mocked(layoutOffThread);
    const before = calls.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    await settle(200);
    expect(calls.mock.calls.length).toBe(before);
    await act(async () => {
      window.dispatchEvent(new CustomEvent(FONT_EVENT, { detail: 'plex' }));
    });
    await settle(200);
    expect(calls.mock.calls.length).toBeGreaterThan(before);
    board.unmount();
  });
});
