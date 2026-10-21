import assert from 'node:assert/strict';
import test from 'node:test';
import { queryNeighbours, renderAnswer, resolveNode } from '../graphQuery.js';
import type { ArchGraph } from '@sequence/schema';

/**
 * P6 concluded that Sequence cannot replace a main coding agent, and that the honest
 * strategy is the inverse: be the thing those agents read. The grounded graph is the
 * one asset Claude Code and Cursor cannot produce.
 *
 * `scan_repo` already exposed it — as the WHOLE graph: this monorepo's entire
 * topology in one response. Handing an agent all of it so it can find three edges
 * is not exposing the graph, it is relocating the work. `who_calls` answers the
 * question instead. (The size is deliberately not written here: it moves. The
 * figure was "~1.1 MB" until the v1 UI was deleted on 2026-08-20, which roughly
 * halved the repo — a today-number in a comment is a claim that rots, which is
 * the honesty guard's own lesson.)
 *
 * (The figures in this docblock until 2026-08-19 — "0.47 MB / 1326 nodes", and a
 * "4.6 KB" answer — were measured on `test/fixtures/shopfront` and written up as this
 * monorepo's. `docs/research/v32-scale-and-gaps.md` §7 retracts them, and
 * `graphQueryRepo.test.ts` now measures the real corpus so the claim cannot drift
 * back. THESE tests stay on the fixture on purpose: they pin behaviour, not scale.)
 *
 * The bug these tests exist to prevent is subtler than a crash. The first cut
 * resolved `orders` to the SERVICE node, found no edge touching it directly (the
 * scanner records file→file edges), and answered "nothing in this scan" — an
 * authoritative negative that was false. A grounded tool that confidently reports
 * nothing is worse than no tool.
 */

/** Two services, each with a file, and a file→file call between them. */
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
      {
        id: 'e3',
        srcId: 'file:gateway/routes.ts',
        dstId: 'file:orders/app.py',
        kind: 'import',
        origin: 'deterministic',
        evidence: [{ file: 'gateway/routes.ts', line: 1 }],
      },
    ],
  }) as unknown as ArchGraph;

test('a question about a SERVICE finds the calls its files make and receive', () => {
  // The regression this file exists for: without rolling file edges up to the owning
  // service, this answered "nothing in this scan" — confidently, and wrongly.
  // includeImports:false here on purpose: this test is about the SERVICE lens —
  // cross-boundary http/queue traffic — which is exactly what that flag now selects.
  // The default became import-inclusive in iteration 7 (see below), so leaving this
  // unqualified would silently change what the test is asking about.
  const a = queryNeighbours(graph(), 'orders', { includeImports: false });
  assert.equal(a.target?.id, 'svc:orders');
  assert.equal(a.callers.length, 1, 'gateway calls orders');
  assert.equal(a.callers[0].service, 'gateway', 'the caller is named at SERVICE level');
  assert.equal(a.callees.length, 1, 'orders publishes to the topic');
  assert.equal(a.callees[0].label, 'order.created');
});

test('every hit carries the file and line that justify it', () => {
  // A grounded product that answers without citations has given up its only edge.
  const a = queryNeighbours(graph(), 'orders');
  const ev = a.callers[0].evidence[0];
  assert.equal(ev.file, 'gateway/routes.ts');
  assert.equal(ev.line, 9);
  assert.ok(ev.snippet?.includes('orders'));
});

test('import edges are INCLUDED by default, and can be excluded on request', () => {
  // REWRITTEN in iteration 7, reversing my own earlier call.
  //
  // The original reasoning — "imports outnumber every other kind, so including them
  // buries the answer" — was measured against a graph holding 79 import edges. That
  // graph was 2% real: resolveImport could not resolve TypeScript ESM `.js`
  // specifiers, so 100% of packages/web's 1545 relative imports produced no edge.
  // With resolution fixed the graph is 2299 imports vs 8 others, and the OLD default
  // made the commonest question return nothing at all — `who_calls ProductComposer`
  // answered 0 edges in 66 tokens. The feared noise never appeared either: the worst
  // realistic target measures ~796 tokens.
  //
  // A default that returns an empty answer to the most-asked question is not
  // conservative, it is broken. The cross-service lens is still one flag away.
  assert.equal(queryNeighbours(graph(), 'orders').callers.length, 2, 'imports are in by default');
  const onlyTraffic = queryNeighbours(graph(), 'orders', { includeImports: false });
  assert.equal(onlyTraffic.callers.length, 1, 'includeImports:false is the service lens');
});

test('an internal call does not count as calling yourself', () => {
  // Both endpoints owned by the target must not appear as a caller OR a callee.
  const g = graph();
  g.edges.push({
    id: 'e4',
    srcId: 'file:orders/app.py',
    dstId: 'file:orders/app.py',
    kind: 'http',
    origin: 'deterministic',
    evidence: [{ file: 'orders/app.py', line: 2 }],
  } as never);
  // Pinned to the service lens: this test is about SELF-edges, not about imports,
  // and leaving it on the default would make it count the fixture's import edge too.
  const a = queryNeighbours(g, 'orders', { includeImports: false });
  assert.equal(a.callers.length, 1);
  assert.equal(a.callees.length, 1);
});

