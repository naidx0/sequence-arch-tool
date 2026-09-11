import { describe, expect, it } from 'vitest';
import type { ArchGraph, ArchNode, ArchEdge } from '@sequence/schema';
import { validateSeqDiagram } from '@sequence/schema';
import {
  assertSeqdGroundedInGraph,
  countArchGraphNodes,
  enrichNodeDetailFromGraph,
  seqdFromGraph,
} from './seqdFromGraph.js';

function graph(
  nodes: Partial<ArchNode>[],
  edges: Partial<ArchEdge>[],
  mode: 'scan' | 'design' = 'scan',
): ArchGraph {
  return {
    version: 1,
    mode,
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

/** Shopfront topology — 8 services, 2 datastores, 1 topic. */
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
  return graph(nodes, edges);
}

describe('seqdFromGraph', () => {
  it('sets grounded.origin to scan', () => {
    const doc = seqdFromGraph(shopfrontGraph());
    expect(doc.grounded.origin).toBe('scan');
  });

  it('grounds every node id in the ArchGraph and resolves edges', () => {
    const g = shopfrontGraph();
    const doc = seqdFromGraph(g);
    const issues = assertSeqdGroundedInGraph(doc, g);
    expect(issues).toEqual([]);
    const validation = validateSeqDiagram(doc);
    expect(validation).toEqual({ ok: true, errors: [] });
  });

  it('shopfront fixture counts: 8 services, 2 datastores, 1 topic', () => {
    const counts = countArchGraphNodes(shopfrontGraph());
    expect(counts).toEqual({ services: 8, datastores: 2, topics: 1 });
    const doc = seqdFromGraph(shopfrontGraph());
    expect(doc.nodes.filter((n) => n.kind === 'service').length).toBe(8);
    expect(doc.nodes.filter((n) => n.kind === 'datastore').length).toBe(2);
    expect(doc.nodes.filter((n) => n.kind === 'topic').length).toBe(1);
    expect(doc.nodes.some((n) => n.id === 'ds:redis')).toBe(true);
  });

  it('adds orphan scan nodes with no projected edges (redis)', () => {
    const g = graph(
      [
        { id: 'svc:a', kind: 'service', label: 'a', parentId: 'repo' },
        { id: 'ds:redis', kind: 'datastore', label: 'redis', parentId: 'repo' },
      ],
      [{ srcId: 'svc:a', dstId: 'svc:a', kind: 'http' }],
    );
    const base = seqdFromGraph(g);
    expect(base.nodes.map((n) => n.id)).toContain('ds:redis');
    const validation = validateSeqDiagram(base);
    expect(validation).toEqual({ ok: true, errors: [] });
  });

  it('copies whatItIs as label and preserves whatItDoes from nodeDetail', () => {
    const g = shopfrontGraph();
    const doc = seqdFromGraph(g, {
      'svc:orders': {
        whatItIs: 'Order service',
        whatItDoes: 'Accepts checkout and persists orders',
      },
    });
    const orders = doc.nodes.find((n) => n.id === 'svc:orders');
    expect(orders?.label).toBe('Order service');
    expect(orders?.detail?.whatItDoes).toBe('Accepts checkout and persists orders');
  });

  it('enriches parts and talksTo from graph topology when nodeDetail omits them', () => {
    const g = graph(
      [
        { id: 'svc:web', kind: 'service', label: 'web', parentId: 'repo' },
        { id: 'svc:api', kind: 'service', label: 'api', parentId: 'repo' },
        { id: 'mod:api-core', kind: 'module', label: 'core', parentId: 'svc:api' },
        { id: 'file:api-main', kind: 'file', label: 'main.ts', parentId: 'mod:api-core', path: 'api/main.ts' },
      ],
      [{ srcId: 'svc:web', dstId: 'svc:api', kind: 'http' }],
    );
    const detail = enrichNodeDetailFromGraph(g);
    expect(detail['svc:api']?.parts).toEqual(['core']);
    expect(detail['svc:web']?.talksTo).toEqual(['api']);
    const doc = seqdFromGraph(g);
    const web = doc.nodes.find((n) => n.id === 'svc:web');
    expect(web?.detail?.talksTo).toEqual(['api']);
  });
});
