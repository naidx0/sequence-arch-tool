import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* The store-free part of the overlay; the board mounts it through a wrapper that reads the chat from the store. */
import { AgentLights as AgentOverlay } from '../canvas/AgentOverlay.js';
import { createAgentStore, type AgentStore } from './agentStream.js';
import type { AgentEvent } from './agentTypes.js';
import { FADE_MS, LIVE_MS, LightBook, edgeKeyFromLabel } from './overlayModel.js';

/* The board's DOM as the overlay sees it: cards carry data-node-id, and
   @xyflow's edge wrapper carries "Edge from A to B". */
function board(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'board-scope';
  root.innerHTML = `
    <div data-testid="board-node" data-node-id="svc:gateway" class="node"></div>
    <div data-testid="board-node" data-node-id="svc:orders" class="node"></div>
    <svg><g class="react-flow__edge" aria-label="Edge from svc:gateway to svc:orders"><path class="edgeline"/></g>
    <g class="react-flow__edge" aria-label="Edge from svc:orders to svc:gateway"><path class="edgeline"/></g></svg>`;
  document.body.appendChild(root);
  return root;
}

let n = 0;
function edit(useId: string, at: number, kind: 'tool_start' | 'tool_end' = 'tool_end'): AgentEvent {
  return {
    id: `ev-${++n}`,
    at,
    source: 'claude-hook',
    sessionId: 's',
    kind,
    tool: 'Edit',
    toolKind: 'edit',
    paths: ['gateway/src/routes/orders.ts'],
    status: kind === 'tool_end' ? 'done' : 'running',
    toolUseId: useId,
    title: 'Edit gateway/src/routes/orders.ts',
    board: [
      {
        path: 'gateway/src/routes/orders.ts',
        fileNodeId: 'file:gateway/src/routes/orders.ts',
        moduleId: null,
        serviceId: 'svc:gateway',
        serviceLabel: 'gateway',
        touchedEdgeIds: ['e2:http'],
        liftedEdges: ['svc:gateway>svc:orders'],
      },
    ],
  };
}

