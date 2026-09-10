import assert from 'node:assert';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanRepo } from '../scan.js';
import { findNegatives } from '../moat/negatives.js';
import type { ArchGraph } from '@sequence/schema';

/**
 * THE FOUR NEGATIVES — the questions a scan can answer and never was asked.
 *
 * Everything the engine computes is a POSITIVE: this calls that, this reads
 * that table. The useful architectural questions are the other shape — what is
 * here that nothing uses, and what is missing that should not be. The scan
 * already had the material for all four and threw it away:
 *
 *   1. a table read by a service that does not own it — the coupling nobody
 *      declared, and the reason a schema change breaks a service that was never
 *      mentioned in the ticket;
 *   2. a route with no caller — needs the route INVENTORY, which the joiner
 *      built to match callers and then dropped, so a route nothing calls left
 *      no trace at all;
 *   3. a topic nobody consumes — a publisher writing into the void;
 *   4. a product file with no test anywhere in its reverse closure — not
 *      "untested file", which is a coverage tool's job, but "nothing that tests
 *      anything reaches this", which is a graph question.
 *
 * EVERY NEGATIVE IS A CLAIM ABOUT ABSENCE, which is the most dangerous kind to
 * get wrong: a false positive here tells someone to delete a route that is
 * live. So each one is reported with the evidence that PROVES the absence — the
 * registration site for a route, the accessing file for a table — and the
 * module refuses to answer at all when the input cannot support the question
 * (see the `routes: undefined` case below).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOPFRONT = path.resolve(here, '..', '..', 'test', 'fixtures', 'shopfront');

function g(over: Partial<ArchGraph>): ArchGraph {
  return {
    version: 1,
    mode: 'scan',
    scannedAt: '2026-08-22T00:00:00.000Z',
    repoRoot: '/repo',
    repoName: 'fixture',
    nodes: [],
    edges: [],
    warnings: [],
    ...over,
  } as ArchGraph;
}

/* ═══ 1. a table read by a service that does not own it ═══════════════════ */

test('a table read by a non-owner is reported, with the file that reads it', () => {
  const graph = g({
    nodes: [
      { id: 'svc:orders', label: 'orders', kind: 'service' },
      { id: 'svc:billing', label: 'billing', kind: 'service' },
      { id: 'ds:pg', label: 'pg', kind: 'datastore' },
      { id: 'file:orders/a.ts', label: 'a.ts', kind: 'file', path: 'orders/a.ts', parentId: 'svc:orders' },
      { id: 'file:billing/b.ts', label: 'b.ts', kind: 'file', path: 'billing/b.ts', parentId: 'svc:billing' },
    ],
    edges: [
      /* orders writes `orders` — it owns the table. */
      { id: 'e1', srcId: 'file:orders/a.ts', dstId: 'ds:pg', kind: 'db_write', confidence: 1, origin: 'deterministic', detail: { table: 'orders' } },
      /* billing READS it. Nothing declares that relationship anywhere. */
      { id: 'e2', srcId: 'file:billing/b.ts', dstId: 'ds:pg', kind: 'db_read', confidence: 1, origin: 'deterministic', detail: { table: 'orders' } },
    ],
  } as unknown as Partial<ArchGraph>);

  const n = findNegatives(graph);
  assert.strictEqual(n.foreignTableReads.length, 1);
  const hit = n.foreignTableReads[0]!;
  assert.strictEqual(hit.table, 'orders');
  assert.strictEqual(hit.reader, 'billing');
  assert.strictEqual(hit.owner, 'orders');
  /* The evidence, because this is a claim about a coupling nobody declared and
     "billing reads orders" is not actionable without the file. */
  assert.strictEqual(hit.file, 'billing/b.ts');
});

test('a service reading its OWN table is not a finding', () => {
  const graph = g({
    nodes: [
      { id: 'svc:orders', label: 'orders', kind: 'service' },
      { id: 'ds:pg', label: 'pg', kind: 'datastore' },
      { id: 'file:orders/a.ts', label: 'a.ts', kind: 'file', path: 'orders/a.ts', parentId: 'svc:orders' },
    ],
    edges: [
      { id: 'e1', srcId: 'file:orders/a.ts', dstId: 'ds:pg', kind: 'db_write', confidence: 1, origin: 'deterministic', detail: { table: 'orders' } },
      { id: 'e2', srcId: 'file:orders/a.ts', dstId: 'ds:pg', kind: 'db_read', confidence: 1, origin: 'deterministic', detail: { table: 'orders' } },
    ],
  } as unknown as Partial<ArchGraph>);
  assert.deepStrictEqual(findNegatives(graph).foreignTableReads, []);
});

