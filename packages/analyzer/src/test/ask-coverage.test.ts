/**
 * WAVE 1 · ITEM 1.1 — COVERAGE ON THE WIRE.
 *
 * Sequence's one structural advantage over a terminal agent is that it can say
 * what it did NOT read. Codex and Claude Code cannot: they have no denominator.
 * Sequence has one — the graph — and until this landed it was throwing it away.
 *
 * THE DEFECT. `buildDigest` caps the edge list at `MAX_EDGES = 300`
 * (explain.ts:766) before anything else sees it, and every omission number in
 * the module is computed against that ALREADY-CAPPED digest:
 *
 *     const omittedEdges = digest.edges.length - edges.length;   // explain.ts:1143
 *
 * `digest.edges.length` is at most 300. So the largest omission the engine could
 * ever report was 300, no matter how big the graph was. MEASURED on this
 * repository (scan 2026-08-20, 1425 nodes / 2847 edges): the digest carries 300
 * edges, and `packages/web` puts 1567 edges into the graph and SIXTY into the
 * digest. The 2547 edges the cap removed were reported by nothing, anywhere.
 *
 * THE INVARIANT THESE TESTS LOCK — coverage is counted against the WHOLE GRAPH:
 *
 *     coverage.edgesTotal === graph.edges.length
 *
 * and never against the digest, the cap, or any other number that has already
 * had the cut applied to it. No test here pins a graph size, an edge count or a
 * cap value, because all three move whenever the scanner changes; they pin the
 * relationship between what was seen and what existed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ArchGraph, ArchNode, ArchEdge } from '@sequence/schema';
import {
  buildAskPromptWithCoverage,
  buildDigest,
  computeAskCoverage,
} from '../explain/explain.js';
import { runAskPipeline, type AskPipelineInput, type AskStreamEvent } from '../server/askPipeline.js';

/* ================================================================ fixture === */

function serviceNode(id: string, label: string, path: string): ArchNode {
  return { id, kind: 'service', label, path, parentId: 'repo' } as ArchNode;
}

/** A file node carrying an explicit pageRank — what digest edge selection reads. */
function fileNode(rel: string, svcId: string, rank: number): ArchNode {
  return {
    id: `file:${rel}`,
    kind: 'file',
    label: rel.slice(rel.lastIndexOf('/') + 1),
    path: rel,
    parentId: svcId,
    meta: { language: 'ts', loc: 100, pageRank: rank },
  } as ArchNode;
}

function importEdge(fromRel: string, toRel: string): ArchEdge {
  return {
    id: `file:${fromRel}->file:${toRel}`,
    srcId: `file:${fromRel}`,
    dstId: `file:${toRel}`,
    kind: 'import',
    confidence: 1,
    origin: 'deterministic',
    evidence: [],
  } as ArchEdge;
}

/**
 * A monorepo shaped like this one: three packages whose edges differ in
 * centrality, and MORE edges in total than the digest cap can carry.
 *
 * `analyzer` (rank 0.9) and `web` (rank 0.5) outrank `ink` (rank 0.001) by three
 * orders of magnitude, so ranked selection fills the cap before it reaches a
 * single `ink` edge — the real shape of the thing being measured: a package that
 * exists in the graph and contributes NOTHING to what the model was shown.
 */
function monorepoGraph(): { graph: ArchGraph; webEdges: number; inkEdges: number } {
  const nodes: ArchNode[] = [
    { id: 'repo', kind: 'repo', label: 'monorepo' } as ArchNode,
    serviceNode('svc:analyzer', 'analyzer', 'packages/analyzer'),
    serviceNode('svc:web', 'web', 'packages/web'),
    serviceNode('svc:ink', 'ink', 'packages/ink'),
  ];
  const edges: ArchEdge[] = [];

  const chain = (pkg: string, svcId: string, rank: number, count: number): void => {
    for (let i = 0; i <= count; i++) nodes.push(fileNode(`packages/${pkg}/src/f${i}.ts`, svcId, rank));
    for (let i = 0; i < count; i++) {
      edges.push(importEdge(`packages/${pkg}/src/f${i}.ts`, `packages/${pkg}/src/f${i + 1}.ts`));
    }
  };

  const ANALYZER = 200;
  const WEB = 200;
  const INK = 4;
  chain('analyzer', 'svc:analyzer', 0.9, ANALYZER);
  chain('web', 'svc:web', 0.5, WEB);
  chain('ink', 'svc:ink', 0.001, INK);

  return {
    graph: {
      version: 1,
      mode: 'scan',
      scannedAt: new Date(0).toISOString(),
      repoRoot: '/tmp/monorepo',
      repoName: 'monorepo',
      nodes,
      edges,
      warnings: [],
    },
    webEdges: WEB,
    inkEdges: INK,
  };
}

