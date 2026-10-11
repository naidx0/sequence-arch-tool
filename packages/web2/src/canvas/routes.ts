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
import { polylinePathD, routeOrthogonalElbow } from './orthogonalElbow.js';
import { placeEdgeLabels, type LabelInput } from './edgeLabelPlace.js';

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
  /** ELK's routes by edge id. Used when the route still starts on the source
   *  card's border and ends on the target's (nothing was dragged since). */
  elk?: Readonly<Record<string, ReadonlyArray<{ x: number; y: number }>>>,
): RoutedEdge[] {
  const boxById = new Map(boxes.map((box) => [box.id, box]));
  /* A group's frame holds the members edges go to, so it is never something
     to route around. One array, handed to every route. */
  const obstacles = boxes.some((box) => box.container) ? boxes.filter((box) => !box.container) : boxes;
  const siblings = edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
  }));

  const routed: RoutedEdge[] = [];
  const allRoutes: Array<{ id: string; points: Array<{ x: number; y: number }> }> = [];
  const wanted: LabelInput[] = [];

  for (const edge of edges) {
    const source = boxById.get(edge.source);
    const target = boxById.get(edge.target);
    /* AN EDGE WHOSE ENDPOINTS ARE NOT BOTH ON THE BOARD IS NOT DRAWN, and it is
       not drawn to a guessed coordinate either. A connector between two places
       the reader cannot see is the grounded claim spent on nothing — and CANON
       records what that costs: `svc:gateway`'s only two inbound edges were
       nginx confs inside test fixtures and the board drew them as facts. */
    if (!source || !target) continue;

    const given = elk?.[edge.id] ? fitRouteToBoxes(elk[edge.id]!, source, target) : null;
    const points =
      given && onBorder(given[0]!, source) && onBorder(given[given.length - 1]!, target)
        ? given
        : routeOrthogonalElbow({
            source,
            target,
            // The SAME array, every time. That is the whole point of this function.
            obstacles,
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
    /* ROUND 7: the anchor is no longer taken alone. Every route is known
       first, then `placeEdgeLabels` puts each tag where it overprints no other
       tag, card or connector (edgeLabelPlace.ts) — the longest segment's
       midpoint is still its first choice. */
    allRoutes.push({ id: edge.id, points });
    if (edge.label && showLabels) {
      wanted.push({ id: edge.id, points, label: edge.label, ...(edge.labelFull ? { full: edge.labelFull } : {}) });
    }

    routed.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      data: {
        d: polylinePathD(points),
        proof: edge.proof,
        pair: `${edge.source}->${edge.target}`,
        ...(edge.title ? { title: edge.title } : {}),
        ...(edge.imports ? { imports: true } : {}),
        ...(edge.runActive ? { runActive: true } : {}),
      },
    });
  }

  if (wanted.length > 0) {
    const placed = placeEdgeLabels(wanted, allRoutes, boxes);
    const asked = new Map(wanted.map((w) => [w.id, w.full ?? w.label]));
    for (const r of routed) {
      const at = placed.get(r.id);
      if (!at) {
        /* No free place even for a chip: the tag is not drawn, and the line
           says it on hover instead. */
        const words = asked.get(r.id);
        if (words) r.data = { ...r.data, labelHidden: words };
        continue;
      }
      r.data = {
        ...r.data,
        label: at.text,
        labelAt: at.at,
        ...(at.full ? { labelFull: at.full } : {}),
        ...(at.mode === 'chip' ? { labelMode: 'chip' as const } : {}),
      };
    }
  }

  return routed;
}

/** True when `p` lies on `box`'s border (1.5 flow units of slack). */
export function onBorder(p: { x: number; y: number }, box: CardBox, slack = 1.5): boolean {
  const inX = p.x >= box.x - slack && p.x <= box.x + box.w + slack;
  const inY = p.y >= box.y - slack && p.y <= box.y + box.h + slack;
  if (!inX || !inY) return false;
  return (
    Math.abs(p.x - box.x) <= slack ||
    Math.abs(p.x - (box.x + box.w)) <= slack ||
    Math.abs(p.y - box.y) <= slack ||
    Math.abs(p.y - (box.y + box.h)) <= slack
  );
}

/**
 * ELK laid the cards out at rung 1; a far rung draws some of them shorter
 * (the glance line drops), so a route can end below a card's new bottom. Pull
 * each end back onto its card, moving the horizontal segment it sits on with
 * it so the route stays orthogonal. Only a bounded overshoot below the card is
 * repaired: a card the reader dragged is routed afresh, not bent to fit.
 */
export function fitRouteToBoxes(
  route: ReadonlyArray<{ x: number; y: number }>,
  source: CardBox,
  target: CardBox,
  slack = 1.5,
  overshoot = 96,
): Array<{ x: number; y: number }> | null {
  if (route.length < 2) return null;
  const pts = route.map((p) => ({ x: p.x, y: p.y }));
  let broken = false;
  const pull = (i: number, j: number, box: CardBox) => {
    const p = pts[i]!;
    const q = pts[j];
    const bottom = box.y + box.h;
    if (p.y <= bottom + slack || p.y > bottom + overshoot) return;
    if (p.x < box.x - slack || p.x > box.x + box.w + slack) return;
    const onSide = Math.abs(p.x - box.x) <= slack || Math.abs(p.x - (box.x + box.w)) <= slack;
    if (onSide) {
      /* Enters through a side: move the horizontal segment up into the card. */
      const y = box.y + box.h / 2;
      /* A straight two-point line cannot move one end alone and stay
         orthogonal: route it afresh instead. */
      if (pts.length <= 2) broken = true;
      else if (q && Math.abs(q.y - p.y) <= 0.01) q.y = y;
      p.y = y;
    } else {
      /* Enters through the bottom: the vertical segment just ends sooner. */
      p.y = bottom;
    }
  };
  pull(0, 1, source);
  pull(pts.length - 1, pts.length - 2, target);
  return broken ? null : pts;
}
