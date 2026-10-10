import { describe, expect, it } from 'vitest';

import type { FlowHop, FlowPlayback } from '../state/types';
import {
  hopAt,
  parentLookup,
  promoteOnFlow,
  resolveFlow,
  sameDim,
  selectionDim,
  teachDim,
  type BoardShape,
  type HopResolution,
} from './flowFocus';

/* ══════════════════════════════════════════════════════════════════════════
   THE RESOLVER — item playback
   packages/web2/src/canvas/flowFocus.test.ts

   THE FOUR RESOLUTIONS ARE ASSERTED SEPARATELY BECAUSE THEY ARE FOUR DIFFERENT
   CLAIMS, and collapsing any two of them is the defect this module exists to
   prevent. `inside` reported as `direct` would be the board asserting a
   service-to-service crossing the scan never found — which is the same shape as
   the incident CANON §1 names by commit: svc:gateway's only two inbound edges
   were nginx confs inside test fixtures, drawn as facts.

   THE FIXTURE IS THE SHAPE THIS MONOREPO ACTUALLY PRODUCES. Ten service cards,
   file nodes underneath them, and call edges that stay inside one package —
   measured, not imagined: `.sequence/functions.json` holds thousands of call edges and
   ZERO of them cross a package, so every real flow here resolves `inside`.
   A fixture whose hops all crossed services would have let a resolver that only
   handled `direct` pass this file and light nothing in the product.
   ══════════════════════════════════════════════════════════════════════════ */

/** Two cards, one connector between them — what the board is drawing. */
const BOARD: BoardShape = {
  nodeIds: new Set(['svc:a', 'svc:b']),
  edges: [{ id: 'edge:a-b', source: 'svc:a', target: 'svc:b' }],
};

/** The scan's own `parentId` chain. `file:orphan` belongs to nothing drawn. */
const PARENT = parentLookup([
  { id: 'svc:a', parentId: 'repo' },
  { id: 'svc:b', parentId: 'repo' },
  { id: 'file:a1', parentId: 'mod:a' },
  { id: 'file:a2', parentId: 'mod:a' },
  { id: 'mod:a', parentId: 'svc:a' },
  { id: 'file:b1', parentId: 'svc:b' },
  { id: 'file:orphan', parentId: null },
  { id: 'repo', parentId: null },
]);

function hop(from: string, to: string): FlowHop {
  return { from, to, via: null, label: null, evidence: null };
}

function flow(hops: FlowHop[], cursor = 0, playing = false): FlowPlayback {
  return { functionId: 'fn:test', hops, cursor, playing };
}

describe('a hop is resolved to the level the board actually draws', () => {
  it('calls a hop between two drawn nodes DIRECT, and finds the connector', () => {
    const out = resolveFlow(flow([hop('svc:a', 'svc:b')]), BOARD, PARENT);
    expect(out.hops[0].how).toBe<HopResolution>('direct');
    expect(out.hops[0].from).toBe('svc:a');
    expect(out.hops[0].to).toBe('svc:b');
    /* THE CONNECTOR IS MATCHED BY ITS ENDS. `FlowHop.via` is an ARCH edge id
       and the board draws SeqDiagram ids; copying one into the other would
       never match and the promotion would silently never happen. */
    expect(out.hops[0].edgeId).toBe('edge:a-b');
  });

  it('calls a hop below the board CONTAINING, and lights what contains it', () => {
    // file:a1 sits under mod:a under svc:a — two levels, so the walk has to walk.
    const out = resolveFlow(flow([hop('file:a1', 'file:b1')]), BOARD, PARENT);
    expect(out.hops[0].how).toBe<HopResolution>('containing');
    expect(out.hops[0].from).toBe('svc:a');
    expect(out.hops[0].to).toBe('svc:b');
    expect(out.hops[0].edgeId).toBe('edge:a-b');
  });

  it('calls a hop whose ends land on ONE node INSIDE it, and draws no crossing', () => {
    /* THIS IS 100% OF THIS REPOSITORY'S FLOWS. Reporting it as `direct` would
       have the board claim a crossing between two services that the function
       graph — 4,000 edges, none of them cross-package — never traced. */
    const out = resolveFlow(flow([hop('file:a1', 'file:a2')]), BOARD, PARENT);
    expect(out.hops[0].how).toBe<HopResolution>('inside');
    expect(out.hops[0].from).toBe('svc:a');
    expect(out.hops[0].to).toBe('svc:a');
    expect(out.hops[0].edgeId).toBeNull();
  });

  it('calls a hop it cannot place NONE, and lights nothing for it', () => {
    const out = resolveFlow(flow([hop('file:orphan', 'svc:b')]), BOARD, PARENT);
    expect(out.hops[0].how).toBe<HopResolution>('none');
    expect(out.hops[0].from).toBeNull();
    expect(out.hops[0].to).toBe('svc:b');
    expect(out.shown).toBe(0);
  });

  it('drops no hop — every hop in gets a resolution out', () => {
    /* A DROPPED HOP IS THE ORIGINAL DEFECT IN MINIATURE: the reader steps the
       strip and the board does nothing, with no way to tell whether that is the
       graph or the wiring. `hops` is index-aligned with the playback so the two
       lists cannot drift. */
    const hops = [
      hop('svc:a', 'svc:b'),
      hop('file:a1', 'file:a2'),
      hop('file:orphan', 'file:orphan'),
    ];
    const out = resolveFlow(flow(hops), BOARD, PARENT);
    expect(out.hops).toHaveLength(3);
    expect(out.hops.map((h) => h.index)).toEqual([0, 1, 2]);
    expect(out.shown).toBe(2);
  });
});

