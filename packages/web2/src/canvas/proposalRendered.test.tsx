import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

import { CanvasProvider, useCanvas } from './canvasChannel';
import { ConnectedBoard } from './ConnectedBoard';
import { DocProvider, useDoc } from './docChannel';
import { seqdFromGraph } from './seqdFromGraph';
import { StoreProvider, createStore, type Store } from '../state';
import { readShellPersisted, readShellTokens } from '../shell';
import { summarizeGraph } from '../boot';
import { installResizeObserver } from './testResizeObserver';
import type { CanvasAction } from './canvasReduce';
import type { TopologyProposal } from '../state/types';
import type { GetArchGraphResponse } from '@sequence/api-types';
import { scratchKey } from './localScratch';

installResizeObserver();

/**
 * S4 ON THE BOARD — the render arm the register said did not exist.
 *
 * The row read "a type with no reducer case and no render arm", and recorded it
 * as blocked on draw mode. It is not: `TopologyProposal.turnId` says the ghost
 * comes from an ASK, so an agent can propose a service without anybody picking
 * up a pen. That mis-scoping kept a buildable row shut, which is worth writing
 * down where the next reader will see it.
 */

const GRAPH = {
  repoName: 'shop',
  scannedAt: '2026-08-22T00:00:00.000Z',
  nodes: [{ id: 'svc:orders', label: 'orders', kind: 'service', file: 'src/o.ts', line: 1 }],
  edges: [],
  nodeDetail: {},
} as unknown as GetArchGraphResponse;

const PROPOSAL: TopologyProposal = {
  id: 'p1',
  turnId: 't1',
  title: 'Split billing out of orders',
  rationale: 'orders writes three billing tables',
  nodes: [{ id: 'svc:billing', label: 'billing', kind: 'service' }],
  edges: [{ id: 'e:new', from: 'svc:orders', to: 'svc:billing', family: 'http', label: 'POST /charge' }],
  status: 'pending',
  verify: null,
};

const SCRATCH_PROPOSAL: TopologyProposal = {
  id: 'p-scratch',
  turnId: 't1',
  title: 'Add billing service',
  rationale: 'clean local agent harness should not appear on the bar',
  nodes: [{ id: 'svc:billing', label: 'billing', kind: 'service' }],
  edges: [],
  status: 'pending',
  verify: null,
};

const AGENT_LOOP_PROPOSAL: TopologyProposal = {
  id: 'p-agent-loop',
  turnId: 't2',
  title: 'Agentic harness loop',
  rationale: 'orchestrator planner router tools memory cycle',
  nodes: [
    { id: 'agent:orchestrator', label: 'Orchestrator', kind: 'agent' },
    { id: 'svc:planner', label: 'Planner', kind: 'service' },
    { id: 'svc:router', label: 'Provider Router', kind: 'service' },
    { id: 'svc:tools', label: 'Tool Registry', kind: 'service' },
    { id: 'svc:memory', label: 'Memory', kind: 'service' },
  ],
  edges: [
    { id: 'e1', from: 'agent:orchestrator', to: 'svc:planner', family: 'control' },
    { id: 'e2', from: 'svc:planner', to: 'svc:router', family: 'control' },
    { id: 'e3', from: 'svc:router', to: 'svc:tools', family: 'control' },
    { id: 'e4', from: 'svc:tools', to: 'svc:memory', family: 'control' },
    { id: 'e5', from: 'svc:memory', to: 'agent:orchestrator', family: 'control' },
  ],
  status: 'pending',
  verify: null,
};

function detached(): Store {
  return createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
}

function mountDetached() {
  let probe: {
    canvas: (a: CanvasAction) => void;
    docNodes: () => string[];
    edgeLabel: (id: string) => string | undefined;
  } | null = null;
  render(
    <StoreProvider store={detached()}>
      <CanvasProvider>
        <DocProvider>
          <Probe onReady={(c) => (probe = c)} />
          <ConnectedBoard />
        </DocProvider>
      </CanvasProvider>
    </StoreProvider>,
  );
  return () => probe!;
}

function attached(): Store {
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({
    type: 'repo/loaded',
    draft: {
      root: '/tmp/shop',
      repoName: 'shop',
      graph: GRAPH,
      summary: summarizeGraph(GRAPH),
      scannedAt: '2026-08-22T00:00:00.000Z',
    },
    at: 0,
  });
  return store;
}

