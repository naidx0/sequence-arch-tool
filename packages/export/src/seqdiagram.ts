/**
 * ArchGraph → SeqDiagram v1 projector. Pure, browser-safe — depends only on
 * `@sequence/schema` types and the shared projection in project.ts / mermaid.ts.
 */
import type {
  ArchGraph,
  ArchNode,
  SeqDiagramV1,
  SeqDiagramKind,
  SeqDiagramTheme,
  SeqDiagramOrigin,
  SeqDiagramNode,
  SeqDiagramEdge,
  SeqDiagramEdgeFamily,
  SeqDiagramFlow,
  SeqDiagramNodeDetail,
} from '@sequence/schema';
import {
  projectEdges,
  participantKinds,
  orderParticipants,
  orderParticipantsFrom,
  orderEdgesByFlow,
  type ProjectedEdge,
} from './project.js';
import { mermaidSequence, mermaidFlow } from './mermaid.js';
import {
  archNodeEvidenceRef,
  projectedEdgeEvidenceRefs,
  projectedEdgeKey,
} from './evidenceRef.js';

export interface ArchGraphToSeqDiagramOptions {
  kind?: SeqDiagramKind;
  title?: string;
  theme?: SeqDiagramTheme;
  origin?: SeqDiagramOrigin;
  graphId?: string;
  /** When false, omit `projections.mermaid`. Defaults to true. */
  includeMermaid?: boolean;
  /**
   * MADR detail slots keyed by real ArchGraph node id — typically from analyzer
   * `seqdNodeDetailFromStructuralTree`. Omitted keys stay absent; never invented.
   */
  nodeDetail?: Readonly<Record<string, SeqDiagramNodeDetail>>;
}

const GENERATOR = '@sequence/export@0.1.0';

/** Map lifted projection labels back to ArchGraph service/datastore/topic nodes. */
function liftedNodeByLabel(graph: ArchGraph): Map<string, ArchNode> {
  const m = new Map<string, ArchNode>();
  for (const n of graph.nodes) {
    if (n.kind === 'service' || n.kind === 'datastore') m.set(n.label, n);
    else if (n.kind === 'topic') m.set(`topic:${n.label}`, n);
  }
  return m;
}

function toSeqNodeKind(
  kind: 'service' | 'datastore' | 'topic'
): SeqDiagramNode['kind'] {
  return kind;
}

function toEdgeFamily(family: string): SeqDiagramEdgeFamily {
  if (family === 'http' || family === 'grpc') return family;
  if (family === 'queue_publish' || family === 'queue_consume') return 'queue';
  if (family.startsWith('db_')) return 'db';
  return 'call';
}

function edgeId(from: string, to: string, family: string, index: number): string {
  const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `e:${slug(from)}-${slug(to)}-${family}-${index}`;
}

function syntheticNodeId(
  label: string,
  kind: 'service' | 'datastore' | 'topic'
): string {
  const bare = label.replace(/^topic:/, '');
  if (kind === 'service') return `svc:${bare}`;
  if (kind === 'datastore') return `ds:${bare}`;
  return `topic:${bare}`;
}

function extractCapNote(mermaid: string): string | undefined {
  const line = mermaid.split('\n').find((l) => /^\s+%%\s+\d+ of \d+ calls shown/.test(l));
  if (!line) return undefined;
  return line.replace(/^\s+%%\s+/, '').trim();
}

function mergeNodeDetail(
  arch: ArchNode | undefined,
  extra: Readonly<Record<string, SeqDiagramNodeDetail>> | undefined
): SeqDiagramNodeDetail | undefined {
  const fromExtra = arch ? extra?.[arch.id] : undefined;
  const desc = arch?.meta?.description?.trim();
  const detail: SeqDiagramNodeDetail = { ...fromExtra };
  if (!detail.whatItIs && desc) detail.whatItIs = desc;
  if (!detail.whatItIs && !detail.whatItDoes && !detail.parts?.length && !detail.talksTo?.length) {
    return undefined;
  }
  return detail;
}

function buildNodes(
  order: string[],
  kinds: Map<string, 'service' | 'datastore' | 'topic'>,
  byLabel: Map<string, ArchNode>,
  scanMode: boolean,
  nodeDetail: Readonly<Record<string, SeqDiagramNodeDetail>> | undefined,
  unknowns: string[]
): SeqDiagramNode[] {
  const nodes: SeqDiagramNode[] = [];
  for (const label of order) {
    const arch = byLabel.get(label);
    const kind = kinds.get(label)!;
    let id: string;
    if (arch?.id) {
      id = arch.id;
    } else if (scanMode) {
      unknowns.push(`No arch node for projected participant "${label}" — omitted from diagram`);
      continue;
    } else {
      id = syntheticNodeId(label, kind);
    }
    const detail = mergeNodeDetail(arch, nodeDetail);
    const node: SeqDiagramNode = {
      id,
      label: arch?.label ?? label.replace(/^topic:/, ''),
      kind: toSeqNodeKind(kind),
      role: 'participant',
    };
    const evidenceRef = arch ? archNodeEvidenceRef(arch) : undefined;
    if (evidenceRef) node.evidenceRef = evidenceRef;
    if (detail) node.detail = detail;
    nodes.push(node);
  }
  return nodes;
}