/* =============================================== computeAskCoverage (unit) === */

test('coverage counts edges against the WHOLE GRAPH, not the capped digest', () => {
  const { graph } = monorepoGraph();
  const digest = buildDigest(graph);
  const coverage = computeAskCoverage(graph, digest);

  // The defect in one assertion. Before this landed, every omission number in
  // explain.ts was `digest.edges.length - <something>`, so the denominator was
  // the cut itself and the edges the cap removed were unreportable.
  assert.equal(
    coverage.edgesTotal,
    graph.edges.length,
    `edgesTotal is ${coverage.edgesTotal} but the graph holds ${graph.edges.length} edges. ` +
      `Coverage is being computed against the already-capped digest ` +
      `(${digest.edges.length} edges), so the ${graph.edges.length - digest.edges.length} ` +
      `edges the cap removed can never be reported.`,
  );

  assert.equal(
    coverage.edgesSeen,
    digest.edges.length,
    'edgesSeen must be what actually reached the model, which is the digest that was rendered',
  );
  assert.ok(
    coverage.edgesSeen < coverage.edgesTotal,
    'the fixture must exceed the cap or it proves nothing about what the cap removed',
  );
});

test('a package the cap excluded is NAMED, not merely absent', () => {
  const { graph, inkEdges } = monorepoGraph();
  const digest = buildDigest(graph);
  const coverage = computeAskCoverage(graph, digest);

  assert.ok(
    coverage.packagesMissed.includes('packages/ink'),
    `packages/ink puts ${inkEdges} edges into the graph and none of them reached the digest, ` +
      `yet packagesMissed is ${JSON.stringify(coverage.packagesMissed)}. A package that ` +
      `contributed nothing must be named — that is the entire point of the field.`,
  );
  assert.ok(
    coverage.packagesSeen.includes('packages/analyzer') && coverage.packagesSeen.includes('packages/web'),
    `packagesSeen is ${JSON.stringify(coverage.packagesSeen)}; both ranked packages reached the digest`,
  );
});

test('seen and missed partition the edge-bearing packages — nothing is silently dropped', () => {
  const { graph } = monorepoGraph();
  const coverage = computeAskCoverage(graph, buildDigest(graph));

  const both = coverage.packagesSeen.filter((p: string) => coverage.packagesMissed.includes(p));
  assert.deepEqual(both, [], 'a package cannot be both seen and missed');

  const union = [...coverage.packagesSeen, ...coverage.packagesMissed].sort();
  assert.deepEqual(
    union,
    ['packages/analyzer', 'packages/ink', 'packages/web'],
    'every package with an edge in the graph is accounted for on exactly one side',
  );
});

test('a graph that fits the cap reports full coverage and misses nothing', () => {
  const nodes: ArchNode[] = [
    { id: 'repo', kind: 'repo', label: 'small' } as ArchNode,
    serviceNode('svc:a', 'a', 'packages/a'),
    fileNode('packages/a/src/x.ts', 'svc:a', 0.5),
    fileNode('packages/a/src/y.ts', 'svc:a', 0.4),
  ];
  const graph: ArchGraph = {
    version: 1,
    mode: 'scan',
    scannedAt: new Date(0).toISOString(),
    repoRoot: '/tmp/small',
    repoName: 'small',
    nodes,
    edges: [importEdge('packages/a/src/x.ts', 'packages/a/src/y.ts')],
    warnings: [],
  };
  const coverage = computeAskCoverage(graph, buildDigest(graph));

  assert.equal(coverage.edgesSeen, coverage.edgesTotal, 'nothing was cut, so nothing is missing');
  assert.deepEqual(coverage.packagesMissed, [], 'no package was excluded');
  assert.deepEqual(coverage.packagesSeen, ['packages/a']);
});