test('the same fact asserted twice is reported once', () => {
  const g = graph();
  g.edges.push({ ...g.edges[0], id: 'e1-dup' } as never);
  // Service lens for the same reason: the subject is DEDUPE, not the import default.
  assert.equal(queryNeighbours(g, 'orders', { includeImports: false }).callers.length, 1);
});

test('resolution prefers a service over a file that merely contains the word', () => {
  assert.equal(resolveNode(graph(), 'orders')?.id, 'svc:orders');
  assert.equal(resolveNode(graph(), 'ORDERS')?.id, 'svc:orders', 'case-insensitive');
  assert.equal(resolveNode(graph(), 'svc:orders')?.id, 'svc:orders', 'by id');
});

test('a miss names the real alternatives instead of just failing', () => {
  const a = queryNeighbours(graph(), 'nope-not-here');
  assert.equal(a.target, null);
  assert.deepEqual(a.callers, []);
  assert.ok(a.didYouMean.includes('orders'));
  assert.ok(a.didYouMean.includes('gateway'));
  assert.match(renderAnswer(a, 'nope-not-here'), /No node matches/);
});

test('the rendered answer cites a file and a line for every fact', () => {
  // RE-POINTED 2026-08-19, and only the literal moved: this used to pin the exact
  // string `gateway → routes.ts [http] — gateway/routes.ts:9`. That form spent 90
  // bytes per fact — the filename twice (label, then evidence path) plus an `[import]`
  // stamp on the 99.6% of this repo's edges that are imports — and `who_calls` was
  // measured at 4.5x ripgrep's token cost partly because of it. The INVARIANT the
  // test exists for is unchanged and still asserted below: the target is named with
  // its kind, and every hit carries a file and a line an agent can open.
  const out = renderAnswer(queryNeighbours(graph(), 'orders'), 'orders');
  assert.match(out, /orders \(service\)/);
  assert.match(out, /gateway\/routes\.ts:9/, 'the http caller is cited at file:line');
  assert.match(out, /\[http\]/, 'a minority edge kind is still named');
  // The attribution the compact rewrite dropped. An adversarial pass caught that
  // `renderAnswer` had stopped reading `h.service` entirely while the field was still
  // being populated, and that the two assertions above passed only because this
  // fixture's evidence path happens to BEGIN with `gateway/` — a service whose name
  // differed from its path prefix would have rendered with no attribution at all and
  // this test would still have been green. Asserting the arrow form pins the thing
  // itself rather than a coincidence of the fixture.
  assert.match(out, /gateway → /, 'a cross-service row still names the service it is in');
});

test('a parentId cycle terminates instead of hanging', () => {
  const g = graph();
  (g.nodes.find((n) => n.id === 'file:orders/app.py') as { parentId?: string }).parentId =
    'file:orders/app.py';
  assert.doesNotThrow(() => queryNeighbours(g, 'orders'));
});

/**
 * v3.2 overnight iteration 7 — the default, the cap, and match ranking.
 *
 * Three defects found by MEASURING the tool rather than trusting its design notes.
 */
const RANK_GRAPH = {
  repoName: 'r',
  nodes: [
    { id: 'svc:web', kind: 'service', label: 'web', parentId: 'repo' },
    { id: 'file:Icon.tsx', kind: 'file', label: 'Icon.tsx', parentId: 'svc:web' },
    { id: 'file:AiConnectCta.tsx', kind: 'file', label: 'AiConnectCta.tsx', parentId: 'svc:web' },
    { id: 'file:Menu.tsx', kind: 'file', label: 'Menu.tsx', parentId: 'svc:web' },
  ],
  edges: [
    {
      id: 'e1',
      srcId: 'file:Menu.tsx',
      dstId: 'file:Icon.tsx',
      kind: 'import',
      evidence: [{ file: 'Menu.tsx', line: 3 }],
    },
  ],
  warnings: [],
} as unknown as ArchGraph;

test('who_calls includes imports BY DEFAULT - the old default answered nothing', () => {
  // Measured before the flip: who_calls ProductComposer returned 0 edges and 66
  // tokens of silence on the real repo, because every edge it could have shown was
  // an import. The exclusion was reasoned at 79 imports vs 8 others; the real graph
  // is 2299 vs 8.
  const a = queryNeighbours(RANK_GRAPH, 'Icon');
  assert.equal(a.callers.length, 1, 'the import caller must be visible without a flag');
  assert.equal(a.callers[0].label, 'Menu.tsx');
});

test('who_calls still allows the cross-service-only lens explicitly', () => {
  const a = queryNeighbours(RANK_GRAPH, 'Icon', { includeImports: false });
  assert.equal(a.callers.length, 0, 'includeImports:false must still exclude imports');
});

test('who_calls prefers an exact filename stem over an incidental substring', () => {
  // The bug: lowercased "aiconnectcta" CONTAINS "icon", and unranked
  // first-past-the-post substring matching returned AiConnectCta.tsx for "Icon" -
  // an authoritative-looking answer about the wrong file.
  const a = queryNeighbours(RANK_GRAPH, 'Icon');
  assert.equal(a.target?.label, 'Icon.tsx');
});

test('who_calls reports what a cap removed instead of truncating silently', () => {
  // A truncated answer that looks complete is how an agent concludes "nothing else
  // calls this" and deletes something.
  const a = queryNeighbours(RANK_GRAPH, 'Icon');
  assert.deepEqual(a.omitted, { callers: 0, callees: 0 });
});
