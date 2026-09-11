import assert from 'node:assert';
import { test } from 'node:test';
import type { ArchGraph, ArchNode, ArchEdge } from '@sequence/schema';
import { validateSeqDiagram } from '@sequence/schema';
import { archGraphToBreakoutSeqDiagram } from './seqdiagram-breakout.js';

function graph(nodes: Partial<ArchNode>[], edges: Partial<ArchEdge>[]): ArchGraph {
  return {
    version: 1,
    mode: 'scan',
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

function shopfrontGraph(): ArchGraph {
  const nodes: Partial<ArchNode>[] = [
    { id: 'repo', kind: 'repo', label: 'shopfront' },
    { id: 'svc:gateway', kind: 'service', label: 'gateway', parentId: 'repo' },
    { id: 'svc:orders', kind: 'service', label: 'orders', parentId: 'repo' },
    { id: 'svc:payments', kind: 'service', label: 'payments', parentId: 'repo' },
    { id: 'svc:inventory', kind: 'service', label: 'inventory', parentId: 'repo' },
    { id: 'ds:postgres', kind: 'datastore', label: 'postgres', parentId: 'repo' },
    { id: 'topic:order.created', kind: 'topic', label: 'order.created', parentId: 'ds:postgres' },
    { id: 'mod:handlers', kind: 'module', label: 'handlers', parentId: 'svc:orders' },
    { id: 'file:api', kind: 'file', label: 'api.ts', parentId: 'mod:handlers', path: 'orders/api.ts' },
  ];
  const edges: Partial<ArchEdge>[] = [
    { srcId: 'svc:gateway', dstId: 'svc:orders', kind: 'http' },
    { srcId: 'svc:orders', dstId: 'svc:payments', kind: 'http' },
    { srcId: 'svc:orders', dstId: 'svc:inventory', kind: 'grpc' },
    { srcId: 'svc:orders', dstId: 'topic:order.created', kind: 'queue_publish' },
    { srcId: 'svc:orders', dstId: 'ds:postgres', kind: 'db_access' },
  ];
  return graph(nodes, edges);
}

test('archGraphToBreakoutSeqDiagram: focus orders → breakout-interior with neighbours as boundary', () => {
  const g = shopfrontGraph();
  const doc = archGraphToBreakoutSeqDiagram(g, 'svc:orders', {
    detail: {
      whatItIs: 'Order orchestration service',
      whatItDoes: 'Creates and tracks customer orders.',
      parts: ['handlers', 'api.ts'],
      talksTo: ['gateway', 'payments', 'inventory', 'postgres', 'order.created'],
    },
  });

  assert.strictEqual(doc.kind, 'breakout-interior');
  assert.strictEqual(doc.version, 1);
  assert.ok(doc.nodes.some((n) => n.id === 'svc:orders' && n.role === 'actor'));
  assert.ok(doc.nodes.filter((n) => n.role === 'boundary').length >= 3);

  const focus = doc.nodes.find((n) => n.id === 'svc:orders')!;
  assert.strictEqual(focus.detail?.whatItIs, 'Order orchestration service');
  assert.strictEqual(focus.detail?.whatItDoes, 'Creates and tracks customer orders.');
  assert.deepStrictEqual(focus.detail?.parts, ['handlers', 'api.ts']);
  assert.ok(focus.detail?.talksTo?.includes('gateway'));

  for (const e of doc.edges) {
    assert.ok(doc.nodes.some((n) => n.id === e.from));
    assert.ok(doc.nodes.some((n) => n.id === e.to));
  }

  const validation = validateSeqDiagram(doc);
  assert.deepEqual(validation, { ok: true, errors: [] }, validation.errors.join('; '));
});

test('archGraphToBreakoutSeqDiagram: derives child parts from graph when detail.parts omitted', () => {
  const g = shopfrontGraph();
  const doc = archGraphToBreakoutSeqDiagram(g, 'svc:orders');
  const focus = doc.nodes.find((n) => n.id === 'svc:orders')!;
  assert.deepStrictEqual(focus.detail?.parts, ['handlers']);
});

test('archGraphToBreakoutSeqDiagram: fills whatItIs from meta.description only — never invents', () => {
  const g = graph(
    [
      { id: 'svc:plain', kind: 'service', label: 'plain' },
      { id: 'svc:other', kind: 'service', label: 'other' },
    ],
    [{ srcId: 'svc:plain', dstId: 'svc:other', kind: 'http' }]
  );
  const noMeta = archGraphToBreakoutSeqDiagram(g, 'svc:plain');
  assert.strictEqual(noMeta.nodes.find((n) => n.id === 'svc:plain')?.detail?.whatItIs, undefined);

  g.nodes[0].meta = { description: 'A real scan sentence.' };
  const withMeta = archGraphToBreakoutSeqDiagram(g, 'svc:plain');
  assert.strictEqual(
    withMeta.nodes.find((n) => n.id === 'svc:plain')?.detail?.whatItIs,
    'A real scan sentence.'
  );
});

test('archGraphToBreakoutSeqDiagram: unknown focus yields empty calm doc', () => {
  const doc = archGraphToBreakoutSeqDiagram(shopfrontGraph(), 'svc:missing');
  assert.strictEqual(doc.nodes.length, 0);
  assert.strictEqual(doc.kind, 'breakout-interior');
});
