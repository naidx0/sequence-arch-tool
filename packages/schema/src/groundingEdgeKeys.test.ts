import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groundingEdgeKeys, validateChart } from './index.js';

/*
 * A queue consumer's scan edge points at the topic (the subscribe call lives
 * in the consumer), but data flows from the topic to the consumer, and that is
 * how people and models draw it. Only that edge kind reads both ways.
 */
const EDGES = [
  { srcId: 'file:events.py', dstId: 'topic:order.created', kind: 'queue_publish' },
  { srcId: 'file:worker.py', dstId: 'topic:order.created', kind: 'queue_consume' },
  { srcId: 'file:gateway.ts', dstId: 'file:routes.py', kind: 'http' },
];
const NODES = new Set(['file:events.py', 'file:worker.py', 'file:gateway.ts', 'file:routes.py', 'topic:order.created']);

function chart(from: string, to: string) {
  return {
    kind: 'data-flow',
    title: 't',
    items: [
      { id: 'a', label: 'a', nodeId: from },
      { id: 'b', label: 'b', nodeId: to },
    ],
    links: [{ from: 'a', to: 'b' }],
  };
}

test('every scanned edge is kept in its own direction', () => {
  const keys = groundingEdgeKeys(EDGES);
  for (const e of EDGES) assert.ok(keys.has(`${e.srcId}>${e.dstId}`));
});

test('a subscription may be drawn in data-flow direction, topic -> consumer', () => {
  const keys = groundingEdgeKeys(EDGES);
  assert.equal(validateChart(chart('topic:order.created', 'file:worker.py'), NODES, keys).ok, true);
  /* The old edge set refused exactly this drawing. */
  const old = new Set(EDGES.map((e) => `${e.srcId}>${e.dstId}`));
  assert.equal(validateChart(chart('topic:order.created', 'file:worker.py'), NODES, old).ok, false);
});

test('no other kind reads backwards: publish, http', () => {
  const keys = groundingEdgeKeys(EDGES);
  assert.equal(validateChart(chart('topic:order.created', 'file:events.py'), NODES, keys).ok, false);
  assert.equal(validateChart(chart('file:routes.py', 'file:gateway.ts'), NODES, keys).ok, false);
  assert.equal(keys.size, 4);
});
