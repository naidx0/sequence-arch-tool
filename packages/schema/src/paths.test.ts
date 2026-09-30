import assert from 'node:assert';
import { test } from 'node:test';

import { PATHS_DEFAULTS, pathsBetween } from './paths.js';
import type { ImpactLink } from './impact.js';

/**
 * THE ROUTE BETWEEN TWO NODES, WHICH NOTHING COULD ANSWER.
 *
 * `computeImpact` returns SETS — what depends on this, what this depends on.
 * Both are true and neither answers "how does the gateway reach postgres",
 * which is the question a person actually asks of an architecture diagram. A
 * grep for `pathsBetween|shortestPath|allPaths` across `packages/*` returned
 * nothing: every consumer returned a set.
 *
 * DIRECTION IS INHERITED FROM impact.ts AND IS NOT RE-DECIDED HERE. That module
 * states the law: `edge X -> Y ⇔ X depends on Y`. So a path from A to B is a
 * dependency chain — A needs B, through the nodes between. Transposing it would
 * silently answer the blast-radius question instead, which is the single defect
 * impact.ts calls the most important thing to get right.
 *
 * SIMPLE PATHS ONLY. A graph with a cycle has infinitely many walks between two
 * nodes; it has finitely many paths that visit no node twice. Enumerating walks
 * would not terminate, so the choice is forced — and it is stated rather than
 * discovered later by whoever wonders where their loop went.
 */

function links(...pairs: [string, string][]): ImpactLink[] {
  return pairs.map(([srcId, dstId]) => ({ srcId, dstId }));
}

/* gateway → orders → postgres, and a second, longer way round through billing. */
const DIAMOND = links(
  ['gateway', 'orders'],
  ['orders', 'postgres'],
  ['gateway', 'billing'],
  ['billing', 'orders'],
);

test('finds the route between two nodes, not a set of them', () => {
  const r = pathsBetween(DIAMOND, 'gateway', 'postgres');
  assert.deepStrictEqual(r.paths, [
    ['gateway', 'orders', 'postgres'],
    ['gateway', 'billing', 'orders', 'postgres'],
  ]);
  assert.strictEqual(r.truncated, false);
});

test('shortest first, then alphabetical — the order is total, not incidental', () => {
  /* Two routes of equal length. Without a tiebreak the order would depend on
     edge insertion order, and a caller rendering "the main path" would watch it
     change when someone reordered a detector's output. */
  const g = links(['a', 'm'], ['m', 'z'], ['a', 'b'], ['b', 'z']);
  const r = pathsBetween(g, 'a', 'z');
  assert.deepStrictEqual(r.paths, [
    ['a', 'b', 'z'],
    ['a', 'm', 'z'],
  ]);
});

test('a cycle on the route terminates and is not walked twice', () => {
  const g = links(['a', 'b'], ['b', 'c'], ['c', 'b'], ['c', 'd']);
  const r = pathsBetween(g, 'a', 'd');
  assert.deepStrictEqual(r.paths, [['a', 'b', 'c', 'd']]);
});

test('no route is an empty list, not an error and not a guess', () => {
  const r = pathsBetween(DIAMOND, 'postgres', 'gateway');
  /* The reverse direction genuinely has no route — postgres depends on nothing.
     This is the assertion that would fail if the adjacency were transposed. */
  assert.deepStrictEqual(r.paths, []);
  assert.strictEqual(r.truncated, false);
  assert.strictEqual(r.fromExists, true);
  assert.strictEqual(r.toExists, true);
});

test('an unknown node is reported as unknown rather than as "no route"', () => {
  const r = pathsBetween(DIAMOND, 'gateway', 'nope');
  assert.deepStrictEqual(r.paths, []);
  assert.strictEqual(r.fromExists, true);
  /*
   * "There is no path" and "I have never heard of that node" are different
   * answers, and a caller that renders the first for the second tells the user
   * their architecture is disconnected when they actually made a typo.
   */
  assert.strictEqual(r.toExists, false);
});

