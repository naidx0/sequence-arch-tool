import test from 'node:test';
import assert from 'node:assert/strict';
import type { ArchEdge, ArchGraph, EdgeKind } from './index.js';
import {
  buildDecisionRecord,
  decisionRecordFilename,
  decisionRecordToMarkdown,
  diffAppliedPatch,
  filterGroundedProse,
  nextDecisionRecordNumber,
  patchDiagramScope,
} from './decisionRecord.js';

function edge(srcId: string, dstId: string, kind: EdgeKind = 'db_access'): ArchEdge {
  return {
    id: `${srcId}->${dstId}`,
    srcId,
    dstId,
    kind,
    confidence: 1,
    origin: 'design',
    evidence: [],
  };
}

function baseGraph(): ArchGraph {
  return {
    version: 1,
    mode: 'design',
    scannedAt: '',
    repoRoot: '',
    repoName: 'shop',
    nodes: [
      { id: 'repo', kind: 'repo', label: 'shop' },
      { id: 'svc:orders', kind: 'service', label: 'orders', parentId: 'repo' },
      { id: 'ds:postgres', kind: 'datastore', label: 'postgres', parentId: 'repo' },
    ],
    edges: [edge('svc:orders', 'ds:postgres')],
    warnings: [],
  };
}

test('nextDecisionRecordNumber — sequential numbering never collides', () => {
  const files = [
    'docs/adr/ADR-001-one-canvas.md',
    'docs/adr/ADR-003-functions-first.md',
    'docs/adr/README.md',
    '.sequence/decisions/ADR-009-decision-records.md',
  ];
  assert.strictEqual(nextDecisionRecordNumber(files), 10);
  assert.strictEqual(nextDecisionRecordNumber([]), 1);
  assert.strictEqual(nextDecisionRecordNumber(['ADR-007-test.md']), 8);
});

test('diffAppliedPatch — captures added nodes and edges by real id', () => {
  const before = baseGraph();
  const after: ArchGraph = {
    ...before,
    nodes: [
      ...before.nodes,
      { id: 'ds:postgres-cache', kind: 'datastore', label: 'postgres-cache', parentId: 'repo' },
    ],
    edges: [
      ...before.edges,
      edge('svc:orders', 'ds:postgres-cache'),
    ],
  };
  const patch = diffAppliedPatch(before, after);
  assert.deepStrictEqual(patch.addedNodes.map((n) => n.id), ['ds:postgres-cache']);
  assert.strictEqual(patch.addedEdges.length, 1);
  assert.strictEqual(patch.addedEdges[0].srcId, 'svc:orders');
  assert.strictEqual(patch.addedEdges[0].dstId, 'ds:postgres-cache');
});

test('filterGroundedProse — drops ungrounded claims', () => {
  const allowed = new Set(['svc:orders', 'ds:postgres']);
  const prose =
    'Keep `svc:orders` talking to `ds:postgres`. Also route via `svc:ghost` for speed.';
  const filtered = filterGroundedProse(prose, allowed);
  assert.ok(filtered);
  assert.match(filtered!, /svc:orders/);
  assert.doesNotMatch(filtered!, /svc:ghost/);
});

test('buildDecisionRecord — no-key structural fallback without model prose', () => {
  const before = baseGraph();
  const after: ArchGraph = {
    ...before,
    nodes: [
      ...before.nodes,
      { id: 'ds:postgres-cache', kind: 'datastore', label: 'postgres-cache', parentId: 'repo' },
    ],
    edges: [...before.edges, edge('svc:orders', 'ds:postgres-cache')],
  };
  const patch = diffAppliedPatch(before, after);
  const record = buildDecisionRecord({
    before,
    after,
    patch,
    number: 10,
    title: 'Add a read cache in front of postgres',
    alternatives: [
      {
        title: 'Rewrite orders service',
        rationale: 'Rejected — too invasive for the current blast radius.',
        patch: { addedNodes: [], addedEdges: [], removedNodeIds: [], removedEdgeIds: [] },
      },
    ],
  });

  assert.strictEqual(record.status, 'Accepted');
  assert.ok(record.context.summary.length > 0);
  assert.ok(record.decision.summary.includes('postgres-cache'));
  assert.ok(record.consequences.summary.length > 0);
  assert.strictEqual(record.alternatives.length, 1);
  assert.ok(!record.context.prose);
});

test('decisionRecordToMarkdown — embeds diagram from projection when attached', () => {
  const before = baseGraph();
  const after: ArchGraph = {
    ...before,
    nodes: [
      ...before.nodes,
      { id: 'ds:postgres-cache', kind: 'datastore', label: 'postgres-cache', parentId: 'repo' },
    ],
    edges: [...before.edges, edge('svc:orders', 'ds:postgres-cache')],
  };
  const patch = diffAppliedPatch(before, after);
  const diagram = 'flowchart TD\n  orders["orders"] --> postgres-cache["postgres-cache"]';

  const record = buildDecisionRecord({
    before,
    after,
    patch,
    number: 10,
    title: 'Add a read cache in front of postgres',
    diagrams: { after: diagram },
  });

  const md = decisionRecordToMarkdown(record);
  assert.match(md, /^# ADR-010 — Add a read cache/);
  assert.match(md, /```mermaid\nflowchart TD/);
  assert.match(md, /postgres-cache/);
  assert.match(md, /## Alternatives considered/);
});

test('decisionRecordFilename — stable slug from title', () => {
  const record = buildDecisionRecord({
    before: baseGraph(),
    after: baseGraph(),
    patch: { addedNodes: [], addedEdges: [], removedNodeIds: [], removedEdgeIds: [] },
    number: 4,
    title: 'One canvas: understanding + editing',
  });
  assert.strictEqual(decisionRecordFilename(record), 'ADR-004-one-canvas-understanding-editing.md');
});

test('patchDiagramScope — includes patch endpoints only', () => {
  const before = baseGraph();
  const patch = {
    addedNodes: [{ id: 'ds:postgres-cache', kind: 'datastore' as const, label: 'postgres-cache' }],
    addedEdges: [{ id: 'e1', srcId: 'svc:orders', dstId: 'ds:postgres-cache', kind: 'db_access' as const }],
    removedNodeIds: [],
    removedEdgeIds: [],
  };
  const scope = patchDiagramScope(patch, before);
  assert.deepStrictEqual(scope.sort(), ['ds:postgres-cache', 'svc:orders'].sort());
});
