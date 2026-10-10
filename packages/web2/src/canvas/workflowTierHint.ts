/**
 * Suggest Tier 3 (full council) when the grounded graph shows high blast-radius hubs.
 */

import { computeRisks, type ImpactLink } from '@sequence/schema';
import type { GetArchGraphResponse } from '@sequence/api-types';

export function suggestFullWorkflowTier(graph: GetArchGraphResponse | null): boolean {
  if (!graph?.nodes?.length) return false;
  const links: ImpactLink[] = (graph.edges ?? []).map((l) => ({
    srcId: l.srcId,
    dstId: l.dstId,
  }));
  const nodes = graph.nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.label }));
  const risks = computeRisks(links, nodes, { topN: 5 });
  return risks.some((r) => r.fraction >= 0.3 || r.severity === 'high' || r.severity === 'critical');
}
