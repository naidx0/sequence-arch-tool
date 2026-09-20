import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { ArchGraph, SeqDiagramV1 } from '@sequence/schema';
import { archGraphToSeqDiagram } from './seqdiagram.js';
import { docWithExpandedRollup } from './seqDiagramLayout.js';
import { renderSeqDiagramSvg, _edgeStrokeUsesSignal, _hasSignalTitleRule, resolveFlowNodeOrder } from './renderSeqDiagramSvg.js';
import { structuralTheme } from './structuralTheme.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TICKETING = path.resolve(here, '..', '..', '..', 'examples', 'ticketing.spec.json');
const SIGNAL = '#F25C05';

function loadTicketing(): ArchGraph {
  return JSON.parse(fs.readFileSync(TICKETING, 'utf8')) as ArchGraph;
}

function shopfrontGraph(): ArchGraph {
  const nodes = [
    { id: 'repo', kind: 'repo' as const, label: 'shopfront' },
    { id: 'svc:edge', kind: 'service' as const, label: 'edge', parentId: 'repo' },
    { id: 'svc:gateway', kind: 'service' as const, label: 'gateway', parentId: 'repo' },
    { id: 'svc:orders', kind: 'service' as const, label: 'orders', parentId: 'repo' },
    { id: 'svc:payments', kind: 'service' as const, label: 'payments', parentId: 'repo' },
    { id: 'svc:inventory', kind: 'service' as const, label: 'inventory', parentId: 'repo' },
    { id: 'svc:notifications', kind: 'service' as const, label: 'notifications', parentId: 'repo' },
    { id: 'svc:shipping', kind: 'service' as const, label: 'shipping', parentId: 'repo' },
    { id: 'svc:invoices', kind: 'service' as const, label: 'invoices', parentId: 'repo' },
    { id: 'ds:postgres', kind: 'datastore' as const, label: 'postgres', parentId: 'repo' },
    { id: 'ds:redis', kind: 'datastore' as const, label: 'redis', parentId: 'repo' },
    { id: 'topic:order.created', kind: 'topic' as const, label: 'order.created', parentId: 'ds:redis' },
  ];
  const edges = [
    { srcId: 'svc:gateway', dstId: 'svc:orders', kind: 'http' as const },
    { srcId: 'svc:gateway', dstId: 'svc:payments', kind: 'http' as const },
    { srcId: 'svc:orders', dstId: 'svc:payments', kind: 'http' as const },
    { srcId: 'svc:orders', dstId: 'svc:inventory', kind: 'grpc' as const },
    { srcId: 'svc:orders', dstId: 'topic:order.created', kind: 'queue_publish' as const },
    { srcId: 'svc:notifications', dstId: 'topic:order.created', kind: 'queue_consume' as const },
    { srcId: 'svc:orders', dstId: 'ds:postgres', kind: 'db_access' as const },
    { srcId: 'svc:payments', dstId: 'ds:postgres', kind: 'db_access' as const },
    { srcId: 'svc:gateway', dstId: 'svc:shipping', kind: 'http' as const },
    { srcId: 'svc:shipping', dstId: 'ds:postgres', kind: 'db_access' as const },
    { srcId: 'svc:shipping', dstId: 'topic:order.created', kind: 'queue_consume' as const },
    { srcId: 'svc:edge', dstId: 'svc:gateway', kind: 'http' as const },
    { srcId: 'svc:gateway', dstId: 'svc:invoices', kind: 'http' as const },
    { srcId: 'svc:invoices', dstId: 'svc:payments', kind: 'http' as const },
    { srcId: 'svc:invoices', dstId: 'ds:postgres', kind: 'db_access' as const },
  ];
  return {
    version: 1,
    mode: 'scan',
    scannedAt: '2020-01-01T00:00:00.000Z',
    repoRoot: '/fixtures/shopfront',
    repoName: 'shopfront',
    nodes: nodes.map((n) => ({
      ...n,
      confidence: 1,
      origin: 'deterministic' as const,
      evidence: [{ file: 'fixture', line: 1, snippet: 'test' }],
    })),
    edges: edges.map((e, i) => ({
      id: `e${i}`,
      ...e,
      confidence: 1,
      origin: 'deterministic' as const,
      evidence: [{ file: 'fixture', line: 1, snippet: 'test' }],
    })),
    warnings: [],
  };
}

