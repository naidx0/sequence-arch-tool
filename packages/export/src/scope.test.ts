import assert from 'node:assert';
import { test } from 'node:test';
import type { ArchGraph, ArchNode, ArchEdge } from '@sequence/schema';
import { scopeGraph, withDescendants, mermaidFlow, mermaidSequence, projectEdges } from './index.js';

function graph(nodes: Partial<ArchNode>[], edges: Partial<ArchEdge>[], mode?: 'scan' | 'design'): ArchGraph {
  return {
    version: 1,
    ...(mode ? { mode } : {}),
    scannedAt: '2026-01-01T00:00:00.000Z',
    repoRoot: '/tmp/x',
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
    warnings: ['a real warning'],
  };
}

const design = graph([
  { id: 'repo', kind: 'repo', label: 'x' },
  { id: 'svc:a', kind: 'service', label: 'a', parentId: 'repo' },
  { id: 'svc:b', kind: 'service', label: 'b', parentId: 'repo' },
  { id: 'ds:pg', kind: 'datastore', label: 'postgres', parentId: 'repo' },
], [
  { srcId: 'svc:a', dstId: 'svc:b', kind: 'http', detail: { method: 'GET', pathPattern: '/things' } },
  { srcId: 'svc:b', dstId: 'ds:pg', kind: 'db_read', detail: { table: 'things' } },
], 'design');

const scan = graph([
  { id: 'repo', kind: 'repo', label: 'x' },
  { id: 'svc:a', kind: 'service', label: 'a', parentId: 'repo' },
  { id: 'file:a1', kind: 'file', label: 'a.ts', parentId: 'svc:a' },
  { id: 'svc:b', kind: 'service', label: 'b', parentId: 'repo' },
  { id: 'file:b1', kind: 'file', label: 'b.ts', parentId: 'svc:b' },
  { id: 'ds:pg', kind: 'datastore', label: 'postgres', parentId: 'repo' },
], [
  { srcId: 'file:a1', dstId: 'file:b1', kind: 'http', detail: { method: 'GET', pathPattern: '/things' } },
  { srcId: 'file:a1', dstId: 'ds:pg', kind: 'db_read', detail: { table: 'things' } },
]);

test('scopeGraph keeps grounded edges whose endpoints both survive', () => {
  const s = scopeGraph(design, ['svc:a', 'svc:b']);
  assert.deepStrictEqual(s.nodes.map((n) => n.id), ['svc:a', 'svc:b']);
  assert.deepStrictEqual(s.edges.map((e) => e.id), ['e0']);
  // the surviving edge is the REAL edge object, untouched
  assert.deepStrictEqual(s.edges[0], design.edges[0]);
});

test('scopeGraph drops an edge whose other endpoint left the scope (no dangling)', () => {
  const s = scopeGraph(design, ['svc:b']);
  assert.deepStrictEqual(s.nodes.map((n) => n.id), ['svc:b']);
  assert.deepStrictEqual(s.edges, []);
  for (const e of s.edges as { srcId: string; dstId: string }[]) {
    assert.ok(s.nodes.some((n) => n.id === e.srcId) && s.nodes.some((n) => n.id === e.dstId));
  }
});

test('scopeGraph ignores unknown ids and never invents a node', () => {
  const s = scopeGraph(design, ['svc:a', 'svc:b', 'svc:ghost', '', 'repo:nope']);
  assert.deepStrictEqual(s.nodes.map((n) => n.id), ['svc:a', 'svc:b']);
  assert.ok(!s.nodes.some((n) => n.id === 'svc:ghost'));
});

test('scopeGraph with an empty scope is an honest empty graph, not the whole graph', () => {
  const s = scopeGraph(design, []);
  assert.deepStrictEqual(s.nodes, []);
  assert.deepStrictEqual(s.edges, []);
  assert.deepStrictEqual(projectEdges(s), []);
  // metadata survives so the caller can still caption the (empty) result honestly
  assert.strictEqual(s.repoName, 'x');
  assert.strictEqual(s.mode, 'design');
  assert.deepStrictEqual(s.warnings, ['a real warning']);
});

