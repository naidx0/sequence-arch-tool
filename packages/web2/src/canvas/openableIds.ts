/**
 * The ids of nodes that contain others (the expand icon on a card header).
 *
 * One pass over the nodes, collecting every `parentId`, then one pass picking
 * the nodes named by one. The earlier form asked `nodes.some(c => c.parentId
 * === n.id)` inside a loop over the same nodes: O(n squared), 204 ms on the
 * 2,773-node codeforge graph for the same set this builds in under a
 * millisecond.
 */
export function openableIds(nodes: ReadonlyArray<{ id: string; parentId?: string | null }>): Set<string> {
  const parents = new Set<string>();
  for (const n of nodes) if (n.parentId != null) parents.add(n.parentId);
  const ids = new Set<string>();
  for (const n of nodes) if (parents.has(n.id)) ids.add(n.id);
  return ids;
}

/** `openableIds` for a scanned graph, kept per graph object: the board remounts on every reopen of Architecture. */
const perGraph = new WeakMap<object, Set<string>>();
export function openableIdsOf(graph: { nodes: ReadonlyArray<{ id: string; parentId?: string | null }> }): ReadonlySet<string> {
  let ids = perGraph.get(graph);
  if (ids === undefined) {
    ids = openableIds(graph.nodes);
    perGraph.set(graph, ids);
  }
  return ids;
}
