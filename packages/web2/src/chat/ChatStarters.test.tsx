import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgentRunStore } from '../agents/agentRuns';
import { summarizeGraph } from '../boot';
import { seqdFromGraph } from '../canvas';
import { CanvasProvider, useCanvas } from '../canvas/canvasChannel';
import { readShellPersisted, readShellTokens } from '../shell';
import { createStore, type Store } from '../state';
import { StoreProvider } from '../state/connect';
import { AgentChatLayer } from './AgentChatLayer';
import { starterActions, topService, PLAN_DRAFT } from './ChatStarters';

const NODES = [
  { id: 'svc:web', kind: 'service', label: 'web', meta: { pageRank: 0.1 } },
  { id: 'svc:orders', kind: 'service', label: 'orders', meta: { pageRank: 0.4 } },
  { id: 'svc:payments', kind: 'service', label: 'payments', meta: { pageRank: 0.2 } },
  { id: 'ds:pg', kind: 'datastore', label: 'postgres' },
];
const EDGES = [
  { srcId: 'svc:web', dstId: 'svc:payments' },
  { srcId: 'svc:orders', dstId: 'ds:pg' },
];

describe('starter actions', () => {
  it('names the selected node, else the top service; nothing without a graph', () => {
    expect(starterActions(NODES, EDGES, []).map((a) => a.label)).toEqual(['Explain this architecture', 'What touches orders?', 'Plan a change']);
    expect(starterActions(NODES, EDGES, ['ds:pg'])[1].label).toBe('What touches postgres?');
    /* An id the graph does not have (a drawn shape) falls back too. */
    expect(starterActions(NODES, EDGES, ['shape:1'])[1].label).toBe('What touches orders?');
    expect(starterActions([], [], [])).toEqual([]);
    /* No services at all: Explain and Plan still apply. */
    expect(starterActions([NODES[3]], [], []).map((a) => a.id)).toEqual(['explain', 'plan']);
  });

  it('the top service: page rank first, then the most edges', () => {
    expect(topService(NODES, EDGES)?.id).toBe('svc:orders');
    const flat = NODES.map((n) => ({ ...n, meta: undefined }));
    expect(topService(flat, EDGES)?.id).toBe('svc:web');
    expect(topService(flat, [...EDGES, { srcId: 'svc:payments', dstId: 'ds:pg' }])?.id).toBe('svc:payments');
  });
});

function storeWithBoard(): Store {
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  const graph = {
    version: 2,
    repoRoot: '/tmp/shop',
    scannedAt: '2026-10-05T00:00:00.000Z',
    nodes: NODES,
    edges: EDGES.map((e, i) => ({ id: `e${i}`, ...e, kind: 'http', confidence: 1, origin: 'deterministic', evidence: [] })),
    nodeDetail: {},
  };
  store.dispatch({
    type: 'repo/loaded',
    draft: { root: '/tmp/shop', repoName: 'shop', graph, summary: summarizeGraph(graph as never), scannedAt: graph.scannedAt },
    at: 0,
  } as never);
  return store;
}

describe('the empty chat', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('offers three starters tied to the open board, following the selection', () => {
    const store = storeWithBoard();
    let select!: (id: string) => void;
    function Board() {
      const { dispatch } = useCanvas();
      select = (nodeId) => dispatch({ type: 'canvas/select', nodeId, additive: false });
      return null;
    }
    render(
      <StoreProvider store={store}>
        <CanvasProvider>
          <Board />
          <AgentChatLayer empty runs={createAgentRunStore()} />
        </CanvasProvider>
      </StoreProvider>,
    );
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Explain this architecture', 'What touches orders?', 'Plan a change']);
    act(() => select('svc:payments'));
    expect(screen.getByTestId('chat-starter-touches').textContent).toBe('What touches payments?');
  });

  it('Explain sends at once; Plan a change switches to Plan and leaves the request to finish', () => {
    const store = storeWithBoard();
    render(
      <StoreProvider store={store}>
        <div className="v3-composer">
          <textarea data-testid="field" />
        </div>
        <AgentChatLayer empty runs={createAgentRunStore()} />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByTestId('chat-starter-plan'));
    expect(store.getState().composer.draft).toBe(PLAN_DRAFT);
    expect(store.getState().composer.permission.mode).toBe('plan');
    expect(document.activeElement).toBe(screen.getByTestId('field'));
    fireEvent.click(screen.getByTestId('chat-starter-explain'));
    expect(store.getState().composer.draft).toBe('');
    expect(JSON.stringify(store.getState().session)).toMatch(/Explain this architecture: the main services/);
  });

  it('a run started from the board pins its node as a context chip and shows in this thread, not the starters', async () => {
    const store = storeWithBoard();
    const runs = createAgentRunStore({ fetch: () => new Promise<Response>(() => {}) });
    render(
      <StoreProvider store={store}>
        <AgentChatLayer empty runs={runs} />
      </StoreProvider>,
    );
    act(() => {
      void runs.start({ nodeId: 'svc:orders', agentRef: 'codex' });
    });
    expect(store.getState().composer.chips).toEqual([{ id: 'node:svc:orders', kind: 'node', ref: 'svc:orders', label: 'orders', nodeKind: 'service' }]);
    expect(screen.queryByTestId('chat-starters')).toBeNull();
    /* The run cards are a lazy chunk, loaded with the first run. */
    expect((await screen.findByTestId('agent-run-node')).textContent).toBe('orders');
    expect(runs.get().runs[0].sessionId).toBe(store.getState().session.activeId);
  });
});
