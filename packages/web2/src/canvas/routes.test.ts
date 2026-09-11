import { describe, expect, it, vi } from 'vitest';

import type { BoardEdge } from './Board';
import type { CardBox } from './cardBox';
import * as elbow from './orthogonalElbow';
import { routeEdges } from './routes';

function grid(count: number): CardBox[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `svc:${i}`,
    x: (i % 6) * 200,
    y: Math.floor(i / 6) * 140,
    w: 160,
    h: 56,
  }));
}

function chain(count: number): BoardEdge[] {
  return Array.from({ length: count - 1 }, (_, i) => ({
    id: `e${i}`,
    source: `svc:${i}`,
    target: `svc:${i + 1}`,
    proof: 'traced' as const,
  }));
}

/**
 * ITEM 3.4 — THE EDGE BOX MAP IS HOISTED OUT OF THE EDGE.
 *
 * THE DEFECT, AS MEASURED IN v1: `ArchElbowEdge` calls `useNodes()` AND
 * `useEdges()` AND THEN `nodes.map()` into a fresh box array inside EVERY
 * connector — about 960 box allocations per drag frame on a 24-card graph,
 * because O(nodes) work is done once per EDGE.
 *
 * WHAT IS ASSERTED, AND WHY IT IS THIS AND NOT A TIMING. A stopwatch is a
 * different number on every machine and a different number on the same machine
 * twice. The INVARIANT is that every route is handed THE SAME obstacle array —
 * object identity, which is exact, machine-independent, and impossible to
 * satisfy accidentally by a version that rebuilds the list per edge.
 */
describe('item 3.4 — one box map for the whole board', () => {
  it('hands every route the same obstacle array, by identity', () => {
    const boxes = grid(24);
    const edges = chain(24);

    const seen: Array<readonly unknown[]> = [];
    const spy = vi.spyOn(elbow, 'routeOrthogonalElbow');
    spy.mockImplementation((options) => {
      seen.push(options.obstacles);
      return [
        { x: options.source.x, y: options.source.y },
        { x: options.target.x, y: options.target.y },
      ];
    });

    try {
      routeEdges(edges, boxes);
    } finally {
      spy.mockRestore();
    }

    expect(seen).toHaveLength(edges.length);
    // 24 nodes x 23 edges is 552 boxes if the map moved back inside the edge.
    // One array, 23 times, is what a hoisted map looks like.
    for (const obstacles of seen) expect(obstacles).toBe(boxes);
  });

  it('routes once per edge and never once per node', () => {
    const spy = vi.spyOn(elbow, 'routeOrthogonalElbow');
    try {
      routeEdges(chain(24), grid(24));
      expect(spy).toHaveBeenCalledTimes(23);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('item 3.4 — what the router produces', () => {
  it('is an orthogonal polyline, with its proof state attached', () => {
    const [routed] = routeEdges(
      [{ id: 'e', source: 'svc:0', target: 'svc:1', proof: 'declared' }],
      grid(2),
    );

    expect(routed!.data.proof).toBe('declared');
    expect(routed!.data.d).toMatch(/^M[-\d.]+ [-\d.]+( L[-\d.]+ [-\d.]+)+$/);
    // The module's own predicate, rather than a second opinion about what
    // orthogonal means.
    expect(elbow.pathIsOrthogonalElbow(routed!.data.d)).toBe(true);
  });

  it('drops an edge whose endpoints are not both on the board', () => {
    // Not drawn to a guessed coordinate. A connector between two places the
    // reader cannot see is the grounded claim spent on nothing.
    const routed = routeEdges(
      [
        { id: 'real', source: 'svc:0', target: 'svc:1', proof: 'traced' },
        { id: 'dangling', source: 'svc:0', target: 'svc:ghost', proof: 'traced' },
      ],
      grid(2),
    );

    expect(routed.map((edge) => edge.id)).toEqual(['real']);
  });

  it('routes the same board to the same picture twice', () => {
    // A layout that moves when nothing moved is a board the reader cannot trust
    // to have stayed still while they looked away.
    const boxes = grid(8);
    const edges = chain(8);
    expect(routeEdges(edges, boxes)).toEqual(routeEdges(edges, boxes));
  });
});

describe('the edge tag — anchored on the route, gated by the ladder', () => {
  /*
   * `polylineLabelAnchor` has been in `orthogonalElbow.ts` since the elbow was
   * written, with a comment explaining exactly where an edge label belongs —
   * the midpoint of the LONGEST segment, never a bend, because a bend is by
   * construction the part of the route nearest a card. Nothing in the package
   * called it. A grep for `edgetag` across `packages/web2/src` returned two
   * hits, both inside comments: zero CSS rules and zero JSX.
   */
  it('anchors a labelled edge on the longest segment of its own route', () => {
    const [routed] = routeEdges(
      [{ id: 'e', source: 'svc:0', target: 'svc:1', proof: 'derived', label: '84 imports' }],
      grid(2),
    );

    expect(routed!.data.label).toBe('84 imports');
    const points = elbow.routeOrthogonalElbow({
      source: grid(2)[0]!,
      target: grid(2)[1]!,
      obstacles: grid(2),
      edgeId: 'e',
      siblings: [{ id: 'e', source: 'svc:0', target: 'svc:1' }],
    });
    expect(routed!.data.labelAt).toEqual(elbow.polylineLabelAnchor(points));
  });

  it('draws no tag for an edge the document gave no label', () => {
    // Absent is not empty: an unlabelled connector renders nothing rather than
    // an empty box, so the board never captions an arrow it has no words for.
    const [routed] = routeEdges(
      [{ id: 'e', source: 'svc:0', target: 'svc:1', proof: 'traced' }],
      grid(2),
    );
    expect('label' in routed!.data).toBe(false);
    expect('labelAt' in routed!.data).toBe(false);
  });

  it('withholds the tag when the ladder has taken the --t-10 row away', () => {
    /* §05.8 row 1: `.edgetag` is authored at --t-10, so its threshold is
       --t-10 / --t-10 = 1.00 and it is the FIRST ink to go. The board asks
       `lod.ts` and passes the answer; the router does not read a camera. */
    const [routed] = routeEdges(
      [{ id: 'e', source: 'svc:0', target: 'svc:1', proof: 'derived', label: '84 imports' }],
      grid(2),
      false,
    );
    expect('label' in routed!.data).toBe(false);
    // The connector itself is unaffected — only its caption leaves.
    expect(routed!.data.d).not.toBe('');
  });
});