test('a table nobody writes has no owner, so a read of it is not called foreign', () => {
  /* A read-only reference table, or a table written by something outside the
     repo. Naming an owner here would be a guess, and the whole finding is
     "someone other than the OWNER reads this" — with no owner there is no
     finding, and inventing one would accuse a service at random. */
  const graph = g({
    nodes: [
      { id: 'svc:billing', label: 'billing', kind: 'service' },
      { id: 'ds:pg', label: 'pg', kind: 'datastore' },
      { id: 'file:billing/b.ts', label: 'b.ts', kind: 'file', path: 'billing/b.ts', parentId: 'svc:billing' },
    ],
    edges: [
      { id: 'e1', srcId: 'file:billing/b.ts', dstId: 'ds:pg', kind: 'db_read', confidence: 1, origin: 'deterministic', detail: { table: 'countries' } },
    ],
  } as unknown as Partial<ArchGraph>);
  assert.deepStrictEqual(findNegatives(graph).foreignTableReads, []);
});

test('two writers means shared ownership, not a violation', () => {
  /* When two services both write a table, neither is trespassing on the other.
     That may still be a design smell, but it is a DIFFERENT finding and saying
     it with this one's words would be wrong. */
  const graph = g({
    nodes: [
      { id: 'svc:a', label: 'a', kind: 'service' },
      { id: 'svc:b', label: 'b', kind: 'service' },
      { id: 'ds:pg', label: 'pg', kind: 'datastore' },
      { id: 'file:a/x.ts', label: 'x.ts', kind: 'file', path: 'a/x.ts', parentId: 'svc:a' },
      { id: 'file:b/y.ts', label: 'y.ts', kind: 'file', path: 'b/y.ts', parentId: 'svc:b' },
    ],
    edges: [
      { id: 'e1', srcId: 'file:a/x.ts', dstId: 'ds:pg', kind: 'db_write', confidence: 1, origin: 'deterministic', detail: { table: 't' } },
      { id: 'e2', srcId: 'file:b/y.ts', dstId: 'ds:pg', kind: 'db_write', confidence: 1, origin: 'deterministic', detail: { table: 't' } },
      { id: 'e3', srcId: 'file:b/y.ts', dstId: 'ds:pg', kind: 'db_read', confidence: 1, origin: 'deterministic', detail: { table: 't' } },
    ],
  } as unknown as Partial<ArchGraph>);
  assert.deepStrictEqual(findNegatives(graph).foreignTableReads, []);
});

/* ═══ 2. a route with no caller ═══════════════════════════════════════════ */

test('a route nothing calls is reported, with its registration site', () => {
  const graph = g({
    nodes: [
      { id: 'svc:api', label: 'api', kind: 'service' },
      { id: 'file:api/routes.ts', label: 'routes.ts', kind: 'file', path: 'api/routes.ts', parentId: 'svc:api' },
      { id: 'svc:web', label: 'web', kind: 'service' },
      { id: 'file:web/call.ts', label: 'call.ts', kind: 'file', path: 'web/call.ts', parentId: 'svc:web' },
    ],
    edges: [
      {
        id: 'e1', srcId: 'file:web/call.ts', dstId: 'file:api/routes.ts', kind: 'http',
        confidence: 0.95, origin: 'deterministic',
        detail: { matchedRoute: 'GET /orders' },
      },
    ],
    routes: [
      { service: 'api', method: 'GET', path: '/orders', file: 'api/routes.ts', line: 10 },
      { service: 'api', method: 'DELETE', path: '/orders/{id}', file: 'api/routes.ts', line: 20 },
    ],
  } as unknown as Partial<ArchGraph>);

  const n = findNegatives(graph);
  assert.strictEqual(n.uncalledRoutes.length, 1);
  const r = n.uncalledRoutes[0]!;
  assert.strictEqual(r.method, 'DELETE');
  assert.strictEqual(r.path, '/orders/{id}');
  /* file:line, because "you have a dead route" is not actionable and
     "api/routes.ts:20 is a dead route" is. */
  assert.strictEqual(r.file, 'api/routes.ts');
  assert.strictEqual(r.line, 20);

  /*
   * AND THE CAVEAT RIDES WITH IT. Measured on shopfront, 6 of 16 routes come
   * back uncalled and several are `/health` — endpoints a load balancer calls,
   * correctly reported as having no caller IN THIS REPOSITORY and absolutely
   * not dead code. A claim about absence that does not say what it could not
   * see is how someone deletes a live route on our say-so.
   */
  assert.match(n.uncalledRouteCaveat ?? '', /outside this repository/i);
});