test('renderSeqDiagramSvg: steel canvas background', () => {
  const theme = structuralTheme();
  const doc = archGraphToSeqDiagram(shopfrontGraph());
  const svg = renderSeqDiagramSvg(doc);
  assert.match(svg, new RegExp(`fill="${theme.canvas}"`));
});

test('renderSeqDiagramSvg: sheet frame stroke is omitted (no page-in-black void)', () => {
  const doc = archGraphToSeqDiagram(shopfrontGraph());
  const svg = renderSeqDiagramSvg(doc);
  assert.doesNotMatch(svg, /<rect[^>]*x="0\.5"[^>]*y="0\.5"[^>]*fill="none"/);
});

test('renderSeqDiagramSvg: edge strokes never use signal orange', () => {
  const doc = archGraphToSeqDiagram(shopfrontGraph());
  const svg = renderSeqDiagramSvg(doc);
  assert.strictEqual(_edgeStrokeUsesSignal(svg), false);
  const edgeLines = svg.match(/<line[^>]*stroke="[^"]*"[^>]*>/g) ?? [];
  for (const line of edgeLines) {
    assert.doesNotMatch(line, new RegExp(SIGNAL, 'i'), `edge must not use signal: ${line}`);
  }
});

test('renderSeqDiagramSvg: escapes XML in labels', () => {
  const doc: SeqDiagramV1 = {
    version: 1,
    kind: 'service-sequence',
    title: 'Test',
    grounded: { graphId: 'x' },
    layout: { engine: 'sequence' },
    nodes: [
      { id: 'a', label: '<bad&"x">', kind: 'service', role: 'participant' },
      { id: 'b', label: 'b', kind: 'service', role: 'participant' },
    ],
    edges: [
      {
        id: 'e1',
        from: 'a',
        to: 'b',
        family: 'http',
        label: '<script>alert(1)</script>',
      },
    ],
  };
  const svg = renderSeqDiagramSvg(doc);
  assert.doesNotMatch(svg, /<script/i);
  assert.match(svg, /&lt;bad&amp;&quot;x&quot;&gt;/);
  assert.match(svg, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('renderSeqDiagramSvg: empty nodes shows calm message', () => {
  const doc: SeqDiagramV1 = {
    version: 1,
    kind: 'service-flow',
    title: 'Empty architecture',
    grounded: { graphId: 'empty' },
    nodes: [],
    edges: [],
  };
  const svg = renderSeqDiagramSvg(doc);
  assert.match(svg, /Empty architecture/);
  assert.doesNotMatch(svg, /svc:/);
  assert.doesNotMatch(svg, /<script/i);
});

test('renderSeqDiagramSvg: shopfront via archGraphToSeqDiagram contains known labels', () => {
  const doc = archGraphToSeqDiagram(shopfrontGraph());
  const svg = renderSeqDiagramSvg(doc);
  assert.match(svg, />gateway</);
  assert.match(svg, />orders</);
  assert.match(svg, />postgres</);
  assert.match(svg, /viewBox="/);
  assert.doesNotMatch(svg, /<script/i);
});

test('renderSeqDiagramSvg: ticketing via archGraphToSeqDiagram contains known labels', () => {
  const doc = archGraphToSeqDiagram(loadTicketing(), { kind: 'service-sequence' });
  const svg = renderSeqDiagramSvg(doc);
  assert.match(svg, />gateway</);
  assert.match(svg, />api</);
  assert.match(svg, />postgres</);
  assert.match(svg, /stroke="#5aa9ff"/);
  assert.match(svg, /stroke="#30d158"/);
});

test('renderSeqDiagramSvg: export default shows signal title rule', () => {
  const doc = archGraphToSeqDiagram(shopfrontGraph());
  const svg = renderSeqDiagramSvg(doc);
  assert.strictEqual(_hasSignalTitleRule(svg), true);
  assert.match(svg, />shopfront architecture</);
  assert.doesNotMatch(svg, /<rect[^>]*x="0\.5"[^>]*y="0\.5"[^>]*fill="none"/);
});

test('renderSeqDiagramSvg: title block can be suppressed', () => {
  const doc = archGraphToSeqDiagram(shopfrontGraph());
  doc.layout = { ...doc.layout, showTitleBlock: false };
  const svg = renderSeqDiagramSvg(doc);
  assert.strictEqual(_hasSignalTitleRule(svg), false);
});

test('renderSeqDiagramSvg: title block uses signal accent on rule only', () => {
  const doc = archGraphToSeqDiagram(shopfrontGraph(), {
    title: 'Shopfront map',
    kind: 'service-flow',
  });
  doc.layout = { engine: 'layered-flow', showTitleBlock: true };
  const svg = renderSeqDiagramSvg(doc);
  assert.match(svg, new RegExp(`fill="${SIGNAL}"`));
  assert.strictEqual(_edgeStrokeUsesSignal(svg), false);
  assert.match(svg, />Shopfront map</);
});

test('renderSeqDiagramSvg: deterministic output', () => {
  const doc = archGraphToSeqDiagram(shopfrontGraph());
  assert.strictEqual(renderSeqDiagramSvg(doc), renderSeqDiagramSvg(doc));
});

test('renderSeqDiagramSvg: layered flow uses LR lanes with edge labels', () => {
  const doc = archGraphToSeqDiagram(shopfrontGraph());
  const svg = renderSeqDiagramSvg(doc);
  assert.match(svg, /FLOW · LANE 01/);
  assert.match(svg, />edge</);
  assert.match(svg, />gateway</);
  assert.match(svg, />orders</);
  assert.match(svg, />postgres</);
  assert.match(svg, />order\.created</);
  // edge labels visible (family or http/grpc/db/queue)
  assert.match(svg, /font-size="10"[^>]*>http</);
  const services = doc.nodes.filter((n) => n.kind === 'service');
  assert.strictEqual(services.length, 8, '8 services rendered');
  const datastores = doc.nodes.filter((n) => n.kind === 'datastore');
  /*
   * BOTH datastores. This said 1, "postgres projected (redis has no edges)" —
   * an assertion that recorded the defect as the specification. shopfront has a
   * redis the scan finds and no projected edge touches, and the diagram simply
   * did not draw it. A datastore missing from the architecture picture is not a
   * rendering detail; it is the picture being wrong about the architecture.
   */
  assert.strictEqual(datastores.length, 2, 'postgres AND redis, connected or not');
  assert.match(svg, />redis</, 'the unconnected datastore is on the canvas');
  const topics = doc.nodes.filter((n) => n.kind === 'topic');
  assert.strictEqual(topics.length, 1, '1 topic');
});

test('renderSeqDiagramSvg: prefers doc.flows node order', () => {
  const doc = archGraphToSeqDiagram(shopfrontGraph());
  doc.flows = [{ id: 'custom', label: 'Custom', nodeIds: ['svc:payments', 'svc:orders', 'svc:gateway'] }];
  const order = resolveFlowNodeOrder(doc, doc.primaryNodeIds!);
  assert.deepStrictEqual(order.slice(0, 3), ['svc:payments', 'svc:orders', 'svc:gateway']);
});

test('renderSeqDiagramSvg: sequence height floors to MIN_MSG_SLOTS lifeline rows', () => {
  const doc: SeqDiagramV1 = {
    version: 1,
    kind: 'service-sequence',
    title: 'Sparse',
    grounded: { graphId: 'sparse' },
    nodes: [
      { id: 'a', label: 'a', kind: 'service', role: 'participant' },
      { id: 'b', label: 'b', kind: 'service', role: 'participant' },
    ],
    edges: [],
  };
  const sparse = renderSeqDiagramSvg(doc);
  const sparseH = Number(sparse.match(/viewBox="0 0 \d+ (\d+)"/)?.[1]);
  doc.edges = [
    { id: 'e1', from: 'a', to: 'b', family: 'http' },
    { id: 'e2', from: 'a', to: 'b', family: 'http' },
    { id: 'e3', from: 'a', to: 'b', family: 'http' },
    { id: 'e4', from: 'a', to: 'b', family: 'http' },
    { id: 'e5', from: 'a', to: 'b', family: 'http' },
    { id: 'e6', from: 'a', to: 'b', family: 'http' },
    { id: 'e7', from: 'a', to: 'b', family: 'http' },
  ];
  const dense = renderSeqDiagramSvg(doc);
  const denseH = Number(dense.match(/viewBox="0 0 \d+ (\d+)"/)?.[1]);
  assert.strictEqual(sparseH, 52 + 48 + 68 + 6 * 40 + 40);
  assert.ok(denseH > sparseH);
});

test('renderSeqDiagramSvg: service-sequence layout unchanged', () => {
  const doc = archGraphToSeqDiagram(loadTicketing(), { kind: 'service-sequence' });
  const svg = renderSeqDiagramSvg(doc);
  assert.match(svg, /stroke-dasharray="3 5"/);
  assert.doesNotMatch(svg, /FLOW · LANE 01/);
});

test('renderSeqDiagramSvg: layered flow cards show English title and subtitle', () => {
  const doc: SeqDiagramV1 = {
    version: 1,
    kind: 'service-flow',
    title: 'Detail cards',
    grounded: { graphId: 'detail' },
    layout: { engine: 'layered-flow' },
    nodes: [
      {
        id: 'svc:orders',
        label: 'orders',
        kind: 'service',
        detail: {
          whatItIs: 'Order service',
          whatItDoes: 'Persists order state',
        },
      },
      { id: 'svc:payments', label: 'payments', kind: 'service' },
    ],
    edges: [{ id: 'e1', from: 'svc:orders', to: 'svc:payments', family: 'http' }],
  };
  const svg = renderSeqDiagramSvg(doc);
  assert.match(svg, />Order service</);
  assert.match(svg, />Persists order state</);
  const titleTag = svg.match(/<text[^>]*>Order service<\/text>/)?.[0] ?? '';
  assert.doesNotMatch(titleTag, /spacingAndGlyphs/);
  assert.match(svg, />S</);
});

test('renderSeqDiagramSvg: long card titles use spacingAndGlyphs fit', () => {
  const doc: SeqDiagramV1 = {
    version: 1,
    kind: 'service-flow',
    title: 'Long titles',
    grounded: { graphId: 'long' },
    layout: { engine: 'layered-flow' },
    nodes: [
      {
        id: 'svc:orders',
        label: 'orders',
        kind: 'service',
        detail: {
          whatItIs: 'Order fulfillment and checkout orchestration service',
        },
      },
      { id: 'svc:payments', label: 'payments', kind: 'service' },
    ],
    edges: [{ id: 'e1', from: 'svc:orders', to: 'svc:payments', family: 'http' }],
  };
  const svg = renderSeqDiagramSvg(doc);
  assert.match(svg, /spacingAndGlyphs/);
  assert.match(svg, /…/);
});

test('renderSeqDiagramSvg: svg width and height match viewBox', () => {
  const doc: SeqDiagramV1 = {
    version: 1,
    kind: 'service-flow',
    title: 'Dims',
    grounded: { graphId: 'dims' },
    layout: { engine: 'layered-flow' },
    nodes: [
      { id: 'svc:a', label: 'a', kind: 'service' },
      { id: 'svc:b', label: 'b', kind: 'service' },
    ],
    edges: [{ id: 'e1', from: 'svc:a', to: 'svc:b', family: 'http' }],
  };
  const svg = renderSeqDiagramSvg(doc);
  const root = svg.match(/^<svg[^>]+>/)?.[0] ?? '';
  const m = root.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)" width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/);
  assert.ok(m, 'root svg viewBox and explicit width/height required');
  assert.strictEqual(m![1], m![3]);
  assert.strictEqual(m![2], m![4]);
  assert.doesNotMatch(root, /width="100%"/);
});

test('renderSeqDiagramSvg: expanded rollup reveals hidden node ids', () => {
  const nodes = Array.from({ length: 22 }, (_, i) => ({
    id: `svc:n${i}`,
    label: `n${i}`,
    kind: 'service' as const,
  }));
  const doc: SeqDiagramV1 = {
    version: 1,
    kind: 'service-flow',
    title: 'Rollup',
    grounded: { graphId: 'rollup' },
    layout: { engine: 'layered-flow' },
    nodes,
    edges: [{ id: 'e1', from: 'svc:n0', to: 'svc:n1', family: 'http' }],
    primaryNodeIds: nodes.slice(0, 20).map((n) => n.id),
  };
  const collapsed = renderSeqDiagramSvg(doc);
  assert.match(collapsed, /data-rollup="true"/);
  const expanded = renderSeqDiagramSvg(docWithExpandedRollup(doc));
  assert.doesNotMatch(expanded, /data-rollup="true"/);
  assert.match(expanded, />n21</);
});
