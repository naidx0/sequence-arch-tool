import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

import { CanvasProvider, useCanvas, type CanvasChannel } from './canvasChannel';
import { ConnectedBoard } from './ConnectedBoard';
import { DocProvider } from './docChannel';
import { seqdFromGraph } from './seqdFromGraph';
import { installResizeObserver } from './testResizeObserver';
import { between, easeOut } from './useInterpolatedPositions';
import { fromHash } from './viewState';
import { StoreProvider, createStore } from '../state';
import { readShellPersisted, readShellTokens } from '../shell';
import { summarizeGraph } from '../boot';
import type { GetArchGraphResponse } from '@sequence/api-types';

installResizeObserver();

/* S2 — THE BOARD CONTROLS (Nx project-graph style) and the §3.2 view state,
   each control driven the way a reader drives it. A chain gateway -> orders ->
   payments -> ledger (http), with orders holding two modules. */

const ev = (file: string, line: number) => [{ file, line, snippet: '' }];
const GRAPH = {
  repoName: 'chain',
  scannedAt: '2026-10-05T00:00:00.000Z',
  nodes: [
    { id: 'svc:gateway', label: 'gateway', kind: 'service' },
    { id: 'svc:orders', label: 'orders', kind: 'service' },
    { id: 'svc:payments', label: 'payments', kind: 'service' },
    { id: 'ds:ledger', label: 'ledger', kind: 'datastore' },
    { id: 'svc:mail', label: 'mail', kind: 'service' },
    { id: 'mod:orders/api', label: 'api', kind: 'module', parentId: 'svc:orders', path: 'orders/api' },
    { id: 'mod:orders/db', label: 'db', kind: 'module', parentId: 'svc:orders', path: 'orders/db' },
    { id: 'file:orders/api/h.ts', label: 'h.ts', kind: 'file', parentId: 'mod:orders/api', path: 'orders/api/h.ts' },
    { id: 'file:orders/api/k.ts', label: 'k.ts', kind: 'file', parentId: 'mod:orders/api', path: 'orders/api/k.ts' },
    { id: 'file:gateway/r.ts', label: 'r.ts', kind: 'file', parentId: 'svc:gateway', path: 'gateway/r.ts' },
  ],
  edges: [
    { id: 'h1', srcId: 'file:gateway/r.ts', dstId: 'svc:orders', kind: 'http', confidence: 1, origin: 'deterministic', evidence: ev('gateway/r.ts', 12) },
    { id: 'h2', srcId: 'file:orders/api/h.ts', dstId: 'svc:payments', kind: 'http', confidence: 1, origin: 'deterministic', evidence: ev('orders/api/h.ts', 7) },
    { id: 'h3', srcId: 'file:orders/api/k.ts', dstId: 'svc:payments', kind: 'http', confidence: 1, origin: 'deterministic', evidence: ev('orders/api/k.ts', 30) },
    { id: 'd1', srcId: 'svc:payments', dstId: 'ds:ledger', kind: 'db_write', confidence: 1, origin: 'deterministic', evidence: ev('payments/db.ts', 4) },
  ],
  nodeDetail: {},
} as unknown as GetArchGraphResponse;

let channel: CanvasChannel | null = null;
function Probe() {
  channel = useCanvas();
  return null;
}

function mount() {
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({
    type: 'repo/loaded',
    draft: { root: '/tmp/chain', repoName: 'chain', graph: GRAPH, summary: summarizeGraph(GRAPH), scannedAt: GRAPH.scannedAt },
    at: 0,
  });
  return render(
    <StoreProvider store={store}>
      <CanvasProvider>
        <DocProvider>
          <Probe />
          <ConnectedBoard />
        </DocProvider>
      </CanvasProvider>
    </StoreProvider>,
  );
}

const card = (label: string) =>
  screen
    .getAllByTestId('board-node')
    .find((el) => el.querySelector('[data-testid="board-node-title"]')?.textContent?.toLowerCase() === label)!;
const titles = () => screen.queryAllByTestId('board-node-title').map((el) => el.textContent?.toLowerCase());
const more = () => fireEvent.click(screen.getByTestId('board-controls-toggle'));

afterEach(() => {
  window.history.replaceState(null, '', window.location.pathname);
});

