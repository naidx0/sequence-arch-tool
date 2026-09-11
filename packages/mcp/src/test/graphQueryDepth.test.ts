/**
 * Transitive reach — the one order-of-magnitude win the graph actually has.
 *
 * `docs/research/v2-architecture-and-gaps.md` §5.3 B4 measured it: the full closure of
 * `web/src/state/store.ts` is 146 files at depth 4, **2,360 tokens in 1 call**, against
 * **6,786 tokens in 78 grep round trips for depth 2 alone**. Its note reads "Not
 * shipped" — `who_calls` had no depth parameter, so the only question a graph answers
 * that grep structurally cannot was the one question it could not be asked.
 *
 * It matters that the currency here is ROUND TRIPS, not tokens. The same research
 * found direct one-hop lookups are 1.15x-2.9x *worse* than a well-formed grep on
 * tokens, so "we use fewer tokens" is false for the shallow case and true only for
 * closure. This is the shape of question the product should be built around.
 *
 * The fixture below is the same two-service graph the sibling suite uses, which
 * already contains a genuine two-hop chain:
 *
 *     file:gateway/routes.ts --http--> file:orders/app.py --queue_publish--> topic:order.created
 *
 * so `who_calls order.created` at depth 1 must find only `app.py`, and at depth 2 must
 * also find `routes.ts` — labelled as the second hop, because a caller two steps away
 * is a different claim from a direct one and an agent must be able to tell them apart.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { queryNeighbours } from '../graphQuery.js';
import type { ArchGraph } from '@sequence/schema';

const graph = (): ArchGraph =>
  ({
    version: 1,
    repoRoot: '/r',
    repoName: 'r',
    nodes: [
      { id: 'repo', kind: 'repo', label: 'r' },
      { id: 'svc:gateway', kind: 'service', label: 'gateway', parentId: 'repo', path: 'gateway' },
      { id: 'svc:orders', kind: 'service', label: 'orders', parentId: 'repo', path: 'orders' },
      { id: 'file:gateway/routes.ts', kind: 'file', label: 'routes.ts', parentId: 'svc:gateway' },
      { id: 'file:orders/app.py', kind: 'file', label: 'app.py', parentId: 'svc:orders' },
      { id: 'topic:order.created', kind: 'topic', label: 'order.created', parentId: 'repo' },
    ],
    edges: [
      {
        id: 'e1',
        srcId: 'file:gateway/routes.ts',
        dstId: 'file:orders/app.py',
        kind: 'http',
        confidence: 0.9,
        origin: 'deterministic',
        evidence: [{ file: 'gateway/routes.ts', line: 9, snippet: 'fetch("http://orders")' }],
      },
      {
        id: 'e2',
        srcId: 'file:orders/app.py',
        dstId: 'topic:order.created',
        kind: 'queue_publish',
        origin: 'deterministic',
        evidence: [{ file: 'orders/app.py', line: 10 }],
      },
    ],
  }) as unknown as ArchGraph;

test('depth 1 is unchanged — only the direct caller', () => {
  const a = queryNeighbours(graph(), 'order.created');
  assert.deepEqual(
    a.callers.map((c) => c.id),
    ['file:orders/app.py'],
    'the default answer must stay exactly what it was',
  );
});

test('depth 2 reaches the caller of the caller, and says which hop it was', () => {
  const a = queryNeighbours(graph(), 'order.created', { depth: 2 });
  const ids = a.callers.map((c) => c.id);
  assert.ok(
    ids.includes('file:orders/app.py'),
    'the direct caller must still be there',
  );
  assert.ok(
    ids.includes('file:gateway/routes.ts'),
    'routes.ts reaches order.created THROUGH app.py — this is the whole feature. ' +
      `got: ${JSON.stringify(ids)}`,
  );

  const direct = a.callers.find((c) => c.id === 'file:orders/app.py');
  const indirect = a.callers.find((c) => c.id === 'file:gateway/routes.ts');
  assert.equal(direct?.depth, 1, 'the direct caller is hop 1');
  assert.equal(indirect?.depth, 2, 'the transitive caller is hop 2 — a different claim, labelled');
});

test('depth is bounded, and a cycle terminates', () => {
  // A graph that loops back on itself. Without a visited set this walks forever; with
  // one, every node is reported once, at its SHORTEST distance from the target.
  const g = graph();
  (g.edges as unknown[]).push({
    id: 'e3',
    srcId: 'topic:order.created',
    dstId: 'file:gateway/routes.ts',
    kind: 'queue_consume',
    origin: 'deterministic',
    evidence: [{ file: 'gateway/routes.ts', line: 20 }],
  });

  const a = queryNeighbours(g, 'order.created', { depth: 5 });
  const ids = a.callers.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'a node must appear at most once across all hops');
  assert.ok(!ids.includes('topic:order.created'), 'the target is never its own caller');
});

test('depth does not leak across directions', () => {
  // callers and callees are answered independently; a node reached as a callee must
  // not be excluded from the callers walk (or vice versa) by a shared visited set.
  const a = queryNeighbours(graph(), 'orders', { depth: 3 });
  assert.ok(a.target, 'the service resolves');
  const callerIds = a.callers.map((c) => c.id);
  const calleeIds = a.callees.map((c) => c.id);
  assert.ok(callerIds.includes('file:gateway/routes.ts'), 'gateway calls into orders');
  assert.ok(calleeIds.includes('topic:order.created'), 'orders publishes order.created');
});