function Probe({ onReady }: { onReady: (c: {
  canvas: (a: CanvasAction) => void;
  docNodes: () => string[];
  edgeLabel: (id: string) => string | undefined;
}) => void }) {
  const { dispatch } = useCanvas();
  const { session } = useDoc();
  onReady({
    canvas: dispatch,
    docNodes: () => (session.doc?.nodes ?? []).map((n) => n.id),
    edgeLabel: (id) => session.doc?.edges.find((edge) => edge.id === id)?.label,
  });
  return null;
}

function mount() {
  let probe: {
    canvas: (a: CanvasAction) => void;
    docNodes: () => string[];
    edgeLabel: (id: string) => string | undefined;
  } | null = null;
  render(
    <StoreProvider store={attached()}>
      <CanvasProvider>
        <DocProvider>
          <Probe onReady={(c) => (probe = c)} />
          <ConnectedBoard />
        </DocProvider>
      </CanvasProvider>
    </StoreProvider>,
  );
  return () => probe!;
}

function cards(): { label: string; ghost: string | null }[] {
  return screen.queryAllByTestId('board-node').map((el) => ({
    label: el.querySelector('[data-testid="board-node-title"]')?.textContent ?? '',
    ghost: el.getAttribute('data-ghost'),
  }));
}

describe('the proposal ghost, on the board', () => {
  it('no bar and no ghost until an agent proposes', () => {
    mount();
    expect(screen.queryByTestId('board-proposal')).toBeNull();
    expect(cards().every((c) => c.ghost !== 'true')).toBe(true);
  });

  it('a proposed node is DRAWN, and drawn as a ghost', () => {
    const probe = mount();
    act(() => probe().canvas({ type: 'canvas/proposal', proposal: PROPOSAL }));

    const billing = cards().find((c) => c.label === 'Billing');
    expect(billing, `expected a billing card; saw ${JSON.stringify(cards())}`).toBeTruthy();
    /* Dashed is the whole signal — a ghost tinted with the accent would say the
       product endorses it, and one at low opacity would say it is unimportant. */
    expect(billing!.ghost).toBe('true');
    /* And the grounded node beside it is NOT a ghost. */
    expect(cards().find((c) => c.label === 'Orders')?.ghost).toBe('false');
  });

  it('the bar names what it is judging — title and counts only, no rationale prose', () => {
    const probe = mount();
    act(() => probe().canvas({ type: 'canvas/proposal', proposal: PROPOSAL }));
    const bar = screen.getByTestId('board-proposal');
    /* An Accept/Deny with no subject is a dialog asking the reader to agree to
       something they have to go and find. */
    expect(bar.textContent).toContain('Split billing out of orders');
    expect(bar.textContent).toContain('1 node');
    expect(bar.textContent).toContain('1 edge');
    expect(bar.textContent).not.toContain('orders writes three billing tables');
  });

  it('the ghost is NOT in the document until Accept', () => {
    const probe = mount();
    act(() => probe().canvas({ type: 'canvas/proposal', proposal: PROPOSAL }));
    /*
     * The load-bearing property. A ghost that had already edited the document
     * would make Deny a second edit rather than a refusal — and would leave a
     * denied proposal's node in the diagram if anything went wrong in between.
     */
    expect(probe().docNodes()).not.toContain('svc:billing');
  });

  it('Accept applies it through docEdit and clears the ghost', () => {
    const probe = mount();
    act(() => probe().canvas({ type: 'canvas/proposal', proposal: PROPOSAL }));
    act(() => {
      fireEvent.click(screen.getByTestId('board-proposal-accept'));
    });

    expect(probe().docNodes()).toContain('svc:billing');
    expect(screen.queryByTestId('board-proposal')).toBeNull();
    /* Accepted, so no longer provisional: the same card, no longer dashed. */
    expect(cards().find((c) => c.label === 'Billing')?.ghost).toBe('false');
  });

  it('Accept preserves the proposed edge label', () => {
    const probe = mount();
    act(() => probe().canvas({ type: 'canvas/proposal', proposal: PROPOSAL }));
    act(() => {
      fireEvent.click(screen.getByTestId('board-proposal-accept'));
    });

    expect(probe().edgeLabel('e:new')).toBe('POST /charge');
  });

  it('Deny removes the ghost and changes nothing', () => {
    const probe = mount();
    act(() => probe().canvas({ type: 'canvas/proposal', proposal: PROPOSAL }));
    act(() => {
      fireEvent.click(screen.getByTestId('board-proposal-deny'));
    });

    expect(screen.queryByTestId('board-proposal')).toBeNull();
    expect(probe().docNodes()).not.toContain('svc:billing');
    expect(cards().find((c) => c.label === 'Billing')).toBeUndefined();
  });

  it('a proposal naming a node the repo already has does not draw it twice', () => {
    const probe = mount();
    act(() =>
      probe().canvas({
        type: 'canvas/proposal',
        proposal: {
          ...PROPOSAL,
          nodes: [{ id: 'svc:orders', label: 'orders', kind: 'service' }],
          edges: [],
        },
      }),
    );
    /* An agent proposing a node the repo has is proposing an EDGE to it, and
       two cards with one id is a board that cannot say which was clicked. */
    const orders = cards().filter((c) => c.label === 'Orders');
    expect(orders).toHaveLength(1);
    /* The surviving card came from the scan, with real evidence. A colliding
       proposal must not lend its dashed, unproved state to that grounded card. */
    expect(orders[0].ghost).toBe('false');
  });

  it('Accept keeps the bar when every node collides — does not vanish the design', () => {
    const probe = mount();
    act(() =>
      probe().canvas({
        type: 'canvas/proposal',
        proposal: {
          ...PROPOSAL,
          nodes: [{ id: 'svc:orders', label: 'orders', kind: 'service' }],
          edges: [],
        },
      }),
    );
    act(() => {
      fireEvent.click(screen.getByTestId('board-proposal-accept'));
    });

    expect(probe().docNodes().filter((id) => id === 'svc:orders')).toHaveLength(1);
    /* Owner: Accept that applies nothing must not clear the ghost — that read
       as "I clicked Accept and the design disappeared." */
    expect(screen.getByTestId('board-proposal')).toBeTruthy();
    expect(cards().find((c) => c.label === 'Orders')?.ghost).toBe('false');
  });
});

