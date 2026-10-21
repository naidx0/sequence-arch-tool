import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

import type { GetArchGraphResponse } from '@sequence/api-types';
import type { ArchGraph } from '@sequence/schema';

import { registerBoardAskSender } from '../askInPlace/boardAskBus';
import { summarizeGraph } from '../boot';
import { readShellPersisted, readShellTokens } from '../shell';
import { StoreProvider, createStore, type Store } from '../state';
import { CanvasProvider, useCanvasOptional } from './canvasChannel';
import { ConnectedBoard } from './ConnectedBoard';
import { DocProvider } from './docChannel';
import { displayLabel } from './displayLabel.js';
import { seqdFromGraph } from './seqdFromGraph';
import { installResizeObserver } from './testResizeObserver';
import { SURFACE_KINDS, WORKFLOW_KINDS, nodeSurface, workflowAsk } from './nodeSurface';
import { NodeSurfacePanel } from './NodeSurfacePanel';

installResizeObserver();

vi.mock('../askInPlace/snapshot', async (orig) => ({
  ...(await orig<typeof import('../askInPlace/snapshot')>()),
  snapshotHtmlRegion: vi.fn(async () => null),
}));

/* ══════════════════════════════════════════════════════════════════════════
   E5/E6 — THE NODE SUB-SURFACE
   Jaden: "you click on one of the nodes and you see a subsurface ... you have
   to click a button just like generate workflow ... if it's an admin ... the
   admin workflow, if it's a customer interface ... a customer interface
   workflow".
   ══════════════════════════════════════════════════════════════════════════ */

const GRAPH = {
  repoName: 'shop',
  scannedAt: '2026-10-12T00:00:00.000Z',
  nodes: [
    { id: 'svc:web', label: 'web', kind: 'service', path: 'web', meta: { language: 'ts', framework: 'next', loc: 1200, description: 'The storefront and admin pages' }, owner: '@shop/web' },
    { id: 'file:web/pages/cart.ts', label: 'cart.ts', kind: 'file', path: 'web/pages/cart.ts', parentId: 'svc:web' },
    { id: 'file:web/pages/admin.ts', label: 'admin.ts', kind: 'file', path: 'web\\pages\\admin.ts', parentId: 'svc:web' },
    { id: 'svc:orders', label: 'orders', kind: 'service', path: 'orders' },
    { id: 'file:orders/api.ts', label: 'api.ts', kind: 'file', path: 'orders/api.ts', parentId: 'svc:orders' },
    { id: 'svc:bare', label: 'bare', kind: 'service', path: 'bare' },
  ],
  edges: [
    { id: 'e1', srcId: 'file:web/pages/cart.ts', dstId: 'file:orders/api.ts', kind: 'http', confidence: 0.9, origin: 'deterministic' },
    { id: 'e2', srcId: 'file:web/pages/admin.ts', dstId: 'file:orders/api.ts', kind: 'http', confidence: 0.9, origin: 'deterministic' },
    { id: 'e3', srcId: 'svc:orders', dstId: 'svc:web', kind: 'queue_publish', confidence: 0.8, origin: 'deterministic' },
  ],
  routes: [
    { service: 'svc:web', method: 'GET', path: '/cart', file: 'web/pages/cart.ts', line: 3 },
    { service: 'svc:orders', method: 'POST', path: '/orders', file: 'orders/api.ts', line: 9 },
  ],
  nodeDetail: {},
} as unknown as GetArchGraphResponse;

