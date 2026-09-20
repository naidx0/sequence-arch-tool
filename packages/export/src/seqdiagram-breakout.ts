/**
 * ArchGraph → breakout-interior SeqDiagram — scoped to one focus node and its
 * service-level neighbours, with MADR `detail` slots filled from graph evidence.
 */
import type {
  ArchGraph,
  ArchNode,
  SeqDiagramV1,
  SeqDiagramTheme,
  SeqDiagramOrigin,
  SeqDiagramNode,
  SeqDiagramEdge,
  SeqDiagramEdgeFamily,
  SeqDiagramNodeDetail,
} from '@sequence/schema';
import {
  projectEdges,
  participantKinds,
  orderEdgesByFlow,
  type ProjectedEdge,
} from './project.js';
import { mermaidSequence } from './mermaid.js';
import { scopeGraph } from './scope.js';

export interface ArchGraphToBreakoutSeqDiagramOptions {
  title?: string;
  theme?: SeqDiagramTheme;
  origin?: SeqDiagramOrigin;
  graphId?: string;
  /** When false, omit `projections.mermaid`. Defaults to true. */
  includeMermaid?: boolean;
  /**
   * Enriched detail from `componentInterior` — merged with graph-derived fields.
   * Omitted keys stay absent; nothing is invented.
   */
  detail?: SeqDiagramNodeDetail;
}

const GENERATOR = '@sequence/export@0.1.0';

function liftedNodeByLabel(graph: ArchGraph): Map<string, ArchNode> {
  const m = new Map<string, ArchNode>();
  for (const n of graph.nodes) {
    if (n.kind === 'service' || n.kind === 'datastore') m.set(n.label, n);
    else if (n.kind === 'topic') m.set(`topic:${n.label}`, n);
  }
  return m;
}

function liftedLabel(node: ArchNode): string {
  if (node.kind === 'topic') return `topic:${node.label}`;
  return node.label;
}

