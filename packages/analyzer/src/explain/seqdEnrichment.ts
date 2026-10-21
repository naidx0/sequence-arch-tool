/**
 * ArchGraph → SeqDiagram MADR detail slots from the deterministic structural explain tree.
 */
import { projectEdges } from '@sequence/export';
import type { ArchGraph, ArchNode, SeqDiagramNodeDetail } from '@sequence/schema';
import { buildStructuralTree } from './explain.js';
import type { PlainNode } from './plaintree.js';

function walkPlain(node: PlainNode, visit: (n: PlainNode) => void): void {
  visit(node);
  for (const child of node.children) walkPlain(child, visit);
}

const DETAIL_KINDS = new Set<PlainNode['kind']>(['service', 'data', 'feature', 'file']);

const TOPOLOGY_NODE_KINDS = new Set<ArchNode['kind']>(['service', 'datastore']);

function liftedLabel(node: ArchNode): string {
  if (node.kind === 'topic') return `topic:${node.label}`;
  return node.label;
}

/**
 * Grounded `detail.parts` (arch children) and `detail.talksTo` (projected edge
 * neighbours) — same evidence as breakout enrichment; never invents ids.
 */
export function seqdTopologyDetailFromGraph(
  graph: ArchGraph,
  base: Readonly<Record<string, SeqDiagramNodeDetail>> = {},
): Record<string, SeqDiagramNodeDetail> {
  const out: Record<string, SeqDiagramNodeDetail> = { ...base };
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const labelToId = new Map<string, string>();
  for (const n of graph.nodes) {
    if (n.kind === 'service' || n.kind === 'datastore' || n.kind === 'topic') {
      labelToId.set(liftedLabel(n), n.id);
    }
  }

  const neighbours = new Map<string, Set<string>>();
  for (const e of projectEdges(graph)) {
    const srcId = labelToId.get(e.src);
    const dstId = labelToId.get(e.dst);
    if (!srcId || !dstId) continue;
    const dstNode = byId.get(dstId);
    if (!dstNode) continue;
    const set = neighbours.get(srcId) ?? new Set<string>();
    set.add(dstNode.label);
    neighbours.set(srcId, set);
  }

  for (const n of graph.nodes) {
    if (!TOPOLOGY_NODE_KINDS.has(n.kind)) continue;
    const childParts = graph.nodes
      .filter((c) => c.parentId === n.id)
      .map((c) => c.label)
      .sort((a, b) => a.localeCompare(b));
    const talks = neighbours.has(n.id)
      ? [...neighbours.get(n.id)!].sort((a, b) => a.localeCompare(b))
      : undefined;

    const prev = out[n.id];
    const detail: SeqDiagramNodeDetail = { ...prev };
    if (childParts.length > 0 && !detail.parts?.length) detail.parts = childParts;
    if (talks && talks.length > 0 && !detail.talksTo?.length) detail.talksTo = talks;
    if (detail.whatItIs || detail.whatItDoes || detail.parts?.length || detail.talksTo?.length) {
      out[n.id] = detail;
    }
  }

  return out;
}

/**
 * Build `detail.whatItIs` / `whatItDoes` keyed by real ArchGraph node ids from
 * {@link buildStructuralTree} — never invents ids.
 */
export function seqdNodeDetailFromStructuralTree(
  graph: ArchGraph,
  profile: 'recommended' | 'bestfit' = 'recommended',
): Record<string, SeqDiagramNodeDetail> {
  const tree = buildStructuralTree(graph, profile);
  const out: Record<string, SeqDiagramNodeDetail> = {};
  const graphIds = new Set(graph.nodes.map((n) => n.id));

  walkPlain(tree, (node) => {
    if (!DETAIL_KINDS.has(node.kind)) return;
    const whatItIs = node.title?.trim();
    const whatItDoes = node.summary?.trim();
    if (!whatItIs && !whatItDoes) return;

    for (const ref of node.sourceRefs) {
      if (!graphIds.has(ref)) continue;
      const prev = out[ref];
      const detail: SeqDiagramNodeDetail = { ...prev };
      if (whatItIs && (!prev?.whatItIs || node.kind === 'service' || node.kind === 'data')) {
        detail.whatItIs = whatItIs;
      }
      if (whatItDoes && (!prev?.whatItDoes || node.kind === 'service' || node.kind === 'data')) {
        detail.whatItDoes = whatItDoes;
      }
      if (detail.whatItIs || detail.whatItDoes) out[ref] = detail;
    }
  });

  for (const n of graph.nodes) {
    if (out[n.id]) continue;
    const desc = n.meta?.description?.trim();
    if (desc) out[n.id] = { whatItIs: desc };
  }

  return seqdTopologyDetailFromGraph(graph, out);
}
