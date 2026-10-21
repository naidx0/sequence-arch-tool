import assert from 'node:assert/strict';
import { test } from 'node:test';

import { answer, hops, liftedPairs, mcnemar, questions } from './board-views-ab.mjs';

/* The registered scorer's pure half (lab/log.md, 2026-10-05): the truth, the
   generated questions, the answers and the McNemar test, each with a case that
   must fail it. */

const graph = {
  nodes: [
    { id: 'a' },
    { id: 'b' },
    { id: 'c' },
    { id: 'a1', parentId: 'a' },
    { id: 'f', parentId: 'a1' },
  ],
  edges: [
    { srcId: 'f', dstId: 'b', kind: 'import' },
    { srcId: 'b', dstId: 'c', kind: 'http' },
    { srcId: 'c', dstId: 'b', kind: 'http' },
    { srcId: 'f', dstId: 'a', kind: 'import' },
  ],
};

test('truth lifts every edge, imports included, to the deepest drawn box; nesting pairs are dropped', () => {
  assert.deepEqual([...liftedPairs(graph, ['a', 'b', 'c'])].sort(), ['a->b', 'b->c', 'c->b']);
  assert.deepEqual([...liftedPairs(graph, ['a', 'a1', 'b', 'c'])].sort(), ['a1->b', 'b->c', 'c->b']);
});

test('questions are derived from the truth: Q1/Q2 per box with an edge, Q3 per joined pair, Q4 far and none', () => {
  const truth = liftedPairs(graph, ['a', 'b', 'c']);
  const qs = questions(['a', 'b', 'c'], truth);
  assert.deepEqual(qs.filter((q) => q.q === 'Q1').map((q) => q.x), ['a', 'b', 'c']);
  assert.deepEqual(qs.filter((q) => q.q === 'Q2').map((q) => q.x), ['b', 'c']);
  assert.deepEqual(qs.filter((q) => q.q === 'Q3').map((q) => `${q.a}|${q.b}`), ['a|b', 'b|c']);
  assert.deepEqual(qs.filter((q) => q.q === 'Q4').map((q) => `${q.a}>${q.b}`), ['a>c', 'b>a', 'c>a']);
});

test('answers: sets, mutual yes/no, hop counts and none; a missing pair changes the answer', () => {
  const truth = liftedPairs(graph, ['a', 'b', 'c']);
  assert.equal(answer({ q: 'Q1', x: 'a' }, truth), 'b');
  assert.equal(answer({ q: 'Q3', a: 'b', b: 'c' }, truth), 'yes');
  assert.equal(answer({ q: 'Q4', a: 'a', b: 'c' }, truth), '2');
  assert.equal(answer({ q: 'Q4', a: 'c', b: 'a' }, truth), 'none');
  const missing = new Set([...truth].filter((k) => k !== 'c->b'));
  assert.equal(answer({ q: 'Q3', a: 'b', b: 'c' }, missing), 'no');
  assert.equal(hops(missing, 'c', 'b'), null);
});

test('exact McNemar: 6 to 0 is p = 0.03125; 5 to 0 is not below 0.05; ties are 1', () => {
  assert.equal(mcnemar(6, 0), 0.03125);
  assert.equal(mcnemar(5, 0), 0.0625);
  assert.equal(mcnemar(3, 3), 1);
  assert.equal(mcnemar(0, 0), 1);
});
