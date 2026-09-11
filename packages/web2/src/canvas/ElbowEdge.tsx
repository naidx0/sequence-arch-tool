/* ══════════════════════════════════════════════════════════════════════════
   THE CONNECTOR — item 3.4
   packages/web2/src/canvas/ElbowEdge.tsx

   docs/brand/graphite/pages/04-edge-kinds-and-proof.html, and the substrate's
   `.edgeline` / `.e-*` rules.

   THIS COMPONENT DRAWS AND DOES NOT COMPUTE, and that is the whole point of it.

   THE DEFECT IT REPLACES, measured: v1's elbow edge calls `useNodes()` AND
   `useEdges()` AND then `nodes.map()` into a fresh box array INSIDE EVERY EDGE
   — about 960 box allocations per drag frame on a 24-card graph, because the
   work is O(nodes) and it is done once PER EDGE. The route is a property of the
   whole board, not of one connector, so the whole board computes it once:
   `Board.tsx` builds ONE box map per layout change and hands each edge the
   polyline it already routed, on `data.d`.

   THE CLASS LIST MUST REACH THE <path> ITSELF, never only the wrapping <g>.
   @xyflow's EdgeWrapper puts `edge.className` on the <g> and never forwards it
   to the custom edge, while `.e-traced` declares an explicit `stroke` on the
   path. An inherited stroke from an ancestor <g> can never beat an explicit
   declaration on the descendant, so a proof state that only reaches the <g> is
   a silent no-op — v1's flow playback shipped that way for a whole release.

   COLOUR IS PERMITTED HERE and nowhere else on this surface. A drawn connector
   between two nodes is DATA — a chart series with two endpoints — and Law 1
   governs chrome, not a series. Three states, three aliases, no new hue:
   traced takes --viz-baseline, on-flow takes --accent, declared takes
   --unknown. The DASH carries the same distinction, so the three states survive
   greyscale — which is the reason a reader who cannot receive the hue can still
   tell a traced call from a declared one.
   ══════════════════════════════════════════════════════════════════════════ */

import { BaseEdge, type EdgeProps } from '@xyflow/react';

/** Traced: the analyzer followed a real call in the source. Declared: config or
 *  a manifest claimed it and the source could not confirm it. On-flow: this
 *  edge is part of the flow being played back or selected.
 *
 *  DERIVED is the weakest and is a different KIND of claim from the other
 *  three. Those three all say "these two things interact"; derived says only
 *  "files in one import files in the other", aggregated and counted. It exists
 *  because the owner walk asked for it — "there could be some type of dotted
 *  lines or maybe a dot connector" — and it is drawn in its own visual
 *  language precisely so nobody reads it as one of the other three. */
export type EdgeProof = 'traced' | 'declared' | 'onflow' | 'derived';

export interface ElbowEdgeData extends Record<string, unknown> {
  /** The polyline, routed ONCE by the board and handed down. */
  d: string;
  proof: EdgeProof;
  /** Active program-run edge — animated overlay from workflow SSE. */
  runActive?: boolean;
  /**
   * `.edgetag` — WHAT THIS CONNECTOR SAYS, and it is present only when there
   * is something true to write on it.
   *
   * Sheet 04 draws a tag on every connector ('POST /charge', 'pub
   * order.placed', 'imports'), and the board drew none: `project.ts` built
   * `{id, source, target, proof}` and dropped `SeqDiagramEdge.label` on the
   * floor, while `renderSeqDiagramSvg.ts` rendered it for the SAME document
   * through the CLI. So `sequence diagram --svg` produced a better picture
   * than the product's own canvas.
   *
   * ABSENT IS NOT EMPTY. An edge with no label draws no tag rather than an
   * empty box, and the router only fills this in when the ladder's --t-10 row
   * is live — so the tag leaves with the rest of the --t-10 ink instead of
   * colliding into a smear at low zoom.
   */
  label?: string;
  /** Where the tag sits, in flow coordinates: the midpoint of the route's
   *  longest segment. Computed with the route, never in this component. */
  labelAt?: { x: number; y: number };
  /** The whole label when `label` is a shortened form of it. */
  labelFull?: string;
}

const PROOF_CLASS: Record<EdgeProof, string> = {
  traced: 'e-traced',
  declared: 'e-declared',
  onflow: 'e-onflow',
  derived: 'e-derived',
};

export function ElbowEdge({ id, data }: EdgeProps) {
  const edge = data as ElbowEdgeData | undefined;
  // No route means the board could not place this edge, and an edge drawn from
  // nowhere to nowhere is worse than an edge the reader can see is missing.
  if (!edge?.d) return null;

  return (
    <>
      {/* Arrowheads once per board — duplicate defs are idempotent by id. */}
      <svg width={0} height={0} aria-hidden="true" style={{ position: 'absolute' }}>
        <defs>
          <marker
            id="board-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--flow-traced)" />
          </marker>
          <marker
            id="board-arrow-accent"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--flow-onflow)" />
          </marker>
          <marker
            id="board-arrow-muted"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--flow-derived)" />
          </marker>
        </defs>
      </svg>
      <BaseEdge
        id={id}
        path={edge.d}
        className={`edgeline ${PROOF_CLASS[edge.proof]}${edge.runActive ? ' e-run-active' : ''}`}
        data-testid="board-edge"
        data-proof={edge.proof}
        data-run-active={edge.runActive ? 'true' : undefined}
      />
      {/* SVG TEXT, NOT AN <EdgeLabelRenderer> HTML CHIP, and that is deliberate:
          the tag has to sit in the same coordinate space as the line it belongs
          to, so it scales, pans and clips with the connector and cannot drift a
          frame behind it. It is knocked out of the line with `paint-order:
          stroke` in board.css rather than with a background rectangle, because a
          rectangle needs a measured text width and nothing here has measured
          one — a guessed box is how a label ends up wider than its own text.

          `data-proof` is repeated on the tag so a DERIVED count reads in the
          derived vocabulary. An inference's label must not be able to paint in
          the ink a traced call uses. */}
      {edge.label && edge.labelAt ? (
        <text
          className="edgetag"
          data-testid="board-edge-label"
          data-proof={edge.proof}
          x={edge.labelAt.x}
          y={edge.labelAt.y}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {/* The rest of a shortened label, on hover. `<title>` rather than an
              attribute because it is the SVG way to say the same thing, and it
              is announced. */}
          {edge.labelFull ? <title>{edge.labelFull}</title> : null}
          {edge.label}
        </text>
      ) : null}
    </>
  );
}