describe('nodeSurface: only what the graph has', () => {
  const web = nodeSurface(GRAPH as unknown as ArchGraph, 'svc:web')!;

  it('reads facts, files (normalised), routes, dependencies and callers off the scan', () => {
    expect(web.description).toBe('The storefront and admin pages');
    expect([web.language, web.framework, web.loc, web.owner]).toEqual(['ts', 'next', 1200, '@shop/web']);
    expect(web.files).toEqual(['web/pages/admin.ts', 'web/pages/cart.ts']);
    expect(web.routes.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /cart']);
    expect(web.dependsOn).toEqual([{ id: 'svc:orders', label: 'orders', kind: 'service', via: ['http'], count: 2 }]);
    expect(web.callers.map((c) => [c.label, c.via])).toEqual([['orders', ['queue_publish']]]);
  });

  it('lists each endpoint and each dependency once, however many files or same-named nodes the scan has', () => {
    const g = {
      ...GRAPH,
      nodes: [
        ...GRAPH.nodes,
        { id: 'pkg:a/top', label: 'Top level', kind: 'module', parentId: 'svc:web' },
        { id: 'pkg:b/top', label: 'Top level', kind: 'module' },
        { id: 'pkg:c/top', label: 'Top level', kind: 'module' },
      ],
      edges: [
        ...GRAPH.edges,
        { id: 'e4', srcId: 'file:web/pages/cart.ts', dstId: 'pkg:b/top', kind: 'import', confidence: 1, origin: 'deterministic' },
        { id: 'e5', srcId: 'file:web/pages/cart.ts', dstId: 'pkg:c/top', kind: 'import', confidence: 1, origin: 'deterministic' },
      ],
      routes: [
        ...GRAPH.routes!,
        { service: 'svc:web', method: 'GET', path: '/cart', file: 'web/pages/cart2.ts', line: 7 },
        { service: 'svc:web', method: 'POST', path: '/cart', file: 'web/pages/cart.ts', line: 12 },
      ],
    } as unknown as ArchGraph;
    const s = nodeSurface(g, 'svc:web')!;
    expect(s.routes.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /cart', 'POST /cart']);
    const labels = s.dependsOn.map((d) => `${d.kind}:${d.label}`);
    expect(new Set(labels).size).toBe(labels.length);
    expect(s.dependsOn.find((d) => d.label === 'Top level')?.count).toBe(2);
  });

  it('fabricates nothing for a node the scan knows little about', () => {
    const bare = nodeSurface(GRAPH as unknown as ArchGraph, 'svc:bare')!;
    expect(bare.description).toBeUndefined();
    expect(bare.language).toBeUndefined();
    expect([bare.files, bare.routes, bare.dependsOn, bare.callers]).toEqual([[], [], [], []]);
  });

  it('says "no such node" as null', () => {
    expect(nodeSurface(GRAPH as unknown as ArchGraph, 'nope')).toBeNull();
  });

  it('the ask names the audience, and Auto leaves the choice to the code', () => {
    expect(workflowAsk('web', 'admin')).toMatch(/ADMIN workflow/);
    expect(workflowAsk('web', 'customer')).toMatch(/CUSTOMER workflow/);
    expect(workflowAsk('web', 'auto')).toMatch(/Decide the audience from the code/);
    expect(workflowAsk('web', 'auto')).toMatch(/page-to-page/);
    expect(workflowAsk('web', 'auto')).toMatch(/Space/);
  });
});

function mount(): Store {
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({
    type: 'repo/loaded',
    draft: { root: '/tmp/shop', repoName: 'shop', graph: GRAPH, summary: summarizeGraph(GRAPH), scannedAt: '2026-10-12T00:00:00.000Z' },
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
  return store;
}

function card(label: string): HTMLElement {
  const shown = displayLabel(label);
  const found = screen.queryAllByTestId('board-node').find((el) => el.textContent?.includes(shown));
  if (!found) throw new Error(`no card labelled ${shown}`);
  return found;
}

afterEach(() => {
  registerBoardAskSender(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('on the board', () => {
  it('clicking a service opens its sub-surface with what the scan knows; clicking another switches; close hides it', async () => {
    mount();
    expect(screen.queryByTestId('node-surface')).toBeNull();
    fireEvent.click(card('web'));
    /* The panel loads when a surface opens (React.lazy), so the first one is awaited. */
    const panel = await screen.findByTestId('node-surface');
    expect(panel.getAttribute('data-node-id')).toBe('svc:web');
    expect(within(screen.getByTestId('node-surface-routes')).getByText('/cart')).toBeTruthy();
    expect(within(screen.getByTestId('node-surface-deps')).getByText('orders')).toBeTruthy();
    expect(within(screen.getByTestId('node-surface-files')).getByText(/web\/pages\/cart\.ts/)).toBeTruthy();
    fireEvent.click(card('orders'));
    expect(screen.getByTestId('node-surface').getAttribute('data-node-id')).toBe('svc:orders');
    expect(within(screen.getByTestId('node-surface-routes')).getByText('/orders')).toBeTruthy();
    expect(within(screen.getByTestId('node-surface-deps')).queryByText('orders')).toBeNull();
    fireEvent.click(screen.getByTestId('node-surface-close'));
    expect(screen.queryByTestId('node-surface')).toBeNull();
  });

  /* The route a Space draw goes through; every other path 404s like an engine without it. */
  function engineWith(flows: (() => Response) | null) {
    const calls: { url: string; body: string | null }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, body: typeof init?.body === 'string' ? init.body : null });
        if (url.startsWith('/api/services/') && url.endsWith('/flows') && flows) return flows();
        return new Response(JSON.stringify({ error: 'nf' }), { status: 404 });
      }),
    );
    return calls;
  }

  it('on 404 from the flows route, Generate workflow falls back to the chat ask with the node as a chip', async () => {
    const calls = engineWith(null);
    const store = mount();
    const sent = vi.fn();
    registerBoardAskSender(sent);
    fireEvent.click(card('web'));
    fireEvent.click(within(screen.getByTestId('node-surface-audience')).getByText('Admin'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('node-surface-generate'));
    });
    /* The status line is written after the lazy sendBoardAsk import has resolved and sent. */
    const status = await screen.findByTestId('node-surface-status');
    await waitFor(() => expect(status.textContent).toMatch(/Asked the agent in chat/), { timeout: 8000 });
    expect(sent).toHaveBeenCalledTimes(1);
    expect(calls.some((c) => c.url === '/api/services/svc%3Aweb/flows' && c.body === '{"audience":"admin"}')).toBe(true);
    const text = sent.mock.calls[0]![0] as string;
    expect(text).toMatch(/page-to-page user workflow for "web"/);
    expect(text).toMatch(/ADMIN workflow/);
    const chip = store.getState().composer.chips.find((c) => c.kind === 'board-ref');
    expect(chip?.detail).toContain('svc:web | service | "web"');
  });

  it('when the engine draws the flow, the Space opens and the panel says so; no chat ask is sent', async () => {
    engineWith(
      () =>
        new Response(
          JSON.stringify({ board: { id: 'wb-7', name: 'web: admin flow' }, group: 'g-1', steps: [], grounded: { routes: 1, edgesFromCode: 2 }, notes: [] }),
          { status: 200 },
        ),
    );
    const { setHostCommandHandler } = await import('../app/hostCommands');
    const hostSeen = vi.fn();
    setHostCommandHandler(hostSeen);
    mount();
    const sent = vi.fn();
    registerBoardAskSender(sent);
    fireEvent.click(card('web'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('node-surface-generate'));
    });
    const status = await screen.findByTestId('node-surface-status');
    expect(status.textContent).toMatch(/web: admin flow/);
    expect(status.textContent).toMatch(/opened in Spaces/);
    expect(hostSeen).toHaveBeenCalledWith('canvas.whiteboard');
    expect(sent).not.toHaveBeenCalled();
    setHostCommandHandler(null);
  });

  it('a 200 that is not JSON, or has no board, is never reported as drawn', async () => {
    for (const reply of [() => new Response('<html></html>', { status: 200 }), () => new Response(JSON.stringify({ steps: [] }), { status: 200 })]) {
      engineWith(reply);
      mount();
      const sent = vi.fn();
      registerBoardAskSender(sent);
      fireEvent.click(card('web'));
      await act(async () => {
        fireEvent.click(screen.getByTestId('node-surface-generate'));
      });
      const status = await screen.findByTestId('node-surface-status');
      expect(status.className).toContain('is-fail');
      expect(status.textContent).not.toMatch(/drawn/);
      expect(sent).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it('a rejected generate resets the button and says so (panel unit)', async () => {
    const onGenerate = vi.fn(async () => {
      throw new Error('upload exploded');
    });
    const surface = nodeSurface(GRAPH as unknown as ArchGraph, 'svc:web')!;
    render(<NodeSurfacePanel surface={surface} onClose={() => undefined} onGenerate={onGenerate} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('node-surface-generate'));
    });
    const failed = await screen.findByTestId('node-surface-status');
    await waitFor(() => expect(failed.textContent).toBe('upload exploded'), { timeout: 8000 });
    expect((screen.getByTestId('node-surface-generate') as HTMLButtonElement).disabled).toBe(false);
  });

  it('a refusal from the flows route is shown, and nothing is asked in chat', async () => {
    engineWith(() => new Response(JSON.stringify({ error: 'no pages found in web' }), { status: 422 }));
    mount();
    const sent = vi.fn();
    registerBoardAskSender(sent);
    fireEvent.click(card('web'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('node-surface-generate'));
    });
    const refused = await screen.findByTestId('node-surface-status');
    await waitFor(() => expect(refused.textContent).toBe('no pages found in web'), { timeout: 8000 });
    expect(sent).not.toHaveBeenCalled();
  });

  it('closing a panel is forgotten when another node is picked, so returning reopens it', () => {
    engineWith(null);
    mount();
    fireEvent.click(card('web'));
    fireEvent.click(screen.getByTestId('node-surface-close'));
    expect(screen.queryByTestId('node-surface')).toBeNull();
    fireEvent.click(card('orders'));
    expect(screen.getByTestId('node-surface').getAttribute('data-node-id')).toBe('svc:orders');
    fireEvent.click(card('web'));
    expect(screen.getByTestId('node-surface').getAttribute('data-node-id')).toBe('svc:web');
  });
});

