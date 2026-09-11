/**
 * Locking tests for the baseline diff.
 *
 * "Report the raw numbers" is not the job — "is this worse than last time?" is.
 * These tests pin the direction of every rule: a metric moving the wrong way is
 * a regression, the same metric moving the right way is not.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { METRIC_VERSION, buildSummary, diffBaseline, hardFindings, toBaseline } from '../lib/report.mjs';
import { runAiJudgeTier, JUDGE_SKIP_NO_KEY, JUDGE_SKIP_DISABLED, JUDGE_SKIP_NOT_IMPLEMENTED } from '../lib/judge.mjs';

const row = (over = {}) => ({
  id: 'demo',
  sha: 'a'.repeat(40),
  ok: true,
  elapsedMs: 1000,
  rssMb: 100,
  counts: { services: 3, datastores: 1, topics: 0, modules: 8, files: 40, edges: 12 },
  evidencePct: 100,
  evidenceResolvedPct: 100,
  fallbackTitlePct: 10,
  dupTitleCount: 0,
  stemFound: true,
  stemPlays: true,
  stemHops: 6,
  stemFlow: { stemFile: 'src/main.py', message: 'Show main flow from src/main.py — entrypoint filename (main.py)' },
  scoreVsTruth: { precision: 0.9, recall: 0.8 },
  warnings: [],
  error: null,
  ...over,
});

const baselineOf = (over = {}) => toBaseline([row(over)]);

test('no baseline means no regressions can be claimed', () => {
  const d = diffBaseline([row()], null);
  assert.deepEqual(d.regressions, []);
  assert.deepEqual(d.improvements, []);
});

test('an identical run against its own baseline is silent', () => {
  const d = diffBaseline([row()], baselineOf());
  assert.deepEqual(d.regressions, []);
  assert.deepEqual(d.improvements, []);
  assert.deepEqual(d.warnings, []);
});

test('a repo that stopped scanning is a regression', () => {
  const d = diffBaseline([row({ ok: false, error: { message: 'boom' } })], baselineOf());
  assert.equal(d.regressions.length, 1);
  assert.match(d.regressions[0], /was OK, now FAILED — boom/);
});

test('a repo that started scanning is an improvement, not a regression', () => {
  const d = diffBaseline([row()], baselineOf({ ok: false }));
  assert.deepEqual(d.regressions, []);
  assert.match(d.improvements[0], /was FAILED, now OK/);
});

test('an evidence drop is a regression; an evidence gain is not', () => {
  assert.equal(diffBaseline([row({ evidencePct: 99 })], baselineOf()).regressions.length, 1);
  assert.equal(diffBaseline([row({ evidencePct: 100 })], baselineOf({ evidencePct: 99 })).regressions.length, 0);
  assert.equal(diffBaseline([row({ evidencePct: 100 })], baselineOf({ evidencePct: 99 })).improvements.length, 1);
});

test('a ground-truth precision or recall drop past the tolerance is a regression', () => {
  const d = diffBaseline([row({ scoreVsTruth: { precision: 0.8, recall: 0.8 } })], baselineOf());
  assert.equal(d.regressions.length, 1);
  assert.match(d.regressions[0], /ground-truth precision 90% → 80%/);
  // Inside the 1-point noise tolerance: not reported either way.
  const quiet = diffBaseline([row({ scoreVsTruth: { precision: 0.895, recall: 0.8 } })], baselineOf());
  assert.deepEqual(quiet.regressions, []);
});

test('more fallback titles is a regression past the threshold; fewer is an improvement', () => {
  assert.equal(diffBaseline([row({ fallbackTitlePct: 16 })], baselineOf()).regressions.length, 1);
  assert.equal(diffBaseline([row({ fallbackTitlePct: 12 })], baselineOf()).regressions.length, 0);
  assert.equal(diffBaseline([row({ fallbackTitlePct: 4 })], baselineOf()).improvements.length, 1);
});

test('any new duplicate module title is a regression', () => {
  assert.equal(diffBaseline([row({ dupTitleCount: 1 })], baselineOf()).regressions.length, 1);
  assert.equal(diffBaseline([row({ dupTitleCount: 0 })], baselineOf({ dupTitleCount: 3 })).improvements.length, 1);
});

test('a lost main-flow stem is a regression', () => {
  assert.match(diffBaseline([row({ stemFound: false })], baselineOf()).regressions[0], /stem was found, now none/);
});

test('a big slowdown is a warning, never a regression', () => {
  const d = diffBaseline([row({ elapsedMs: 30_000 })], baselineOf({ elapsedMs: 6_000 }));
  assert.deepEqual(d.regressions, []);
  assert.equal(d.warnings.length, 1);
  assert.match(d.warnings[0], /slower/);
});

test('a small absolute slowdown under the floor is not even a warning', () => {
  assert.deepEqual(diffBaseline([row({ elapsedMs: 4000 })], baselineOf({ elapsedMs: 100 })).warnings, []);
});

test('repos added to or dropped from the manifest are reported, not silently ignored', () => {
  const d = diffBaseline([row({ id: 'other' })], baselineOf());
  assert.deepEqual(d.newRepos, ['other']);
  assert.deepEqual(d.missing, ['demo']);
});

// ---------------------------------------------------------------------------
// Hard findings — the checks that need no baseline.
// ---------------------------------------------------------------------------

test('a healthy row produces no hard findings', () => {
  assert.deepEqual(hardFindings([row()]), []);
});

test('matching NONE of a hand-verified ground truth is a hard finding', () => {
  const f = hardFindings([
    row({ scoreVsTruth: { precision: 0, recall: 0, truth: 'docs/ground-truth/spring-petclinic.json' } }),
  ]);
  assert.equal(f.length, 1);
  assert.match(f[0], /matched NONE of the hand-verified edges/);
});

test('a successful scan that produced zero files is a hard finding, with the scanner\'s own words', () => {
  const f = hardFindings([
    row({
      counts: { services: 0, datastores: 0, topics: 0, modules: 0, files: 0, edges: 0 },
      scoreVsTruth: null,
      warnings: ['no buildable app services found in compose file — nothing to analyze'],
    }),
  ]);
  assert.equal(f.length, 1);
  assert.match(f[0], /produced ZERO files — scanner said: no buildable app services/);
});

test('a declared negative case producing nothing is NOT a hard finding — that is the answer', () => {
  const f = hardFindings([
    row({
      negativeCase: true,
      counts: { services: 0, datastores: 0, topics: 0, modules: 0, files: 0, edges: 0 },
      scoreVsTruth: null,
    }),
  ]);
  assert.deepEqual(f, []);
});

test('a failed scan is reported as a failure, not as a hard finding (no double-count)', () => {
  assert.deepEqual(hardFindings([row({ ok: false })]), []);
});

test('the AI-judge tier always skips, and says which reason applies', () => {
  const rows = [row()];
  assert.equal(runAiJudgeTier(rows, { noAi: true, env: { OPENROUTER_API_KEY: 'sk-real' } })[0].reason, JUDGE_SKIP_DISABLED);
  assert.equal(runAiJudgeTier(rows, { env: {} })[0].reason, JUDGE_SKIP_NO_KEY);
  assert.equal(runAiJudgeTier(rows, { env: { OPENROUTER_API_KEY: 'sk-real' } })[0].reason, JUDGE_SKIP_NOT_IMPLEMENTED);
  for (const r of runAiJudgeTier(rows, { env: { OPENROUTER_API_KEY: 'sk-real' } })) {
    assert.equal(r.status, 'skipped', 'no judged score may exist until the judge is built');
  }
});

test('the summary states there is no baseline rather than implying a clean run', () => {
  const md = buildSummary([row()], runAiJudgeTier([row()], { env: {} }), diffBaseline([row()], null), {
    stamp: 's',
    tier: 'smoke',
    cacheRoot: '/tmp/cache',
    baselineFile: 'tools/qa-loop/baseline.json',
    hasBaseline: false,
  });
  assert.match(md, /No baseline recorded/);
  assert.match(md, /cannot detect a regression/);
  assert.match(md, /all \*\*skipped\*\*/);
});