describe('what the board lights, and what it refuses to', () => {
  it('lights every placeable end once, in hop order', () => {
    const out = resolveFlow(
      flow([hop('svc:a', 'svc:b'), hop('file:b1', 'file:a1')]),
      BOARD,
      PARENT,
    );
    expect(out.dim).not.toBeNull();
    expect(out.dim!.reason).toBe('playback');
    expect(out.dim!.litNodeIds).toEqual(['svc:a', 'svc:b']);
    expect(out.dim!.litEdgeIds).toEqual(['edge:a-b']);
  });

  it('dims NOTHING when it can place nothing', () => {
    /* SHEET 06.6: "dimming is never how the board answers a question". An empty
       lit set would recede every card on the board to answer a question that has
       no answer on it — the reader would see the board go quiet and read that as
       the answer. `null` leaves the board at rest and the note says why. */
    const out = resolveFlow(flow([hop('file:orphan', 'file:orphan')]), BOARD, PARENT);
    expect(out.dim).toBeNull();
    expect(out.focus).toBeNull();
  });

  it('focuses the hop’s DESTINATION, and falls back to its source only if it must', () => {
    const two = [hop('svc:a', 'svc:b'), hop('svc:b', 'file:orphan')];
    expect(resolveFlow(flow(two, 0), BOARD, PARENT).focus).toBe('svc:b');
    // Second hop's destination cannot be placed, so the board goes to the end
    // it can — never nowhere, and never silently to the previous hop's card.
    expect(resolveFlow(flow(two, 1), BOARD, PARENT).focus).toBe('svc:b');
  });

  it('clamps a cursor past the end and keeps -1 meaning “not started”', () => {
    const hops = [hop('svc:a', 'svc:b')];
    expect(hopAt(flow(hops, 99))).toBe(0);
    expect(hopAt(flow(hops, -1))).toBe(-1);
    expect(hopAt(flow([], 3))).toBe(-1);
    expect(resolveFlow(flow(hops, -1), BOARD, PARENT).focus).toBeNull();
  });

  it('does not spin on a malformed parent cycle', () => {
    /* A cycle in `parentId` is a fact about a scan, not something to hang on.
       The rail's own index guards the same field the same way. */
    const cyclic = parentLookup([
      { id: 'file:x', parentId: 'file:y' },
      { id: 'file:y', parentId: 'file:x' },
    ]);
    const out = resolveFlow(flow([hop('file:x', 'svc:b')]), BOARD, cyclic);
    expect(out.hops[0].how).toBe<HopResolution>('none');
    expect(out.hops[0].from).toBeNull();
  });
});

describe('sheet 06.6 — the path is promoted before anything is dimmed', () => {
  const EDGES = [
    { id: 'edge:a-b', proof: 'traced' },
    { id: 'edge:b-c', proof: 'declared' },
  ];

  it('promotes exactly the connectors the flow lights, and no others', () => {
    const out = promoteOnFlow(EDGES, {
      reason: 'playback',
      litNodeIds: ['svc:a', 'svc:b'],
      litEdgeIds: ['edge:a-b'],
    });
    expect(out.map((e) => e.proof)).toEqual(['onflow', 'declared']);
  });

  it('never promotes for a dim that is not playback’s, and never at rest', () => {
    /* Sheet 06.6 allows dimming for playback AND for explicit path-focus, and
       path-focus is not built. A promotion that fired on any DimSpec would
       light a path the moment that feature landed, from a file nobody edited. */
    expect(promoteOnFlow(EDGES, null)).toBe(EDGES);
    expect(
      promoteOnFlow(EDGES, { reason: 'path-focus', litNodeIds: [], litEdgeIds: ['edge:a-b'] }),
    ).toBe(EDGES);
  });

  it('keeps the array identity when the path crosses no connector', () => {
    /* THIS IS THIS REPOSITORY'S ONLY CASE. Every edge the scan finds here is an
       import, which the board deliberately does not lift to a service
       connector, so a flow lights nodes and no line. Re-allocating the edge
       list on every render of a flow would re-route the whole board for
       nothing — the per-render-map defect the board's own header names. */
    expect(
      promoteOnFlow(EDGES, { reason: 'playback', litNodeIds: ['svc:a'], litEdgeIds: [] }),
    ).toBe(EDGES);
    expect(
      promoteOnFlow(EDGES, { reason: 'playback', litNodeIds: ['svc:a'], litEdgeIds: ['edge:zz'] }),
    ).toBe(EDGES);
  });
});