describe('while a flow plays, the flow owns the board', () => {
  it('a node the flow selects does not open its sub-surface over the board', async () => {
    let channel: ReturnType<typeof useCanvasOptional> = null;
    function Grab() {
      channel = useCanvasOptional();
      return null;
    }
    const store = createStore({
      project: (g) => seqdFromGraph(g, g.nodeDetail),
      tokens: readShellTokens(document.documentElement),
      persisted: readShellPersisted(),
    });
    store.dispatch({ type: 'repo/loaded', draft: { root: '/tmp/shop', repoName: 'shop', graph: GRAPH, summary: summarizeGraph(GRAPH), scannedAt: 'x' }, at: 0 });
    render(
      <StoreProvider store={store}>
        <CanvasProvider>
          <DocProvider>
            <ConnectedBoard />
            <Grab />
          </DocProvider>
        </CanvasProvider>
      </StoreProvider>,
    );
    await act(async () => {
      channel!.dispatch({ type: 'canvas/flow', playback: { functionId: 'f', hops: [{ from: 'svc:web', to: 'svc:orders', via: null, label: null, evidence: null }], cursor: 0, playing: false } });
    });
    fireEvent.click(card('web'));
    expect(screen.queryByTestId('node-surface')).toBeNull();
  });
});

describe('datastores and topics get a sub-surface from the fields the graph has, without a workflow button', () => {
  it('surfaces a datastore with its callers and offers no Generate workflow', () => {
    const g = {
      ...GRAPH,
      nodes: [...(GRAPH.nodes as unknown[]), { id: 'ds:db', label: 'db', kind: 'datastore', meta: { tech: 'postgres' } }],
      edges: [...(GRAPH.edges as unknown[]), { id: 'e9', srcId: 'svc:orders', dstId: 'ds:db', kind: 'db', confidence: 1, origin: 'deterministic' }],
    } as unknown as ArchGraph;
    expect(SURFACE_KINDS.has('datastore') && SURFACE_KINDS.has('topic')).toBe(true);
    expect(WORKFLOW_KINDS.has('datastore')).toBe(false);
    expect(nodeSurface(g, 'ds:db')!.callers.map((c) => c.label)).toEqual(['orders']);
  });
});