describe('search', () => {
  it('counts the cards whose name holds the text and lights only them', () => {
    mount();
    fireEvent.change(screen.getByTestId('board-search'), { target: { value: 'pay' } });
    expect(screen.getByTestId('board-search-count').textContent).toBe('1 match');
    expect(card('payments').getAttribute('data-dimmed')).toBe('false');
    expect(card('gateway').getAttribute('data-dimmed')).toBe('true');
  });

  it('Enter fits the camera to the matches', () => {
    mount();
    const before = { ...channel!.canvas.viewport };
    act(() => channel!.dispatch({ type: 'canvas/frame', width: 800, height: 600 }));
    const input = screen.getByTestId('board-search');
    fireEvent.change(input, { target: { value: 'ledger' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(channel!.canvas.viewport).not.toEqual(before);
  });
});

describe('path tracing', () => {
  it('Start on one card and End on another light the shortest path and say its length', () => {
    mount();
    more();
    fireEvent.click(card('gateway'));
    fireEvent.click(screen.getByTestId('board-path-start'));
    fireEvent.click(card('ledger'));
    fireEvent.click(screen.getByTestId('board-path-end'));
    expect(screen.getByTestId('board-path-note').textContent).toBe('gateway to ledger: 3 hops.');
    expect(card('mail').getAttribute('data-dimmed')).toBe('true');
    expect(card('orders').getAttribute('data-dimmed')).toBe('false');
  });
});

describe('neighbours, direction, grouping', () => {
  it('Only near selected draws the card and what is one hop away; 2 hops reaches further', () => {
    mount();
    more();
    fireEvent.click(card('gateway'));
    fireEvent.click(screen.getByTestId('board-focus-selected'));
    expect(titles().sort()).toEqual(['gateway', 'orders']);
    fireEvent.click(screen.getByTestId('board-proximity').querySelector('[data-value="2"]')!);
    expect(titles().sort()).toEqual(['gateway', 'orders', 'payments']);
    fireEvent.click(screen.getByTestId('board-focus-clear'));
    expect(titles()).toContain('mail');
  });

  it('the direction control writes the chosen direction to the view', () => {
    mount();
    more();
    fireEvent.click(screen.getByTestId('board-direction').querySelector('[data-value="TB"]')!);
    expect(fromHash(window.location.hash).dir).toBe('TB');
    fireEvent.click(screen.getByTestId('board-direction').querySelector('[data-value="auto"]')!);
    expect(fromHash(window.location.hash).dir).toBeNull();
  });

  it('Flat replaces an expanded group with its members, without a frame', () => {
    mount();
    fireEvent.doubleClick(card('orders'));
    expect(screen.getByTestId('board-group')).toBeTruthy();
    more();
    fireEvent.click(screen.getByTestId('board-grouping').querySelector('[data-value="flat"]')!);
    expect(screen.queryByTestId('board-group')).toBeNull();
    expect(titles()).toEqual(expect.arrayContaining(['api', 'db']));
    expect(titles()).not.toContain('orders');
  });
});

describe('a connector lists the scanned edges it stands for', () => {
  it('a lifted line merges two calls into one, says 2, and lists both file:line', () => {
    mount();
    fireEvent.doubleClick(card('orders'));
    /* api -> payments stands for h2 and h3. */
    /* Round 7: in this suite's seed layout the tag may have no free place, so
       it is on the line's hover instead (edgeLabelPlace.ts); either way the
       line says "2 http". */
    const line =
      screen.queryAllByTestId('board-edge-label').find((el) => el.textContent === '2 http') ??
      screen.queryAllByTestId('board-edge-hover').find((el) => el.getAttribute('data-label-hidden') === '2 http');
    expect(line).toBeTruthy();
    const edgeG = line!.closest('.react-flow__edge') as HTMLElement;
    fireEvent.click(edgeG);
    expect(screen.getByTestId('board-edge-evidence-count').textContent).toBe('2 edges');
    expect(screen.getAllByTestId('board-edge-evidence-row').map((r) => r.textContent)).toEqual([
      'orders/api/h.ts:7',
      'orders/api/k.ts:30',
    ]);
  });
});

describe('the view lives in the URL hash', () => {
  it('an expand writes the hash, and a board mounted on that hash opens expanded', () => {
    const first = mount();
    fireEvent.doubleClick(card('orders'));
    const hash = window.location.hash;
    expect(fromHash(hash).expanded).toEqual(['svc:orders']);
    first.unmount();
    window.history.replaceState(null, '', `${window.location.pathname}${hash}`);
    mount();
    expect(screen.getByTestId('board-group')).toBeTruthy();
  });
});

describe('the glide between layouts', () => {
  it('eases from the old place to the new, and a new card starts at its place', () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    const at = between({ a: { x: 0, y: 0 } }, { a: { x: 100, y: 50 }, b: { x: 9, y: 9 } }, 0.5);
    expect(at.a!.x).toBeCloseTo(87.5);
    expect(at.b).toEqual({ x: 9, y: 9 });
  });
});

describe('one more-button per place (audit 14c)', () => {
  it('the head toggle is not drawn as the dock\'s dots, and its name says what it opens', () => {
    mount();
    const toggle = screen.getByTestId('board-controls-toggle');
    expect(toggle.querySelector('svg')!.getAttribute('data-icon')).not.toBe('b-more');
    expect(toggle.getAttribute('aria-label')).toBe('Show board controls');
  });
});
