import assert from 'node:assert/strict';
import test from 'node:test';

import { buildConceptChart, conceptHopSays, conceptHopSentence } from '../server/conceptChart.js';

/**
 * SEQUENCE_TEACH_CONCEPT_STEPS=1: the concept chart labels each arrow with its
 * scanned edge kind and gets steps, inbound first, saying what travels. Off, the
 * chart is byte for byte what it was.
 */

const GRAPH = {
  nodes: [
    { id: 'a', label: 'routes.py', path: 'orders/routes.py' },
    { id: 'b', label: 'db.py', path: 'orders/db.py' },
    { id: 'c', label: 'orders.ts', path: 'gateway/orders.ts' },
  ],
  edges: [
    { srcId: 'a', dstId: 'b', kind: 'db_access', detail: { table: 'orders' } },
    { srcId: 'c', dstId: 'a', kind: 'http', detail: { method: 'GET', pathPattern: '/orders/*' } },
  ],
} as never;

function withFlag<T>(value: string | undefined, run: () => T): T {
  const before = process.env.SEQUENCE_TEACH_CONCEPT_STEPS;
  if (value === undefined) delete process.env.SEQUENCE_TEACH_CONCEPT_STEPS;
  else process.env.SEQUENCE_TEACH_CONCEPT_STEPS = value;
  try {
    return run();
  } finally {
    if (before === undefined) delete process.env.SEQUENCE_TEACH_CONCEPT_STEPS;
    else process.env.SEQUENCE_TEACH_CONCEPT_STEPS = before;
  }
}

test('=0: no link labels, no steps and the old caption, as before', () => {
  const chart = withFlag('0', () => buildConceptChart(GRAPH, { title: 'routes', nodeId: 'a' })!);
  assert.ok(chart.links!.every((l) => l.label === undefined));
  assert.equal(chart.steps, undefined);
  assert.equal(chart.caption, 'routes.py and what it connects to, from the scanned graph.');
});

test('unset: the caption mode is the default', () => {
  const chart = withFlag(undefined, () => buildConceptChart(GRAPH, { title: 'routes', nodeId: 'a' })!);
  assert.ok(chart.caption!.startsWith('What travels here: '), chart.caption);
  assert.equal(chart.steps, undefined);
});

test('flag on: arrows carry the edge kind and steps run in, then out, in the scan\'s words', () => {
  const chart = withFlag('1', () => buildConceptChart(GRAPH, { title: 'routes', nodeId: 'a' })!);
  assert.deepEqual(
    chart.links!.map((l) => `${l.from}>${l.to}:${l.label}`).sort(),
    ['a>b:db_access', 'c>a:http'],
  );
  assert.deepEqual(chart.steps, [
    { from: 'c', to: 'a', says: 'http: GET /orders/*' },
    { from: 'a', to: 'b', says: 'db_access: orders' },
  ]);
});

test('an edge with no detail says only its kind', () => {
  assert.equal(conceptHopSays({ kind: 'import' } as never), 'import');
});

test('caption mode: no labels and no steps; the non-import hops are written into the caption', () => {
  const chart = withFlag('caption', () => buildConceptChart(GRAPH, { title: 'routes', nodeId: 'a' })!);
  assert.ok(chart.links!.every((l) => l.label === undefined));
  assert.equal(chart.steps, undefined);
  assert.ok(chart.caption!.startsWith("What travels here: "), chart.caption);
  assert.ok(chart.caption!.includes("orders.ts calls routes.py (GET /orders/*)."), chart.caption);
  assert.ok(chart.caption!.includes("routes.py uses db.py (orders)."), chart.caption);
});

test('an import hop writes no caption sentence', () => {
  assert.equal(conceptHopSentence('a', 'b', { kind: 'import' } as never), undefined);
});