test('no uncalled routes means no caveat — a warning about nothing is noise', () => {
  const graph = g({
    edges: [
      {
        id: 'e1', srcId: 'file:a', dstId: 'file:b', kind: 'http',
        confidence: 0.95, origin: 'deterministic', detail: { matchedRoute: 'GET /x' },
      },
    ],
    routes: [{ service: 's', method: 'GET', path: '/x', file: 's/r.ts', line: 1 }],
  } as unknown as Partial<ArchGraph>);
  const n = findNegatives(graph);
  assert.deepStrictEqual(n.uncalledRoutes, []);
  assert.strictEqual(n.uncalledRouteCaveat, undefined);
});

test('a route with no inventory is NOT reported as uncalled', () => {
  /*
   * THE MOST IMPORTANT TEST HERE. A graph from before the inventory existed, or
   * a design-mode graph, has `routes: undefined`. Treating that as "no routes"
   * would report every route in the repository as dead — a claim about absence
   * made from absent data, which is exactly how a tool earns the reputation of
   * being confidently wrong. Absent and empty are different, and the result
   * says which it had.
   */
  const withoutInventory = g({ nodes: [], edges: [] });
  const n = findNegatives(withoutInventory);
  assert.deepStrictEqual(n.uncalledRoutes, []);
  assert.strictEqual(n.routeInventory, 'absent');

  const withEmptyInventory = g({ routes: [] } as Partial<ArchGraph>);
  assert.strictEqual(findNegatives(withEmptyInventory).routeInventory, 'empty');
});

test('a prefix route is matched by a call beneath it', () => {
  /* The Go subtree case. `/shipments/` is registered as a prefix and the caller
     asks for `/shipments/42`; reporting the registration as uncalled would be a
     false positive on the exact shape the joiner was just taught to match. */
  const graph = g({
    nodes: [{ id: 'svc:s', label: 's', kind: 'service' }],
    edges: [
      {
        id: 'e1', srcId: 'file:x', dstId: 'file:y', kind: 'http',
        confidence: 0.95, origin: 'deterministic',
        detail: { matchedRoute: 'GET /shipments/' },
      },
    ],
    routes: [{ service: 's', method: 'GET', path: '/shipments/', file: 's/main.go', line: 53, prefix: true }],
  } as unknown as Partial<ArchGraph>);
  assert.deepStrictEqual(findNegatives(graph).uncalledRoutes, []);
});

/* ═══ 3. a topic nobody consumes ══════════════════════════════════════════ */

test('a topic that is published and never consumed is reported', () => {
  const graph = g({
    nodes: [
      { id: 'topic:order.created', label: 'order.created', kind: 'topic' },
      { id: 'topic:order.shipped', label: 'order.shipped', kind: 'topic' },
      { id: 'file:a.ts', label: 'a.ts', kind: 'file', path: 'a.ts' },
    ],
    edges: [
      { id: 'e1', srcId: 'file:a.ts', dstId: 'topic:order.created', kind: 'queue_publish', confidence: 1, origin: 'deterministic' },
      { id: 'e2', srcId: 'file:a.ts', dstId: 'topic:order.shipped', kind: 'queue_publish', confidence: 1, origin: 'deterministic' },
      { id: 'e3', srcId: 'file:a.ts', dstId: 'topic:order.created', kind: 'queue_consume', confidence: 1, origin: 'deterministic' },
    ],
  } as unknown as Partial<ArchGraph>);
  const n = findNegatives(graph);
  assert.deepStrictEqual(n.unconsumedTopics.map((t) => t.topic), ['order.shipped']);
});