describe('AgentOverlay', () => {
  let store: AgentStore;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    store = createAgentStore(() => null);
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it("lights the touched service and the edge its evidence sits on, then fades, then clears", () => {
    const root = board();
    render(<AgentOverlay store={store} />);
    const gw = root.querySelector('[data-node-id="svc:gateway"]')!;
    const orders = root.querySelector('[data-node-id="svc:orders"]')!;
    const [out, back] = [...root.querySelectorAll('.react-flow__edge')];
    expect(gw.hasAttribute('data-agent-here')).toBe(false);

    act(() => store.apply(edit('t1', Date.now())));
    /* Same task as the message — no timer needed for the light to land. */
    expect(gw.getAttribute('data-agent-here')).toBe('live');
    expect(orders.hasAttribute('data-agent-here')).toBe(false);
    expect(out.getAttribute('data-agent-edge')).toBe('live');
    expect(back.hasAttribute('data-agent-edge')).toBe(false);

    act(() => vi.advanceTimersByTime(LIVE_MS + 300));
    expect(gw.getAttribute('data-agent-here')).toBe('fading');
    act(() => vi.advanceTimersByTime(FADE_MS));
    expect(gw.hasAttribute('data-agent-here')).toBe(false);
    expect(out.hasAttribute('data-agent-edge')).toBe(false);
    expect(root.querySelectorAll('[data-agent-here],[data-agent-edge]').length).toBe(0);
  });

  it('a replay of old work (a reconnect) does not relight the board', () => {
    const root = board();
    render(<AgentOverlay store={store} />);
    act(() => store.apply(edit('old', Date.now() - 60_000)));
    expect(root.querySelectorAll('[data-agent-here]').length).toBe(0);
  });

  /* Round 8 integration (built app): every page load lit the cards of work
     that had finished long before, for LIVE_MS + FADE_MS, because the replay
     folds a call's start (running: lit "now") before its end, and the end's
     old time could not take the light back. */
  it('a replay of a whole old call, start then end, does not relight the board', () => {
    const root = board();
    render(<AgentOverlay store={store} />);
    act(() => {
      store.apply(edit('old2', Date.now() - 60_000, 'tool_start'));
      store.apply(edit('old2', Date.now() - 59_000, 'tool_end'));
    });
    expect(root.querySelectorAll('[data-agent-here],[data-agent-edge]').length).toBe(0);
  });

  it('a call that ends now stays lit, and another call on the same card keeps it lit', () => {
    const root = board();
    render(<AgentOverlay store={store} />);
    const gw = root.querySelector('[data-node-id="svc:gateway"]')!;
    act(() => store.apply(edit('live1', Date.now(), 'tool_start')));
    act(() => store.apply(edit('old3', Date.now() - 60_000, 'tool_start')));
    act(() => store.apply(edit('old3', Date.now() - 59_000, 'tool_end')));
    expect(gw.getAttribute('data-agent-here')).toBe('live');
    act(() => store.apply(edit('live1', Date.now(), 'tool_end')));
    expect(gw.getAttribute('data-agent-here')).toBe('live');
  });

  it('a focused step stays lit past the fade until the focus moves', () => {
    const root = board();
    render(<AgentOverlay store={store} />);
    act(() => store.apply(edit('t2', Date.now())));
    act(() => store.focus('tool:s:t2'));
    act(() => vi.advanceTimersByTime(LIVE_MS + FADE_MS + 1000));
    const gw = root.querySelector('[data-node-id="svc:gateway"]')!;
    expect(gw.getAttribute('data-agent-here')).toBe('live');
    act(() => store.focus(null));
    act(() => vi.advanceTimersByTime(300));
    expect(gw.hasAttribute('data-agent-here')).toBe(false);
  });

  it('two lit cards whose chips would overlap on screen stack into lanes instead (ask 25)', () => {
    const root = document.createElement('div');
    root.className = 'board-scope';
    root.innerHTML = `<div class="react-flow">
      <div data-testid="board-node" data-node-id="svc:gateway" class="node"></div>
      <div data-testid="board-node" data-node-id="svc:orders" class="node"></div></div>`;
    document.body.appendChild(root);
    const rect = (l: number, t: number, w: number, h: number) =>
      ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h, x: l, y: t, toJSON: () => ({}) }) as DOMRect;
    const pane = root.querySelector('.react-flow') as HTMLElement;
    pane.getBoundingClientRect = () => rect(0, 0, 800, 600);
    const gw = root.querySelector('[data-node-id="svc:gateway"]') as HTMLElement;
    const orders = root.querySelector('[data-node-id="svc:orders"]') as HTMLElement;
    /* A zoomed-out board: two small cards a few pixels apart. */
    gw.getBoundingClientRect = () => rect(100, 200, 20, 12);
    orders.getBoundingClientRect = () => rect(130, 204, 20, 12);

    render(<AgentOverlay store={store} />);
    const both = edit('t-two', Date.now(), 'tool_end');
    both.board = [
      ...both.board!,
      { ...both.board![0]!, serviceId: 'svc:orders', serviceLabel: 'orders', fileNodeId: 'file:orders/a.ts' },
    ];
    act(() => store.apply(both));

    const lanes = [gw, orders].map((el) => el.style.getPropertyValue('--agent-chip-lane'));
    expect(gw.hasAttribute('data-agent-chip')).toBe(true);
    expect(orders.hasAttribute('data-agent-chip')).toBe(true);
    expect(lanes[0]).not.toBe(lanes[1]);
    expect(lanes).toContain('0');
  });

  it('a card that remounts is re-marked on the next tick', () => {
    const root = board();
    render(<AgentOverlay store={store} />);
    act(() => store.apply(edit('t3', Date.now())));
    const fresh = document.createElement('div');
    fresh.setAttribute('data-testid', 'board-node');
    fresh.setAttribute('data-node-id', 'svc:gateway');
    root.querySelector('[data-node-id="svc:gateway"]')!.replaceWith(fresh);
    act(() => vi.advanceTimersByTime(300));
    expect(fresh.getAttribute('data-agent-here')).toBe('live');
  });
});

describe('overlay model', () => {
  it('parses only @xyflow default edge labels', () => {
    expect(edgeKeyFromLabel('Edge from svc:a to svc:b')).toBe('svc:a>svc:b');
    expect(edgeKeyFromLabel('something else')).toBeNull();
    expect(edgeKeyFromLabel(null)).toBeNull();
  });
  it('a call with no locations lights nothing', () => {
    const book = new LightBook();
    const store = createAgentStore(() => null);
    store.apply({ ...edit('x', 5), board: undefined, paths: [] });
    const node = [...store.get().nodes.values()].find((x) => x.kind === 'tool_call')!;
    expect(book.touch([node], 5)).toBe(false);
    expect(book.size()).toBe(0);
  });
});
