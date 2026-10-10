import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StoreProvider, createStore, type Store } from '../state';
import { CanvasProvider, useCanvas } from './canvasChannel';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * THE KEYSTONE SEAM — an agent's proposal reaches the board
 *
 * `canvasReduce` has handled `canvas/proposal` since it was written. The dashed
 * ghost, the merge-for-layout-only rule, the Accept that runs back through
 * `docEdit` and the Deny that drops the layer are all built, and fourteen tests
 * cover them. A grep for `canvas/proposal` across the whole client returned the
 * union declaration, the reducer case, and those tests. NOTHING DISPATCHED IT.
 *
 * So an agent could propose a change to your architecture and the product had
 * no way to show it to you — while the prompt cheerfully asked the model for a
 * fenced `seqd` block that no code anywhere parsed.
 *
 * This asserts the whole chain in the client: an ask event enters the store,
 * and the board ends up in S4 holding that proposal. It fails if the store arm,
 * the session field, or the provider's subscription is missing — and every one
 * of those is a joint that was missing before.
 * ══════════════════════════════════════════════════════════════════════════
 */

/** Reads the canvas the way a real surface does, and prints what it found. */
function Probe() {
  const { canvas } = useCanvas();
  const proposal = canvas.view.state === 'S4' ? canvas.view.proposal : null;
  return (
    <div
      data-testid="probe"
      data-view={canvas.view.state}
      data-nodes={proposal ? proposal.nodes.map((n) => n.id).join(',') : ''}
      data-title={proposal?.title ?? ''}
      data-rationale={proposal?.rationale ?? ''}
      data-evidence={proposal ? proposal.nodes.filter((n) => 'evidenceRef' in n).length : -1}
    />
  );
}

function mount(store: Store) {
  render(
    <StoreProvider store={store}>
      <CanvasProvider>
        <Probe />
      </CanvasProvider>
    </StoreProvider>,
  );
  return () => screen.getByTestId('probe');
}

/** A store with a turn in flight, which is the only state an event can land in. */
function streaming(): Store {
  const store = createStore({ project: () => ({ nodes: [], edges: [] }) as never });
  store.dispatch({
    type: 'repo/loaded',
    draft: {
      root: '/repo',
      repoName: 'repo',
      graph: { nodes: [], edges: [], repoName: 'repo' },
      summary: { services: 0, files: 0, edges: 0 },
      scannedAt: new Date().toISOString(),
    },
    at: 0,
  } as never);
  store.dispatch({ type: 'composer/draft', text: 'add a rate limiter' } as never);
  store.dispatch({ type: 'turn/send', at: 1 } as never);
  return store;
}

const EVENT = {
  type: 'topology:proposal',
  title: 'Add a rate limiter',
  rationale: 'the gateway has no backpressure',
  nodes: [{ id: 'svc:limiter', label: 'limiter', kind: 'service' }],
  edges: [{ id: 'e1', from: 'svc:gateway', to: 'svc:limiter', family: 'http' }],
};

describe('a proposed architecture reaches the board', () => {
  it('THE BOARD ENTERS S4 HOLDING IT', () => {
    const store = streaming();
    const probe = mount(store);
    expect(probe().getAttribute('data-view')).not.toBe('S4');

    act(() => store.dispatch({ type: 'turn/event', event: EVENT, at: 2 } as never));

    expect(probe().getAttribute('data-view')).toBe('S4');
    expect(probe().getAttribute('data-nodes')).toBe('svc:limiter');
  });

  it('carries the title and the rationale the model wrote', () => {
    /* The board renders both. A proposal that arrives without its reasoning is
       a change a reviewer cannot disagree with. */
    const store = streaming();
    const probe = mount(store);
    act(() => store.dispatch({ type: 'turn/event', event: EVENT, at: 2 } as never));
    expect(probe().getAttribute('data-title')).toBe('Add a rate limiter');
    expect(probe().getAttribute('data-rationale')).toBe('the gateway has no backpressure');
  });

  it('NO PROPOSED NODE CARRIES EVIDENCE, on the client side too', () => {
    /*
     * Enforced twice on purpose. The server refuses a proposal whose node
     * supplies `evidenceRef`; this arm builds each node from three fields and
     * cannot add a fourth. The board's Generate gate keys off the ABSENCE of
     * that field to decide a node is unproven, so a ghost carrying one would be
     * indistinguishable from something the scanner actually found.
     */
    const store = streaming();
    const probe = mount(store);
    act(() =>
      store.dispatch({
        type: 'turn/event',
        /* A hostile payload: the wire type forbids it, and a real server could
           still be replaced by something that does not. */
        event: { ...EVENT, nodes: [{ ...EVENT.nodes[0], evidenceRef: 'scan:a.ts:1' }] },
        at: 2,
      } as never),
    );
    expect(probe().getAttribute('data-evidence')).toBe('0');
  });

  it('a second proposal REPLACES the first rather than merging', () => {
    /* The reducer's own rule: "a second answer to the same question is still a
       second answer, and merging them would show a topology no agent proposed."
       This proves the seam honours it, not just the reducer. */
    const store = streaming();
    const probe = mount(store);
    act(() => store.dispatch({ type: 'turn/event', event: EVENT, at: 2 } as never));
    act(() =>
      store.dispatch({
        type: 'turn/event',
        event: { ...EVENT, nodes: [{ id: 'svc:cache', label: 'cache', kind: 'service' }] },
        at: 3,
      } as never),
    );
    expect(probe().getAttribute('data-nodes')).toBe('svc:cache');
  });

  it('a provider mounted AFTER the proposal still shows it', () => {
    /* The overlay and the board come and go; a proposal that only arrived by
       subscription would vanish for anyone who was not already listening. */
    const store = streaming();
    act(() => store.dispatch({ type: 'turn/event', event: EVENT, at: 2 } as never));
    const probe = mount(store);
    expect(probe().getAttribute('data-view')).toBe('S4');
  });
});
