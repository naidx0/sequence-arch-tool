/**
 * OPENING A SERVICE — what is inside it.
 *
 * The owner's ruling was SYSTEMS LAYER ONLY, no nesting — "but a service must
 * still be openable". Those are not in tension: opening REPLACES the view
 * rather than nesting inside it. One level is on screen at a time, and the
 * level changes.
 *
 * IT IS NOT `archGraphToBreakoutSeqDiagram`, which despite its
 * `breakout-interior` kind places the focus service and its service-level
 * NEIGHBOURS. Measured on shopfront: the gateway has six file children and the
 * breakout returned none of them. That view answers "what does this talk to";
 * this one answers "what is in it", and they are different questions.
 *
 * WHAT COUNTS AS INSIDE is `parentId`, which is the scan's own containment and
 * not a path prefix. Re-deriving membership from directory names would disagree
 * with the graph the moment a service's build context is narrowed — and
 * `discovery/compose.ts` already carries a warning about exactly that case.
 */

import type {
  ArchGraph,
  ArchNode,
  SeqDiagramEdge,
  SeqDiagramEdgeFamily,
  SeqDiagramNode,
  SeqDiagramV1,
} from '@sequence/schema';

import { archNodeEvidenceRef } from './evidenceRef.js';

const GENERATOR = 'sequence/serviceInterior';

function toSeqKind(kind: string): SeqDiagramNode['kind'] {
  if (kind === 'module' || kind === 'file' || kind === 'package' || kind === 'function') {
    return kind;
  }
  return 'module';
}

function toFamily(kind: string): SeqDiagramEdgeFamily {
  if (kind === 'import') return 'import';
  if (kind === 'http' || kind === 'grpc') return kind;
  if (kind.startsWith('queue_')) return 'queue';
  if (kind.startsWith('db_')) return 'db';
  return 'call';
}

export interface ServiceInteriorOptions {
  graphId?: string;
  /** Most nodes to place. A service with 900 files is a file tree, not a map. */
  limit?: number;
}

export interface ServiceInterior {
  doc: SeqDiagramV1;
  /** Children the scan found, before any cap. */
  total: number;
  /** How many were left out, so the surface can say so rather than imply none. */
  omitted: number;
}

/**
 * The interior of one service.
 *
 * Returns an EMPTY document with `total: 0` for a service with no children —
 * which is a real answer. A single-file service is a normal thing, and a view
 * that errored on it would refuse the simplest repository there is.
 */
export function serviceInterior(
  graph: ArchGraph,
  serviceId: string,
  opts: ServiceInteriorOptions = {},
): ServiceInterior {
  const limit = Math.max(1, Math.min(opts.limit ?? 60, 300));
  const focus = graph.nodes.find((n) => n.id === serviceId);

  const children = graph.nodes.filter((n) => n.parentId === serviceId);
  const total = children.length;

  /*
   * RANKED BY CONNECTEDNESS, not by name. When a service has more children than
   * fit, the ones worth showing are the ones other things use — an alphabetical
   * cut would keep `a.ts` and drop the module every other file imports.
   */
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    degree.set(e.srcId, (degree.get(e.srcId) ?? 0) + 1);
    degree.set(e.dstId, (degree.get(e.dstId) ?? 0) + 1);
  }
  const kept = [...children]
    .sort(
      (a, b) =>
        (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) ||
        (a.label ?? a.id).localeCompare(b.label ?? b.id),
    )
    .slice(0, limit);
  const keptIds = new Set(kept.map((n) => n.id));

  const nodes: SeqDiagramNode[] = kept.map((n: ArchNode) => {
    const evidenceRef = archNodeEvidenceRef(n);
    return {
      id: n.id,
      label: n.label ?? n.id,
      kind: toSeqKind(n.kind),
      role: 'participant',
      ...(evidenceRef ? { evidenceRef } : {}),
    };
  });

  /* Only edges with BOTH ends inside. An edge leaving the service is a fact
     about the systems layer, and drawing half of it here would put a line into
     empty space. */
  const seen = new Set<string>();
  const edges: SeqDiagramEdge[] = [];
  for (const e of graph.edges) {
    if (!keptIds.has(e.srcId) || !keptIds.has(e.dstId) || e.srcId === e.dstId) continue;
    const family = toFamily(e.kind);
    const key = `${e.srcId}\u0000${e.dstId}\u0000${family}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ id: `int:${edges.length}`, from: e.srcId, to: e.dstId, family });
  }

  return {
    doc: {
      version: 1,
      kind: 'breakout-interior',
      title: focus ? `Inside ${focus.label ?? serviceId}` : serviceId,
      grounded: {
        graphId: opts.graphId ?? graph.repoName ?? 'arch',
        repoPath: graph.repoRoot || undefined,
        scopeNodeIds: nodes.map((n) => n.id),
        origin: 'scan',
      },
      theme: 'structural',
      nodes,
      edges,
      layout: { engine: 'layered-flow', direction: 'LR' },
      meta: { createdAt: new Date().toISOString(), generator: GENERATOR },
    },
    total,
    omitted: Math.max(0, total - kept.length),
  };
}
