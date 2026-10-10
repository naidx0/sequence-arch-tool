import test from 'node:test';
import assert from 'node:assert/strict';
import type { ArchEdge, ArchGraph, EdgeKind } from './index.js';
import { computeImpact, impactHighlight } from './impact.js';

/**
 * Dependency + failure-impact intelligence lock (vision.md §2 layer 2).
 *
 * These tests pin the EDGE-DIRECTION contract the whole feature rests on:
 * an edge `src -> dst` means "src depends on dst" (caller -> callee, exactly as
 * the analyzer emits and the shopfront ground-truth records `gateway -> orders`).
 * So `dependsOn` is the forward closure and `impactedBy` (blast radius) is the
 * reverse closure. The "DIRECTION LOCK" test below fails if those two are ever
 * transposed — the single bug that would make this feature actively lie.
 *
 * Fixture — a known dependency chain A -> B -> C with a branch B -> D and a
 * leaf datastore edge C -> store, plus an isolated node solo:
 *
 *      A ──▶ B ──▶ C ──▶ store
 *            └──▶ D
 *
 * Read as depends-on: A relies on B; B relies on C and D; C relies on store.
 * Read as blast radius: if C fails, B and A break (they depend on C, directly
 * or transitively); D and store do not.
 */

function edge(srcId: string, dstId: string, kind: EdgeKind = 'http'): ArchEdge {
  return {
    id: `${srcId}->${dstId}`,
    srcId,
    dstId,
    kind,
    confidence: 1,
    origin: 'deterministic',
    evidence: [{ file: 'f', line: 1, snippet: 's' }],
  };
}

const CHAIN: ArchEdge[] = [
  edge('A', 'B'),
  edge('B', 'C'),
  edge('B', 'D'),
  edge('C', 'store', 'db_access'),
];

test('computeImpact — root A: dependsOn = whole downstream, impactedBy = empty', () => {
  const r = computeImpact(CHAIN, 'A');
  assert.strictEqual(r.exists, true);
  assert.deepStrictEqual(r.dependsOnDirect, ['B']);
  assert.deepStrictEqual(r.dependsOn, ['B', 'C', 'D', 'store']);
  // A is a root — nothing points at it, so nothing breaks if it fails.
  assert.deepStrictEqual(r.impactedByDirect, []);
  assert.deepStrictEqual(r.impactedBy, []);
});

test('computeImpact — middle C: relies on store; if it fails, A and B break', () => {
  const r = computeImpact(CHAIN, 'C');
  assert.deepStrictEqual(r.dependsOnDirect, ['store']);
  assert.deepStrictEqual(r.dependsOn, ['store']);
  // Blast radius: B depends on C directly, A transitively (A -> B -> C).
  assert.deepStrictEqual(r.impactedByDirect, ['B']);
  assert.deepStrictEqual(r.impactedBy, ['A', 'B']);
  // D and store must NOT be in C's blast radius.
  assert.ok(!r.impactedBy.includes('D'));
  assert.ok(!r.impactedBy.includes('store'));
});

test('computeImpact — leaf store: depends on nothing; blast radius is everything upstream', () => {
  const r = computeImpact(CHAIN, 'store');
  // A pure sink — relies on nothing.
  assert.deepStrictEqual(r.dependsOn, []);
  assert.deepStrictEqual(r.dependsOnDirect, []);
  // If the datastore fails, C breaks directly; B and A transitively.
  assert.deepStrictEqual(r.impactedByDirect, ['C']);
  assert.deepStrictEqual(r.impactedBy, ['A', 'B', 'C']);
});

test('computeImpact — branch leaf D: relies on nothing; only its own upstream breaks (not C/store)', () => {
  const r = computeImpact(CHAIN, 'D');
  assert.deepStrictEqual(r.dependsOn, []);
  // B depends on D directly; A transitively (A -> B -> D). C/store are a
  // SIBLING branch off B and must NOT appear in D's blast radius.
  assert.deepStrictEqual(r.impactedByDirect, ['B']);
  assert.deepStrictEqual(r.impactedBy, ['A', 'B']);
  assert.ok(!r.impactedBy.includes('C'));
  assert.ok(!r.impactedBy.includes('store'));
});