test('the summary prints a failed repo\'s stack and its one-command repro verbatim', () => {
  const failed = row({ ok: false, error: { message: 'NoManifestsError: nothing to scan', stack: 'at scanRepo (...)' } });
  const md = buildSummary([failed], runAiJudgeTier([failed], { env: {} }), diffBaseline([failed], null), {
    stamp: 's',
    tier: 'smoke',
    cacheRoot: '/tmp/cache',
    baselineFile: 'tools/qa-loop/baseline.json',
    hasBaseline: false,
  });
  assert.match(md, /node tools\/qa-loop\/run\.mjs --repos demo/);
  assert.match(md, /NoManifestsError: nothing to scan/);
  assert.match(md, /at scanRepo/);
});

// ---------------------------------------------------------------------------
// U30 — the outcome metrics, and the baseline-version guard.
// ---------------------------------------------------------------------------

test('a main flow that stops playing is a regression even though the stem is still found', () => {
  // The exact U23 shape: `stemFound` does not move, and the button dead-ends.
  const dead = row({
    stemPlays: false,
    stemHops: 0,
    stemFlow: { stemFile: 'index.js', message: 'No grounded call path from index.js — …' },
  });
  const d = diffBaseline([dead], baselineOf());
  assert.equal(d.regressions.length, 1, 'exactly one regression, and it is the flow');
  assert.match(d.regressions[0], /main flow no longer plays/);
  assert.match(d.regressions[0], /No grounded call path from index\.js/, 'the user-facing reason travels with it');
});

test('a main flow that starts playing is an improvement, not a regression', () => {
  const d = diffBaseline([row()], baselineOf({ stemPlays: false, stemHops: 0 }));
  assert.deepEqual(d.regressions, []);
  assert.match(d.improvements[0], /main flow now plays \(6 hops\)/);
});

