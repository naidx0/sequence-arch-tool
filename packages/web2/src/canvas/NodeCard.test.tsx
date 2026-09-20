import { fireEvent, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

import { NodeCard, type BoardNode } from './NodeCard';
import { SILHOUETTES, silhouetteClass, silhouetteOf } from './kinds';
import type { LodRung } from '../state/types';

const service: BoardNode = {
  id: 'svc:checkout',
  label: 'checkout',
  subtitle: null,
  present: { kind: 'service', entry: false },
  schemaKind: 'service',
  provenance: null,
  count: null,
};

function draw(node: BoardNode, extra: Partial<Parameters<typeof NodeCard>[0]> = {}) {
  return render(
    <div className="board-scope">
      <ReactFlowProvider>
        <NodeCard
          node={node}
          selected={false}
          dimmed={false}
          rung={1}
          onSelect={() => undefined}
          {...extra}
        />
      </ReactFlowProvider>
    </div>,
  );
}

/**
 * ITEM 3.3 — THE NODE CARD.
 *
 * What this tier can see: markup, class lists, which slots are drawn, and which
 * props reached the renderer. What it CANNOT see: a rendered radius, a computed
 * colour, or a painted box — jsdom does not substitute custom properties and
 * has no compositor. Those live in `boardRendered.test.ts`, in a real browser,
 * which is where the book's own first draft of the greyscale invariant went
 * wrong.
 */
describe('P2.6 — module uses the service chassis', () => {
  it('still reports module as its kind, but paints with the n-module class', () => {
    const moduleNode: BoardNode = {
      ...service,
      id: 'mod:core',
      label: 'core',
      present: { kind: 'module', entry: false },
      schemaKind: 'module',
    };
    const { container } = draw(moduleNode);
    const card = container.querySelector('[data-testid="board-node"]')!;
    expect(card.getAttribute('data-kind')).toBe('module');
    expect(card.classList.contains('n-module')).toBe(true);
    expect(card.classList.contains('n-service')).toBe(false);
  });
});

describe('item 3.3 — the eight handles', () => {
  it('renders eight, and edges have something to terminate on', () => {
    // THE FACT: @xyflow/react derives every edge endpoint from handle bounds
    // MEASURED OFF THE DOM. `getHandleBounds` returns null when the query finds
    // nothing, `getEdgePosition` then returns null, and `EdgeWrapper` returns
    // null before the custom edge mounts. Delete these and EVERY EDGE ON THE
    // BOARD DISAPPEARS — a routing wobble it is not.
    const { container } = draw(service);
    expect(container.querySelectorAll('.react-flow__handle')).toHaveLength(8);
    expect(container.querySelectorAll('.react-flow__handle.source')).toHaveLength(4);
    expect(container.querySelectorAll('.react-flow__handle.target')).toHaveLength(4);
  });

  it('makes all eight inert as a CONNECTION STARTER, not merely unclickable', () => {
    // <Handle> defaults isConnectable / isConnectableStart / isConnectableEnd
    // ALL THREE to true and never reads the board's `nodesConnectable`. Pass
    // only the first and the nubs stay live starters that happen to take no
    // pointer events because they are hidden — one `visibility` regression away
    // from a board that drags connection lines it will never accept.
    //
    // Asserted on the CLASS LIST the renderer emits, which is the observable
    // consequence, rather than on the props this file passed in.
    const { container } = draw(service);
    const live = [...container.querySelectorAll('.react-flow__handle')].filter(
      (handle) =>
        handle.classList.contains('connectablestart') ||
        handle.classList.contains('connectableend'),
    );
    expect(live).toEqual([]);
  });

  it('keeps the handles at the mark rung too', () => {
    // A node drawn as a mark is still a node an edge terminates on.
    const { container } = draw(service, { rung: 7 as LodRung });
    expect(container.querySelectorAll('.react-flow__handle')).toHaveLength(8);
  });
});

describe('item 3.3 — the chassis and its four slots', () => {
  it('paints the substrate’s class for every silhouette', () => {
    for (const silhouette of SILHOUETTES) {
      const node: BoardNode =
        silhouette === 'entry'
          ? { ...service, present: { kind: 'service', entry: true } }
          : { ...service, present: { kind: silhouette, entry: false }, schemaKind: silhouette };

      const { container, unmount } = draw(node);
      const card = container.querySelector('[data-testid="board-node"]')!;
      expect(card.classList.contains('node')).toBe(true);
      expect(card.classList.contains(silhouetteClass(silhouette))).toBe(true);
      expect(card.getAttribute('data-kind')).toBe(silhouette);
      unmount();
    }
  });

  it('draws no footer when the analyzer has nothing further to say', () => {
    // Sheet 02.5: "A node the analyzer has nothing further to say about gets no
    // footer, and is shorter for it." An empty footer chip would be room held
    // for a fact that does not exist.
    const { container } = draw(service);
    expect(container.querySelector('.nd-ft')).toBeNull();
    expect(container.querySelector('.nd-s')).toBeNull();
  });

  it('carries at most one provenance tag, and says the two words the edges say', () => {
    const traced = draw({ ...service, provenance: 'traced' }, { selected: true });
    expect(traced.container.querySelectorAll('.prov')).toHaveLength(1);
    expect(screen.getByText('Traced').classList.contains('p-measured')).toBe(true);
    traced.unmount();

    const declared = draw({ ...service, provenance: 'declared' }, { selected: true });
    // Declared is --unknown and NEVER --wont: a claim nobody could check has
    // not failed at anything.
    expect(screen.getByText('Declared').classList.contains('p-declared')).toBe(true);
    expect(declared.container.querySelector('.p-wont')).toBeNull();
  });

  it('holds provenance until the card is selected — first glance stays icon + English', () => {
    const { container } = draw({ ...service, provenance: 'traced' });
    expect(container.querySelector('.prov')).toBeNull();
  });

  it('quiets provenance chrome — no claim wash pill (Decision 6 density)', () => {
    /*
     * Seat walk: every card wore a green Traced pill that out-competed the
     * English. Within Decision 6 we keep the words and drop the wash/pill.
     * Lock the class contract (tests without CSSOM) — paint rules live in
     * board.css `.p-measured` / `.p-declared` as transparent backgrounds.
     */
    const { container } = draw({ ...service, provenance: 'traced' }, { selected: true });
    const pill = container.querySelector('.prov.p-measured') as HTMLElement;
    expect(pill).toBeTruthy();
    expect(pill.classList.contains('verdict')).toBe(false);
    expect(container.querySelector('.nd-t')).toBeTruthy();
  });

  it('never dresses a category as a verdict', () => {
    const { container } = draw(
      {
        ...service,
        present: { kind: 'agent', entry: false },
        schemaKind: 'agent',
        provenance: 'traced',
      },
      { selected: true },
    );
    expect(container.querySelector('.verdict')).toBeNull();
    expect(container.querySelector('.nd-k')).toBeNull();
    expect(container.querySelector('[data-testid="board-node-icon"]')).toBeTruthy();
  });

  it('pins kind icon and expand in corners — title centered in body', () => {
    const { container } = draw(service, { openable: true, onOpen: vi.fn() });
    expect(container.querySelector('.nd-k')).toBeNull();
    expect(container.querySelector('.nd-body')).toBeTruthy();
    expect(container.querySelector('.nd-row')).toBeNull();
    expect(container.querySelector('[data-testid="board-node-icon"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="board-node-expand"]')).toBeTruthy();
  });

  it('entry position keeps one kind icon — no second glyph on the right', () => {
    const { container } = draw({ ...service, present: { kind: 'service', entry: true } });
    expect(container.querySelector('[data-testid="board-node"]')!.getAttribute('data-kind')).toBe(
      'entry',
    );
    expect(container.querySelector('.nd-k')).toBeNull();
    expect(container.querySelectorAll('[data-testid="board-node-icon"] svg')).toHaveLength(1);
  });

  it('title-cases bare scan ids on the card face', () => {
    const { container } = draw({ ...service, label: 'order-service' });
    expect(container.querySelector('[data-testid="board-node-title"]')!.textContent).toBe(
      'Order Service',
    );
  });

  it('maps label heuristics to role icons from the book atlas', () => {
    const modelNode: BoardNode = {
      ...service,
      label: 'gpt-model',
      present: { kind: 'service', entry: false },
    };
    const { container, unmount } = draw(modelNode);
    expect(
      container.querySelector('[data-testid="board-node-icon"] svg')!.getAttribute('data-icon'),
    ).toBe('model');
    unmount();

    const cacheNode: BoardNode = {
      ...service,
      label: 'redis-cache',
      present: { kind: 'service', entry: false },
    };
    const cache = draw(cacheNode);
    expect(
      cache.container.querySelector('[data-testid="board-node-icon"] svg')!.getAttribute('data-icon'),
    ).toBe('database');
    cache.unmount();
  });
});

describe('item 3.8 — the ladder, on the card', () => {
  it('shows node detail at closer zoom and hides it when zoomed out', () => {
    const withDetail: BoardNode = {
      ...service,
      subtitle: 'Accepts checkout and persists orders.',
    };
    const near = draw(withDetail, { rung: 2 as LodRung });
    expect(near.container.querySelector('.nd-s')).not.toBeNull();
    near.unmount();
    const far = draw(withDetail, { rung: 4 as LodRung });
    expect(far.container.querySelector('.nd-s')).toBeNull();
    far.unmount();
  });

  it('drops each rung whole and adds nothing back', () => {
    const full: BoardNode = {
      ...service,
      subtitle: 'Charges an order.',
      provenance: 'traced',
      count: { label: 'parts', value: '4' },
    };

    const seen: Record<number, string[]> = {};
    for (const rung of [1, 2, 3, 4, 5, 6, 7] as LodRung[]) {
      /* Rest (unselected): kind tag + footer wait for select. */
      const { container, unmount } = draw(full, { rung });
      seen[rung] = ['.nd-k', '.nd-t', '.nd-s', '.nd-ft', '[data-testid="board-node-icon"]'].filter(
        (selector) => container.querySelector(selector),
      );
      unmount();
    }

    expect(seen[1]).toEqual(['.nd-t', '.nd-s', '[data-testid="board-node-icon"]']);
    expect(seen[2]).toEqual(['.nd-t', '.nd-s', '[data-testid="board-node-icon"]']);
    /* A5.2 — detailed subtitle stays one rung longer. */
    expect(seen[3]).toEqual(['.nd-t', '.nd-s', '[data-testid="board-node-icon"]']);
    expect(seen[4]).toEqual(['.nd-t']);
    expect(seen[5]).toEqual(['.nd-t']);
    expect(seen[7]).toEqual([]);

    // And the mark rung is a different element, not a card with nothing in it.
    const { container } = draw(full, { rung: 7 as LodRung });
    expect(container.querySelector('.boardmark')).not.toBeNull();
    expect(container.querySelector('.node')).toBeNull();
  });

  it('keeps a condensed counter-scaled title at far zoom (owner big-picture ask)', () => {
    const { container } = render(
      <div className="board-scope" data-rung="5" style={{ ['--board-cam-z' as string]: 0.3 }}>
        <ReactFlowProvider>
          <NodeCard
            node={{ ...service, label: 'order-service' }}
            selected={false}
            dimmed={false}
            rung={5}
            onSelect={() => undefined}
          />
        </ReactFlowProvider>
      </div>,
    );
    const title = container.querySelector('.nd-t-short');
    expect(title).not.toBeNull();
    expect(title!.textContent).toBe('Order');
    expect(getComputedStyle(title!).transform).not.toBe('none');
  });
});

describe('P2.6 — expand-into affordance', () => {
  it('shows an expand icon when the node is openable', () => {
    const { container } = draw(service, { openable: true, onOpen: vi.fn() });
    expect(container.querySelector('[data-testid="board-node-expand"]')).not.toBeNull();
  });

  it('hides the expand icon when the node is not openable', () => {
    const { container } = draw(service, { openable: false, onOpen: vi.fn() });
    expect(container.querySelector('[data-testid="board-node-expand"]')).toBeNull();
  });

  it('opens on expand click without firing select', () => {
    const onSelect = vi.fn();
    const onOpen = vi.fn();
    const { container } = draw(service, { openable: true, onOpen, onSelect });
    fireEvent.click(container.querySelector('[data-testid="board-node-expand"]')!);
    expect(onOpen).toHaveBeenCalledWith('svc:checkout');
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('item 3.5 — one click, one action', () => {
  it('reports the node once per click, with the modifier that was held', () => {
    const onSelect = vi.fn();
    const { container } = draw(service, { onSelect });
    const card = container.querySelector('[data-testid="board-node"]') as HTMLElement;

    card.click();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenLastCalledWith('svc:checkout', false);
  });

  it('is a real control, so the keyboard can reach it', () => {
    const { container } = draw(service);
    const card = container.querySelector('[data-testid="board-node"]')!;
    expect(card.getAttribute('role')).toBe('button');
    expect(card.getAttribute('aria-pressed')).toBe('false');
  });

  it('says it is selected in the accessibility tree as well as in paint', () => {
    const { container } = draw(service, { selected: true });
    const card = container.querySelector('[data-testid="board-node"]')!;
    expect(card.classList.contains('sel')).toBe(true);
    expect(card.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('sheet 06.6 — dimming is not a selection effect', () => {
  it('is its own flag, and selecting does not set it', () => {
    const { container } = draw(service, { selected: true });
    const card = container.querySelector('[data-testid="board-node"]')!;
    expect(card.classList.contains('dim')).toBe(false);
    expect(card.getAttribute('data-dimmed')).toBe('false');
  });

  it('keeps the kind channels when it IS dimmed', () => {
    // Dimming is opacity, never a colour, so the silhouette and the glyph
    // survive it. A dimmed card the reader can see is there but cannot identify
    // is worse than a hidden one.
    const { container } = draw(service, { dimmed: true });
    const card = container.querySelector('[data-testid="board-node"]')!;
    expect(card.classList.contains('dim')).toBe(true);
    expect(card.classList.contains(silhouetteClass(silhouetteOf(service.present)))).toBe(true);
    expect(container.querySelector('[data-testid="board-node-icon"] svg')).not.toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Decision 6 — THE STATUS DOT.
   Sheet 06 §06.1: "A small dot left of the title carries where the node stands
   in the path being read … kind keeps its four non-chromatic channels, and the
   dot may not carry a kind." Tokens: --board-dot-selected → --accent,
   --board-dot-onpath → --info, --board-dot-offpath → --st-neutral, hollow.
   ══════════════════════════════════════════════════════════════════════════ */
describe('Decision 6 — the status dot', () => {
  it('renders with the state token class, left of the title', () => {
    for (const state of ['selected', 'onpath', 'offpath'] as const) {
      const { container, unmount } = draw(service, { dot: state });
      const dot = container.querySelector('.nd-dot');
      expect(dot, `no dot for ${state}`).not.toBeNull();
      expect(dot!.classList.contains(`dot-${state}`)).toBe(true);
      expect(dot!.getAttribute('data-dot')).toBe(state);
      // Dot lives in the centered title row inside .nd-body.
      const row = dot!.parentElement!;
      expect(row.classList.contains('nd-t')).toBe(true);
      expect(row.closest('.nd-body')?.querySelector('.nd-t')).not.toBeNull();
      unmount();
    }
  });

  it('carries no dot at all when the node has no state — rest is rest', () => {
    const { container } = draw(service);
    expect(container.querySelector('.nd-dot')).toBeNull();
  });

  it('never appears on a card whose title has dropped — the dot lives in the title row', () => {
    // Sheet 05.8's ladder drops the title at rung 4; the dot rides the title
    // row, so it goes with it. Nothing is added back below the handoff.
    for (const rung of [1, 2, 3]) {
      const { container, unmount } = draw(service, { rung: rung as LodRung, dot: 'onpath' });
      expect(container.querySelector('.nd-dot'), `rung ${rung}`).not.toBeNull();
      unmount();
    }
    for (const rung of [4, 5, 6]) {
      const { container, unmount } = draw(service, { rung: rung as LodRung, dot: 'onpath' });
      expect(container.querySelector('.nd-dot'), `rung ${rung}`).toBeNull();
      unmount();
    }
  });

  it('is absent from the mark rung, which is not a card', () => {
    const { container } = draw(service, { rung: 7 as LodRung, dot: 'selected' });
    expect(container.querySelector('.boardmark')).not.toBeNull();
    expect(container.querySelector('.nd-dot')).toBeNull();
  });

  it('carries the node’s annotation as ONE English glance line at the subtitle rungs only', () => {
    // /api/annotate's per-node bullet: one glance line (not a second note row).
    // A5.2 keeps a real subtitle one rung longer (1–3), so glance follows.
    const annotated = { ...service, annotation: 'Takes an order and charges it.' };
    for (const rung of [1, 2, 3]) {
      const { container, unmount } = draw(annotated, { rung: rung as LodRung });
      expect(container.querySelector('[data-testid="board-node-glance"]'), `rung ${rung}`).not.toBeNull();
      unmount();
    }
    for (const rung of [4, 5]) {
      const { container, unmount } = draw(annotated, { rung: rung as LodRung });
      expect(container.querySelector('[data-testid="board-node-glance"]'), `rung ${rung}`).toBeNull();
      unmount();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   WHO WROTE THE ONE SENTENCE ON THE CARD.

   The glance line takes an `/api/annotate` bullet in preference to the
   analyzer's own derived summary. The server validates only that the annotation
   KEY is a node id the request asked about — the STRING is trimmed,
   length-capped, and never checked against any evidence; the prompt asks the
   model not to invent and nothing enforces it.

   So on any repository with a provider key bound, the line a reader actually
   reads on every card is model prose, and it visually outranked AND replaced
   the analyzer's own answer with no mark of any kind. On the product whose
   first non-negotiable is grounded, not guessed.
   ══════════════════════════════════════════════════════════════════════════ */
describe('the glance line says where it came from', () => {
  const scanned: BoardNode = {
    ...service,
    subtitle: 'Charges an order and records the receipt.',
  };

  it('marks a model-written line as AI, in the ink used for an unverified claim', () => {
    const { container } = draw({ ...scanned, annotation: 'Takes payment for a checkout.' });
    const glance = container.querySelector('[data-testid="board-node-glance"]')!;
    expect(glance.getAttribute('data-source')).toBe('ai');
    /* A WORD as well as an ink: colour alone dies in greyscale, and a reader who
       cannot receive the hue still has to be able to tell the two apart. */
    expect(glance.querySelector('[data-testid="board-node-glance-ai"]')!.textContent).toBe('AI');
    expect(glance.textContent).toContain('Takes payment for a checkout.');
  });

  it('leaves a scan-derived line unmarked, because measured is the default here', () => {
    const { container } = draw(scanned);
    const glance = container.querySelector('[data-testid="board-node-glance"]')!;
    expect(glance.getAttribute('data-source')).toBe('scan');
    expect(glance.querySelector('[data-testid="board-node-glance-ai"]')).toBeNull();
    expect(glance.textContent).toBe('Charges an order and records the receipt.');
  });

  it('does not mark the scan line just because an annotation was noise', () => {
    /* `isGlanceNoise` drops a path dump before it can take the slot. The line
       that survives is the scan's, so the card must not claim a model wrote
       it — a false AI mark is the same defect pointing the other way. */
    const { container } = draw({ ...scanned, annotation: 'frontend/src/App.tsx (ts, 728 lines)' });
    const glance = container.querySelector('[data-testid="board-node-glance"]')!;
    expect(glance.getAttribute('data-source')).toBe('scan');
    expect(glance.querySelector('[data-testid="board-node-glance-ai"]')).toBeNull();
  });
});

describe('an invented node keeps saying so after it is accepted', () => {
  it('marks the ungrounded card at rest — unselected, and with no proposal live', () => {
    /* The ghost border is driven by `proposalProjection.addedNodeIds`, which
       Accept clears. So the ONE signal that distinguished a model's invention
       was exactly the state that ended when it became part of the document.
       This is the same mark, driven by the document instead of the proposal. */
    const { container } = draw({ ...service, grounded: false }, { selected: false, ghost: false });
    const card = container.querySelector('[data-testid="board-node"]')!;
    expect(card.getAttribute('data-grounded')).toBe('false');
    /* And it is genuinely at rest: no footer is open, so the provenance chip —
       the only signal there used to be — is not on screen. */
    expect(card.querySelector('.prov')).toBeNull();
  });

  it('says nothing about a grounded card, so the exception stays visible', () => {
    const { container } = draw({ ...service, grounded: true });
    expect(
      container.querySelector('[data-testid="board-node"]')!.getAttribute('data-grounded'),
    ).toBeNull();
  });
});
