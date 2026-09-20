import assert from 'node:assert';
import { test } from 'node:test';

import type { ArchGraph } from '@sequence/schema';

import { deriveImportEdges, DERIVED_DEFAULTS } from './derivedEdges.js';

/**
 * DERIVED CONNECTORS — the weaker claim, drawn as a weaker claim.
 *
 * Owner walk 2026-08-22: "Between the services, they might not be directly
 * connected, but there could be some type of dotted lines or maybe a dot
 * connector that shows how the analyzer or whatever it outputs can interact
 * with the next board."
 *
 * THE BOARD IS RIGHT NOT TO DRAW IMPORTS AS CALLS and nothing here changes
 * that. `project.ts` skips `kind === 'import'` for three recorded reasons, and
 * the first is the one that binds: an import says one FILE names another, and
 * drawing it between two services asserts at the system level something only
 * ever measured at the file level. CANON's first non-negotiable is that a tool
 * asserting a false edge with a citation is worse than no tool.
 *
 * So this produces a DIFFERENT KIND OF THING, and every test below exists to
 * keep it different: it counts imports and says so, it never says "calls", it
 * never carries the traced vocabulary, and it is thresholded because 1,348
 * imports over ten services is a hairball rather than a diagram.
 */

/** A repo where two services import each other's files, plus a lone one. */
function graph(): ArchGraph {
  return {
    version: 1,
    scannedAt: '2026-08-22T00:00:00.000Z',
    repoRoot: '/r',
    repoName: 'r',
    warnings: [],
    nodes: [
      { id: 'svc:web', label: 'web', kind: 'service', path: 'web', line: 1 },
      { id: 'svc:core', label: 'core', kind: 'service', path: 'core', line: 1 },
      { id: 'svc:alone', label: 'alone', kind: 'service', path: 'alone', line: 1 },
      { id: 'f:web/a.ts', label: 'a.ts', kind: 'file', path: 'web/a.ts', line: 1, parentId: 'svc:web' },
      { id: 'f:web/b.ts', label: 'b.ts', kind: 'file', path: 'web/b.ts', line: 1, parentId: 'svc:web' },
      { id: 'f:core/x.ts', label: 'x.ts', kind: 'file', path: 'core/x.ts', line: 1, parentId: 'svc:core' },
      { id: 'f:core/y.ts', label: 'y.ts', kind: 'file', path: 'core/y.ts', line: 1, parentId: 'svc:core' },
    ],
    edges: [
      imp('1', 'f:web/a.ts', 'f:core/x.ts'),
      imp('2', 'f:web/b.ts', 'f:core/x.ts'),
      imp('3', 'f:web/b.ts', 'f:core/y.ts'),
      /* within one service — not a connector between anything */
      imp('4', 'f:web/a.ts', 'f:web/b.ts'),
      /* a SINGLE import from core into web: real, and far below any floor
         worth drawing. The threshold test exists to suppress exactly this. */
      imp('5', 'f:core/y.ts', 'f:web/a.ts'),
    ],
  } as unknown as ArchGraph;
}

function imp(id: string, srcId: string, dstId: string) {
  return {
    id,
    srcId,
    dstId,
    kind: 'import',
    confidence: 1,
    origin: 'deterministic',
    evidence: [{ file: srcId.replace('f:', ''), line: 1, snippet: 'import x' }],
  };
}

test('it counts the imports between two services, and reports the count', () => {
  const derived = deriveImportEdges(graph(), { minImports: 1 });
  const webToCore = derived.find((d) => d.src === 'web' && d.dst === 'core');
  assert.ok(webToCore, 'expected a web → core derived edge');
  /* Three file imports cross that boundary. The COUNT is the whole content of
     this edge — it is the only honest thing it knows. */
  assert.strictEqual(webToCore.imports, 3);
});

test('the label counts imports and NEVER says calls', () => {
  const derived = deriveImportEdges(graph(), { minImports: 1 });
  const label = derived.find((d) => d.src === 'web')!.label;
  assert.match(label, /3 imports/);
  /*
   * The one word this must never contain. "Calls" is the claim the scan did
   * not make, and a reader who sees it has been told something false with the
   * authority of something measured.
   */
  assert.doesNotMatch(label, /call/i);
});

test('it is marked DERIVED, and carries no traced vocabulary', () => {
  const derived = deriveImportEdges(graph(), { minImports: 1 });
  for (const d of derived) {
    assert.strictEqual(d.derived, true);
    /* `proofOf` marks import traced. Spending the strongest proof word on the
       weakest claim is the third reason project.ts skips these at all. */
    assert.notStrictEqual((d as { proof?: string }).proof, 'traced');
  }
});

test('a service importing only itself produces NO edge', () => {
  const derived = deriveImportEdges(graph(), { minImports: 1 });
  /* `f:web/a.ts → f:web/b.ts` is real and is not a connector between two
     things. A self-loop on a service board is ink that says "this service has
     files in it", which every service has. */
  assert.ok(!derived.some((d) => d.src === d.dst));
});

