/**
 * The claims registry (docs/claims.json) and the deny-list over the public copy (plan 0.1).
 *
 * Every check runs twice: on the real tree (must be clean) and on a planted bad example (must fail),
 * because a scan that finds zero means nothing until it has found one planted example.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DENY,
  checkCode,
  checkEngineGuards,
  checkPartialScope,
  checkReadmeVersion,
  checkShape,
  checkTests,
  currentReleaseFile,
  currentVersion,
  declares,
  guardedFiles,
  loadRegistry,
  scanDeny,
} from './lib/claims.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const entries = loadRegistry(ROOT);

/** The guarded files with their text and kind, the way CI reads them. */
function guarded() {
  const g = guardedFiles(ROOT);
  const current = currentReleaseFile(ROOT);
  const texts = {};
  const kinds = {};
  const add = (rels, kind) => {
    for (const rel of rels) {
      texts[rel] = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      kinds[rel] = kind;
    }
  };
  add(g.readme, 'readme');
  add(g.releases.filter((r) => r !== current), 'past-release');
  add(g.releases.filter((r) => r === current), 'current-release');
  add(g.site, 'site');
  add(g.settings, 'settings');
  return { texts, kinds, g, current };
}

test('registry: every entry has the planned fields and a gap when it is not real', () => {
  assert.ok(entries.length >= 100, `the registry is seeded from the audit rows, got ${entries.length}`);
  assert.deepEqual(checkShape(entries), []);
});

test('registry: every code symbol exists (the file is there and declares it)', () => {
  assert.deepEqual(checkCode(entries, ROOT), []);
  assert.ok(entries.some((e) => e.code.some((c) => c.includes('#'))), 'some entries name a symbol');
});

test('registry: every tests file exists', () => {
  assert.deepEqual(checkTests(entries, ROOT), []);
});

test('registry: the claims this round built are real, and name their code and a locking test', () => {
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const id of ['A5', 'A9', 'F4', 'L2', 'T3', 'U15', 'U26', 'U70', 'U71', 'U80', 'V13', 'V19']) {
    const e = byId.get(id);
    assert.ok(e, id);
    assert.equal(e.status, 'real', id);
    assert.ok(e.tests.length > 0, `${id} names a test`);
  }
  assert.notEqual(byId.get('T2').status, 'real', 'the map reaches Claude and Codex only when plan 2.1 lands');
});

test('deny-list: none of the known-false phrases is in the guarded public copy', () => {
  const { texts, kinds } = guarded();
  assert.ok(Object.keys(texts).length > 20, 'the scan reads README, PUBLIC-README, releases, site lt and web2 settings');
  assert.deepEqual(scanDeny(texts, kinds), []);
});

test('deny-list: app and downloadable version claims match their sources', () => {
  const { texts } = guarded();
  const siteRelease = fs.readFileSync(path.join(ROOT, 'site/src/data/release.ts'), 'utf8');
  const downloadable = siteRelease.match(/export const VERSION = '(\d+(?:\.\d+){2,3})'/)?.[1];
  assert.ok(downloadable, 'site release data names the downloadable version');
  assert.deepEqual(checkReadmeVersion(texts, currentVersion(ROOT), (v) => fs.existsSync(path.join(ROOT, `docs/releases/v${v}.md`)), downloadable), []);
  assert.match(texts['README.md'], new RegExp(`current downloadable version is ${downloadable.replace(/\./g, '\\.')}`));
});

