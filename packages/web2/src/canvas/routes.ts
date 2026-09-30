/* ══════════════════════════════════════════════════════════════════════════
   ROUTING, ONCE FOR THE WHOLE BOARD — item 3.4
   packages/web2/src/canvas/routes.ts

   THE DEFECT THIS FILE'S SIGNATURE MAKES IMPOSSIBLE.

   v1's elbow edge computes its own obstacle set INSIDE ITSELF — `useNodes()` +
   `useEdges()` + `nodes.map()` per connector — so the O(nodes) work is done
   once per EDGE: about 960 box allocations per drag frame on a 24-card graph.
   The fix is not "call it less"; it is to make the per-edge call unable to
   allocate at all. `routeEdges` takes the boxes it needs as arguments and hands
   ONE array to every route, so a second box map cannot appear without changing
   this function's shape.

   IT IS PURE, AND THAT IS WHY THE PERF LOCK IS CHEAP. `routes.test.ts` can
   assert the identity of the obstacle array handed to each route — the same
   object every time, which is the invariant, rather than a timing measurement
   that would be a different number on every machine.

   WHY THE ROUTE IS COMPUTED HERE AND NOT IN THE EDGE COMPONENT AT ALL: a route
   is a property of the whole board — where every other card is — and not of one
   connector. Putting it in the connector is what made it O(E x N) allocations
   instead of O(N).
   ══════════════════════════════════════════════════════════════════════════ */

import type { BoardEdge } from './Board.js';
import type { ElbowEdgeData } from './ElbowEdge.js';
import type { CardBox } from './cardBox.js';
import { polylineLabelAnchor, polylinePathD, routeOrthogonalElbow } from './orthogonalElbow.js';

export interface RoutedEdge {
  id: string;
  source: string;
  target: string;
  data: ElbowEdgeData;
}

/**
 * `showLabels` — the LOD ladder's answer, passed in rather than looked up.
 *
 * §05.8's first row authors `.edgetag` at --t-10, so it is the first ink to go
 * and it goes at zoom 1.00. The board knows the rung; this function does not,
 * and a router that read the camera would be a second opinion about a number
 * `lod.ts` already owns. Default true so a caller that has no camera — a test,
 * the specimen — still gets the label it asked for by supplying one.
 */
export function routeEdges(
  edges: readonly BoardEdge[],
  boxes: readonly CardBox[],
  showLabels = true,
): RoutedEdge[] {
  const boxById = new Map(boxes.map((box) => [box.id, box]));
  const siblings = edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
  }));

  const routed: RoutedEdge[] = [];

  for (const edge of edges) {
    const source = boxById.get(edge.source);
    const target = boxById.get(edge.target);
    /* AN EDGE WHOSE ENDPOINTS ARE NOT BOTH ON THE BOARD IS NOT DRAWN, and it is
       not drawn to a guessed coordinate either. A connector between two places
       the reader cannot see is the grounded claim spent on nothing — and CANON
       records what that costs: `svc:gateway`'s only two inbound edges were
       nginx confs inside test fixtures and the board drew them as facts. */
    if (!source || !target) continue;

    const points = routeOrthogonalElbow({
      source,
      target,
      // The SAME array, every time. That is the whole point of this function.
      obstacles: boxes,
      edgeId: edge.id,
      siblings,
    });

    /* THE LABEL IS ANCHORED HERE, ON THE ROUTE, for the same reason the route
       itself is: the anchor is a property of the polyline, and computing it
       inside the connector would put the geometry back in the component this
       file exists to keep free of it. `polylineLabelAnchor` has been in
       `orthogonalElbow.ts` since the elbow was written — the midpoint of the
       LONGEST segment, never a bend, because a bend is by construction the part
       of the route nearest a card — and until now nothing called it. */
    const anchor = edge.label && showLabels ? polylineLabelAnchor(points) : null;

    routed.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      data: {
        d: polylinePathD(points),
        proof: edge.proof,
        ...(edge.runActive ? { runActive: true } : {}),
        ...(anchor && edge.label
          ? {
              label: edge.label,
              labelAt: anchor,
              ...(edge.labelFull ? { labelFull: edge.labelFull } : {}),
            }
          : {}),
      },
    });
  }

  return routed;
}