function buildEdges(
  edges: ProjectedEdge[],
  nodes: SeqDiagramNode[],
  edgeEvidence: Map<string, string>
): SeqDiagramEdge[] {
  const idOfLabel = new Map(nodes.map((n) => [n.label, n.id]));
  // Also map topic:label form used by projection
  for (const n of nodes) {
    if (n.kind === 'topic') idOfLabel.set(`topic:${n.label}`, n.id);
  }
  /* EDGE ordering, so it is the EDGE participants that rank — deliberately not
     the systems-layer set the node list uses. A node with no edge has no place
     in a flow ordering, and giving it one would push real hops down the page to
     make room for a participant that never appears in any of them. */
  const order = orderParticipants(edges);
  const flow = orderEdgesByFlow(edges, order);
  return flow.map((e, i) => {
    const fromId = idOfLabel.get(e.src) ?? e.src;
    const toId = idOfLabel.get(e.dst) ?? e.dst;
    const evidenceRef = edgeEvidence.get(projectedEdgeKey(e.src, e.dst, e.family));
    return {
      id: edgeId(fromId, toId, e.family, i),
      from: fromId,
      to: toId,
      family: toEdgeFamily(e.family),
      label: e.labels.join(', ') || e.family,
      ...(evidenceRef ? { evidenceRef } : {}),
    };
  });
}

const MAX_PRIMARY = 20;

function buildPrimaryNodeIds(nodes: SeqDiagramNode[]): string[] {
  return nodes.slice(0, MAX_PRIMARY).map((n) => n.id);
}

function buildDefaultFlow(
  nodes: SeqDiagramNode[],
  edges: SeqDiagramEdge[],
  order: string[]
): SeqDiagramFlow {
  const idOfLabel = new Map(nodes.map((n) => [n.label, n.id]));
  for (const n of nodes) {
    if (n.kind === 'topic') idOfLabel.set(`topic:${n.label}`, n.id);
  }
  const nodeIds =
    order.length > 0
      ? order
          .map((label) => idOfLabel.get(label))
          .filter((id): id is string => id !== undefined)
      : nodes.map((n) => n.id);
  return {
    id: 'flow:main',
    label: 'Main flow',
    nodeIds,
    edgeIds: edges.map((e) => e.id),
  };
}

/**
 * Project an ArchGraph to a grounded SeqDiagram v1 document. Uses the same
 * service-level edge projection as Mermaid exports; `projections.mermaid` is
 * derived via `mermaidSequence()` (and `mermaidFlow()` is available on the same
 * graph for flow layouts).
 */
export function archGraphToSeqDiagram(
  graph: ArchGraph,
  opts: ArchGraphToSeqDiagramOptions = {}
): SeqDiagramV1 {
  const edges = projectEdges(graph);
  const byLabel = liftedNodeByLabel(graph);
  const kinds = participantKinds(edges);

  /*
   * THE SYSTEMS LAYER, NOT THE EDGE PARTICIPANTS.
   *
   * `kinds` above holds only the endpoints of PROJECTED edges, and
   * `projectEdges` drops every `import`. On a monorepo that is nearly all of
   * them: measured on Sequence itself, 1,237 of 1,243 edges are imports, and
   * this function used to return a diagram of TWO nodes for a 628-node graph —
   * 9 of the 10 services missing. They were not omitted for a reason the
   * diagram could state; they were never considered.
   *
   * `liftedNodeByLabel` is keyed by exactly the convention `participantKinds`
   * uses, `topic:` prefix included, so merging cannot produce one node under
   * two labels.
   *
   * ONLY services, datastores and topics — the owner's ruling is one level and
   * no nesting. `liftedNodeByLabel` already admits nothing else, so the 589
   * files and 27 modules in that same graph stay off, which is the difference
   * between a systems map and a file listing.
   */
  for (const [label, node] of byLabel) {
    if (!kinds.has(label)) kinds.set(label, node.kind as 'service' | 'datastore' | 'topic');
  }

  const order = orderParticipantsFrom(kinds, edges);
  const scanMode = graph.mode === 'scan';
  const groundedUnknowns: string[] = [];
  const nodes = buildNodes(order, kinds, byLabel, scanMode, opts.nodeDetail, groundedUnknowns);
  const edgeEvidence = projectedEdgeEvidenceRefs(graph);
  const seqEdges = buildEdges(edges, nodes, edgeEvidence);
  const kind = opts.kind ?? 'service-flow';
  const includeMermaid = opts.includeMermaid !== false;
  const primaryNodeIds = buildPrimaryNodeIds(nodes);

  const doc: SeqDiagramV1 = {
    version: 1,
    kind,
    title: opts.title ?? (graph.repoName ? `${graph.repoName} architecture` : 'Architecture diagram'),
    grounded: {
      graphId: opts.graphId ?? (graph.repoName || 'arch'),
      repoPath: graph.repoRoot || undefined,
      scopeNodeIds: nodes.map((n) => n.id),
      origin: opts.origin ?? 'export',
      ...(groundedUnknowns.length > 0 ? { unknowns: groundedUnknowns } : {}),
    },
    theme: opts.theme ?? 'structural',
    nodes: nodes.map((n) => ({ ...n, primary: primaryNodeIds.includes(n.id) })),
    edges: seqEdges,
    primaryNodeIds,
    flows: kind === 'service-flow' ? [buildDefaultFlow(nodes, seqEdges, order)] : undefined,
    layout: {
      engine: kind === 'service-flow' ? 'layered-flow' : 'sequence',
      direction: kind === 'service-flow' ? 'LR' : 'LR',
    },
    meta: {
      createdAt: new Date().toISOString(),
      generator: GENERATOR,
    },
  };

  if (includeMermaid) {
    const mermaid =
      kind === 'service-sequence' ? mermaidSequence(graph) : mermaidFlow(graph);
    const capNote = kind === 'service-sequence' ? extractCapNote(mermaid) : undefined;
    doc.projections = {
      mermaid,
      ...(capNote ? { capNote } : {}),
    };
  }

  return doc;
}

/** Flow-chart Mermaid projection for a SeqDiagram doc's source graph (helper for callers). */
export function seqDiagramMermaidFlow(graph: ArchGraph): string {
  return mermaidFlow(graph);
}
