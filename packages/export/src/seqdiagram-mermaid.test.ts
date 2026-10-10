import assert from 'node:assert';
import { test } from 'node:test';
import type { ArchGraph, ArchNode, ArchEdge } from '@sequence/schema';
import { archGraphToSeqDiagram } from './seqdiagram.js';
import { mermaidSequence, mermaidFlow } from './mermaid.js';

function graph(nodes: Partial<ArchNode>[], edges: Partial<ArchEdge>[]): ArchGraph {
  return {
    version: 1,
    scannedAt: '',
    repoRoot: '',
    repoName: 'x',
    nodes: nodes as ArchNode[],
    edges: edges.map((e, i) => ({
      id: e.id ?? `e${i}`,
      srcId: e.srcId!,
      dstId: e.dstId!,
      kind: e.kind!,
      confidence: e.confidence ?? 1,
      origin: e.origin ?? 'design',
      evidence: e.evidence ?? [],
      detail: e.detail,
    })) as ArchEdge[],
    warnings: [],
  };
}

const sampleGraph = graph(
  [
    { id: 'repo', kind: 'repo', label: 'x' },
    { id: 'svc:a', kind: 'service', label: 'a', parentId: 'repo' },
    { id: 'svc:b', kind: 'service', label: 'b', parentId: 'repo' },
    { id: 'ds:pg', kind: 'datastore', label: 'postgres', parentId: 'repo' },
  ],
  [
    { srcId: 'svc:a', dstId: 'svc:b', kind: 'http', detail: { method: 'GET', pathPattern: '/things' } },
    { srcId: 'svc:a', dstId: 'ds:pg', kind: 'db_read', detail: { table: 'things' } },
  ]
);

test('projections.mermaid byte-matches direct mermaidSequence() when kind is service-sequence', () => {
  const direct = mermaidSequence(sampleGraph);
  const doc = archGraphToSeqDiagram(sampleGraph, { kind: 'service-sequence' });
  assert.strictEqual(doc.projections?.mermaid, direct);
});

test('projections.mermaid byte-matches direct mermaidFlow() for default service-flow kind', () => {
  const direct = mermaidFlow(sampleGraph);
  const doc = archGraphToSeqDiagram(sampleGraph);
  assert.strictEqual(doc.projections?.mermaid, direct);
});

test('projections.mermaid stays in sync on a multi-hop graph (service-sequence)', () => {
  const g = graph(
    [
      { id: 'repo', kind: 'repo', label: 'x' },
      { id: 'svc:z', kind: 'service', label: 'z', parentId: 'repo' },
      { id: 'svc:m', kind: 'service', label: 'm', parentId: 'repo' },
      { id: 'svc:a', kind: 'service', label: 'a', parentId: 'repo' },
    ],
    [
      { srcId: 'svc:z', dstId: 'svc:m', kind: 'http', detail: { method: 'GET', pathPattern: '/m' } },
      { srcId: 'svc:m', dstId: 'svc:a', kind: 'http', detail: { method: 'GET', pathPattern: '/a' } },
    ]
  );
  const direct = mermaidSequence(g);
  const doc = archGraphToSeqDiagram(g, { kind: 'service-sequence' });
  assert.strictEqual(doc.projections?.mermaid, direct);
});
