/**
 * EVERY NUMBER ON THE BENCHMARKS PAGE STILL MATCHES THE MEASUREMENT IT CAME FROM.
 *
 * site/src/data/bench.ts holds every number site/benchmarks.html shows, in one
 * flat block `N`. This gate derives the expected value of every key from its
 * source (report/data.json, lab/log.md, the depth measurement, the ranker's
 * source, the shopfront ground truth, and the verbatim re-check output kept in
 * bench.ts) and fails when a number drifts, when a key has no source, or when
 * a source has no key. It also holds the page to the owner's copy rules: no
 * hand-typed digits in the page's visible text, and no package paths, internal
 * file names or repository nicknames outside the Method details.
 * No build, no network.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const BENCH = read('site/src/data/bench.ts');
const DATA = JSON.parse(read('report/data.json'));
const LOG = read('lab/log.md');
const TRUTH = JSON.parse(read('packages/analyzer/test/fixtures/shopfront/ground-truth.json'));
const DEPTH = read('site/src/components/DepthCharts.tsx');
const LTR = read('packages/analyzer/src/explain/askLtr.ts');
const FF = read('packages/analyzer/src/explain/findFiles.ts');
const GRADE_RAW = read('report/raw/grade-2026-09-30.txt');

/* ── PARSE bench.ts ─────────────────────────────────────────────────────── */
function block(text, name) {
  const start = text.indexOf(`export const ${name} =`);
  assert.ok(start >= 0, `bench.ts has no ${name}`);
  const end = text.indexOf('} as const;', start);
  assert.ok(end > start, `${name} is not closed with "} as const;"`);
  return text.slice(start, end);
}
/** The N block as an object: `key: 12.5,` or `key: [1, 2],`, one per line. */
function parseN(text) {
  const out = {};
  for (const line of block(text, 'N').split(/\r?\n/).slice(1)) {
    const t = line.trim();
    if (!t || t.startsWith('/*') || t.startsWith('*') || t.startsWith('//')) continue;
    const m = /^([A-Za-z0-9_]+):\s*(\[[^\]]*\]|-?[\d._]+),$/.exec(t);
    assert.ok(m, `N line is not "key: number," or "key: [numbers],": ${t}`);
    assert.ok(!(m[1] in out), `N.${m[1]} appears twice`);
    const v = m[2].startsWith('[')
      ? m[2].slice(1, -1).split(',').map((s) => Number(s.trim().replace(/_/g, '')))
      : Number(m[2].replace(/_/g, ''));
    for (const x of [v].flat()) assert.ok(Number.isFinite(x), `N.${m[1]} is not numeric`);
    out[m[1]] = v;
  }
  return out;
}
const RECHECK_LINES = [...block(BENCH, 'RECHECK').matchAll(/^\s*'(.*)',?$/gm)].map((m) => m[1]);
const recheck = (re, what) => {
  const hits = RECHECK_LINES.map((l) => re.exec(l)).filter(Boolean);
  assert.equal(hits.length, 1, `re-check record: expected one line for ${what}, found ${hits.length}`);
  return hits[0];
};
const scanLine = (re) => {
  const j = JSON.parse(recheck(re, String(re)).input);
  /* The record keeps its own arithmetic honest: the median and the cached run are read from the runs. */
  assert.equal(j.coldMedian, [...j.coldRuns].sort((a, b) => a - b)[1], 're-check cold median');
  assert.equal(j.cached, j.plainRuns[2], 're-check cached run');
  return j;
};