test('scopeGraph preserves every other graph field and never mutates the input', () => {
  const before = JSON.stringify(design);
  const s = scopeGraph(design, ['svc:a', 'svc:b']);
  assert.strictEqual(JSON.stringify(design), before, 'input graph untouched');
  assert.strictEqual(s.version, design.version);
  assert.strictEqual(s.mode, design.mode);
  assert.strictEqual(s.scannedAt, design.scannedAt);
  assert.strictEqual(s.repoRoot, design.repoRoot);
  assert.strictEqual(s.repoName, design.repoName);
  assert.deepStrictEqual(s.warnings, design.warnings);
});

test('scopeGraph is deterministic: same input, byte-identical projection', () => {
  const ids = ['svc:b', 'svc:a', 'ds:pg'];
  assert.strictEqual(mermaidFlow(scopeGraph(design, ids)), mermaidFlow(scopeGraph(design, ids)));
  // id order in the request does not change the output (graph order wins)
  assert.strictEqual(
    mermaidFlow(scopeGraph(design, ids)),
    mermaidFlow(scopeGraph(design, ['svc:a', 'ds:pg', 'svc:b'])),
  );
});

test('mermaidFlow / mermaidSequence over a scoped graph stay valid diagrams', () => {
  const s = scopeGraph(design, ['svc:a', 'svc:b']);
  const flow = mermaidFlow(s);
  assert.match(flow, /^flowchart TD\n/);
  assert.match(flow, /a -->\|GET \/things\| b/);
  // postgres left the scope, so it appears nowhere
  assert.ok(!flow.includes('postgres'));

  const seq = mermaidSequence(s);
  assert.match(seq, /^sequenceDiagram\n/);
  assert.match(seq, /a->>b: GET \/things/);
  assert.ok(!seq.includes('postgres'));
});

test('an empty scope projects to a header-only diagram, not a blank/fabricated one', () => {
  const s = scopeGraph(design, ['svc:ghost']);
  assert.strictEqual(mermaidFlow(s), 'flowchart TD\n');
  // The sequence diagram states its own emptiness rather than staying a bare,
  // silent header — a lone `sequenceDiagram\n` pasted into a doc reads like a
  // bug, not "this scope really has no interactions".
  const seq = mermaidSequence(s);
  assert.match(seq, /^sequenceDiagram\n {4}%% no service-level interactions found/);
  assert.ok(!seq.includes('participant'), 'no fabricated participant for an empty graph');
});

test('withDescendants expands a container id to the leaves that carry the edges (scan mode)', () => {
  // scoping to the bare service ids alone drops the file-level edges — honest, but empty
  assert.deepStrictEqual(projectEdges(scopeGraph(scan, ['svc:a', 'svc:b'])), []);
  const ids = withDescendants(scan, ['svc:a', 'svc:b']);
  assert.deepStrictEqual(ids, ['svc:a', 'file:a1', 'svc:b', 'file:b1']);
  const flow = mermaidFlow(scopeGraph(scan, ids));
  assert.match(flow, /a -->\|GET \/things\| b/);
  assert.ok(!flow.includes('postgres'), 'the out-of-scope datastore edge is still dropped');
});

test('withDescendants drops unknown ids and tolerates a parentId cycle', () => {
  assert.deepStrictEqual(withDescendants(scan, ['nope']), []);
  const cyclic = graph([
    { id: 'a', kind: 'service', label: 'a', parentId: 'b' },
    { id: 'b', kind: 'service', label: 'b', parentId: 'a' },
    { id: 'c', kind: 'service', label: 'c' },
  ], [], 'design');
  assert.deepStrictEqual(withDescendants(cyclic, ['a']), ['a', 'b']);
  assert.deepStrictEqual(withDescendants(cyclic, ['c']), ['c']);
});
