/**
 * ArchGraph → SeqDiagram for the product board (scan origin).
 */
import { archGraphToSeqDiagram, archNodeEvidenceRef, projectEdges } from '@sequence/export';
import type { ArchGraph, ArchNode, SeqDiagramNode, SeqDiagramNodeDetail, SeqDiagramV1 } from '@sequence/schema';

import { saysMoreThan } from './naming.js';

export interface ArchGraphCounts {
  services: number;
  datastores: number;
  topics: number;
}

/** Count scan-shaped nodes in an ArchGraph — used for shopfront-scale locking tests. */
export function countArchGraphNodes(graph: ArchGraph): ArchGraphCounts {
  let services = 0;
  let datastores = 0;
  let topics = 0;
  for (const n of graph.nodes) {
    if (n.kind === 'service') services += 1;
    else if (n.kind === 'datastore') datastores += 1;
    else if (n.kind === 'topic') topics += 1;
  }
  return { services, datastores, topics };
}

const graphNodeIds = (graph: ArchGraph): Set<string> =>
  new Set(graph.nodes.map((n) => n.id));

/** Grounding checks — every diagram node id must exist on the graph; edges must resolve. */
export function assertSeqdGroundedInGraph(doc: SeqDiagramV1, graph: ArchGraph): string[] {
  const ids = graphNodeIds(graph);
  const errors: string[] = [];
  for (const n of doc.nodes) {
    if (!ids.has(n.id)) errors.push(`diagram node ${n.id} is not in the ArchGraph`);
  }
  const docIds = new Set(doc.nodes.map((n) => n.id));
  for (const e of doc.edges) {
    if (!docIds.has(e.from)) errors.push(`edge ${e.id} from ${e.from} missing node`);
    if (!docIds.has(e.to)) errors.push(`edge ${e.id} to ${e.to} missing node`);
  }
  return errors;
}

const SCAN_NODE_KINDS = new Set<ArchNode['kind']>(['service', 'datastore', 'topic']);

const TOPOLOGY_NODE_KINDS = new Set<ArchNode['kind']>(['service', 'datastore']);

function liftedLabel(node: ArchNode): string {
  if (node.kind === 'topic') return `topic:${node.label}`;
  return node.label;
}

/** Grounded parts/talksTo from arch children + projected edges — never invents ids. */
export function enrichNodeDetailFromGraph(
  graph: ArchGraph,
  base?: Readonly<Record<string, SeqDiagramNodeDetail>>,
): Record<string, SeqDiagramNodeDetail> {
  const out: Record<string, SeqDiagramNodeDetail> = { ...(base ?? {}) };
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

    /*
     * A DATASTORE'S PARTS ARE ITS TABLES.
     *
     * It has no child nodes, so `childParts` is empty and its card carried no
     * count at all — while the scan knew 31 table names for it, each traced to a
     * file and a line. The card showed a box called "Database" and nothing a
     * reader could act on. The tables ARE the contents; naming them is the same
     * move `childParts` makes for a service, on the only children a store has.
     */
    const tables = n.kind === 'datastore' ? (n.meta?.tables as string[] | undefined) : undefined;

    const prev = out[n.id];
    const detail: SeqDiagramNodeDetail = { ...prev };
    if (childParts.length > 0 && !detail.parts?.length) detail.parts = childParts;
    if (tables?.length && !detail.parts?.length) detail.parts = [...tables].sort((a, b) => a.localeCompare(b));
    if (talks && talks.length > 0 && !detail.talksTo?.length) detail.talksTo = talks;
    if (detail.whatItIs || detail.whatItDoes || detail.parts?.length || detail.talksTo?.length) {
      out[n.id] = detail;
    }
  }

  return out;
}

function archNodeToSeqNode(
  n: ArchNode,
  nodeDetail?: Readonly<Record<string, SeqDiagramNodeDetail>>,
): SeqDiagramNode {
  const detail = nodeDetail?.[n.id];
  // Same rule as the label promotion below — see the note there.
  const summary = detail?.whatItIs?.trim();
  const displayLabel = summary && saysMoreThan(n.label, summary) ? summary : n.label;
  const node: SeqDiagramNode = {
    id: n.id,
    label: displayLabel,
    kind: n.kind as SeqDiagramNode['kind'],
    role: 'participant',
  };
  const evidenceRef = archNodeEvidenceRef(n);
  if (evidenceRef) node.evidenceRef = evidenceRef;
  if (detail) node.detail = detail;
  else {
    const desc = n.meta?.description?.trim();
    if (desc) node.detail = { whatItIs: desc };
  }
  return node;
}

/**
 * archGraphToSeqDiagram only includes nodes that appear on projected edges; scan
 * nodes with no edges (e.g. orphan Redis) must still land on the board.
 */
export function enrichSeqdWithOrphanScanNodes(
  doc: SeqDiagramV1,
  graph: ArchGraph,
  nodeDetail?: Readonly<Record<string, SeqDiagramNodeDetail>>,
): SeqDiagramV1 {
  const present = new Set(doc.nodes.map((n) => n.id));
  const additions: SeqDiagramNode[] = [];
  for (const n of graph.nodes) {
    if (!SCAN_NODE_KINDS.has(n.kind)) continue;
    if (present.has(n.id)) continue;
    additions.push(archNodeToSeqNode(n, nodeDetail));
  }
  if (additions.length === 0) return doc;
  const nodes = [...doc.nodes, ...additions];
  const flows = doc.flows?.map((f, i) =>
    i === 0
      ? { ...f, nodeIds: nodes.map((n) => n.id), edgeIds: f.edgeIds ?? doc.edges.map((e) => e.id) }
      : f,
  );
  return {
    ...doc,
    nodes,
    ...(flows ? { flows } : {}),
    grounded: {
      ...doc.grounded,
      scopeNodeIds: nodes.map((n) => n.id),
    },
  };
}

/** Project a scanned ArchGraph to a grounded SeqDiagram for the native board. */
export function seqdFromGraph(
  graph: ArchGraph,
  nodeDetail?: Readonly<Record<string, SeqDiagramNodeDetail>>,
): SeqDiagramV1 {
  const mergedDetail = enrichNodeDetailFromGraph(graph, nodeDetail);
  const base = archGraphToSeqDiagram(graph, { origin: 'scan', nodeDetail: mergedDetail });
  const enriched = enrichSeqdWithOrphanScanNodes(base, graph, mergedDetail);
  /*
   * THE TITLE IS THE NODE'S NAME UNLESS THE SUMMARY EARNS THE SLOT.
   *
   * This promoted `whatItIs` to the label unconditionally. On a real repository
   * that summary is the name with its own kind appended, so every card read
   * "<Name> <kind>" directly under a chip that already said the kind — and the
   * name a reader can grep for was not on the card at all. Measured on
   * ml-harness: 293 of 300 summaries were an exact echo of the label, 7 restated
   * it, none said anything new.
   *
   * A summary that DOES say something new is still better than a bare
   * identifier, so it still wins the slot. `saysMoreThan` is the same rule the
   * subtitle uses, deliberately shared: the two lines sit one above the other
   * and disagreeing about what counts as informative is how the card ended up
   * printing one fact three times.
   */
  const nodes = enriched.nodes.map((n) => {
    const whatItIs = mergedDetail[n.id]?.whatItIs?.trim();
    if (!whatItIs || !saysMoreThan(n.label, whatItIs)) return n;
    return { ...n, label: whatItIs };
  });
  return { ...enriched, nodes };
}