/* ── SOURCES ────────────────────────────────────────────────────────────── */
/** One section of lab/log.md, from its heading to the next `## `. */
function logSection(headingStart) {
  const i = LOG.indexOf(`\n## ${headingStart}`);
  assert.ok(i >= 0, `lab/log.md has no section "${headingStart}"`);
  const j = LOG.indexOf('\n## ', i + 4);
  return LOG.slice(i, j < 0 ? undefined : j);
}
function one(re, text, what) {
  const m = re.exec(text);
  assert.ok(m, `source has no ${what}`);
  return m;
}
const row = (label) => {
  const r = DATA.bigRepo.rows.find((x) => label.test(x.label));
  assert.ok(r, `bigRepo has no row ${label}`);
  return r.tokens;
};
const depth4 = one(
  /depth: 'depth 4', files: (\d+), grep: (\d+), sequence: 1, bytesRead: (\d+), bytesAnswer: (\d+)/,
  DEPTH,
  'DEPTH_MEASURED depth 4',
).slice(1).map(Number);
const ffHit = one(/hit@5 ([\d.]+)% vs ([\d.]+)% for grep/, FF, 'the ranker vs grep hit@5').slice(1).map(Number);
const ltrHit = one(/for ([\d.]+)% of questions, against\s*\n?\s*\*?\s*([\d.]+)%/, LTR, 'the ranker vs the picker before').slice(1).map(Number);
const runsTable = (section) => [...section.matchAll(/^\| r\d \| ([\d.]+) \| ([\d.]+) \|$/gm)].map((m) => [Number(m[1]), Number(m[2])]);
const qwenSec = logSection('2026-10-05 · Stream 2: agent to board');
const qwenRuns = runsTable(qwenSec);
const qwenPooled = one(/pooled 3 vs 3 same-day: \+([\d.]+), SE [\d.]+, ([\d.]+) SE/, qwenSec, 'the 4B pooled result').slice(1).map(Number);
const graniteSec = logSection('2026-10-06 · Result: map.md replication on granite4.2:3b');
const graniteRuns = runsTable(graniteSec);
const granitePooled = one(/map ([\d.]+), sequence ([\d.]+), delta \+([\d.]+), SE [\d.]+, ([\d.]+) SE, n=36/, graniteSec, 'the 3B pooled result')
  .slice(1)
  .map(Number);
const callsRows = [...LOG.matchAll(/^\| model calls per turn \| ([\d.]+) \| ([\d.]+) \|/gm)];
const callsLast = callsRows[callsRows.length - 1];
const firstBoard = (name) => one(new RegExp(`\\| ${name}: page to first board node \\| (\\d+) ms \\((\\d+)-(\\d+)\\)`), LOG, `${name} first board`).slice(1).map(Number);
const GRID_ORDER = ['shopfront', 'codeforge', 'ml-harness'];
const gridSec = logSection('2026-10-05 · Board views A/B');
const gridRows = GRID_ORDER.map((r) => one(new RegExp(`^\\| ${r} \\| (\\d+) \\| (\\d+) \\| (\\d+) \\|`, 'm'), gridSec, `grid row ${r}`).slice(1).map(Number));
const hotSec = logSection('2026-10-05 · Diff and Hotspots A/B');
const hotRows = GRID_ORDER.map((r) =>
  one(new RegExp(`^\\| ${r} \\| [^|]+ \\| (\\d+), (\\d+) / (\\d+),`, 'm'), hotSec, `hotspots row ${r}`).slice(1).map(Number),
);
const byType = (t) => {
  const r = DATA.agentAB.byType.find((x) => x.type === t);
  assert.ok(r, `agentAB.byType has no ${t}`);
  return [r.plain, r.sequence];
};
const byRepo = (repo) => {
  const r = DATA.agentAB.byRepo.find((x) => x.repo === repo);
  assert.ok(r, `agentAB.byRepo has no ${repo}`);
  return [r.plain, r.sequence];
};
const SCAN_ORDER =['shopfront (fixture)', 'premai (web site)', 'sequence', 'ml-harness'];
const scanRow = (repo) => {
  const r = DATA.scan.rows.find((x) => x.repo === repo);
  assert.ok(r, `scan has no row ${repo}`);
  return r;
};
const uniq = (xs) => {
  assert.equal(new Set(xs).size, 1, `expected one value, got ${xs.join(', ')}`);
  return xs[0];
};