test('a topic nobody publishes to is not reported as unconsumed', () => {
  /* A topic with no publisher is a different finding — probably an external
     producer — and reporting "nobody consumes it" would send the reader looking
     for a missing consumer that was never the problem. */
  const graph = g({
    nodes: [{ id: 'topic:t', label: 't', kind: 'topic' }],
    edges: [],
  } as unknown as Partial<ArchGraph>);
  assert.deepStrictEqual(findNegatives(graph).unconsumedTopics, []);
});

/* ═══ 4. product files no test reaches ════════════════════════════════════ */

test('a product file no test reaches, transitively, is reported', () => {
  const graph = g({
    nodes: [
      { id: 'file:src/a.ts', label: 'a.ts', kind: 'file', path: 'src/a.ts' },
      { id: 'file:src/b.ts', label: 'b.ts', kind: 'file', path: 'src/b.ts' },
      { id: 'file:src/lonely.ts', label: 'lonely.ts', kind: 'file', path: 'src/lonely.ts' },
      { id: 'file:src/a.test.ts', label: 'a.test.ts', kind: 'file', path: 'src/a.test.ts' },
    ],
    edges: [
      /* the test imports a, and a imports b — so b IS reached, transitively. */
      { id: 'e1', srcId: 'file:src/a.test.ts', dstId: 'file:src/a.ts', kind: 'import', confidence: 1, origin: 'deterministic' },
      { id: 'e2', srcId: 'file:src/a.ts', dstId: 'file:src/b.ts', kind: 'import', confidence: 1, origin: 'deterministic' },
    ],
  } as unknown as Partial<ArchGraph>);

  const n = findNegatives(graph);
  /* `lonely.ts` only. Reporting `b.ts` would be the naive answer — it has no
     test file NAMED after it — and it is wrong: a test does reach it. */
  assert.deepStrictEqual(n.untestedFiles.map((f) => f.path), ['src/lonely.ts']);
});

test('the test files themselves are never reported as untested', () => {
  const graph = g({
    nodes: [{ id: 'file:x.test.ts', label: 'x.test.ts', kind: 'file', path: 'x.test.ts' }],
    edges: [],
  } as unknown as Partial<ArchGraph>);
  assert.deepStrictEqual(findNegatives(graph).untestedFiles, []);
});

test('a repo with no tests at all reports that, rather than every file', () => {
  /*
   * The absence guard again. "All 300 of your files are untested" is technically
   * true and useless; the finding a person can act on is "this repository has no
   * tests", said once.
   */
  const graph = g({
    nodes: [
      { id: 'file:a.ts', label: 'a.ts', kind: 'file', path: 'a.ts' },
      { id: 'file:b.ts', label: 'b.ts', kind: 'file', path: 'b.ts' },
    ],
    edges: [],
  } as unknown as Partial<ArchGraph>);
  const n = findNegatives(graph);
  assert.deepStrictEqual(n.untestedFiles, []);
  assert.strictEqual(n.testCoverage, 'no-tests');
});

/* ═══ on the real fixture ═════════════════════════════════════════════════ */

test('runs on a real scan and every finding carries real evidence', async () => {
  const graph = await scanRepo(SHOPFRONT, {});
  const n = findNegatives(graph);

  /* The inventory reached the graph — the whole point of retaining it. */
  assert.notStrictEqual(n.routeInventory, 'absent');
  assert.ok((graph.routes ?? []).length > 0, 'shopfront registers routes');

  for (const r of n.uncalledRoutes) {
    assert.ok(r.file.length > 0 && r.line > 0, 'a dead-route claim names where to look');
    assert.ok(
      (graph.routes ?? []).some((x) => x.path === r.path && x.method === r.method),
      'every reported route came from the inventory, not from a guess',
    );
  }
  for (const t of n.foreignTableReads) {
    assert.notStrictEqual(t.reader, t.owner, 'a foreign read is by definition not the owner');
  }
});

test('is pure — two runs over one graph agree, and the graph is not mutated', async () => {
  const graph = await scanRepo(SHOPFRONT, {});
  const snapshot = JSON.stringify(graph);
  const a = findNegatives(graph);
  const b = findNegatives(graph);
  assert.deepStrictEqual(a, b);
  assert.strictEqual(JSON.stringify(graph), snapshot);
});