test('a flow that still plays but collapsed to a fraction of its hops is flagged, not fatal', () => {
  const d = diffBaseline([row({ stemHops: 1 })], baselineOf({ stemHops: 20 }));
  assert.deepEqual(d.regressions, [], 'hop counts move legitimately — this is not a failure');
  assert.match(d.warnings[0], /main flow shortened 20 → 1 hops/);
});

test('a short flow that gets shorter is below the floor and says nothing', () => {
  const d = diffBaseline([row({ stemHops: 1 })], baselineOf({ stemHops: 2 }));
  assert.deepEqual(d.warnings, []);
});

test('evidence that stops opening is a regression, separately from evidencePct', () => {
  const d = diffBaseline([row({ evidenceResolvedPct: 60 })], baselineOf());
  assert.equal(d.regressions.length, 1);
  assert.match(d.regressions[0], /evidence that opens 100% → 60%/);
});

test('HARD FINDING: every edge cites evidence and none of it opens', () => {
  const f = hardFindings([
    row({
      evidencePct: 100,
      evidenceResolvedPct: 0,
      evidenceResolution: {
        edgesWithEvidence: 12,
        edgesWithResolvableEvidence: 0,
        examples: [{ edge: 'e1', problem: 'no such file: src/gone.ts' }],
      },
    }),
  ]);
  assert.equal(f.length, 1);
  assert.match(f[0], /NONE of it opens/);
  assert.match(f[0], /evidencePct says 100%/);
  assert.match(f[0], /no such file: src\/gone\.ts/);
});

test('one openable citation keeps a repo out of the hard-finding list', () => {
  const f = hardFindings([
    row({ evidenceResolution: { edgesWithEvidence: 12, edgesWithResolvableEvidence: 1, examples: [] } }),
  ]);
  assert.deepEqual(f, []);
});

test('a redefined metric is NOT judged against an older baseline — it is named instead', () => {
  // A v1 baseline knows nothing of the widened dup/fallback rules, so a rise
  // there is the metric getting sharper, not the product getting worse.
  const old = { ...baselineOf(), metricVersion: 1 };
  const d = diffBaseline([row({ dupTitleCount: 9, fallbackTitlePct: 90 })], old);
  assert.deepEqual(d.regressions, [], 'a metric change must never read as a regression');
  assert.equal(d.staleMetrics.length, 2);
  assert.ok(d.staleMetrics.some((s) => s.startsWith('dupTitleCount:')));
  assert.ok(d.staleMetrics.some((s) => s.startsWith('fallbackTitlePct:')));
  for (const s of d.staleMetrics) assert.match(s, /re-record with `--update-baseline`/);
});

test('metrics that did NOT change meaning are still judged against an old baseline', () => {
  const old = { ...baselineOf(), metricVersion: 1 };
  const d = diffBaseline([row({ evidencePct: 50 })], old);
  assert.equal(d.regressions.length, 1);
  assert.match(d.regressions[0], /evidence 100% → 50%/);
});

test('a baseline recorded now carries the metric version and is judged in full', () => {
  const fresh = baselineOf();
  assert.equal(fresh.metricVersion, METRIC_VERSION);
  const d = diffBaseline([row({ dupTitleCount: 9 })], fresh);
  assert.equal(d.regressions.length, 1);
  assert.deepEqual(d.staleMetrics, []);
});

test('the baseline carries stemPlays and stemHops beside the old stemFound', () => {
  const b = toBaseline([row()]).repos.demo;
  assert.equal(b.stemFound, true);
  assert.equal(b.stemPlays, true);
  assert.equal(b.stemHops, 6);
  assert.equal(b.evidenceResolvedPct, 100);
});

test('the summary names every dead end with the sentence the user would read', () => {
  const dead = row({
    stemPlays: false,
    stemHops: 0,
    stemFlow: { stemFile: 'src/sqlfluff/__main__.py', message: 'No grounded call path from src/sqlfluff/__main__.py — …' },
  });
  const md = buildSummary([dead], runAiJudgeTier([dead], { env: {} }), diffBaseline([dead], null), {
    stamp: 's',
    tier: 'smoke',
    cacheRoot: '/tmp/cache',
    baselineFile: 'tools/qa-loop/baseline.json',
    hasBaseline: false,
  });
  assert.match(md, /## "Show main flow" dead ends/);
  assert.match(md, /No grounded call path from src\/sqlfluff\/__main__\.py/);
  assert.match(md, /❌ dead end/, 'and the per-repo row does not read as a pass');
});

test('scanner warnings reach the summary verbatim', () => {
  const warned = row({ warnings: ['copies 2 directories with no CMD naming one — left at the repo root'] });
  const md = buildSummary([warned], runAiJudgeTier([warned], { env: {} }), diffBaseline([warned], null), {
    stamp: 's',
    tier: 'smoke',
    cacheRoot: '/tmp/cache',
    baselineFile: 'tools/qa-loop/baseline.json',
    hasBaseline: false,
  });
  assert.match(md, /copies 2 directories with no CMD naming one — left at the repo root/);
});
