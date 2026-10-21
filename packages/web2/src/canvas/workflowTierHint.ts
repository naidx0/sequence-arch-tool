/**
 * Suggest Tier 3 (full council) when the grounded graph shows high blast-radius hubs.
 */

import { computeRisks, type ImpactLink } from '@sequence/schema';
import type { GetArchGraphResponse } from '@sequence/api-types';

/* One answer per scanned graph. The board remounts every time Architecture is reopened and the
   graph is the same object, so the hint (a blast-radius pass over the whole graph, 33-50 ms on
   codeforge) is worked out once per scan rather than once per mount. */
const hinted = new WeakMap<object, boolean>();

export function suggestFullWorkflowTier(graph: GetArchGraphResponse | null): boolean {
  if (!graph?.nodes?.length) return false;
  const known = hinted.get(graph);
  if (known !== undefined) return known;
  const answer = fullTierHint(graph);
  hinted.set(graph, answer);
  return answer;
}

/** The answer for this graph if it has already been worked out, else undefined (never computes). */
export function knownFullWorkflowTier(graph: GetArchGraphResponse | null): boolean | undefined {
  if (!graph?.nodes?.length) return false;
  return hinted.get(graph);
}

function fullTierHint(graph: GetArchGraphResponse): boolean {
  const links: ImpactLink[] = (graph.edges ?? []).map((l) => ({
    srcId: l.srcId,
    dstId: l.dstId,
  }));
  const nodes = graph.nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.label }));
  const risks = computeRisks(links, nodes, { topN: 5 });
  return risks.some((r) => r.fraction >= 0.3 || r.severity === 'high' || r.severity === 'critical');
}