test('deny-list: PUBLIC-README states the ranker figures from site/src/data/advantages.ts', () => {
  const adv = fs.readFileSync(path.join(ROOT, 'site/src/data/advantages.ts'), 'utf8');
  const hit = [...adv.matchAll(/\{ label: '([^']+)', value: ([\d.]+) \}/g)].map((m) => [m[1], m[2]]);
  const ranker = Object.fromEntries(hit);
  const pub = fs.readFileSync(path.join(ROOT, 'docs/PUBLIC-README.md'), 'utf8').replace(/\s+/g, ' ');
  assert.ok(pub.includes(`${ranker['Trained ranker']}%`), 'the trained ranker figure');
  assert.ok(pub.includes(`${ranker.grep}%`), 'the grep figure');
});

test('partial claims: no copy asserts a claim for an engine its gap says it does not hold on', () => {
  const { texts } = guarded();
  assert.deepEqual(checkEngineGuards(entries, texts), []);
  assert.ok(entries.some((e) => e.id === 'T2' && e.guard), 'the map claim is guarded');
});

test('partial claims: no quote of one in the public copy without its scope words', () => {
  const { texts } = guarded();
  assert.deepEqual(checkPartialScope(entries, texts), []);
});

/* ── negative and positive controls: each check must fail on a planted example ── */

test('control: the shape check fails on a bad entry', () => {
  const bad = [{ id: 'X1', text: 't', sources: ['a'], engines: ['cloud'], code: [], tests: [], status: 'partial' }, { id: 'X1', text: '', sources: [], engines: [], code: 'x', tests: [], status: 'maybe' }];
  const p = checkShape(bad).join('\n');
  assert.match(p, /engines must be/);
  assert.match(p, /needs a gap/);
  assert.match(p, /duplicate id/);
  assert.match(p, /status must be/);
});

test('control: the code check fails on a missing file, a missing symbol, and passes on a real one', () => {
  const fake = (code) => [{ id: 'X', code }];
  assert.deepEqual(checkCode(fake(['packages/analyzer/src/server/skillsDiscover.ts#defaultPlaces']), ROOT), []);
  assert.match(checkCode(fake(['packages/analyzer/src/server/nope.ts']), ROOT).join(), /file missing/);
  assert.match(checkCode(fake(['packages/analyzer/src/server/skillsDiscover.ts#noSuchSymbolAnywhere']), ROOT).join(), /does not declare noSuchSymbolAnywhere/);
  assert.ok(declares('export async function foo() {}', 'foo') && declares('const bar = 1;', 'bar') && !declares('// foo is mentioned here', 'foo'));
});

test('control: the tests check fails on a missing file', () => {
  assert.match(checkTests([{ id: 'X', tests: ['tools/ci/does-not-exist.test.mjs'] }], ROOT).join(), /tests file missing/);
  assert.deepEqual(checkTests([{ id: 'X', tests: ['tools/ci/claims.test.mjs'] }], ROOT), []);
});

test('control: the deny-list finds each planted phrase and excuses a stated correction', () => {
  const planted = {
    'a.md': 'There is no way to sign\nin with a ChatGPT subscription.\n\nIt managed 3% to\n9% of the time.\n\nAll 16 board tools, about 4.1k tokens.\n\nThe app has 8 surfaces.\n\nNo chart is taller than 420 px.',
  };
  const hits = scanDeny(planted, { 'a.md': 'readme' });
  for (const rule of DENY) assert.ok(hits.some((h) => h.includes(rule.id)), `planted phrase for ${rule.id} is found`);
  const corrected = { 'b.md': 'No chart is taller than 420 px. (Superseded in 0.1.5: no height cap.)' };
  assert.deepEqual(scanDeny(corrected, { 'b.md': 'past-release' }), []);
  assert.deepEqual(scanDeny({ 'c.md': 'A clean line about trained rankers.' }, { 'c.md': 'readme' }), []);
});

test('control: stale current-version strings fail in README and site copy, and a past release may name its own version', () => {
  const stale = {
    'README.md': "## What's new in 0.1.4\nThe current version is 0.1.4.",
    'lt/Get.tsx': 'Current release: 0.1.5. Download v0.1.5',
    'docs/releases/v0.1.4.md': '# Sequence 0.1.4\nThe current version is 0.1.4 in this note.',
  };
  const hits = scanDeny(stale, { 'README.md': 'readme', 'lt/Get.tsx': 'site', 'docs/releases/v0.1.4.md': 'past-release' });
  assert.ok(hits.some((h) => h.startsWith('README.md') && h.includes('stale-current-version')));
  assert.ok(hits.some((h) => h.startsWith('README.md') && h.includes('stale-whats-new')));
  assert.ok(hits.some((h) => h.startsWith('lt/Get.tsx') && h.includes('stale-current-version')));
  assert.ok(hits.some((h) => h.startsWith('lt/Get.tsx') && h.includes('stale-download')));
  assert.ok(!hits.some((h) => h.startsWith('docs/releases/v0.1.4.md')));
  assert.match(checkReadmeVersion({ 'README.md': 'The current version is 0.1.4.' }, '0.1.7').join(), /the app is 0.1.7/);
  assert.deepEqual(checkReadmeVersion({ 'README.md': 'The current version is 0.1.7.' }, '0.1.7'), []);
  /* A four-part release of the app's version is named when its notes exist; never one with no notes or of another three-part version. */
  const notes = (v) => v === '0.1.7.2';
  assert.deepEqual(checkReadmeVersion({ 'README.md': 'The current version is 0.1.7.2.' }, '0.1.7', notes), []);
  assert.match(checkReadmeVersion({ 'README.md': 'The current version is 0.1.7.3.' }, '0.1.7', notes).join(), /the app is 0.1.7/);
  assert.match(checkReadmeVersion({ 'README.md': 'The current version is 0.1.7.2.' }, '0.1.7').join(), /the app is 0.1.7/);
  assert.match(checkReadmeVersion({ 'README.md': 'The current version is 0.1.8.2.' }, '0.1.7', () => true).join(), /the app is 0.1.7/);
  assert.match(checkReadmeVersion({ 'README.md': 'The current downloadable version is 0.1.7.' }, '0.1.8', () => false, '0.1.8.2').join(), /the site offers 0.1.8.2/);
  assert.deepEqual(checkReadmeVersion({ 'README.md': 'The current downloadable version is 0.1.8.2.' }, '0.1.8', () => false, '0.1.8.2'), []);
});

test('control: a partial claim quoted without its scope words fails; with them, or when real, it passes', () => {
  const e = [{ id: 'T4', status: 'partial', text: 'the coverage line under each answer says how much of the map it actually drew on', scopeWords: ['built-in'], gap: 'g' }];
  const unscoped = { 'a.md': 'The coverage line under each answer says how much of the map it actually drew on.' };
  assert.match(checkPartialScope(e, unscoped).join(), /quotes T4/);
  const scoped = { 'a.md': 'On the built-in model, the coverage line under each answer says how much of the map it actually drew on.' };
  assert.deepEqual(checkPartialScope(e, scoped), []);
  assert.deepEqual(checkPartialScope([{ ...e[0], status: 'real' }], unscoped), []);
  assert.match(checkPartialScope([{ ...e[0], awaiting: '2.2' }], unscoped).join(), /quotes T4/, 'there is no exemption for a claim waiting on its build');
});

test('control: a gap that says an engine lacks the thing needs a guard, and the guard catches copy that asserts it', () => {
  const base = { id: 'G1', text: 't', sources: ['a'], engines: ['builtin'], code: [], tests: [], status: 'partial', gap: 'Claude and Codex do not receive it yet' };
  assert.match(checkShape([base]).join(), /needs a guard/);
  const guard = { topic: 'architecture map', words: 'Claude|Codex', unless: 'map tool|not yet' };
  assert.deepEqual(checkShape([{ ...base, guard }]), []);
  const bad = { 'Settings.tsx': 'The architecture map is sent once per chat thread to Claude and Codex.' };
  assert.match(checkEngineGuards([{ ...base, guard }], bad).join(), /asserts G1/);
  assert.deepEqual(checkEngineGuards([{ ...base, guard }], { 'Settings.tsx': "The architecture map is sent to Sequence's own model. Claude and Codex read it through the map tool." }), []);
  assert.deepEqual(checkEngineGuards([{ ...base, guard, status: 'real', gap: undefined }], bad), []);
});
