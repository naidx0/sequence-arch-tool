import type { ArchGraph } from '@sequence/schema';
import { writeAgentMaps } from '../agentMap.js';
import { writeCachedGraph, type PartSignatures } from '../server/graphCache.js';

/**
 * What a finished scan leaves on disk: `.sequence/graph.json` under its content
 * signature and the agent map beside it. ONE definition, run by the scan worker
 * and by the in-process fallback, so the two cannot write different things.
 */
export function persistScan(
  root: string,
  signature: string,
  graph: ArchGraph,
  sigs?: PartSignatures
): void {
  writeCachedGraph(root, signature, graph, sigs);
  writeAgentMaps(root, graph); // .sequence/map.md beside the graph it was cut from
}