function toSeqNodeKind(kind: 'service' | 'datastore' | 'topic'): SeqDiagramNode['kind'] {
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

function syntheticNodeId(label: string, kind: 'service' | 'datastore' | 'topic'): string {
  const bare = label.replace(/^topic:/, '');
  if (kind === 'service') return `svc:${bare}`;
  if (kind === 'datastore') return `ds:${bare}`;
  return `topic:${bare}`;
}

function buildNodes(
  order: string[],
  kinds: Map<string, 'service' | 'datastore' | 'topic'>,
  byLabel: Map<string, ArchNode>
): SeqDiagramNode[] {
  return order.map((label) => {
    const arch = byLabel.get(label);
    const kind = kinds.get(label)!;
    return {
      id: arch?.id ?? syntheticNodeId(label, kind),
      label: arch?.label ?? label.replace(/^topic:/, ''),
      kind: toSeqNodeKind(kind),
      role: 'participant',
    };
  });
}

function buildEdges(edges: ProjectedEdge[], nodes: SeqDiagramNode[]): SeqDiagramEdge[] {
  const idOfLabel = new Map(nodes.map((n) => [n.label, n.id]));
  for (const n of nodes) {
    if (n.kind === 'topic') idOfLabel.set(`topic:${n.label}`, n.id);
  }
  const flow = orderEdgesByFlow(edges, nodes.map((n) => (n.kind === 'topic' ? `topic:${n.label}` : n.label)));
  return flow.map((e, i) => {
    const fromId = idOfLabel.get(e.src) ?? e.src;
    const toId = idOfLabel.get(e.dst) ?? e.dst;
    return {
      id: edgeId(fromId, toId, e.family, i),
      from: fromId,
      to: toId,
      family: toEdgeFamily(e.family),
      label: e.labels.join(', ') || e.family,
    };
  });
}

function neighbourDisplayLabels(labels: Iterable<string>): string[] {
  return [...labels]
    .map((l) => l.replace(/^topic:/, ''))
    .sort((a, b) => a.localeCompare(b));
}

function buildDetail(
  graph: ArchGraph,
  focus: ArchNode,
  neighbourLabels: string[],
  extra?: SeqDiagramNodeDetail
): SeqDiagramNodeDetail | undefined {
  const desc = focus.meta?.description?.trim();
  const whatItIs = extra?.whatItIs ?? (desc || undefined);
  const whatItDoes = extra?.whatItDoes;
  const childParts = graph.nodes
    .filter((n) => n.parentId === focus.id)
    .map((n) => n.label)
    .sort((a, b) => a.localeCompare(b));
  const parts = extra?.parts ?? (childParts.length > 0 ? childParts : undefined);
  const talksTo =
    extra?.talksTo ?? (neighbourLabels.length > 0 ? neighbourLabels : undefined);

  const detail: SeqDiagramNodeDetail = {};
  if (whatItIs) detail.whatItIs = whatItIs;
  if (whatItDoes) detail.whatItDoes = whatItDoes;
  if (parts?.length) detail.parts = parts;
  if (talksTo?.length) detail.talksTo = talksTo;
  return Object.keys(detail).length > 0 ? detail : undefined;
}

/**
 * Project a focus node's service-level neighbourhood to a `breakout-interior`
 * SeqDiagram. The focus node carries grounded `detail` slots; neighbours render
 * as `boundary` participants.
 */
export function archGraphToBreakoutSeqDiagram(
  graph: ArchGraph,
  focusNodeId: string,
  opts: ArchGraphToBreakoutSeqDiagramOptions = {}
): SeqDiagramV1 {
  const focus = graph.nodes.find((n) => n.id === focusNodeId);
  if (!focus) {
    return {
      version: 1,
      kind: 'breakout-interior',
      title: opts.title ?? 'Breakout',
      grounded: {
        graphId: opts.graphId ?? graph.repoName ?? 'arch',
        scopeNodeIds: [],
        origin: opts.origin ?? 'scan',
      },
      nodes: [],
      edges: [],
      layout: { engine: 'sequence', direction: 'LR', showTitleBlock: false },
      meta: { createdAt: new Date().toISOString(), generator: GENERATOR },
    };
  }

  const focusLbl = liftedLabel(focus);
  const allEdges = projectEdges(graph);
  const scoped: ProjectedEdge[] = [];
  const neighbourLabels = new Set<string>();
  for (const e of allEdges) {
    if (e.src === focusLbl || e.dst === focusLbl) {
      scoped.push(e);
      if (e.src !== focusLbl) neighbourLabels.add(e.src);
      if (e.dst !== focusLbl) neighbourLabels.add(e.dst);
    }
  }

  const kinds = participantKinds(scoped);
  const focusKind: 'service' | 'datastore' | 'topic' =
    focus.kind === 'datastore' ? 'datastore' : focus.kind === 'topic' ? 'topic' : 'service';
  kinds.set(focusLbl, focusKind);

  const order = [focusLbl, ...[...neighbourLabels].sort()];
  const byLabel = liftedNodeByLabel(graph);
  const nodes = buildNodes(order, kinds, byLabel);

  const talksTo = neighbourDisplayLabels(neighbourLabels);
  const detail = buildDetail(graph, focus, talksTo, opts.detail);

  for (const n of nodes) {
    if (n.id === focus.id) {
      n.role = 'actor';
      if (detail) n.detail = detail;
    } else {
      n.role = 'boundary';
    }
  }

  const seqEdges = buildEdges(scoped, nodes);
  const title = opts.title ?? focus.label;
  const includeMermaid = opts.includeMermaid !== false;

  const doc: SeqDiagramV1 = {
    version: 1,
    kind: 'breakout-interior',
    title,
    grounded: {
      graphId: opts.graphId ?? graph.repoName ?? 'arch',
      repoPath: graph.repoRoot || undefined,
      scopeNodeIds: nodes.map((n) => n.id),
      origin: opts.origin ?? 'scan',
    },
    theme: opts.theme ?? 'structural',
    nodes,
    edges: seqEdges,
    layout: { engine: 'sequence', direction: 'LR', showTitleBlock: false },
    meta: { createdAt: new Date().toISOString(), generator: GENERATOR },
  };

  if (includeMermaid && nodes.length > 0) {
    const scopeIds = new Set(nodes.map((n) => n.id));
    const sub = scopeGraph(graph, scopeIds);
    if (sub.nodes.length > 0) {
      doc.projections = { mermaid: mermaidSequence(sub) };
    }
  }

  return doc;
}
