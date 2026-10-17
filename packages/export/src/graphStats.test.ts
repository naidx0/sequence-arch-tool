import assert from 'node:assert';
import { test } from 'node:test';

import type { ArchGraph } from '@sequence/schema';

import {
  degreeRanking,
  graphStats,
  packageComposition,
  reachByDepth,
  thinnest,
} from './graphStats.js';

/**
 * COMPUTED CHARTS — arithmetic, not generation.
 *
 * Owner walk 2026-08-22: "Obviously, I don't have an AI added… but if possible,
 * it'd be really good to add a type of chart or a little bit more in-depth of a
 * chart."
 *
 * The "obviously" is the requirement. Every number here is counted off the
 * graph, so all of it works with no network and no key — non-negotiable 2. A
 * chart that needed a provider would be the one part of this product that stops
 * working on a plane.
 */

function graph(): ArchGraph {
  return {
    version: 1,
    scannedAt: '2026-08-22T00:00:00.000Z',
    repoRoot: '/r',
    repoName: 'r',
    warnings: [],
    nodes: [
      { id: 'svc:core', label: 'core', kind: 'service', path: 'packages/core', line: 1 },
      { id: 'svc:web', label: 'web', kind: 'service', path: 'packages/web', line: 1 },
      { id: 'svc:cli', label: 'cli', kind: 'service', path: 'packages/cli', line: 1 },
      { id: 'svc:lonely', label: 'lonely', kind: 'service', path: 'packages/lonely', line: 1 },
      { id: 'db:main', label: 'main-db', kind: 'datastore', path: 'packages/core', line: 3 },
      { id: 'f:core/a.ts', label: 'a.ts', kind: 'file', path: 'packages/core/a.ts', line: 1, parentId: 'svc:core' },
      { id: 'f:core/b.ts', label: 'b.ts', kind: 'file', path: 'packages/core/b.ts', line: 1, parentId: 'svc:core' },
      { id: 'f:web/x.ts', label: 'x.ts', kind: 'file', path: 'packages/web/x.ts', line: 1, parentId: 'svc:web' },
    ],
    edges: [
      e('1', 'svc:web', 'svc:core'),
      e('2', 'svc:cli', 'svc:core'),
      e('3', 'f:web/x.ts', 'f:core/a.ts'),
      e('4', 'f:core/a.ts', 'f:core/b.ts'),
      e('5', 'svc:core', 'db:main'),
    ],
  } as unknown as ArchGraph;
}

function e(id: string, srcId: string, dstId: string) {
  return {
    id,
    srcId,
    dstId,
    kind: 'import',
    confidence: 1,
    origin: 'deterministic',
    evidence: [],
  } as unknown as ArchGraph['edges'][number];
}

test('inbound and outbound are DIFFERENT questions', () => {
  /*
   * A node with 40 in and 0 out is a foundation; one with 0 in and 40 out is an
   * entry point. Their combined degree is identical, so a single "degree"
   * number answers neither.
   */
  const dependedOn = degreeRanking(graph(), 'inbound');
  const dependsOn = degreeRanking(graph(), 'outbound');

  assert.strictEqual(dependedOn[0]!.label, 'core', 'core is depended on most');
  assert.strictEqual(dependedOn[0]!.value, 2);
  /* core DEPENDS on exactly one thing — the datastore — so it must not top
     the other chart. */
  const coreOut = dependsOn.find((r) => r.label === 'core')!;
  assert.strictEqual(coreOut.value, 1);
});

test('a ranking carries the KIND, so a chart can draw the silhouette', () => {
  const rows = degreeRanking(graph(), 'inbound');
  assert.ok(rows.every((r) => typeof r.kind === 'string' && r.kind.length > 0));
  assert.strictEqual(rows.find((r) => r.label === 'main-db')!.kind, 'datastore');
});

test('ties break by name, so a chart does not shuffle between scans', () => {
  const a = degreeRanking(graph(), 'inbound');
  const g = graph();
  g.nodes.reverse();
  g.edges.reverse();
  assert.deepStrictEqual(a, degreeRanking(g, 'inbound'));
});

test('an empty graph produces empty charts rather than throwing', () => {
  const g = graph();
  g.nodes = [];
  g.edges = [];
  /* A chart surface that crashes on a repository with no edges is worse than
     one that says there are none. */
  assert.deepStrictEqual(degreeRanking(g, 'inbound'), []);
  assert.deepStrictEqual(packageComposition(g), []);
  assert.deepStrictEqual(thinnest(g), []);
  assert.deepStrictEqual(reachByDepth(g, 'nope'), []);
});