test('a node to itself is no path — a hop that goes nowhere is not a route', () => {
  const r = pathsBetween(DIAMOND, 'gateway', 'gateway');
  assert.deepStrictEqual(r.paths, []);
  /* Matching impact.ts, whose contract says a self-loop never places a node in
     its own result. Two modules disagreeing about this would be worse than
     either answer. */
  assert.strictEqual(r.fromExists, true);
  assert.strictEqual(r.toExists, true);
});

test('a self-loop on the source does not create a phantom route', () => {
  const g = links(['a', 'a'], ['a', 'b']);
  const r = pathsBetween(g, 'a', 'b');
  assert.deepStrictEqual(r.paths, [['a', 'b']]);
});

/* ═══ bounds, and saying so ═══════════════════════════════════════════════ */

test('the path count is capped, and a capped answer SAYS it is capped', () => {
  /* A fan of 50 distinct one-hop routes. */
  const g: ImpactLink[] = [];
  for (let i = 0; i < 50; i += 1) {
    g.push({ srcId: 'a', dstId: `m${i}` }, { srcId: `m${i}`, dstId: 'z' });
  }
  const r = pathsBetween(g, 'a', 'z', { maxPaths: 5 });
  assert.strictEqual(r.paths.length, 5);
  /*
   * THE HONESTY BIT. A truncated list returned as if complete is how a tool
   * tells a user there are five routes into their database when there are
   * fifty. The flag is not a nicety; it is the difference between a bounded
   * answer and a wrong one.
   */
  assert.strictEqual(r.truncated, true);
  assert.match(r.note ?? '', /more/i);
});

test('depth is capped, and a chain longer than the cap is reported not silently dropped', () => {
  const g: ImpactLink[] = [];
  for (let i = 0; i < 30; i += 1) g.push({ srcId: `n${i}`, dstId: `n${i + 1}` });
  const r = pathsBetween(g, 'n0', 'n30', { maxDepth: 5 });
  assert.deepStrictEqual(r.paths, []);
  assert.strictEqual(r.truncated, true);
  assert.match(r.note ?? '', /deep|depth|longer/i);
});

test('a complete answer never claims truncation', () => {
  const r = pathsBetween(DIAMOND, 'gateway', 'postgres', { maxPaths: 100, maxDepth: 100 });
  assert.strictEqual(r.truncated, false);
  assert.strictEqual(r.note, undefined);
});

test('the defaults are named, so a caller can state the bound it inherited', () => {
  assert.ok(PATHS_DEFAULTS.maxPaths > 0);
  assert.ok(PATHS_DEFAULTS.maxDepth > 0);
  assert.ok(PATHS_DEFAULTS.maxVisits > PATHS_DEFAULTS.maxPaths);
});

test('a pathological graph terminates on the visit budget and says so', () => {
  /* A dense 12-node graph: every node points at every later node. The number of
     simple paths is exponential, so this is the case where enumerating "all"
     paths is not a thing that finishes. */
  const g: ImpactLink[] = [];
  const n = 12;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) g.push({ srcId: `v${i}`, dstId: `v${j}` });
  }
  const started = Date.now();
  const r = pathsBetween(g, 'v0', `v${n - 1}`, { maxVisits: 500 });
  assert.ok(Date.now() - started < 2000, 'bounded work, not an exponential walk');
  assert.strictEqual(r.truncated, true);
  /* It still returns real paths — a budget that returned nothing would be a
     timeout wearing a result's clothes. */
  assert.ok(r.paths.length > 0);
  for (const p of r.paths) {
    assert.strictEqual(p[0], 'v0');
    assert.strictEqual(p[p.length - 1], `v${n - 1}`);
  }
});

test('is pure — the input links are never mutated or reordered', () => {
  const g = links(['a', 'b'], ['b', 'c']);
  const snapshot = JSON.stringify(g);
  pathsBetween(g, 'a', 'c');
  assert.strictEqual(JSON.stringify(g), snapshot);
});

test('duplicate links do not duplicate routes', () => {
  /* Two detectors reporting the same call is normal; it is one route. */
  const g = links(['a', 'b'], ['a', 'b'], ['b', 'c']);
  const r = pathsBetween(g, 'a', 'c');
  assert.deepStrictEqual(r.paths, [['a', 'b', 'c']]);
});
