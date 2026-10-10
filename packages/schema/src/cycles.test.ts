import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCycles } from './cycles.js';
import type { ImpactLink } from './impact.js';
import type { RiskNode } from './risks.js';

const n = (id: string, label = id, kind: RiskNode['kind'] = 'service'): RiskNode => ({ id, label, kind });
const e = (srcId: string, dstId: string): ImpactLink => ({ srcId, dstId });

test('computeCycles — a clean DAG has no cycles', () => {
  const nodes = [n('a'), n('b'), n('c')];
  const links = [e('a', 'b'), e('b', 'c')];
  assert.deepStrictEqual(computeCycles(links, nodes), []);
});

test('computeCycles — detects a 2-node cycle (A depends on B, B depends on A)', () => {
  const cycles = computeCycles([e('a', 'b'), e('b', 'a')], [n('a'), n('b')]);
  assert.strictEqual(cycles.length, 1);
  assert.strictEqual(cycles[0].size, 2);
  assert.deepStrictEqual(cycles[0].nodes.slice().sort(), ['a', 'b']);
  assert.match(cycles[0].reason, /circular dependency/i);
});

test('computeCycles — detects a 3-node cycle A→B→C→A and includes only the cyclic nodes', () => {
  // d hangs off the cycle (c→d) but is not part of it.
  const nodes = [n('a'), n('b'), n('c'), n('d')];
  const links = [e('a', 'b'), e('b', 'c'), e('c', 'a'), e('c', 'd')];
  const cycles = computeCycles(links, nodes);
  assert.strictEqual(cycles.length, 1);
  assert.deepStrictEqual(cycles[0].nodes, ['a', 'b', 'c']); // sorted by label
  assert.strictEqual(cycles[0].size, 3);
});

test('computeCycles — finds two disjoint cycles', () => {
  const nodes = [n('a'), n('b'), n('x'), n('y')];
  const links = [e('a', 'b'), e('b', 'a'), e('x', 'y'), e('y', 'x')];
  const cycles = computeCycles(links, nodes);
  assert.strictEqual(cycles.length, 2);
  assert.deepStrictEqual(cycles.map((c) => c.nodes).flat().sort(), ['a', 'b', 'x', 'y']);
});

test('computeCycles — reports a self-dependency (A→A) as a size-1 cycle', () => {
  const cycles = computeCycles([e('a', 'a')], [n('a')]);
  assert.strictEqual(cycles.length, 1);
  assert.strictEqual(cycles[0].size, 1);
  assert.match(cycles[0].reason, /itself/i);
});

test('computeCycles — does not double-report a self-loop inside a larger cycle', () => {
  // a↔b cycle, and a also self-loops. Only the 2-cycle is reported.
  const cycles = computeCycles([e('a', 'b'), e('b', 'a'), e('a', 'a')], [n('a'), n('b')]);
  assert.strictEqual(cycles.length, 1);
  assert.strictEqual(cycles[0].size, 2);
});

test('computeCycles — ignores edges touching unknown or repo ids (never fabricates a component)', () => {
  const nodes = [n('a'), n('b'), { id: 'repo', label: 'repo', kind: 'repo' as const }];
  // a→ghost→a would be a cycle only if ghost were a real node; it is not.
  const links = [e('a', 'ghost'), e('ghost', 'a'), e('a', 'repo'), e('repo', 'a')];
  assert.deepStrictEqual(computeCycles(links, nodes), []);
});

test('computeCycles — orders a datastore-involving cycle reason toward failover language', () => {
  const cycles = computeCycles(
    [e('svc', 'db'), e('db', 'svc')],
    [n('svc', 'svc', 'service'), n('db', 'db', 'datastore')],
  );
  assert.match(cycles[0].reason, /failed over/i);
});

test('computeCycles — is total: empty inputs and malformed edges never throw', () => {
  assert.deepStrictEqual(computeCycles([], []), []);
  assert.deepStrictEqual(
    computeCycles([{ srcId: 'a' } as ImpactLink, null as unknown as ImpactLink], [n('a')]),
    [],
  );
  assert.deepStrictEqual(computeCycles([e('a', 'b')], []), []);
});

test('computeCycles — sorts cycles by size (largest first)', () => {
  const nodes = [n('a'), n('b'), n('c'), n('x'), n('y')];
  const links = [e('a', 'b'), e('b', 'c'), e('c', 'a'), e('x', 'y'), e('y', 'x')];
  const cycles = computeCycles(links, nodes);
  assert.deepStrictEqual(cycles.map((c) => c.size), [3, 2]);
});
