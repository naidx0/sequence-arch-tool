import assert from 'node:assert';
import { test } from 'node:test';
import type { ArchGraph, ArchNode, ArchEdge } from '@sequence/schema';
import { mermaidSequence, mermaidFlow, dependencyMatrix, projectEdges, orderParticipants } from './index.js';

function graph(nodes: Partial<ArchNode>[], edges: Partial<ArchEdge>[], mode?: 'scan' | 'design'): ArchGraph {
  return {
    version: 1,
    ...(mode ? { mode } : {}),
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

// A scan-shaped graph: interaction edges land on FILE leaves inside services.
const scanGraph = graph([
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

// The SAME architecture authored as a design spec: edges are service-level.
const designGraph = graph([
  { id: 'repo', kind: 'repo', label: 'x' },
  { id: 'svc:a', kind: 'service', label: 'a', parentId: 'repo' },
  { id: 'svc:b', kind: 'service', label: 'b', parentId: 'repo' },
  { id: 'ds:pg', kind: 'datastore', label: 'postgres', parentId: 'repo' },
], [
  { srcId: 'svc:a', dstId: 'svc:b', kind: 'http', detail: { method: 'GET', pathPattern: '/things' } },
  { srcId: 'svc:a', dstId: 'ds:pg', kind: 'db_read', detail: { table: 'things' } },
], 'design');

test('mode-agnostic: scan-leaf graph and design spec project to the same edges', () => {
  const proj = (g: ArchGraph) =>
    projectEdges(g)
      .map((e) => `${e.src}->${e.dst}[${e.family}] ${e.labels.join('|')}`)
      .sort();
  assert.deepStrictEqual(proj(scanGraph), proj(designGraph));
  // and both fold db_read -> db_access
  assert.ok(proj(scanGraph).some((s) => s.includes('[db_access]')));
});

test('mode-agnostic: mermaidSequence works on both a scan graph and a design spec', () => {
  for (const g of [scanGraph, designGraph]) {
    const out = mermaidSequence(g);
    assert.match(out, /^sequenceDiagram\n/);
    assert.match(out, /a->>b: GET \/things/);
    assert.match(out, /a->>postgres: read things/);
  }
});

test('label escaping: topic colon/dot never leaks into an actor position', () => {
  const g = graph([
    { id: 'repo', kind: 'repo', label: 'x' },
    { id: 'ds:redis', kind: 'datastore', label: 'redis', parentId: 'repo' },
    { id: 'topic:t', kind: 'topic', label: 'ticket.created', parentId: 'ds:redis' },
    { id: 'svc:api', kind: 'service', label: 'api', parentId: 'repo' },
  ], [
    { srcId: 'svc:api', dstId: 'topic:t', kind: 'queue_publish', detail: { topic: 'ticket.created' } },
  ], 'design');
  const out = mermaidSequence(g);
  // the actor is tokenized; the real name survives only as the alias display
  assert.match(out, /participant topic_ticket_created as topic:ticket\.created/);
  assert.match(out, /api->>topic_ticket_created: publish ticket\.created/);
  // the raw colon-bearing label must never sit next to an arrow operator
  assert.doesNotMatch(out, /topic:ticket\.created->>/);
  assert.doesNotMatch(out, /->>topic:ticket\.created/);

  // flowchart: the label is quoted inside the node, arrows use the token
  const flow = mermaidFlow(g);
  assert.match(flow, /topic_ticket_created\{\{"topic:ticket\.created"\}\}/);
  assert.match(flow, /api -->\|publish ticket\.created\| topic_ticket_created/);
});

test('CSV quoting: commas in a label and in a multi-family cell are quoted', () => {
  const g = graph([
    { id: 'repo', kind: 'repo', label: 'x' },
    { id: 'svc:a', kind: 'service', label: 'a', parentId: 'repo' },
    { id: 'svc:b', kind: 'service', label: 'b', parentId: 'repo' },
    { id: 'ds:pg', kind: 'datastore', label: 'pg,main', parentId: 'repo' },
  ], [
    // two distinct families a->b => the cell is "grpc,http" (contains a comma)
    { srcId: 'svc:a', dstId: 'svc:b', kind: 'http', detail: { method: 'GET', pathPattern: '/x' } },
    { srcId: 'svc:a', dstId: 'svc:b', kind: 'grpc' },
    { srcId: 'svc:a', dstId: 'ds:pg', kind: 'db_read', detail: { table: 't' } },
  ], 'design');
  const { csv, markdown } = dependencyMatrix(g);
  // label with a comma is quoted as a header/row field
  assert.match(csv, /"pg,main"/);
  // multi-family cell is quoted
  assert.match(csv, /"grpc,http"/);
  // markdown needs no comma-quoting, but the multi-family cell is present verbatim
  assert.match(markdown, /grpc,http/);
  assert.ok(!markdown.includes('"pg,main"'), 'markdown does not CSV-quote labels');
});

test('participant order: entry-point services first, then the rest alphabetically', () => {
  // gateway (no inbound http) is an entry point; api is http-reached; z-store sorts last
  const g = graph([
    { id: 'repo', kind: 'repo', label: 'x' },
    { id: 'svc:gateway', kind: 'service', label: 'gateway', parentId: 'repo' },
    { id: 'svc:api', kind: 'service', label: 'api', parentId: 'repo' },
    { id: 'ds:z', kind: 'datastore', label: 'zdb', parentId: 'repo' },
  ], [
    { srcId: 'svc:gateway', dstId: 'svc:api', kind: 'http', detail: { method: 'GET', pathPattern: '/a' } },
    { srcId: 'svc:api', dstId: 'ds:z', kind: 'db_read', detail: { table: 't' } },
  ], 'design');
  // gateway first (entry point) even though 'api' < 'gateway' alphabetically
  assert.deepStrictEqual(orderParticipants(projectEdges(g)), ['gateway', 'api', 'zdb']);
});

test('label hygiene: an embedded newline renders single-line Mermaid in BOTH diagram types', () => {
  // A scan-mode label is unconstrained; a raw newline in it must not break the
  // single-line `participant … as …` or flowchart node declarations.
  const g = graph([
    { id: 'repo', kind: 'repo', label: 'x' },
    { id: 'svc:a', kind: 'service', label: 'multi\nline', parentId: 'repo' },
    { id: 'svc:b', kind: 'service', label: 'b', parentId: 'repo' },
  ], [
    { srcId: 'svc:a', dstId: 'svc:b', kind: 'http', detail: { method: 'GET', pathPattern: '/x' } },
  ], 'design');

  const seq = mermaidSequence(g);
  assert.doesNotMatch(seq, /multi\nline/, 'no raw newline survives into the sequence diagram');
  assert.match(seq, /participant multi_line as multi line/);
  // no orphan "line" fragment left dangling on its own row
  assert.ok(!seq.split('\n').some((l) => l === 'line'), 'no split-label orphan line');

  const flow = mermaidFlow(g);
  assert.doesNotMatch(flow, /multi\nline/, 'no raw newline survives into the flowchart');
  assert.match(flow, /multi_line\["multi line"\]/);
});

test('CSV formula-injection guard: a cell starting with = is prefixed with a quote', () => {
  const g = graph([
    { id: 'repo', kind: 'repo', label: 'x' },
    { id: 'svc:a', kind: 'service', label: '=cmd()', parentId: 'repo' },
    { id: 'svc:b', kind: 'service', label: 'b', parentId: 'repo' },
  ], [
    { srcId: 'svc:a', dstId: 'svc:b', kind: 'http', detail: { method: 'GET', pathPattern: '/x' } },
  ], 'design');
  const { csv } = dependencyMatrix(g);
  assert.ok(csv.includes("'=cmd()"), `expected the guard prefix in:\n${csv}`);
  // the raw formula-leading cell must never appear at a field boundary
  assert.doesNotMatch(csv, /(^|,)=cmd\(\)/m, 'no bare =cmd() cell');
});

test('dedup: two http edges between the same services collapse to one arrow', () => {
  const g = graph([
    { id: 'repo', kind: 'repo', label: 'x' },
    { id: 'svc:a', kind: 'service', label: 'a', parentId: 'repo' },
    { id: 'svc:b', kind: 'service', label: 'b', parentId: 'repo' },
  ], [
    { srcId: 'svc:a', dstId: 'svc:b', kind: 'http', detail: { method: 'GET', pathPattern: '/x' } },
    { srcId: 'svc:a', dstId: 'svc:b', kind: 'http', detail: { method: 'POST', pathPattern: '/y' } },
  ], 'design');
  const edges = projectEdges(g);
  assert.strictEqual(edges.length, 1);
  assert.deepStrictEqual(edges[0].labels, ['GET /x', 'POST /y']);
  const seq = mermaidSequence(g);
  assert.match(seq, /a->>b: GET \/x, POST \/y/);
});
