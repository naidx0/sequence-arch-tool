import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { ArchGraph, ArchNode, ArchEdge } from '@sequence/schema';
import { validateSeqDiagram } from '@sequence/schema';
import { archGraphToSeqDiagram } from './seqdiagram.js';
import { graphToSequenceModel } from './diagramModel.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TICKETING = path.resolve(here, '..', '..', '..', 'examples', 'ticketing.spec.json');

function loadTicketing(): ArchGraph {
  return JSON.parse(fs.readFileSync(TICKETING, 'utf8')) as ArchGraph;
}

function graph(nodes: Partial<ArchNode>[], edges: Partial<ArchEdge>[], mode?: 'scan' | 'design'): ArchGraph {
  return {
    version: 1,
    ...(mode ? { mode } : {}),
    scannedAt: '2020-01-01T00:00:00.000Z',
    repoRoot: '/fixtures/shopfront',
    repoName: 'shopfront',
    nodes: nodes as ArchNode[],
    edges: edges.map((e, i) => ({
      id: e.id ?? `e${i}`,
      srcId: e.srcId!,
      dstId: e.dstId!,
      kind: e.kind!,
      confidence: e.confidence ?? 1,
      origin: e.origin ?? 'deterministic',
      evidence: e.evidence ?? [{ file: 'fixture', line: 1, snippet: 'test' }],
      detail: e.detail,
    })) as ArchEdge[],
    warnings: [],
  };
}

/** Shopfront topology with scan-shaped svc:/ds:/topic: ids (8 services + postgres + topic). */
function shopfrontGraph(): ArchGraph {
  const nodes: Partial<ArchNode>[] = [
    { id: 'repo', kind: 'repo', label: 'shopfront' },
    { id: 'svc:edge', kind: 'service', label: 'edge', parentId: 'repo' },
    { id: 'svc:gateway', kind: 'service', label: 'gateway', parentId: 'repo' },
    { id: 'svc:orders', kind: 'service', label: 'orders', parentId: 'repo' },
    { id: 'svc:payments', kind: 'service', label: 'payments', parentId: 'repo' },
    { id: 'svc:inventory', kind: 'service', label: 'inventory', parentId: 'repo' },
    { id: 'svc:notifications', kind: 'service', label: 'notifications', parentId: 'repo' },
    { id: 'svc:shipping', kind: 'service', label: 'shipping', parentId: 'repo' },
    { id: 'svc:invoices', kind: 'service', label: 'invoices', parentId: 'repo' },
    { id: 'ds:postgres', kind: 'datastore', label: 'postgres', parentId: 'repo' },
    { id: 'ds:redis', kind: 'datastore', label: 'redis', parentId: 'repo' },
    { id: 'topic:order.created', kind: 'topic', label: 'order.created', parentId: 'ds:redis' },
  ];
  const edges: Partial<ArchEdge>[] = [
    { srcId: 'svc:gateway', dstId: 'svc:orders', kind: 'http' },
    { srcId: 'svc:gateway', dstId: 'svc:payments', kind: 'http' },
    { srcId: 'svc:orders', dstId: 'svc:payments', kind: 'http' },
    { srcId: 'svc:orders', dstId: 'svc:inventory', kind: 'grpc' },
    { srcId: 'svc:orders', dstId: 'topic:order.created', kind: 'queue_publish' },
    { srcId: 'svc:notifications', dstId: 'topic:order.created', kind: 'queue_consume' },
    { srcId: 'svc:orders', dstId: 'ds:postgres', kind: 'db_access' },
    { srcId: 'svc:payments', dstId: 'ds:postgres', kind: 'db_access' },
    { srcId: 'svc:gateway', dstId: 'svc:shipping', kind: 'http' },
    { srcId: 'svc:shipping', dstId: 'ds:postgres', kind: 'db_access' },
    { srcId: 'svc:shipping', dstId: 'topic:order.created', kind: 'queue_consume' },
    { srcId: 'svc:edge', dstId: 'svc:gateway', kind: 'http' },
    { srcId: 'svc:gateway', dstId: 'svc:invoices', kind: 'http' },
    { srcId: 'svc:invoices', dstId: 'svc:payments', kind: 'http' },
    { srcId: 'svc:invoices', dstId: 'ds:postgres', kind: 'db_access' },
  ];
  return graph(nodes, edges, 'scan');
}

