import assert from 'node:assert/strict';
import { test } from 'node:test';

import { diffTruth, heatTruth, historyAnswer, historyQuestions, lineCountSeen, rankSeen, truthSeen } from './lib/historyAb.mjs';

/* The registered Diff and Hotspots scorer's pure half (lab/log.md,
   2026-10-05): truth, questions, answers, each with a case that must fail. */

const graph = {
  nodes: [
    { id: 'a', kind: 'service', label: 'a', path: 'a' },
    { id: 'b', kind: 'service', label: 'b', path: 'b' },
    { id: 'c', kind: 'service', label: 'c', path: 'c' },
    { id: 'fa', kind: 'file', path: 'a/x.ts', parentId: 'a', meta: { pageRank: 0.5 } },
    { id: 'fb', kind: 'file', path: 'b/y.ts', parentId: 'b', meta: { pageRank: 0.2 } },
    { id: 'fc', kind: 'file', path: 'c/z.ts', parentId: 'c', meta: { pageRank: 0.9 } },
  ],
  edges: [
    { srcId: 'fa', dstId: 'b', evidence: [{ file: 'a/x.ts', line: 1 }] },
    { srcId: 'fb', dstId: 'c', evidence: [{ file: 'b/y.ts', line: 1 }] },
  ],
};
const boxes = ['a', 'b', 'c'];
const pairs = ['a->b', 'b->c'];
const label = (id) => id;

test('diff truth: changed boxes (deleted files by folder) and touched lines', () => {
  const d = diffTruth(graph, boxes, pairs, [{ path: 'a/x.ts', status: 'modified' }, { path: 'c/gone.ts', status: 'deleted' }]);
  assert.deepEqual([...d.changedBoxes].sort(), ['a', 'c']);
  assert.deepEqual([...d.touched], ['a->b']);
});

test('heat truth and the registered questions', () => {
  const heat = heatTruth(graph, boxes, { 'a/x.ts': 4, 'c/z.ts': 1, 'b/y.ts': 0 });
  assert.deepEqual([...heat.entries()].sort(), [['a', 2], ['c', 0.9]]);
  const d = diffTruth(graph, boxes, pairs, [{ path: 'a/x.ts', status: 'modified' }]);
  const qs = historyQuestions(boxes, d, heat, label);
  assert.deepEqual(qs.map((q) => q.q), ['D1', 'D1', 'D1', 'D2', 'D3', 'H1', 'H2', 'H3']);
  const t = truthSeen(d, heat, label);
  assert.equal(historyAnswer({ q: 'H1' }, t), 'a');
  assert.equal(historyAnswer({ q: 'H3', a: 'a', b: 'c' }, t), 'yes');
  assert.equal(historyAnswer({ q: 'D3', x: 'a' }, t), 'a->b');
});

test('readers: painted ranks agree with the truth; the line-count proxy and an empty Diff do not', () => {
  const heat = heatTruth(graph, boxes, { 'a/x.ts': 4, 'c/z.ts': 1 });
  const d = diffTruth(graph, boxes, pairs, [{ path: 'a/x.ts', status: 'modified' }]);
  const t = truthSeen(d, heat, label);
  const ranks = rankSeen(new Map([['a', 1], ['c', 2]]));
  for (const q of [{ q: 'H1' }, { q: 'H2' }, { q: 'H3', a: 'a', b: 'c' }, { q: 'H3', a: 'c', b: 'a' }]) assert.equal(historyAnswer(q, ranks), historyAnswer(q, t));
  const proxy = lineCountSeen(boxes, pairs, label);
  assert.equal(historyAnswer({ q: 'H1' }, proxy), 'b'); // b has two lines; the truth is a
  assert.notEqual(historyAnswer({ q: 'H1' }, proxy), historyAnswer({ q: 'H1' }, t));
  const empty = { changed: new Set(), touched: new Set() };
  assert.equal(historyAnswer({ q: 'D1', x: 'a' }, empty), 'no');
  assert.notEqual(historyAnswer({ q: 'D2' }, empty), historyAnswer({ q: 'D2' }, t));
});