/**
 * DIRECTION LOCK. This is the assertion the reviewer will attack: it fails if
 * dependsOn / impactedBy are ever swapped. With `gateway -> orders` meaning
 * "gateway depends on orders", orders' blast radius MUST include gateway
 * (orders failing breaks gateway) and orders must NOT list gateway as a thing
 * it depends on.
 */
test('computeImpact — DIRECTION LOCK: gateway -> orders ⇒ orders breaks gateway, not vice-versa', () => {
  const g = computeImpact([edge('gateway', 'orders')], 'orders');
  assert.deepStrictEqual(g.impactedBy, ['gateway']); // orders fails => gateway breaks
  assert.deepStrictEqual(g.dependsOn, []); // orders does not depend on gateway
  const caller = computeImpact([edge('gateway', 'orders')], 'gateway');
  assert.deepStrictEqual(caller.dependsOn, ['orders']); // gateway relies on orders
  assert.deepStrictEqual(caller.impactedBy, []); // nothing depends on the gateway here
});

test('computeImpact — missing / unknown node ⇒ empty result, exists=false, no throw', () => {
  const r = computeImpact(CHAIN, 'nope');
  assert.strictEqual(r.exists, false);
  assert.deepStrictEqual(r.dependsOn, []);
  assert.deepStrictEqual(r.impactedBy, []);
});

test('computeImpact — cycle A -> B -> C -> A terminates and returns the right closure', () => {
  const cyc: ArchEdge[] = [edge('A', 'B'), edge('B', 'C'), edge('C', 'A')];
  const r = computeImpact(cyc, 'A');
  // Whole cycle minus self, both directions.
  assert.deepStrictEqual(r.dependsOn, ['B', 'C']);
  assert.deepStrictEqual(r.impactedBy, ['B', 'C']);
  assert.ok(!r.dependsOn.includes('A')); // self excluded
});

test('computeImpact — self-loop A -> A never places A in its own sets', () => {
  const r = computeImpact([edge('A', 'A')], 'A');
  assert.strictEqual(r.exists, true);
  assert.deepStrictEqual(r.dependsOn, []);
  assert.deepStrictEqual(r.impactedBy, []);
});

test('computeImpact — empty edge list ⇒ empty everything', () => {
  const r = computeImpact([], 'A');
  assert.strictEqual(r.exists, false);
  assert.deepStrictEqual(r.dependsOn, []);
  assert.deepStrictEqual(r.impactedBy, []);
});

test('computeImpact — accepts a real ArchGraph edge array unchanged', () => {
  const graph: ArchGraph = {
    version: 1,
    scannedAt: '',
    repoRoot: '',
    repoName: 'x',
    nodes: [],
    edges: CHAIN,
    warnings: [],
  };
  const r = computeImpact(graph.edges, 'B');
  assert.deepStrictEqual(r.dependsOn, ['C', 'D', 'store']);
  assert.deepStrictEqual(r.impactedBy, ['A']);
});

test('impactHighlight — tints blast radius as impacted, dependencies as dependency, dims the rest', () => {
  const rendered = ['A', 'B', 'C', 'D', 'store', 'solo'];
  const hi = impactHighlight(computeImpact(CHAIN, 'C'), rendered);
  assert.strictEqual(hi.roles.get('C'), 'selected');
  // Blast radius (A, B) is impacted.
  assert.strictEqual(hi.roles.get('A'), 'impacted');
  assert.strictEqual(hi.roles.get('B'), 'impacted');
  // C relies on store => dependency tint.
  assert.strictEqual(hi.roles.get('store'), 'dependency');
  // D and the isolated node are neither ⇒ dimmed.
  assert.strictEqual(hi.roles.has('D'), false);
  assert.strictEqual(hi.dimmed.has('D'), true);
  assert.strictEqual(hi.dimmed.has('solo'), true);
});

test('impactHighlight — impacted wins over dependency in a cycle (blast radius must not be missed)', () => {
  const cyc: ArchEdge[] = [edge('A', 'B'), edge('B', 'A')];
  const hi = impactHighlight(computeImpact(cyc, 'A'), ['A', 'B']);
  // B both depends on A and is depended-on by A; the alarming role wins.
  assert.strictEqual(hi.roles.get('B'), 'impacted');
});