test('archGraphToSeqDiagram: shopfront projects to service-flow with grounded svc:/ds: ids', () => {
  const g = shopfrontGraph();
  const doc = archGraphToSeqDiagram(g);

  assert.strictEqual(doc.kind, 'service-flow');
  assert.strictEqual(doc.version, 1);
  assert.strictEqual(doc.grounded.graphId, 'shopfront');
  assert.strictEqual(doc.grounded.repoPath, '/fixtures/shopfront');
  assert.strictEqual(doc.grounded.origin, 'export');

  const services = doc.nodes.filter((n) => n.kind === 'service');
  assert.strictEqual(services.length, 8, 'shopfront has 8 services');
  for (const s of services) {
    assert.match(s.id, /^svc:/, `service id must be svc:* — got ${s.id}`);
  }
  for (const d of doc.nodes.filter((n) => n.kind === 'datastore')) {
    assert.match(d.id, /^ds:/, `datastore id must be ds:* — got ${d.id}`);
  }

  /*
   * 8 services + postgres + redis + topic.
   *
   * This read "8 services + postgres + topic (redis has no projected edges)" —
   * the comment stated the defect and the number locked it in. `redis` is in
   * the scan; no projected edge touches it; the diagram left it out. The node
   * list is now the systems layer rather than the edge participants, so a
   * datastore nothing happens to call is still part of the architecture.
   */
  assert.strictEqual(doc.nodes.length, 11);
  assert.ok(
    doc.nodes.some((n) => n.label === 'redis'),
    'the datastore with no projected edge is placed',
  );
  assert.ok(doc.edges.length >= 15, 'shopfront projects a non-trivial edge set');

  for (const e of doc.edges) {
    assert.ok(doc.nodes.some((n) => n.id === e.from), `edge ${e.id} from ${e.from} missing node`);
    assert.ok(doc.nodes.some((n) => n.id === e.to), `edge ${e.id} to ${e.to} missing node`);
  }

  const validation = validateSeqDiagram(doc);
  assert.deepEqual(validation, { ok: true, errors: [] }, validation.errors.join('; '));
});

test('archGraphToSeqDiagram: layout engine follows kind', () => {
  const doc = archGraphToSeqDiagram(shopfrontGraph());
  assert.strictEqual(doc.layout?.engine, 'layered-flow');
  assert.strictEqual(doc.layout?.direction, 'LR');
});

test('archGraphToSeqDiagram: shopfront fills primaryNodeIds and flows', () => {
  const doc = archGraphToSeqDiagram(shopfrontGraph());
  assert.ok(doc.primaryNodeIds?.length, 'primaryNodeIds populated');
  assert.strictEqual(doc.primaryNodeIds!.length, 11);
  assert.ok(doc.flows?.length === 1, 'default flow present');
  assert.strictEqual(doc.flows![0].id, 'flow:main');
  assert.strictEqual(doc.flows![0].nodeIds.length, 11);
  assert.ok(doc.flows![0].edgeIds!.length >= 15);
  for (const n of doc.nodes) {
    assert.strictEqual(n.primary, true, `${n.id} marked primary`);
  }
});

