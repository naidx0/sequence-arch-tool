/**
 * EVERY NUMBER ON THE BREAKDOWN HAS A SOURCE, AND STILL MATCHES IT.
 *
 * site/src/data/advantages.ts carries the numbers the five advantage chapters
 * show, each copied from a measurement in the repository. This reads those
 * sources (report/data.json, the shopfront ground truth, the find_files
 * defaults, the lab log) and fails when a number on the page drifts from the
 * measurement it names. No build, no network.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const ADV = read('site/src/data/advantages.ts');
const DATA = JSON.parse(read('report/data.json'));
const TRUTH = JSON.parse(read('packages/analyzer/test/fixtures/shopfront/ground-truth.json'));

/** The number written after `key:` inside the named export block. */
function num(block, key) {
  const start = ADV.indexOf(`export const ${block} =`);
  assert.ok(start >= 0, `advantages.ts has no ${block}`);
  const body = ADV.slice(start, ADV.indexOf('} as const;', start));
  const m = new RegExp(`\\b${key}:\\s*(-?[\\d._]+)`).exec(body);
  assert.ok(m, `${block}.${key} not found`);
  return Number(m[1].replace(/_/g, ''));
}
function arr(block, key) {
  const start = ADV.indexOf(`export const ${block} =`);
  const body = ADV.slice(start, ADV.indexOf('} as const;', start));
  const m = new RegExp(`\\b${key}:\\s*\\[([^\\]]*)\\]`).exec(body);
  assert.ok(m, `${block}.${key} not found`);
  return m[1].split(',').map((s) => Number(s.trim()));
}

test('a planted drift is caught (positive control for num())', () => {
  const planted = ADV.replace('edgesFound: 15', 'edgesFound: 14');
  const body = planted.slice(planted.indexOf('export const GRADE ='));
  assert.equal(Number(/edgesFound:\s*(\d+)/.exec(body)[1]), 14);
  assert.notEqual(14, DATA.locate.groundTruthEdges);
});

test('system design: the map against the hand-labelled truth', () => {
  assert.equal(num('GRADE', 'edgesTruth'), TRUTH.edges.length);
  assert.equal(num('GRADE', 'edgesTruth'), DATA.locate.groundTruthEdges);
  assert.equal(num('GRADE', 'edgesFound'), Math.round((DATA.locate.edgeRecall / 100) * DATA.locate.groundTruthEdges));
  assert.equal(num('GRADE', 'precision'), DATA.locate.edgePrecision);
  assert.equal(num('GRADE', 'recall'), DATA.locate.edgeRecall);
  assert.equal(num('GRADE', 'fixtures'), DATA.locate.fixtures);
  assert.equal(num('GRADE', 'fixtureCoverage'), DATA.locate.fixtureCoverage);
});

test('the opened edge quotes the fixture verbatim, at the cited lines', () => {
  const fx = 'packages/analyzer/test/fixtures/shopfront';
  const cites = [...ADV.matchAll(/\{ file: '([^']+)', line: (\d+), code: '([^']*)' \}/g)];
  assert.ok(cites.length >= 4, `only ${cites.length} cited lines`);
  for (const [, file, line, code] of cites) {
    const text = read(`${fx}/${file}`).split(/\r?\n/)[Number(line) - 1];
    assert.equal(text?.trim(), code, `${file}:${line}`);
  }
});

test('tokens: the big-repository and window benches', () => {
  const rows = DATA.bigRepo.rows.map((r) => r.tokens);
  for (const t of rows) assert.ok(ADV.includes(`tokens: ${t}`), `bigRepo ${t} missing`);
  assert.equal(num('BIG_REPO', 'filesSearched'), DATA.bigRepo.filesSearched);
  assert.equal(num('BIG_REPO', 'matchingFiles'), DATA.bigRepo.matchingFiles);
  assert.deepEqual(arr('WINDOW', 'buckets'), DATA.window.buckets);
  for (const t of DATA.window.sequenceTokens) assert.equal(num('WINDOW', 'sequenceTokens'), t);
});