test('package names on the wire are OS-independent', () => {
  // The real scanner writes native paths: this repo scans as `packages\web` on
  // Windows and `packages/web` on macOS. A field a client renders and a test
  // asserts on must not change shape with the machine that produced it.
  const winPath = 'packages\\web';
  const nodes: ArchNode[] = [
    { id: 'repo', kind: 'repo', label: 'winrepo' } as ArchNode,
    serviceNode('svc:web', 'web', winPath),
    { id: 'file:packages\\web\\a.ts', kind: 'file', label: 'a.ts', path: 'packages\\web\\a.ts', parentId: 'svc:web', meta: { pageRank: 0.5 } } as ArchNode,
    { id: 'file:packages\\web\\b.ts', kind: 'file', label: 'b.ts', path: 'packages\\web\\b.ts', parentId: 'svc:web', meta: { pageRank: 0.5 } } as ArchNode,
  ];
  const graph: ArchGraph = {
    version: 1,
    mode: 'scan',
    scannedAt: new Date(0).toISOString(),
    repoRoot: 'C:\\repo',
    repoName: 'winrepo',
    nodes,
    edges: [
      {
        id: 'w1',
        srcId: 'file:packages\\web\\a.ts',
        dstId: 'file:packages\\web\\b.ts',
        kind: 'import',
        confidence: 1,
        origin: 'deterministic',
        evidence: [],
      } as ArchEdge,
    ],
    warnings: [],
  };
  const coverage = computeAskCoverage(graph, buildDigest(graph));
  assert.deepEqual(coverage.packagesSeen, ['packages/web']);
});

/* ============================================ the prompt that was really sent === */

test('coverage measures the digest the PROMPT carried, after ask-scoping cut it', () => {
  // Scoping happens inside buildAskPrompt, AFTER the cap. On this repository,
  // measured: a question about `packages/web` renders 60 of 2847 edges, and ten
  // of the eleven packages contribute nothing. Coverage that stopped at the
  // unscoped digest would claim 300 and name no missing package at all.
  const { graph } = monorepoGraph();
  const digest = buildDigest(graph);
  const whole = computeAskCoverage(graph, digest);
  const { prompt, coverage } = buildAskPromptWithCoverage(digest, 'what does packages/web import', graph);

  assert.ok(prompt.includes('--- STRUCTURE DIGEST (JSON) ---'), 'the prompt still carries the digest');
  assert.equal(
    coverage.edgesTotal,
    graph.edges.length,
    'the denominator is the graph however narrow the scope got',
  );
  assert.ok(
    coverage.edgesSeen < whole.edgesSeen,
    `ask-scoping cut the digest to a subgraph, so the prompt carried FEWER than the ` +
      `${whole.edgesSeen} edges of the unscoped digest, but coverage reported ${coverage.edgesSeen}`,
  );
  assert.ok(
    coverage.packagesMissed.includes('packages/analyzer'),
    `the ask was scoped to web, so analyzer contributed nothing to the prompt and must be ` +
      `named; packagesMissed is ${JSON.stringify(coverage.packagesMissed)}`,
  );
});

/* ==================================================== coverage on the wire === */

function pipelineInput(graph: ArchGraph, question: string): AskPipelineInput {
  return {
    question,
    intents: [],
    scopeLines: [],
    surface: undefined,
    deictic: false,
    design: undefined,
    designMode: false,
    askMode: 'implementation',
    graph,
    digest: buildDigest(graph),
    cfg: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' },
    resolveReadable: () => null,
    repoRoot: null,
    callProvider: async () => ({ text: 'packages/web imports from itself, mostly.' }),
  };
}

