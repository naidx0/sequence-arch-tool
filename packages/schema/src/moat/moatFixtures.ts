/**
 * Shopfront-derived minimal ArchGraph fixtures for tier-3 moat golden tests.
 * Topology is taken verbatim from `packages/analyzer/test/fixtures/shopfront/ground-truth.json`
 * (service-level interaction edges only — no redis trap, no file-level nodes).
 */
import type { ArchEdge, ArchGraph, ArchNode, EdgeKind } from '../index.js';
import type { ImpactLink } from '../impact.js';
import type { RiskNode } from '../risks.js';

const SHOPFRONT_REPO = 'shopfront';

/** Ground-truth edge list — `src` depends on `dst` (caller → callee). */
const SHOPFRONT_GROUND_TRUTH: { src: string; dst: string; kind: EdgeKind }[] = [
  { src: 'gateway', dst: 'orders', kind: 'http' },
  { src: 'gateway', dst: 'payments', kind: 'http' },
  { src: 'orders', dst: 'payments', kind: 'http' },
  { src: 'orders', dst: 'inventory', kind: 'grpc' },
  { src: 'orders', dst: 'topic:order.created', kind: 'queue_publish' },
  { src: 'notifications', dst: 'topic:order.created', kind: 'queue_consume' },
  { src: 'orders', dst: 'postgres', kind: 'db_access' },
  { src: 'payments', dst: 'postgres', kind: 'db_access' },
  { src: 'gateway', dst: 'shipping', kind: 'http' },
  { src: 'shipping', dst: 'postgres', kind: 'db_access' },
  { src: 'shipping', dst: 'topic:order.created', kind: 'queue_consume' },
  { src: 'edge', dst: 'gateway', kind: 'http' },
  { src: 'gateway', dst: 'invoices', kind: 'http' },
  { src: 'invoices', dst: 'payments', kind: 'http' },
  { src: 'invoices', dst: 'postgres', kind: 'db_access' },
];

let edgeSeq = 0;

function shopfrontEdge(srcId: string, dstId: string, kind: EdgeKind): ArchEdge {
  return {
    id: `sf:${srcId}->${dstId}:${edgeSeq++}`,
    srcId,
    dstId,
    kind,
    confidence: 1,
    origin: 'deterministic',
    evidence: [{ file: `${srcId}/main`, line: 1, snippet: `${srcId} -> ${dstId}` }],
  };
}

function service(id: string): ArchNode {
  return { id, kind: 'service', label: id, parentId: 'repo', path: id };
}

function datastore(id: string): ArchNode {
  return { id, kind: 'datastore', label: id, parentId: 'repo', meta: { tech: 'postgres' } };
}

function topicNode(id: string): ArchNode {
  const label = id.startsWith('topic:') ? id.slice('topic:'.length) : id;
  return { id, kind: 'topic', label, parentId: 'repo' };
}

/** Rankable nodes matching the shopfront ground-truth interaction graph. */
export const SHOPFRONT_NODES: ArchNode[] = [
  service('edge'),
  service('gateway'),
  service('orders'),
  service('payments'),
  service('inventory'),
  service('notifications'),
  service('shipping'),
  service('invoices'),
  datastore('postgres'),
  topicNode('topic:order.created'),
];

/** Risk-advisor node universe (id + kind + label). */
export const SHOPFRONT_RISK_NODES: RiskNode[] = SHOPFRONT_NODES.map((n) => ({
  id: n.id,
  kind: n.kind,
  label: n.label,
}));

/** Directed depends-on edges for impact / risk golden tests. */
export const SHOPFRONT_EDGES: ArchEdge[] = SHOPFRONT_GROUND_TRUTH.map((e) =>
  shopfrontEdge(e.src, e.dst, e.kind)
);

/** Bare link list — same semantics as {@link SHOPFRONT_EDGES}. */
export const SHOPFRONT_IMPACT_LINKS: ImpactLink[] = SHOPFRONT_EDGES.map((e) => ({
  srcId: e.srcId,
  dstId: e.dstId,
}));

/** Minimal validateGraph-clean scan graph for moat layer-2 tests. */
export const SHOPFRONT_GRAPH: ArchGraph = {
  version: 1,
  mode: 'scan',
  scannedAt: '2020-01-01T00:00:00.000Z',
  repoRoot: `/fixtures/${SHOPFRONT_REPO}`,
  repoName: SHOPFRONT_REPO,
  nodes: [{ id: 'repo', kind: 'repo', label: SHOPFRONT_REPO }, ...SHOPFRONT_NODES],
  edges: SHOPFRONT_EDGES,
  warnings: [],
};

/**
 * Golden multi-hop closures for {@link computeImpact} on the shopfront fixture.
 * Locked by `impactChains.test.ts` — do not edit without recomputing from ground-truth.
 */
export const SHOPFRONT_IMPACT_GOLDEN: Record<
  string,
  { dependsOn: string[]; impactedBy: string[] }
> = {
  postgres: {
    dependsOn: [],
    impactedBy: ['edge', 'gateway', 'invoices', 'orders', 'payments', 'shipping'],
  },
  gateway: {
    dependsOn: [
      'inventory',
      'invoices',
      'orders',
      'payments',
      'postgres',
      'shipping',
      'topic:order.created',
    ],
    impactedBy: ['edge'],
  },
  orders: {
    dependsOn: ['inventory', 'payments', 'postgres', 'topic:order.created'],
    impactedBy: ['edge', 'gateway'],
  },
  'topic:order.created': {
    dependsOn: [],
    impactedBy: ['edge', 'gateway', 'notifications', 'orders', 'shipping'],
  },
};

/** Shared postgres SPOF blast radius and severity fraction on the shopfront graph. */
export const SHOPFRONT_POSTGRES_SPOF = {
  nodeId: 'postgres',
  blastRadius: 6,
  total: 10,
  fraction: 0.6,
  severity: 'critical' as const,
};