test('tokens: the find_files defaults are the shipped ones', () => {
  const ff = read('packages/analyzer/src/explain/findFiles.ts');
  assert.equal(num('FIND_FILES', 'k'), Number(/FIND_FILES_DEFAULT_K = (\d+)/.exec(ff)[1]));
  assert.equal(num('FIND_FILES', 'budgetTokens'), Number(/FIND_FILES_DEFAULT_BUDGET = (\d+)/.exec(ff)[1]));
});

test('speed: the release bank and the scan', () => {
  const pts = DATA.releaseBank.points;
  const secs = [...ADV.matchAll(/seconds: ([\d.]+), full: (\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.deepEqual(secs, pts.map((p) => [p.turnSeconds, p.fullAnswer]));
  const seq = DATA.scan.rows.find((r) => r.repo === 'sequence');
  assert.equal(num('SCAN', 'files'), seq.files);
  assert.equal(num('SCAN', 'coldMs'), seq.coldMs);
  assert.equal(num('SCAN', 'cachedMs'), seq.cachedMs);
  const log = read('lab/log.md');
  assert.match(log, new RegExp(`model calls per turn \\| ${num('RELEASE_BANK', 'callsBefore')} \\| ${num('RELEASE_BANK', 'callsAfter')}`));
});

test('accuracy: the paired A/B and its replication', () => {
  const ab = DATA.agentAB;
  assert.deepEqual(arr('AGENT_AB', 'plainF1'), ab.runs.plainF1);
  assert.deepEqual(arr('AGENT_AB', 'sequenceF1'), ab.runs.sequenceF1);
  assert.equal(num('AGENT_AB', 'delta'), ab.pooled.delta);
  assert.equal(num('AGENT_AB', 'se'), ab.pooled.se);
  assert.equal(num('AGENT_AB', 'n'), ab.pooled.n);
  assert.deepEqual(arr('AGENT_AB', 'tokensPlain'), ab.cost.plainTokens);
  assert.deepEqual(arr('AGENT_AB', 'tokensSequence'), ab.cost.sequenceTokens);
  for (const t of ab.byType) assert.ok(ADV.includes(`plain: ${t.plain}, sequence: ${t.sequence}`), t.type);
  const log = read('lab/log.md');
  assert.match(log, new RegExp(`map ${num('GRANITE', 'mapF1')}, sequence ${num('GRANITE', 'toolF1')}, delta \\+${num('GRANITE', 'delta').toFixed(3)}`));
  assert.match(log, new RegExp(`${num('GRANITE', 'seRatio')} SE, n=36`));
});

test('our models: the ranker facts are the ones its source states', () => {
  const ltr = read('packages/analyzer/src/explain/askLtr.ts');
  const ff = read('packages/analyzer/src/explain/findFiles.ts');
  assert.match(ltr, new RegExp(`${num('RANKER', 'trees')} trees, ${num('RANKER', 'features')}\\s*\\n?\\s*\\*?\\s*features`));
  assert.equal((/ASK_LTR_FEATURES = \[([\s\S]*?)\] as const/.exec(ltr)[1].match(/'[A-Za-z0-9_]+'/g) ?? []).length, num('RANKER', 'features'));
  assert.match(ltr, /about 125 candidates/);
  assert.match(ltr, /84\.9% of questions, against\s*\n?\s*\*?\s*75\.5%/);
  assert.match(ff, /hit@5 84\.9% vs 51\.0% for grep/);
  assert.match(ltr, new RegExp(`On ${num('RANKER', 'sealedRepos')} sealed repos`));
  for (const v of [51.0, 75.5, 84.9]) assert.ok(ADV.includes(`value: ${v.toFixed(1)}`), String(v));
});

test('our models: the drawing model numbers are its sealed look', () => {
  const sealed = read('tools/bench/ink-fresh-sealed.txt');
  const m = /grouped macroF1 [\d.]+ acc ([\d.]+) wrongSnap ([\d.]+)% recall [\d.]+ \((\d+) strokes, (\d+) drawings\)/.exec(sealed);
  assert.ok(m, 'sealed line not found');
  assert.equal(num('SHAPE', 'accuracy'), Math.round(Number(m[1]) * 1000) / 10);
  assert.equal(num('SHAPE', 'wrongSnap'), Number(m[2]));
  assert.equal(num('SHAPE', 'strokes'), Number(m[3]));
  assert.equal(num('SHAPE', 'drawings'), Number(m[4]));
});