describe('teachDim — a lesson lights only what the board draws', () => {
  /*
   * THE REVERTED SHAPE, LOCKED. The first teach:step attempt (604fa893)
   * dimmed from the step's raw ids. They are grounded — the server checks each
   * one against the scanned graph — but the graph carries file and module
   * nodes and the board paints services, datastores and topics. A step citing
   * a file receded every card and lit none: a spotlight on nothing.
   */
  const drawn = new Set(['svc:gateway', 'svc:orders', 'db:main']);

  it('lights the intersection, and says teach so the dim carries its author', () => {
    const dim = teachDim(['svc:gateway', 'svc:orders'], drawn);
    expect(dim).not.toBeNull();
    expect(dim!.reason).toBe('teach');
    expect(dim!.litNodeIds.sort()).toEqual(['svc:gateway', 'svc:orders']);
    expect(dim!.litEdgeIds, 'a step names concepts, never a traced route').toEqual([]);
  });

  it('keeps only what is drawn when the step also cites something that is not', () => {
    const dim = teachDim(['svc:gateway', 'file:src/index.ts', 'mod:core'], drawn);
    expect(dim!.litNodeIds).toEqual(['svc:gateway']);
  });

  it('returns NULL when nothing the step names is on this board', () => {
    /* The whole point: an untouched board is honest, a fully-dimmed one is
       not. The lesson still has its caption and its chart. */
    expect(teachDim(['file:src/index.ts', 'mod:core'], drawn)).toBeNull();
  });

  it('returns null for a step that lit nothing at all', () => {
    // A lesson about softmax cites no nodeId; chart.ts calls that legal.
    expect(teachDim(undefined, drawn)).toBeNull();
    expect(teachDim([], drawn)).toBeNull();
  });

  it('de-duplicates, so two chart items naming one node do not double it', () => {
    const dim = teachDim(['svc:gateway', 'svc:gateway'], drawn);
    expect(dim!.litNodeIds).toEqual(['svc:gateway']);
  });
});

describe('sameDim — the identity check the render loop depends on', () => {
  it('is true for two spellings of the same lit set and false otherwise', () => {
    const a = { reason: 'playback' as const, litNodeIds: ['x', 'y'], litEdgeIds: ['e'] };
    expect(sameDim(a, { ...a, litNodeIds: ['x', 'y'], litEdgeIds: ['e'] })).toBe(true);
    expect(sameDim(a, { ...a, litNodeIds: ['y', 'x'] })).toBe(false);
    expect(sameDim(a, { ...a, litEdgeIds: [] })).toBe(false);
    expect(sameDim(a, null)).toBe(false);
    expect(sameDim(null, null)).toBe(true);
    expect(sameDim(a, { ...a, reason: 'path-focus' })).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Decision 6 — EXPLICIT SELECTION DIMS OFF-PATH.
   docs/OWNER-PLAN-2026-08-24c.md §1, sheet 06 §06.6: "Selecting a node asks a
   question about THAT node, and the board answers by receding everything not
   on its path … the dim extends today's flow-playback behaviour to the
   selected card rather than inventing a second mechanism."
   ══════════════════════════════════════════════════════════════════════════ */
describe('Decision 6 — selectionDim, the same pipeline fed by a click', () => {
  const EDGES = [
    { id: 'edge:a-b', source: 'svc:a', target: 'svc:b' },
    { id: 'edge:c-d', source: 'svc:c', target: 'svc:d' },
  ];

  it('lights the selected node, its neighbours, and only the connectors that touch them', () => {
    const dim = selectionDim(['svc:a'], EDGES);
    expect(dim).not.toBeNull();
    if (dim === null) return;
    expect(dim.reason).toBe('selection');
    expect([...dim.litNodeIds].sort()).toEqual(['svc:a', 'svc:b']);
    expect(dim.litEdgeIds).toEqual(['edge:a-b']);
  });

  it('is null when nothing is selected — a board at rest stays at rest', () => {
    expect(selectionDim([], EDGES)).toBeNull();
  });

  it('promotes for an explicit selection too — sheet 06.6’s order is not playback’s private rule', () => {
    const PROOF = [
      { id: 'edge:a-b', proof: 'traced' },
      { id: 'edge:c-d', proof: 'declared' },
    ];
    const out = promoteOnFlow(PROOF, {
      reason: 'selection',
      litNodeIds: ['svc:a', 'svc:b'],
      litEdgeIds: ['edge:a-b'],
    });
    expect(out.map((e) => e.proof)).toEqual(['onflow', 'declared']);
  });
});