describe('proposal Accept without a repo — local scratch', () => {
  it('Accept saves to session-scoped localStorage and clears the ghost', () => {
    localStorage.removeItem(scratchKey('workspace'));
    const probe = mountDetached();
    act(() => probe().canvas({ type: 'canvas/proposal', proposal: SCRATCH_PROPOSAL }));
    act(() => {
      fireEvent.click(screen.getByTestId('board-proposal-accept'));
    });

    expect(probe().docNodes()).toContain('svc:billing');
    expect(screen.queryByTestId('board-proposal')).toBeNull();
    expect(cards().find((c) => c.label === 'Billing')?.ghost).toBe('false');

    const raw = localStorage.getItem(scratchKey('workspace'));
    expect(raw).toBeTruthy();
    expect(raw).toContain('svc:billing');
  });

  it('shows an honest note when scratch Accept succeeds', () => {
    localStorage.removeItem(scratchKey('workspace'));
    const probe = mountDetached();
    act(() => probe().canvas({ type: 'canvas/proposal', proposal: SCRATCH_PROPOSAL }));
    act(() => {
      fireEvent.click(screen.getByTestId('board-proposal-accept'));
    });

    expect(screen.getByTestId('board-ink-note').textContent).toBe('Saved to local workspace');
  });

  it('agent-loop proposal draws five ghost nodes (circular classifier path)', async () => {
    const probe = mountDetached();
    act(() => probe().canvas({ type: 'canvas/proposal', proposal: AGENT_LOOP_PROPOSAL }));

    await waitFor(() => {
      expect(cards().length).toBeGreaterThanOrEqual(5);
    });
    const labels = cards().map((c) => c.label);
    expect(labels).toContain('Orchestrator');
    expect(labels).toContain('Memory');
    const ghosts = cards().filter((c) =>
      ['Orchestrator', 'Planner', 'Provider Router', 'Tool Registry', 'Memory'].includes(c.label),
    );
    expect(ghosts).toHaveLength(5);
    expect(ghosts.every((c) => c.ghost === 'true')).toBe(true);
    expect(screen.getByTestId('board-proposal').textContent).toContain('Agentic harness loop');
  });
});
