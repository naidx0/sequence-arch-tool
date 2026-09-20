/**
 * scopeGraph — the ONE way to narrow a graph before projecting it.
 *
 * "Diagram this flow / this selection" must reuse `mermaidFlow` /
 * `mermaidSequence` over a smaller graph, never a second dialect that
 * re-derives edges. So scoping is a pure sub-graph operation: keep the named
 * real nodes, keep an edge only when BOTH of its endpoints survived, and carry
 * every other field of the graph through untouched.
 *
 * Honesty rules baked in:
 *  - ids that are not real nodes are dropped, never invented;
 *  - an edge with a dropped endpoint disappears rather than dangling;
 *  - an empty scope yields an empty graph (which projects to an empty diagram),
 *    never the whole graph and never a fabricated one.
 *
 * Pure, deterministic, browser-safe (zero Node imports), mode-agnostic.
 */
import type { ArchGraph } from '@sequence/schema';

/**
 * Every real node id nested under `nodeIds` (via `parentId`), plus the given
 * ids themselves — the ids actually present in `graph`, in graph order.
 *
 * Callers that select at container level (a service on the canvas) need this:
 * in scan mode the interaction edges live on FILE leaves inside the service, so
 * scoping to the bare service id alone would honestly project to nothing.
 */
export function withDescendants(graph: ArchGraph, nodeIds: Iterable<string>): string[] {
  const requested = new Set(nodeIds);
  const kept = new Set<string>();
  for (const n of graph.nodes) if (requested.has(n.id)) kept.add(n.id);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const inScope = (id: string): boolean => {
    const seen = new Set<string>();
    let cur = byId.get(id);
    while (cur && !seen.has(cur.id)) {
      if (kept.has(cur.id)) return true;
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return false;
  };
  return graph.nodes.filter((n) => inScope(n.id)).map((n) => n.id);
}

/**
 * The sub-graph made of exactly the given real node ids and the edges whose
 * source AND target both survive. Node/edge order and all graph metadata
 * (version, mode, scannedAt, repoRoot, repoName, warnings) are preserved.
 */
export function scopeGraph(graph: ArchGraph, nodeIds: Iterable<string>): ArchGraph {
  const wanted = new Set(nodeIds);
  const nodes = graph.nodes.filter((n) => wanted.has(n.id));
  const kept = new Set(nodes.map((n) => n.id));
  return {
    ...graph,
    nodes,
    edges: graph.edges.filter((e) => kept.has(e.srcId) && kept.has(e.dstId)),
  };
}