test('a service nothing imports appears in no edge — absence stays absent', () => {
  const derived = deriveImportEdges(graph(), { minImports: 1 });
  assert.ok(!derived.some((d) => d.src === 'alone' || d.dst === 'alone'));
});

test('THE THRESHOLD SUPPRESSES, and that is what keeps it off the hairball', () => {
  /*
   * Sheet 08: "a list's overflow is a scrollbar, a graph's overflow is a
   * hairball." On the real repository this is 1,348 imports across ten
   * services — very nearly every ordered pair, and an edge present between
   * almost every two nodes carries no information.
   */
  const all = deriveImportEdges(graph(), { minImports: 1 });
  const strict = deriveImportEdges(graph(), { minImports: 3 });
  assert.ok(all.length > strict.length, 'a higher floor must drop weaker edges');
  for (const d of strict) assert.ok(d.imports >= 3);
});

test('the default floor is not 1 — the quiet board is the default', () => {
  /* A default of 1 would draw every pair that shares a single import, which is
     the hairball arriving by default rather than by choice. */
  assert.ok(DERIVED_DEFAULTS.minImports > 1);
});

test('direction is preserved, and the two directions count separately', () => {
  const derived = deriveImportEdges(graph(), { minImports: 1 });
  const out = derived.find((d) => d.src === 'web' && d.dst === 'core');
  const back = derived.find((d) => d.src === 'core' && d.dst === 'web');
  /*
   * Three imports one way, one the other. Folding these into a single
   * undirected edge would report a mutual entanglement that the scan did not
   * find, and would lose the asymmetry that is the interesting part: web
   * leans on core, core barely reaches back.
   */
  assert.strictEqual(out?.imports, 3);
  assert.strictEqual(back?.imports, 1);
});

test('a floor of 3 keeps the strong direction and drops the weak one', () => {
  const derived = deriveImportEdges(graph(), { minImports: 3 });
  assert.ok(derived.some((d) => d.src === 'web' && d.dst === 'core'));
  assert.ok(!derived.some((d) => d.src === 'core' && d.dst === 'web'));
});

test('a graph with no imports derives nothing, rather than throwing', () => {
  const g = graph();
  g.edges = [];
  assert.deepStrictEqual(deriveImportEdges(g, { minImports: 1 }), []);
});

test('the order is stable, so a board two people are reading does not reshuffle', () => {
  const a = deriveImportEdges(graph(), { minImports: 1 });
  const g = graph();
  g.edges.reverse();
  const b = deriveImportEdges(g, { minImports: 1 });
  assert.deepStrictEqual(a, b);
});

test('it carries evidence, so a derived edge can still be opened', () => {
  const derived = deriveImportEdges(graph(), { minImports: 1 });
  const webToCore = derived.find((d) => d.src === 'web')!;
  /* Weaker claim, same discipline: the reader can still see WHICH imports
     produced it. A count nobody can check is exactly the kind of number
     CANON law 4 forbids. */
  assert.strictEqual(webToCore.evidence.length, 3);
  assert.ok(webToCore.evidence.every((e) => typeof e.file === 'string'));
});

/*
 * THE JOIN KEY IS THE ID, AND IT IS NOT THE LABEL.
 *
 * A board document does not carry the graph's labels. `seqdFromGraph` promotes a
 * node's `whatItIs` over its label when the summary says more, and stored
 * annotations rewrite them too, so the saved board for this monorepo carries
 * "Analyzer service" where the graph carries "analyzer".
 *
 * ConnectedBoard joined the two on `src`/`dst` — the LABELS — and so matched
 * nothing. Measured against the real board document and the real scan:
 *     derived pairs above the floor : 12
 *     matched by id                 : 12
 *     matched by label              : 0    <- what shipped
 * Twelve grounded dependencies (84 analyzer->schema, 63 web2->api-types,
 * 49 web2->schema) were unreachable and the toggle that would have shown them
 * rendered permanently disabled, which reads as "this repository has none".
 *
 * So the row carries the container's own graph id, and this locks it.
 */
test('a derived edge carries the container graph ids, not just labels', () => {
  const rows = deriveImportEdges(graph(), { minImports: 1 });
  const edge = rows.find((r) => r.srcId === 'svc:web' && r.dstId === 'svc:core');
  assert.ok(edge, 'the web -> core pair must be derived');
  assert.equal(edge.srcId, 'svc:web', 'srcId is the importing container id');
  assert.equal(edge.dstId, 'svc:core', 'dstId is the imported container id');
  /* And the ids are NOT the labels — a join written against either one is a
     different join, and this fixture makes the difference visible. */
  assert.notEqual(edge.srcId, edge.src);
  assert.notEqual(edge.dstId, edge.dst);
});