test('archGraphToSeqDiagram: ticketing fixture validates and matches graphToSequenceModel participants', () => {
  const g = loadTicketing();
  const doc = archGraphToSeqDiagram(g);
  const model = graphToSequenceModel(g);

  const validation = validateSeqDiagram(doc);
  assert.deepEqual(validation, { ok: true, errors: [] }, validation.errors.join('; '));

  assert.strictEqual(doc.grounded.graphId, 'ticketing');
  /*
   * THE DOC IS A SUPERSET OF THE SEQUENCE MODEL, AND THAT IS THE POINT.
   *
   * This asserted equality, which held only while the diagram was also built
   * from edge participants. The two answer different questions: a SEQUENCE
   * model is about messages, and a lifeline with no messages on it is noise;
   * an ARCHITECTURE diagram is about the system, and a datastore nothing calls
   * is still part of it. Ticketing has exactly that node — `redis`.
   *
   * Asserting the containment rather than the count is also stricter than the
   * equality was: it catches a participant being dropped OR renamed, which a
   * length comparison never could.
   */
  const docLabels = doc.nodes.map((n) =>
    n.kind === 'topic' ? `topic:${n.label}` : n.label
  );
  for (const p of model.participants) {
    assert.ok(docLabels.includes(p.label), `sequence participant ${p.label} missing from the diagram`);
  }
  const extra = docLabels.filter((l) => !model.participants.some((p) => p.label === l));
  assert.deepStrictEqual(extra, ['redis'], 'the only addition is the datastore no message touches');
});

test('archGraphToSeqDiagram: includeMermaid false omits projections', () => {
  const doc = archGraphToSeqDiagram(shopfrontGraph(), { includeMermaid: false });
  assert.strictEqual(doc.projections, undefined);
});

test('archGraphToSeqDiagram: opts override kind and title', () => {
  const g = shopfrontGraph();
  const doc = archGraphToSeqDiagram(g, {
    kind: 'service-sequence',
    title: 'Custom title',
    graphId: 'custom-arch',
    origin: 'scan',
  });
  assert.strictEqual(doc.kind, 'service-sequence');
  assert.strictEqual(doc.title, 'Custom title');
  assert.strictEqual(doc.grounded.graphId, 'custom-arch');
  assert.strictEqual(doc.grounded.origin, 'scan');
  assert.strictEqual(doc.layout?.engine, 'sequence');
});

test('archGraphToSeqDiagram: nodeDetail fills MADR slots without inventing ids', () => {
  const g = shopfrontGraph();
  const doc = archGraphToSeqDiagram(g, {
    nodeDetail: {
      'svc:gateway': {
        whatItIs: 'API gateway',
        whatItDoes: 'Routes HTTP to backend services.',
      },
    },
  });
  const gateway = doc.nodes.find((n) => n.id === 'svc:gateway');
  assert.strictEqual(gateway?.detail?.whatItIs, 'API gateway');
  assert.strictEqual(gateway?.detail?.whatItDoes, 'Routes HTTP to backend services.');
});

test('archGraphToSeqDiagram: scan mode uses only real arch node ids', () => {
  const phantom = graph(
    [
      { id: 'svc:a', kind: 'service', label: 'alpha', parentId: 'repo' },
      { id: 'svc:b', kind: 'service', label: 'beta', parentId: 'repo' },
    ],
    [{ srcId: 'svc:a', dstId: 'svc:b', kind: 'http' }],
    'scan',
  );
  const doc = archGraphToSeqDiagram(phantom);
  for (const n of doc.nodes) {
    assert.ok(phantom.nodes.some((x) => x.id === n.id), `node ${n.id} must be grounded`);
  }
  assert.strictEqual(doc.nodes.length, 2);
});

test('archGraphToSeqDiagram: edges carry scan evidence refs when graph has evidence', () => {
  const g = shopfrontGraph();
  const first = g.edges[0];
  first.evidence = [{ file: 'docker-compose.yml', line: 12, snippet: 'ORDERS_URL' }];
  first.detail = { ...(first.detail ?? {}), envVar: 'ORDERS_URL' };
  const doc = archGraphToSeqDiagram(g);
  const withRef = doc.edges.filter((e) => e.evidenceRef?.startsWith('scan:'));
  assert.ok(withRef.length >= 1, 'at least one edge should carry evidenceRef');
});
