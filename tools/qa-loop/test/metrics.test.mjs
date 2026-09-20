/**
 * Locking tests for the QA-loop metric functions.
 *
 * Two kinds of assertion live here, and both matter:
 *
 *  1. The metric computes what it says over a synthetic graph.
 *  2. The ENGINE still emits the exact strings the metric matches. A metric that
 *     silently returns 0% because `'Top level'` was renamed upstream is worse
 *     than no metric — it reports health it never measured. The engine-contract
 *     tests below fail loudly on such a rename.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  FALLBACK_MODULE_LABEL,
  GENERIC_GROUP_SUMMARY,
  collectPlainSummaries,
  countNodes,
  duplicateTitleStats,
  evidenceResolutionStats,
  evidenceStats,
  fallbackTitleStats,
  isBlankLabel,
  isFallbackModuleLabel,
  isGenericGroupSummary,
  isTestFilePath,
  MIN_STEM_QUALITY_HOPS,
  normalizeTitle,
  stemFlowStats,
} from '../lib/metrics.mjs';
import { REPO_ROOT } from '../lib/manifest.mjs';

// ---------------------------------------------------------------------------
// Fallback-title matcher.
// ---------------------------------------------------------------------------

test('fallback module label matches the engine string exactly, and nothing near it', () => {
  assert.equal(isFallbackModuleLabel('Top level'), true);
  assert.equal(isFallbackModuleLabel('Top Level'), false, 'case differs — not the engine string');
  assert.equal(isFallbackModuleLabel('Top level '), false);
  assert.equal(isFallbackModuleLabel('Billing'), false);
  assert.equal(isFallbackModuleLabel(undefined), false);
});

test('generic group summary matches singular and plural, and rejects a real summary', () => {
  assert.equal(isGenericGroupSummary('A group of 1 related file.'), true);
  assert.equal(isGenericGroupSummary('A group of 12 related files.'), true);
  assert.equal(isGenericGroupSummary('A group of 12 related files'), false, 'no full stop — not the engine string');
  assert.equal(isGenericGroupSummary('Handles checkout and payment capture.'), false);
  assert.equal(isGenericGroupSummary('A group of many related files.'), false);
  assert.equal(isGenericGroupSummary(null), false);
});

test('ENGINE CONTRACT: cluster.ts still emits the "Top level" fallback label', () => {
  // r18x: this canary used to grep for the exact shape `: 'Top level'`, which tied it
  // to one ternary's punctuation rather than to the string the metric actually matches.
  // The G8/G11/G12 naming round (b517419) rewrote that expression to
  // `?? 'Top level')` — the label still ships, but the canary went red and read as
  // "the metric has gone blind", which was untrue (gin still reports 25% fallback).
  // Now it asserts the emitted LITERAL, with comments stripped so the file's own prose
  // about the fallback cannot satisfy it. Rewritten, not deleted.
  const src = fs
    .readFileSync(path.join(REPO_ROOT, 'packages/analyzer/src/cluster/cluster.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.ok(
    src.includes(`'${FALLBACK_MODULE_LABEL}'`),
    `packages/analyzer/src/cluster/cluster.ts no longer contains the literal '${FALLBACK_MODULE_LABEL}' ` +
      `outside comments. The fallback-title metric matches ${JSON.stringify(FALLBACK_MODULE_LABEL)} and ` +
      `has just gone blind — update tools/qa-loop/lib/metrics.mjs to the new string.`
  );
});

test('ENGINE CONTRACT: explain.ts still emits the "A group of N related files." summary', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'packages/analyzer/src/explain/explain.ts'), 'utf8');
  assert.ok(
    src.includes('A group of ${nFiles} related file${nFiles === 1 ? \'\' : \'s\'}.'),
    `packages/analyzer/src/explain/explain.ts no longer contains the generic group summary template. ` +
      `The fallback-title metric matches ${GENERIC_GROUP_SUMMARY} and has just gone blind.`
  );
});

// ---------------------------------------------------------------------------
// Evidence %.
// ---------------------------------------------------------------------------

test('evidencePct is derived from validateGraph problems, not recomputed', () => {
  const problems = [
    'edge e1 has no evidence',
    'edge e2 has no evidence',
    'edge e9 confidence out of range: 1.5',
  ];
  const s = evidenceStats(problems, 10);
  assert.equal(s.edgesWithoutEvidence, 2);
  assert.equal(s.otherValidationProblems, 1, 'a non-evidence problem must not be counted as missing evidence');
  assert.equal(s.evidencePct, 80);
});

test('evidencePct is null (not 0, not 100) when there are no edges to measure', () => {
  assert.equal(evidenceStats([], 0).evidencePct, null);
});

test('evidencePct is 100 for a clean graph', () => {
  assert.equal(evidenceStats([], 7).evidencePct, 100);
});

test('ENGINE CONTRACT: validateGraph still phrases the violation as "edge <id> has no evidence"', async () => {
  const { validateGraph } = await import(path.join(REPO_ROOT, 'packages/schema/dist/index.js'));
  const graph = {
    mode: 'live',
    nodes: [
      { id: 'svc:a', kind: 'service', label: 'A' },
      { id: 'svc:b', kind: 'service', label: 'B' },
    ],
    edges: [
      { id: 'e1', srcId: 'svc:a', dstId: 'svc:b', kind: 'http', confidence: 1, origin: 'deterministic', evidence: [] },
    ],
    warnings: [],
  };
  const problems = validateGraph(graph);
  assert.ok(
    problems.includes('edge e1 has no evidence'),
    `validateGraph changed its wording (got: ${JSON.stringify(problems)}) — evidenceStats matches on it.`
  );
  assert.equal(evidenceStats(problems, 1).evidencePct, 0);
});

// ---------------------------------------------------------------------------
// Duplicate titles.
// ---------------------------------------------------------------------------

test('duplicate titles count N-1 per colliding sibling group, scoped to the parent', () => {
  const graph = {
    nodes: [
      { id: 'svc:a', kind: 'service', label: 'A' },
      { id: 'svc:b', kind: 'service', label: 'B' },
      { id: 'm1', kind: 'module', label: 'Core', parentId: 'svc:a' },
      { id: 'm2', kind: 'module', label: 'Core', parentId: 'svc:a' },
      { id: 'm3', kind: 'module', label: 'Core', parentId: 'svc:a' },
      // Same label, DIFFERENT service — not a duplicate row on any one card.
      { id: 'm4', kind: 'module', label: 'Core', parentId: 'svc:b' },
      { id: 'm5', kind: 'module', label: 'Billing', parentId: 'svc:b' },
      // A file sharing a module label must not be counted as a module.
      { id: 'f1', kind: 'file', label: 'Core', parentId: 'svc:a' },
    ],
    edges: [],
  };
  const s = duplicateTitleStats(graph);
  assert.equal(s.dupTitleCount, 2, 'three "Core" modules under one service = two duplicates');
  assert.deepEqual(s.worst[0], { parentId: 'svc:a', label: 'Core', count: 3 });
});

test('a clean graph scores zero duplicate titles', () => {
  const graph = {
    nodes: [
      { id: 'svc:a', kind: 'service', label: 'A' },
      { id: 'm1', kind: 'module', label: 'Billing', parentId: 'svc:a' },
      { id: 'm2', kind: 'module', label: 'Checkout', parentId: 'svc:a' },
    ],
    edges: [],
  };
  assert.equal(duplicateTitleStats(graph).dupTitleCount, 0);
});

// ---------------------------------------------------------------------------
// Fallback-title %.
// ---------------------------------------------------------------------------

const TREE = {
  id: 'p:repo',
  summary: 'root',
  children: [
    { id: 'p:m1', summary: 'A group of 4 related files.', children: [] },
    { id: 'p:m2', summary: 'Reads and writes the order ledger.', children: [] },
    { id: 'p:m3', summary: 'A group of 1 related file.', children: [] },
    { id: 'p:m4', summary: 'Renders the customer dashboard.', children: [] },
  ],
};

test('collectPlainSummaries flattens a PlainTree by id', () => {
  const m = collectPlainSummaries(TREE);
  assert.equal(m.get('p:m2'), 'Reads and writes the order ledger.');
  assert.equal(m.size, 5);
  assert.equal(collectPlainSummaries(null).size, 0, 'must be total — a missing tree is not a crash');
});

test('a module counts as fallback-titled by label OR by generic summary, never twice', () => {
  const graph = {
    nodes: [
      { id: 'svc:a', kind: 'service', label: 'A' },
      // generic summary only
      { id: 'm1', kind: 'module', label: 'Billing', parentId: 'svc:a' },
      // clean
      { id: 'm2', kind: 'module', label: 'Ledger', parentId: 'svc:a' },
      // BOTH fallback label and generic summary — must count once
      { id: 'm3', kind: 'module', label: 'Top level', parentId: 'svc:a' },
      // fallback label only
      { id: 'm4', kind: 'module', label: 'Top level', parentId: 'svc:a' },
    ],
    edges: [],
  };
  const s = fallbackTitleStats(graph, TREE);
  assert.equal(s.modules, 4);
  assert.equal(s.byLabel, 2);
  assert.equal(s.bySummary, 2);
  assert.equal(s.fallbackTitled, 3, 'm3 is both, and must not be double-counted');
  assert.equal(s.fallbackTitlePct, 75);
});

test('fallbackTitlePct is null when a repo produced no modules at all', () => {
  const s = fallbackTitleStats({ nodes: [{ id: 'svc:a', kind: 'service', label: 'A' }] }, null);
  assert.equal(s.modules, 0);
  assert.equal(s.fallbackTitlePct, null);
});

test('fallbackTitleStats works with no PlainTree (label-only mode)', () => {
  const graph = {
    nodes: [
      { id: 'm1', kind: 'module', label: 'Top level' },
      { id: 'm2', kind: 'module', label: 'Billing' },
    ],
  };
  const s = fallbackTitleStats(graph, null);
  assert.equal(s.fallbackTitled, 1);
  assert.equal(s.fallbackTitlePct, 50);
});

// ---------------------------------------------------------------------------
// Counts.
// ---------------------------------------------------------------------------

test('countNodes tallies by schema node kind', () => {
  const graph = {
    nodes: [
      { id: 'r', kind: 'repo', label: 'r' },
      { id: 's1', kind: 'service', label: 's1' },
      { id: 's2', kind: 'service', label: 's2' },
      { id: 'd1', kind: 'datastore', label: 'd1' },
      { id: 't1', kind: 'topic', label: 't1' },
      { id: 'm1', kind: 'module', label: 'm1' },
      { id: 'f1', kind: 'file', label: 'f1' },
      { id: 'f2', kind: 'file', label: 'f2' },
    ],
    edges: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }],
  };
  assert.deepEqual(countNodes(graph), {
    services: 2, datastores: 1, topics: 1, modules: 1, files: 2, edges: 3,
    // Nothing in this graph declares a parent, so every container is empty.
    emptyModules: 1, emptyServices: 2,
  });
});

test('countNodes distinguishes a module with files in it from an empty one', () => {
  // U30: `modules: 2` cannot tell these apart on its own — a card the user
  // opens and finds nothing in is a defect, and it used to be uncounted.
  const graph = {
    nodes: [
      { id: 'svc:a', kind: 'service', label: 'A' },
      { id: 'svc:empty', kind: 'service', label: 'Empty' },
      { id: 'm:full', kind: 'module', label: 'Billing', parentId: 'svc:a' },
      { id: 'm:empty', kind: 'module', label: 'Ghost', parentId: 'svc:a' },
      { id: 'f1', kind: 'file', label: 'a.ts', parentId: 'm:full' },
    ],
    edges: [],
  };
  const c = countNodes(graph);
  assert.equal(c.modules, 2);
  assert.equal(c.emptyModules, 1, 'm:empty has no children');
  assert.equal(c.services, 2);
  assert.equal(c.emptyServices, 1, 'svc:empty has no children; svc:a has two modules');
});

test('metrics are total over a malformed graph — they report, they do not throw', () => {
  assert.deepEqual(countNodes({}), {
    services: 0, datastores: 0, topics: 0, modules: 0, files: 0, edges: 0,
    emptyModules: 0, emptyServices: 0,
  });
  assert.equal(fallbackTitleStats({}, undefined).modules, 0);
  assert.equal(duplicateTitleStats({}).dupTitleCount, 0);
  assert.equal(evidenceStats(undefined, 0).edgesWithoutEvidence, 0);
  assert.equal(evidenceResolutionStats(undefined, () => null).edgesWithEvidence, 0);
  assert.equal(stemFlowStats(undefined, undefined).stemPlays, false);
});

// ---------------------------------------------------------------------------
// U30 — stemPlays. The metric this round exists for.
//
// `stemFound` (candidates.length > 0) was true on flask, express, gin and n8n
// while "Show main flow" dead-ended on all four. These tests lock the
// difference: a stem being NAMED and a flow PLAYING are two different facts,
// and the harness now records both.
// ---------------------------------------------------------------------------

test('stemPlays is false where stemFound is true — the exact U23 blind spot', () => {
  const s = stemFlowStats(
    {
      ready: false,
      stem: { file: 'src/__main__.py', reason: 'entrypoint filename (__main__.py)' },
      message: 'No grounded call path from src/__main__.py — the scan recorded no calls out of it',
    },
    1
  );
  assert.equal(s.candidates, 1);
  assert.equal(s.stemFound, true, 'the old metric would have reported a clean green here');
  assert.equal(s.stemPlays, false, 'and the user gets nothing on the click');
  assert.equal(s.stemHops, 0);
  assert.match(s.message, /No grounded call path/);
});

test('stemHops records HOW LONG the flow is — 1 hop and 34 hops are not the same answer', () => {
  const short = stemFlowStats(
    { ready: true, stem: { file: 'a.ts', reason: 'r' }, path: { functionIds: ['f1', 'f2'], edgeIds: ['e1'] }, message: 'ok' },
    2
  );
  const long = stemFlowStats(
    {
      ready: true,
      stem: { file: 'a.ts', reason: 'r' },
      path: {
        functionIds: Array.from({ length: 12 }, (_, i) => `f${i}`),
        edgeIds: Array.from({ length: 34 }, (_, i) => `e${i}`),
      },
      message: 'ok',
    },
    2
  );
  assert.equal(short.stemPlays, true);
  assert.equal(long.stemPlays, true);
  assert.equal(short.stemHops, 1);
  assert.equal(long.stemHops, 34);
  assert.equal(long.stemFunctions, 12);
});

test('a ready state with zero edges is NOT a play — a one-node path goes nowhere', () => {
  const s = stemFlowStats(
    { ready: true, stem: { file: 'a.ts', reason: 'r' }, path: { functionIds: ['f1'], edgeIds: [] }, message: 'ok' },
    1
  );
  assert.equal(s.stemPlays, false, 'edgeIds is the gate — the same one mainFlowState uses');
});

test('ENGINE CONTRACT: stemPlays comes from the same mainFlowState the canvas calls', async () => {
  // Loaded exactly the way lib/measure.mjs loads it: TS source, type-stripped.
  const { mainFlowState, detectStemCandidates } = await import(
    path.join(REPO_ROOT, 'packages/web/src/graph/stemFlow.ts')
  );
  // A repo shaped like the U23 defect: one named entry, real function spans,
  // and NOT ONE recorded call anywhere. The old metric says "stem found ✅".
  const graph = {
    mode: 'live',
    nodes: [
      { id: 'svc:a', kind: 'service', label: 'A' },
      { id: 'f:main', kind: 'file', label: 'main.py', path: 'src/main.py', parentId: 'svc:a' },
      { id: 'f:util', kind: 'file', label: 'util.py', path: 'src/util.py', parentId: 'svc:a' },
    ],
    edges: [],
    warnings: [],
  };
  const spans = [
    { id: 'fn:main', file: 'src/main.py', name: 'main' },
    { id: 'fn:util', file: 'src/util.py', name: 'helper' },
  ];
  const dead = { nodes: spans, edges: [] };
  const deadStats = stemFlowStats(mainFlowState(graph, dead), detectStemCandidates(graph, dead).length);
  assert.equal(deadStats.stemFound, true, 'the stem IS named — that is all stemFound ever measured');
  assert.equal(deadStats.stemPlays, false, 'and the canvas would dead-end on the click');
  assert.equal(deadStats.stemHops, 0);

  // The same repo with one real cross-file call recorded. Now it plays.
  const alive = { nodes: spans, edges: [{ id: 'e1', srcId: 'fn:main', dstId: 'fn:util', kind: 'call' }] };
  const aliveStats = stemFlowStats(mainFlowState(graph, alive), detectStemCandidates(graph, alive).length);
  assert.equal(aliveStats.stemFound, true);
  assert.equal(aliveStats.stemPlays, true);
  assert.equal(aliveStats.stemHops, 1);
  assert.equal(aliveStats.stemFile, 'src/main.py');
});

// ---------------------------------------------------------------------------
// U34 — stem quality. `stemPlays` alone cannot tell a 1-hop flask flow from a
// 22-hop sqlfluff flow that starts in a test file. Both are honest plays; both
// are bad answers for "show main flow".
// ---------------------------------------------------------------------------

test('isTestFilePath catches test directories and conventional test filenames', () => {
  assert.equal(isTestFilePath('test/core/parser/parity/cases_test.py'), true);
  assert.equal(isTestFilePath('src/test/java/ClinicServiceTests.java'), true);
  assert.equal(isTestFilePath('lib/foo_test.go'), true);
  assert.equal(isTestFilePath('src/a.spec.ts'), true);
  assert.equal(isTestFilePath('src/main.py'), false);
  assert.equal(isTestFilePath('src/flask/app.py'), false);
});

test('U34: flask-shaped 1-hop play is stemPlays but not stemQualityOk', () => {
  const s = stemFlowStats(
    {
      ready: true,
      stem: { file: 'src/flask/__main__.py', reason: 'entrypoint filename (__main__.py)' },
      path: { functionIds: ['f1', 'f2'], edgeIds: ['e1'] },
      message: 'ok',
    },
    1
  );
  assert.equal(s.stemPlays, true);
  assert.equal(s.stemHops, 1);
  assert.equal(s.stemThin, true);
  assert.equal(s.stemFromTestFile, false);
  assert.equal(s.stemQualityOk, false);
});

test('U34: sqlfluff-shaped test-file play is stemPlays but not stemQualityOk', () => {
  const s = stemFlowStats(
    {
      ready: true,
      stem: { file: 'test/core/parser/parity/cases_test.py', reason: 'widest caller' },
      path: {
        functionIds: Array.from({ length: 12 }, (_, i) => `f${i}`),
        edgeIds: Array.from({ length: 22 }, (_, i) => `e${i}`),
      },
      message: 'ok',
    },
    1
  );
  assert.equal(s.stemPlays, true);
  assert.equal(s.stemHops, 22);
  assert.equal(s.stemThin, false);
  assert.equal(s.stemFromTestFile, true);
  assert.equal(s.stemQualityOk, false);
});

test('U34: a substantive non-test play passes stemQualityOk', () => {
  const s = stemFlowStats(
    {
      ready: true,
      stem: { file: 'src/main.py', reason: 'entrypoint filename (main.py)' },
      path: {
        functionIds: ['f1', 'f2', 'f3'],
        edgeIds: ['e1', 'e2'],
      },
      message: 'ok',
    },
    1
  );
  assert.equal(s.stemPlays, true);
  assert.equal(s.stemHops, MIN_STEM_QUALITY_HOPS);
  assert.equal(s.stemQualityOk, true);
});

// ---------------------------------------------------------------------------
// U30 — evidence that OPENS, not evidence that EXISTS.
// ---------------------------------------------------------------------------

const LINES = { 'src/a.ts': 40, 'src/b.ts': 3 };
const resolver = (f) => (f in LINES ? LINES[f] : null);

test('an edge whose evidence names a file that is not there does NOT resolve', () => {
  const edges = [
    { id: 'e1', evidence: [{ file: 'src/a.ts', line: 12, snippet: 'fetch()' }] },
    { id: 'e2', evidence: [{ file: 'src/gone.ts', line: 3, snippet: 'x' }] },
  ];
  const s = evidenceResolutionStats(edges, resolver);
  assert.equal(s.edgesWithEvidence, 2);
  assert.equal(s.edgesWithResolvableEvidence, 1);
  assert.equal(s.unresolvedMissingFile, 1);
  assert.equal(s.evidenceResolvedPct, 50);
  assert.match(s.examples[0].problem, /no such file: src\/gone\.ts/);
});

test('line 0, a negative line and a line past the end of the file are all dead ends', () => {
  const edges = [
    { id: 'e0', evidence: [{ file: 'src/a.ts', line: 0, snippet: 'x' }] },
    { id: 'eneg', evidence: [{ file: 'src/a.ts', line: -1, snippet: 'x' }] },
    { id: 'epast', evidence: [{ file: 'src/b.ts', line: 900, snippet: 'x' }] },
    { id: 'elast', evidence: [{ file: 'src/b.ts', line: 3, snippet: 'x' }] },
  ];
  const s = evidenceResolutionStats(edges, resolver);
  assert.equal(s.edgesWithResolvableEvidence, 1, 'only the last line of b.ts is a real destination');
  assert.equal(s.unresolvedBadLine, 3);
  assert.equal(s.evidenceResolvedPct, 25);
});

test('one openable citation is enough — the user only needs somewhere to land', () => {
  const edges = [
    {
      id: 'e1',
      evidence: [
        { file: 'src/gone.ts', line: 1, snippet: 'x' },
        { file: 'src/a.ts', line: 9, snippet: 'y' },
      ],
    },
  ];
  assert.equal(evidenceResolutionStats(edges, resolver).evidenceResolvedPct, 100);
});

test('edges with NO evidence belong to evidenceStats, not to this metric', () => {
  const edges = [{ id: 'e1', evidence: [] }, { id: 'e2' }];
  const s = evidenceResolutionStats(edges, resolver);
  assert.equal(s.edgesWithEvidence, 0);
  assert.equal(s.evidenceResolvedPct, null, 'nothing to measure is not the same as everything failed');
});

test('a blank snippet is counted but does not make the citation unopenable', () => {
  const edges = [{ id: 'e1', evidence: [{ file: 'src/a.ts', line: 4, snippet: '   ' }] }];
  const s = evidenceResolutionStats(edges, resolver);
  assert.equal(s.blankSnippets, 1);
  assert.equal(s.evidenceResolvedPct, 100, 'the line still opens; the empty snippet is a separate finding');
});

// ---------------------------------------------------------------------------
// U30 — the blank title (G12) and the title that only LOOKS different.
// ---------------------------------------------------------------------------

test('a blank module label counts as fallback-titled — the G12 defect the metric missed', () => {
  const graph = {
    nodes: [
      { id: 'svc:a', kind: 'service', label: 'A' },
      { id: 'm1', kind: 'module', label: '', parentId: 'svc:a' },
      { id: 'm2', kind: 'module', label: '   ', parentId: 'svc:a' },
      { id: 'm3', kind: 'module', parentId: 'svc:a' },
      { id: 'm4', kind: 'module', label: 'Billing', parentId: 'svc:a' },
    ],
    edges: [],
  };
  const s = fallbackTitleStats(graph, null);
  assert.equal(s.byBlankLabel, 3, 'empty, whitespace-only and missing all render as an empty row');
  assert.equal(s.byLabel, 0, 'none of them is the literal "Top level"');
  assert.equal(s.fallbackTitled, 3);
  assert.equal(s.fallbackTitlePct, 75);
  assert.equal(isBlankLabel('Billing'), false);
});

test('a blank RENDERED SUMMARY counts too, and a module is never counted twice', () => {
  const tree = { id: 'p:repo', summary: 'root', children: [{ id: 'p:m1', summary: '  ', children: [] }] };
  const graph = { nodes: [{ id: 'm1', kind: 'module', label: '', parentId: 'svc:a' }], edges: [] };
  const s = fallbackTitleStats(graph, tree);
  assert.equal(s.byBlankLabel, 1);
  assert.equal(s.byBlankSummary, 1);
  assert.equal(s.fallbackTitled, 1, 'blank label AND blank summary is still one bad row');
  assert.equal(s.fallbackTitlePct, 100);
});

test('duplicate titles that differ only by case or whitespace are duplicates', () => {
  const graph = {
    nodes: [
      { id: 'svc:a', kind: 'service', label: 'A' },
      { id: 'm1', kind: 'module', label: 'Core', parentId: 'svc:a' },
      { id: 'm2', kind: 'module', label: 'core', parentId: 'svc:a' },
      { id: 'm3', kind: 'module', label: ' Core ', parentId: 'svc:a' },
      { id: 'm4', kind: 'module', label: 'Core  Api', parentId: 'svc:a' },
      { id: 'm5', kind: 'module', label: 'Core Api', parentId: 'svc:a' },
    ],
    edges: [],
  };
  const s = duplicateTitleStats(graph);
  assert.equal(s.dupTitleCount, 3, 'three "Core" rows and two "Core Api" rows read as duplicates');
  assert.equal(s.dupTitleCountExact, 0, 'and the OLD byte-identical metric saw none of them');
  assert.deepEqual(s.worst[0].variants, [' Core ', 'Core', 'core']);
});

test('normalised duplicate count is never below the exact one', () => {
  const graph = {
    nodes: [
      { id: 'm1', kind: 'module', label: 'Core', parentId: 'svc:a' },
      { id: 'm2', kind: 'module', label: 'Core', parentId: 'svc:a' },
      { id: 'm3', kind: 'module', label: 'CORE', parentId: 'svc:a' },
    ],
    edges: [],
  };
  const s = duplicateTitleStats(graph);
  assert.equal(s.dupTitleCountExact, 1);
  assert.equal(s.dupTitleCount, 2);
  assert.ok(s.dupTitleCount >= s.dupTitleCountExact);
});

test('normalizeTitle folds case and collapses whitespace, and nothing else', () => {
  assert.equal(normalizeTitle('  Core   Api '), 'core api');
  assert.equal(normalizeTitle('Core-Api'), 'core-api', 'punctuation is a real difference, not a rendering one');
  assert.equal(normalizeTitle(undefined), '');
});