/* ── EXPECTED VALUE OF EVERY KEY, FROM ITS SOURCE ───────────────────────── */
const EXPECT = {
  readAllTokens: () => row(/^Read all/),
  grepSixTokens: () => row(/^grep/),
  firstTokens: () => row(/first question/),
  followTokens: () => row(/follow-up/),
  filesSearched: () => DATA.bigRepo.filesSearched,
  matchingFiles: () => DATA.bigRepo.matchingFiles,
  windowBuckets: () => DATA.window.buckets,
  windowSeqTokens: () => uniq(DATA.window.sequenceTokens),
  mapNodes: () => DATA.bigRepo.monorepo.nodes,
  mapEdges: () => DATA.bigRepo.monorepo.edges,
  wholeMapTokens: () => DATA.bigRepo.monorepo.wholeMapTokens,
  scopedPromptTokens: () => DATA.bigRepo.monorepo.scopedPromptTokens,
  mapWindow: () => DATA.bigRepo.monorepo.window,
  depthFiles: () => depth4[0],
  depthLookups: () => depth4[1],
  depthReadBytes: () => depth4[2],
  depthAnswerBytes: () => depth4[3],

  hitGrep: () => ffHit[1],
  hitBefore: () => ltrHit[1],
  hitRanker: () => uniq([ffHit[0], ltrHit[0]]),
  sealedRepos: () => Number(one(/On (\d+) sealed repos/, LTR, 'sealed repo count')[1]),
  rankerCandidates: () => Number(one(/about (\d+) candidates/, LTR, 'candidate count')[1]),
  findK: () => Number(one(/FIND_FILES_DEFAULT_K = (\d+)/, FF, 'FIND_FILES_DEFAULT_K')[1]),
  findBudget: () => Number(one(/FIND_FILES_DEFAULT_BUDGET = (\d+)/, FF, 'FIND_FILES_DEFAULT_BUDGET')[1]),
  fixCommits: () => DATA.findTheFix.repos.map((r) => r.commits),
  fixGrep: () => DATA.findTheFix.repos.map((r) => r.A_grep),
  fixFirstPicker: () => DATA.findTheFix.repos.map((r) => r.B_sequence),

  abN: () => DATA.agentAB.pooled.n,
  abPlainF1: () => DATA.agentAB.runs.plainF1,
  abSeqF1: () => DATA.agentAB.runs.sequenceF1,
  abDelta: () => DATA.agentAB.pooled.delta,
  abSE: () => DATA.agentAB.pooled.se,
  typeWhoCalls: () => byType('who calls'),
  typeBreaks: () => byType('what breaks'),
  typePath: () => byType('request path'),
  abPlainTokens: () => DATA.agentAB.cost.plainTokens,
  abSeqTokens: () => DATA.agentAB.cost.sequenceTokens,
  abShopF1: () => byRepo('shopfront'),
  abMlF1: () => byRepo('ml-harness'),
  abSiteF1: () => byRepo('premai'),
  qwenToolRuns: () => qwenRuns.map((r) => r[0]),
  qwenMapRuns: () => qwenRuns.map((r) => r[1]),
  qwenMapDelta: () => qwenPooled[0],
  qwenMapSeRatio: () => qwenPooled[1],
  graniteToolRuns: () => graniteRuns.map((r) => r[0]),
  graniteMapRuns: () => graniteRuns.map((r) => r[1]),
  graniteMapF1: () => granitePooled[0],
  graniteToolF1: () => granitePooled[1],
  graniteDelta: () => granitePooled[2],
  graniteSeRatio: () => granitePooled[3],
  bankFull: () => DATA.releaseBank.points.map((p) => p.fullAnswer),

  bankSeconds: () => DATA.releaseBank.points.map((p) => p.turnSeconds),
  bankTurns: () => Number(one(/= (\d+) turns per snapshot/, DATA.releaseBank.source, 'turns per snapshot')[1]),
  callsBefore: () => Number(callsLast[1]),
  callsAfter: () => Number(callsLast[2]),
  scanFiles: () => SCAN_ORDER.map((r) => scanRow(r).files),
  scanColdMs: () => SCAN_ORDER.map((r) => scanRow(r).coldMs),
  ownCachedMs: () => scanRow('sequence').cachedMs,
  mlCacheHits: () => one(/ml-harness: (\d+) of (\d+) repeat scans hit the cache/, DATA.scan.source, 'ml-harness cache hits').slice(1).map(Number),
  firstBoardMs: () => [firstBoard('shopfront')[0], firstBoard('codeforge')[0]],
  firstBoardLo: () => [firstBoard('shopfront')[1], firstBoard('codeforge')[1]],
  firstBoardHi: () => [firstBoard('shopfront')[2], firstBoard('codeforge')[2]],

  edgesFound: () => Math.round((DATA.locate.edgeRecall / 100) * DATA.locate.groundTruthEdges),
  edgesTruth: () => uniq([TRUTH.edges.length, DATA.locate.groundTruthEdges]),
  edgePrecision: () => DATA.locate.edgePrecision,
  edgeRecall: () => DATA.locate.edgeRecall,
  fixtures: () => uniq([DATA.locate.fixtures, [...GRADE_RAW.matchAll(/ OK {2}cov=100\.0%/g)].length]),
  fixtureCoverage: () => DATA.locate.fixtureCoverage,
  gridQuestions: () => gridRows.map((r) => r[0]),
  gridMapCorrect: () => gridRows.map((r) => r[1]),
  gridCorrect: () => gridRows.map((r) => r[2]),
  hotQuestions: () => hotRows.map((r) => r[0]),
  hotCorrect: () => hotRows.map((r) => r[1]),
  hotMapCorrect: () => hotRows.map((r) => r[2]),
  chartWins: () => DATA.charts.conceptV1.wins,
  chartLosses: () => DATA.charts.conceptV1.losses,
  chartTies: () => DATA.charts.conceptV1.ties,

  rrReadAllTokens: () => Number(recheck(/^hermes\.dump_search\.uncapped_hit_tokens (\d+)$/, 'read-all tokens')[1]),
  rrGrepSixTokens: () => Number(recheck(/^hermes\.dump_search\.tokens_tool (\d+)$/, 'grep+read tokens')[1]),
  rrFirstTokens: () => Number(recheck(/^hermes\.sequence\.prompt_tokens (\d+)$/, 'first question')[1]),
  rrFollowTokens: () => Number(recheck(/^hermes\.followup\.prompt_tokens (\d+)$/, 'follow-up')[1]),
  rrFilesListed: () => Number(recheck(/^hermes\.dump_search\.filesListed (\d+)$/, 'files listed')[1]),
  rrMatchingFiles: () => Number(recheck(/^hermes\.dump_search\.hits (\d+)$/, 'matching files')[1]),
  rrWindowSeqTokens: () => Number(recheck(/^Sequence shopfront prompt \(flat\): (\d+) tok$/, 'flat prompt')[1]),
  rrDepthFiles: () => Number(recheck(/^\s+4\s+\d+\s+(\d+)\s+\d+\s+\d+\s+\d+$/, 'depth 4 files')[1]),
  rrDepthLookups: () => Number(recheck(/^\s+4\s+\d+\s+\d+\s+(\d+)\s+\d+\s+\d+$/, 'depth 4 lookups')[1]),
  rrDepthReadBytes: () => Number(recheck(/^\s+4\s+\d+\s+\d+\s+\d+\s+(\d+)\s+\d+$/, 'depth 4 bytes read')[1]),
  rrDepthAnswerBytes: () => Number(recheck(/^\s+4\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)$/, 'depth 4 answer bytes')[1]),
  rrShopColdMs: () => scanLine(/^\{"repo":"packages\/analyzer\/test\/fixtures\/shopfront"/).coldMedian,
  rrShopCachedMs: () => scanLine(/^\{"repo":"packages\/analyzer\/test\/fixtures\/shopfront"/).cached,
  rrOwnPlainMs: () => scanLine(/^\{"repo":"\."/).plainRuns,
  rrGradeOk: () => RECHECK_LINES.filter((l) => / OK {2}cov=100\.0%/.test(l)).length,
};

const NUM = parseN(BENCH);

test('the parser reads a planted drift (positive control)', () => {
  const planted = BENCH.replace(/^(\s*)edgesFound: 15,$/m, '$1edgesFound: 14,');
  assert.notEqual(planted, BENCH, 'the planted line was not found');
  assert.equal(parseN(planted).edgesFound, 14);
  assert.notDeepEqual(parseN(planted).edgesFound, EXPECT.edgesFound());
});

test('every key on the page has a source, and every source has a key on the page', () => {
  const keys = Object.keys(NUM).sort();
  const sourced = Object.keys(EXPECT).sort();
  assert.ok(keys.length >= 60, `only ${keys.length} numbers parsed: is the N block intact?`);
  assert.deepEqual(keys.filter((k) => !sourced.includes(k)), [], 'numbers with no source');
  assert.deepEqual(sourced.filter((k) => !keys.includes(k)), [], 'sources with no number on the page');
});

test('every number matches its source', () => {
  const drift = [];
  for (const [k, f] of Object.entries(EXPECT)) {
    const want = f();
    try {
      assert.deepEqual(NUM[k], want);
    } catch {
      drift.push(`${k}: page ${JSON.stringify(NUM[k])}, source ${JSON.stringify(want)}`);
    }
  }
  assert.deepEqual(drift, [], `numbers drifted from their measurements:\n${drift.join('\n')}`);
});

test('negative control: a nudged value fails for every key (no checker is vacuous)', () => {
  const nudge = (v) => (Array.isArray(v) ? [nudge(v[0]), ...v.slice(1)] : v === 0 ? 1 : Math.round(v * 1.07 * 1000 + 1) / 1000);
  const passed = Object.keys(EXPECT).filter((k) => {
    try {
      assert.deepEqual(nudge(NUM[k]), EXPECT[k]());
      return true;
    } catch {
      return false;
    }
  });
  assert.deepEqual(passed, [], `these checkers accept a wrong value: ${passed.join(', ')}`);
});

test('the re-check agrees with the published figures where the subject did not change', () => {
  /* The shop fixture and the grade did not change between 2026-09-30 and the re-check. */
  assert.equal(NUM.rrGradeOk, NUM.fixtures);
  assert.ok(Math.abs(NUM.rrShopColdMs - NUM.scanColdMs[0]) / NUM.scanColdMs[0] < 0.1, 'shop cold scan moved by 10% or more');
  assert.ok(Math.abs(NUM.rrWindowSeqTokens - NUM.windowSeqTokens) / NUM.windowSeqTokens < 0.05, 'flat prompt moved by 5% or more');
  /* The depth ratio is the claim; it holds within 5% on a 49% larger tree. */
  const r0 = NUM.depthReadBytes / NUM.depthAnswerBytes;
  const r1 = NUM.rrDepthReadBytes / NUM.rrDepthAnswerBytes;
  assert.ok(Math.abs(r1 - r0) / r0 < 0.05, `depth ratio ${r0.toFixed(0)} vs re-check ${r1.toFixed(0)}`);
});

/* ── COPY RULES (owner, 2026-10-10) ─────────────────────────────────────── */
const PAGE_FILES = [
  'site/src/pages/BenchmarksPage.tsx',
  ...fs
    .readdirSync(path.join(ROOT, 'site/src/components/bench'))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => `site/src/components/bench/${f}`),
];
/** Package paths, internal file names and repository nicknames a visitor would not know. */
const INTERNAL = /packages\/|tools\/|report\/|lab\/|\.(?:mjs|py|jsonl)\b|\b(?:shopfront|codeforge|ml-harness|premai|qwen|granite|HYB_NOSEM|DEPTH_MEASURED)\b/i;

test('the page has components to check (vacuity guard)', () => {
  assert.ok(PAGE_FILES.length >= 3, `only ${PAGE_FILES.length} page files`);
});

test('no hand-typed digits in the visible text: every number comes from N', () => {
  const bad = [];
  for (const f of PAGE_FILES) {
    const src = read(f);
    for (const m of src.matchAll(/>([^<>{}]*)</g)) {
      const text = m[1];
      if (/\d/.test(text) && !/=>|&&|\(|\)/.test(text)) bad.push(`${f}: "${text.trim()}"`);
    }
  }
  assert.deepEqual(bad, [], `digits typed into the page:\n${bad.join('\n')}`);
});

test('a planted digit is caught (control for the digit rule)', () => {
  const planted = '<p>Measured on 36 questions</p>';
  assert.ok([...planted.matchAll(/>([^<>{}]*)</g)].some((m) => /\d/.test(m[1])));
});

test('no package paths, internal file names or repo nicknames outside the Method details', () => {
  const bad = [];
  for (const f of PAGE_FILES) {
    read(f)
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (/^\s*(import|\/\/|\*|\/\*)/.test(line)) return;
        if (INTERNAL.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
      });
  }
  /* bench.ts: only SOURCES, RECHECK, MODELS and comments may name them. */
  const copy = BENCH.replace(block(BENCH, 'SOURCES'), '')
    .replace(block(BENCH, 'RECHECK'), '')
    .replace(block(BENCH, 'MODELS'), '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
  copy.forEach((l) => {
    if (INTERNAL.test(l)) bad.push(`bench.ts: ${l.trim()}`);
  });
  assert.deepEqual(bad, [], `internal names in visible copy:\n${bad.join('\n')}`);
  assert.ok(INTERNAL.test('packages/analyzer/src/scan.ts') && INTERNAL.test('the shopfront fixture'), 'control: the rule catches a path and a nickname');
});

test('the Method details carry the sources', () => {
  for (const group of ['context', 'files', 'accuracy', 'speed', 'mapping']) {
    assert.match(block(BENCH, 'SOURCES'), new RegExp(`\\b${group}: \\[`), `SOURCES has no ${group}`);
  }
  const page = PAGE_FILES.map(read).join('\n');
  assert.ok(/<details/.test(page), 'no collapsible Method details');
  const rendered = [...page.matchAll(/sources=\{SOURCES\.(\w+)\}/g)].map((m) => m[1]).sort();
  assert.deepEqual(rendered, ['accuracy', 'context', 'files', 'mapping', 'speed'], 'every group renders its SOURCES in a Method');
});