test('AskPipelineResult carries coverage, and the result SSE event carries the same', async () => {
  const { graph } = monorepoGraph();
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(pipelineInput(graph, 'what does packages/web import'), (e) =>
    events.push(e),
  );

  assert.ok(result.coverage, 'the ask result must say what it saw — that is item 1.1');
  assert.equal(
    result.coverage.edgesTotal,
    graph.edges.length,
    `edgesTotal on the wire is ${result.coverage.edgesTotal}, the graph holds ${graph.edges.length}`,
  );
  assert.ok(
    result.coverage.edgesSeen < result.coverage.edgesTotal,
    'this ask could not see the whole graph, and the wire must say so',
  );
  assert.ok(
    result.coverage.packagesMissed.length > 0,
    `a scoped ask over a capped digest excluded whole packages; packagesMissed is ` +
      `${JSON.stringify(result.coverage.packagesMissed)}`,
  );

  const resultEvents = events.filter((e) => e.type === 'result');
  assert.equal(resultEvents.length, 1, 'exactly one result event');
  const streamed = resultEvents[0] as Extract<AskStreamEvent, { type: 'result' }>;
  assert.deepEqual(
    streamed.coverage,
    result.coverage,
    'a streaming client and a buffered client must be told the same thing',
  );
});

test('a design-mode ask claims no coverage rather than inventing one', async () => {
  // Design mode has no scanned graph. A coverage number there would be a
  // fabricated denominator, which is worse than no chip at all.
  const result = await runAskPipeline({
    ...pipelineInput(monorepoGraph().graph, 'add a cache in front of the api'),
    graph: null,
    digest: undefined,
    designMode: true,
    design: { title: 'New design', outline: 'api -> cache -> db' },
  });
  assert.equal(result.coverage, undefined);
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE MODEL MUST BE TOLD WHAT THE SCAN NEVER READ

   MEASURED 2026-09-03 against a server on current main. Asked about a Django
   settings module, the answer got the refutation right and then overclaimed:

     "The repository contains only TypeScript/TSX files … it is not a Django
      project, so there is no Django settings module"

   The first half is true. "Only TypeScript" is FALSE — 45 tracked .py files
   under examples/ and tools/, which the walk never enters.

   `scanCoverage` already stops OUR checks refuting from a partial graph. It
   could not stop the MODEL asserting exhaustiveness from the same partial graph,
   because nothing in the prompt ever said the graph was partial. Same law, other
   subject: absence of a signal read as evidence of absence, by the model rather
   than by our code.

   The dangerous shape is worth naming: the answer was MORE confident than the
   evidence allowed while reaching the RIGHT conclusion. Everything around the
   false clause was correct, which is what makes a reader trust it.
   ═══════════════════════════════════════════════════════════════════════════ */

test('the ask prompt tells the model which regions the scan never entered', () => {
  const graph = {
    version: 1,
    scannedAt: '2026-09-03T00:00:00.000Z',
    repoRoot: '/repo',
    repoName: 'fixture',
    nodes: [{ id: 'f:src/index.ts', kind: 'file', label: 'index.ts', path: 'src/index.ts' }],
    edges: [],
    warnings: [],
    unfollowed: [],
    unscanned: [{ dir: 'tools', files: 69, extensions: ['.mjs', '.py'] }],
  } as unknown as ArchGraph;

  const digest = buildDigest(graph);
  const { prompt } = buildAskPromptWithCoverage(digest, 'Is this a Django project?', graph);

  assert.match(prompt, /--- SCAN COVERAGE ---/);
  assert.match(prompt, /did NOT read every file/);
  assert.match(prompt, /tools: 69 source files never visited/);
  /* The extensions matter more than the directory names: ".py" is the token that
     makes "only TypeScript" checkable by a reader. */
  assert.match(prompt, /File types the scan may have missed: .*\.py/);
});

test('a fully-walked repository gets NO coverage hedge', () => {
  /*
   * A permanent warning is a warning nobody reads, and it would teach the model
   * to qualify claims it is entitled to make. `unfollowed: []` and
   * `unscanned: []` are real answers meaning "looked, and read everything".
   */
  const graph = {
    version: 1,
    scannedAt: '2026-09-03T00:00:00.000Z',
    repoRoot: '/repo',
    repoName: 'fixture',
    nodes: [{ id: 'f:src/index.ts', kind: 'file', label: 'index.ts', path: 'src/index.ts' }],
    edges: [],
    warnings: [],
    unfollowed: [],
    unscanned: [],
  } as unknown as ArchGraph;

  const { prompt } = buildAskPromptWithCoverage(buildDigest(graph), 'What is here?', graph);
  assert.ok(!prompt.includes('--- SCAN COVERAGE ---'), 'nothing was missed, so nothing to warn');
});

test('a graph that never RECORDED its coverage is warned about too', () => {
  /* Absent is not empty: "not recorded" must not read as "nothing was missed". */
  const graph = {
    version: 1,
    scannedAt: '2026-09-03T00:00:00.000Z',
    repoRoot: '/repo',
    repoName: 'fixture',
    nodes: [{ id: 'f:src/index.ts', kind: 'file', label: 'index.ts', path: 'src/index.ts' }],
    edges: [],
    warnings: [],
  } as unknown as ArchGraph;

  const { prompt } = buildAskPromptWithCoverage(buildDigest(graph), 'What is here?', graph);
  assert.match(prompt, /--- SCAN COVERAGE ---/);
  assert.match(prompt, /not recorded for this graph/);
});

test('the prompt names the question\u2019s own unverifiable premise, and forbids asking for it', () => {
  /*
   * The turn after the coverage warning shipped, the overclaim went away and took
   * the conclusion with it — the refutation had been CARRIED BY the false half
   * ("contains only TypeScript, therefore not Django"), so the model retreated to
   * "please provide additional context about the Django project layout". That is
   * a clarifying question that treats the premise as established.
   */
  const graph = {
    version: 1,
    scannedAt: '2026-09-03T00:00:00.000Z',
    repoRoot: '/repo',
    repoName: 'fixture',
    nodes: [{ id: 'f:src/index.ts', kind: 'file', label: 'index.ts', path: 'src/index.ts' }],
    edges: [],
    warnings: [],
    unfollowed: [],
    unscanned: [{ dir: 'tools', files: 69, extensions: ['.mjs', '.py'] }],
  } as unknown as ArchGraph;

  const { prompt } = buildAskPromptWithCoverage(
    buildDigest(graph),
    'Since this repo is written in Django, which settings module do I edit?',
    graph,
  );
  assert.match(prompt, /The question assumes "django"/);
  assert.match(prompt, /NEITHER confirm NOR rule that out/);
  assert.match(prompt, /Never ask the user to supply what the scan did not read/);
});

/* ═══════════════════════════════════════════════════════════════════════════
   DOES THE PROMPT FIT THE WINDOW THE MODEL ACTUALLY RUNS?

   Ollama truncates a long prompt silently and answers HTTP 200, so an
   overflowing turn returns a fluent, well-cited answer built on a prefix while
   `coverage` still reports the full denominator. `planContextFit` decides; these
   lock that its verdict actually REACHES a caller, because a decision nothing
   can observe is one nothing can test.
   ═══════════════════════════════════════════════════════════════════════════ */

test('contextFit is attached when the prompt will not fit a local window', async () => {
  const { graph } = monorepoGraph();
  const result = await runAskPipeline(
    { ...pipelineInput(graph, 'explain the whole system'), localContext: { window: 512 } },
    () => {},
  );
  assert.equal(result.contextFit?.verdict, 'refuse');
  assert.equal(result.contextFit?.effective, 512);
  assert.match(result.contextFit?.reason ?? '', /partial view/);
});

test('contextFit says UNKNOWN when the window could not be read — not "fine"', async () => {
  /*
   * `window: null` is the model with no Modelfile num_ctx: the server default
   * decides and /api/show does not report it. That is the configuration that
   * truncates, so it must never be silent.
   */
  const { graph } = monorepoGraph();
  const result = await runAskPipeline(
    { ...pipelineInput(graph, 'explain the whole system'), localContext: { window: null } },
    () => {},
  );
  assert.equal(result.contextFit?.verdict, 'unknown');
  assert.match(result.contextFit?.reason ?? '', /could not be read/);
});

test('a prompt with room reports NOTHING, and a non-local provider is never checked', async () => {
  const { graph } = monorepoGraph();
  const fits = await runAskPipeline(
    { ...pipelineInput(graph, 'what does packages/web import'), localContext: { window: 200_000 } },
    () => {},
  );
  assert.equal(fits.contextFit, undefined, 'presence means "look at this"');

  /* No localContext at all is the hosted-provider case: we neither know nor
     control the window there, and "unknown" on every cloud turn would be a
     warning nobody reads. */
  const hosted = await runAskPipeline(pipelineInput(graph, 'what does packages/web import'), () => {});
  assert.equal(hosted.contextFit, undefined);
});
