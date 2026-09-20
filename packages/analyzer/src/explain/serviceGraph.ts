/**
 * Service-level risk projection (the MOAT digest feed).
 *
 * The shared risk engines (`computeRisks` / `computeCycles` in @sequence/schema)
 * rank the architecture over id-keyed `{ srcId, dstId }` edges plus a matching
 * `RiskNode[]`. To feed them a SERVICE-level picture — the level a human reasons
 * about ("if postgres fails, what breaks?") rather than the file level — this
 * collapses every file/module endpoint into its owning service / datastore /
 * topic, exactly the way `score.ts`'s `buildLift` does for scoring, but returning
 * the ancestor NODE (id + kind + label) so the engines get real ids to rank.
 *
 * PURE + TOTAL: never throws on empty / malformed input; an empty graph yields
 * `{ edges: [], nodes: [] }`.
 */
import type { ArchGraph, ArchNode } from '@sequence/schema';

/**
 * Build a function that lifts ANY node id to the nearest ancestor (itself
 * included) whose kind is `service | datastore | topic` — the top-level component
 * a leaf belongs to. Returns the ancestor NODE (not just its label, unlike
 * `score.ts`'s `buildLift`) so callers can key edges/risks by real ids. Returns
 * `undefined` when no such ancestor exists (e.g. a bare repo-level file).
 */
export function liftToTopLevel(graph: ArchGraph): (id: string) => ArchNode | undefined {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const isTop = (n: ArchNode): boolean =>
    n.kind === 'service' || n.kind === 'datastore' || n.kind === 'topic';
  return (id: string): ArchNode | undefined => {
    // `visited` guards against a malformed containment cycle (A.parentId=B,
    // B.parentId=A, or a self-parent) — a real scan is a tree, but an imported /
    // persisted / AI-authored graph need not be (validateGraph flags such cycles,
    // but doesn't block them from reaching here). Without this the walk hangs,
    // which is strictly worse than the "never throws" TOTAL contract this promises.
    const visited = new Set<string>();
    let cur = byId.get(id);
    while (cur && !visited.has(cur.id)) {
      if (isTop(cur)) return cur;
      visited.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return undefined;
  };
}

/**
 * Project a full ArchGraph down to the service-level inputs the risk engines
 * consume:
 *  - `nodes`: the distinct top-level `service | datastore | topic` nodes (the
 *    universe the SPOF/cycle advisors rank over), as `{ id, kind, label }`.
 *  - `edges`: every non-`import` interaction edge, with src AND dst lifted to
 *    their owning top-level component. An edge is emitted only when both
 *    endpoints resolve and land on DIFFERENT components (a file→file edge inside
 *    one service collapses to a self-edge and is dropped). Deduped by
 *    `srcId>dstId`.
 *
 * PURE + TOTAL — an empty or malformed graph returns `{ edges: [], nodes: [] }`.
 */
/**
 * IS THIS EDGE A CLAIM ABOUT THE SYSTEM, OR ONLY ABOUT TWO FILES?
 *
 * An `import` says one FILE names another. Lifting it to a service connector
 * asserts at the system level something that was only ever measured at the
 * file level — `docs/CANON.md`'s first non-negotiable, and the board's own
 * decision names the incident it comes from: svc:gateway's only two inbound
 * edges were nginx confs inside test fixtures, drawn as facts.
 *
 * THIS PREDICATE EXISTS BECAUSE THE RULE WAS WRITTEN FOUR TIMES AND DISAGREED
 * ONCE. The board refuses to lift imports, `serviceLevelRisksInput` skips them,
 * the ask intents inherit that — and `indexDigestForAsk` rolled them up anyway,
 * putting **162 service-to-service edges into what the model reads** with zero
 * overlap with the 1 the other three compute. The model was told, as structure,
 * exactly what the board will not draw.
 *
 * One predicate, called by every consumer, so a fifth cannot quietly disagree.
 */
export function isServiceLevelEdgeKind(kind: string | undefined): boolean {
  return kind !== 'import';
}

export function serviceLevelRisksInput(graph: ArchGraph): {
  edges: { srcId: string; dstId: string }[];
  nodes: { id: string; kind: ArchNode['kind']; label: string }[];
} {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return { edges: [], nodes: [] };
  }

  const nodes = graph.nodes
    .filter((n) => n && (n.kind === 'service' || n.kind === 'datastore' || n.kind === 'topic'))
    .map((n) => ({ id: n.id, kind: n.kind, label: n.label }));

  const lift = liftToTopLevel(graph);
  const seen = new Set<string>();
  const edges: { srcId: string; dstId: string }[] = [];
  for (const e of graph.edges) {
    if (!e || !isServiceLevelEdgeKind(e.kind)) continue;
    const src = lift(e.srcId);
    const dst = lift(e.dstId);
    if (!src || !dst || src.id === dst.id) continue;
    const key = `${src.id}>${dst.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ srcId: src.id, dstId: dst.id });
  }

  return { edges, nodes };
}