test('an edge pointing at a node that is not there is skipped, not counted', () => {
  const g = graph();
  g.edges.push(e('99', 'svc:web', 'svc:ghost'));
  /* Counting it would put a row on the chart with no node behind it — a
     ranking of something that does not exist. */
  assert.ok(!degreeRanking(g, 'inbound').some((r) => r.id === 'svc:ghost'));
});

test('package composition counts files and edges per package', () => {
  const rows = packageComposition(graph());
  const core = rows.find((r) => r.name === 'core')!;
  assert.strictEqual(core.files, 2);
  assert.strictEqual(core.edges, 1, 'a.ts -> b.ts starts in core');
});

test('THE THIN LIST IS THE HONEST COUNTERPART TO CENTRALITY', () => {
  /*
   * A ranking of the most-connected nodes says where the system is. This says
   * where the GRAPH is weakest, which is where its answers are least worth
   * trusting. Different facts, and only one of them is flattering.
   */
  const thin = thinnest(graph());
  assert.strictEqual(thin[0]!.label, 'lonely');
  assert.strictEqual(thin[0]!.value, 0);
});

test('THE THIN LIST COUNTS A SERVICE BY THE EDGES OF ITS FILES, not its own', () => {
  /*
   * FOUND ON THE REAL REPOSITORY, not in a fixture. Nearly every edge in a
   * scan joins two FILE nodes, so a service's own degree is zero — and the
   * first draft of this chart duly reported all ten services tied at 0 as the
   * thinnest things in the graph. Perfectly correct, and it said nothing.
   *
   * `web` has no edge of its own; `f:web/x.ts` inside it imports a file inside
   * `core`. That must count for web.
   */
  const web = thinnest(graph()).find((r) => r.label === 'web')!;
  assert.ok(web.value > 0, 'a service whose files reach out is not thin');

  /* And `lonely`, which contains nothing and reaches nothing, still is. */
  assert.strictEqual(thinnest(graph()).find((r) => r.label === 'lonely')!.value, 0);
});

test('an edge INSIDE one service does not make that service look connected', () => {
  /*
   * `f:core/a.ts -> f:core/b.ts` is entirely within core. Counting it would
   * say core is well connected to the rest of the system on the strength of
   * talking to itself, which every service does.
   */
  const g = graph();
  const before = thinnest(g).find((r) => r.label === 'core')!.value;
  g.edges.push(e('self', 'f:core/b.ts', 'f:core/a.ts'));
  const after = thinnest(g).find((r) => r.label === 'core')!.value;
  assert.strictEqual(after, before);
});

test('the thin list ignores files, which are all thin in a big repo', () => {
  /* Listing them would bury the finding in noise. */
  assert.ok(!thinnest(graph()).some((r) => r.kind === 'file'));
});

test('reach reports each hop, and STOPS when a hop adds nothing', () => {
  const rows = reachByDepth(graph(), 'f:core/b.ts');
  /* b <- a <- x. Two hops, and then nothing. */
  assert.deepStrictEqual(
    rows.map((r) => [r.depth, r.reached, r.added]),
    [
      [1, 1, 1],
      [2, 2, 1],
    ],
  );
  /*
   * A third row of zeroes would draw a flat tail that says only "we stopped
   * asking", which is not the same as "the closure is complete".
   */
  assert.strictEqual(rows.length, 2);
});

test('reach from something nothing depends on is empty, not a crash', () => {
  assert.deepStrictEqual(reachByDepth(graph(), 'svc:lonely'), []);
});

test('a cycle terminates rather than looping forever', () => {
  const g = graph();
  g.edges.push(e('c1', 'f:core/b.ts', 'f:web/x.ts'));
  /* x -> a -> b -> x. Without the seen-set this never returns. */
  const rows = reachByDepth(g, 'f:core/b.ts');
  assert.ok(rows.length > 0 && rows.length <= 6);
});

test('graphStats computes every chart in one call, with real totals', () => {
  const stats = graphStats(graph());
  assert.strictEqual(stats.totals.nodes, 8);
  assert.strictEqual(stats.totals.edges, 5);
  assert.ok(stats.dependedOn.length > 0);
  assert.ok(stats.dependsOn.length > 0);
  assert.ok(stats.packages.length > 0);
  assert.ok(stats.thin.length > 0);
});

test('NOTHING HERE NEEDS A PROVIDER — the whole point', () => {
  /*
   * Non-negotiable 2: the app boots and delivers its core with no network and
   * no key. These are pure functions over a parsed graph, so this test running
   * at all is the assertion.
   */
  const stats = graphStats(graph());
  assert.ok(Number.isFinite(stats.totals.edges));
});
