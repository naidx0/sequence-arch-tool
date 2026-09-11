import { render } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

import { Board } from './Board';
import { EMPTY_CANVAS } from '../state/initial';
import { canvasReduce } from './canvasReduce';
import { installResizeObserver } from './testResizeObserver';
import { projectDocument } from './project';
import type { SeqDiagramV1 } from '../../../schema/src/seqdiagram.js';

installResizeObserver();

/* ══════════════════════════════════════════════════════════════════════════
   A CHUNK THAT DOES NOT ARRIVE COSTS ONE ROW, NOT THE WHOLE APP
   packages/web2/src/canvas/visualChunkFailure.test.tsx

   WHAT THIS EXISTS BECAUSE OF. The Visual wave put the first `React.lazy` on
   the board's DEFAULT render path (MADR §0 A1 — "they just load it, and it's
   always going to be doing this") with no error boundary anywhere between
   `ArchNode` and `createRoot`. `Suspense` catches suspension, not rejection:
   `lazy` re-throws a failed `import()` during render, so a chunk that 404s
   unmounted the entire tree — a blank page, the transcript and the composer
   gone, rather than a card missing a row. `lazy` caches the rejected promise,
   so nothing short of a reload recovered.

   IT IS REACHABLE, WHICH IS WHY IT IS LOCKED. Vite content-hashes the chunk, so
   a reader holding an open tab while `dist` is rebuilt asks for a
   `VisualMetaStrip-<oldhash>.js` that no longer exists — the stale-dist race
   this repository has already recorded once. An offline or flaky static server
   does the same thing, and before this wave no card render depended on a fetch
   at all.

   THE MOCK REJECTS THE IMPORT rather than throwing inside the component,
   because those are two different failures and only the first is the one that
   shipped: a throwing factory makes the dynamic `import()` reject exactly the
   way a missing chunk does.
   ══════════════════════════════════════════════════════════════════════════ */

vi.mock('./visual/VisualMetaStrip.js', () => {
  /* The message a browser actually gives for a chunk that is no longer on the
     server, so the console line reads like the real failure. */
  throw new Error('Failed to fetch dynamically imported module');
});

const DOC = {
  version: 1,
  kind: 'architecture',
  title: 'chunk failure fixture',
  grounded: { repoRoot: '/tmp/visual', scannedAt: '2026-09-02T00:00:00.000Z' },
  nodes: [
    { id: 'svc:gateway', label: 'gateway', kind: 'service', evidenceRef: 'scan:src/gateway.ts:12' },
    { id: 'svc:checkout', label: 'checkout', kind: 'service', evidenceRef: 'scan:src/checkout.ts:41' },
  ],
  edges: [{ id: 'e1', from: 'svc:gateway', to: 'svc:checkout', family: 'call' }],
} as unknown as SeqDiagramV1;

const CANVAS = canvasReduce(EMPTY_CANVAS, { type: 'canvas/frame', width: 800, height: 600 });

describe('the Visual strip chunk fails to load', () => {
  beforeEach(() => {
    /* React prints its own "The above error occurred in..." on every caught
       boundary error. Silenced so a PASSING run is not a wall of red, and
       restored after, because the assertion below reads this spy. */
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps every card, the board and the rest of the app on screen', async () => {
    const projection = projectDocument(DOC);
    const view = render(
      <Board
        canvas={CANVAS}
        nodes={projection.nodes}
        edges={projection.edges}
        positions={projection.positions}
        dispatch={() => {}}
        onGround={() => {}}
        visual
      />,
    );
    await act(async () => {});

    /* The board is still mounted and still complete: this is the assertion that
       went red before the boundary existed, because React had unmounted the
       whole tree by this point and the container was empty. */
    expect(view.container.querySelector('[data-testid="board"]')).not.toBeNull();
    expect(view.container.querySelectorAll('[data-testid="board-node"]')).toHaveLength(
      DOC.nodes.length,
    );
    /* Each card still carries its own name — nothing about the card is wrong
       without the strip, which is why the boundary renders nothing rather than
       a refusal in a 25px row on every card. */
    expect(view.container.textContent).toContain('Gateway');
    expect(view.container.textContent).toContain('Checkout');

    /* And the row that could not load is ABSENT, not faked. */
    expect(view.container.querySelectorAll('[data-testid="board-node-meta"]')).toHaveLength(0);

    /* Honest errors: the failure reaches the console instead of being
       swallowed, so a reader who reports "Visual looks off" leaves a trace. */
    const said = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(
      said.some((call) => String(call[0]).includes('the visual meta strip failed to render')),
      'the boundary swallowed the failure without saying anything',
    ).toBe(true);

    view.unmount();
  });
});
