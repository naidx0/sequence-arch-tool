// Locks handoff item 18: every published bench number has a pinned dataset, a one-command reproduction, and a
// dry mode that resolves the plan from a clean checkout. node --test tools/bench/test/reproduce.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { lfSha256, loadRepos, verifySealed } from '../data/findfiles-heldout/download.mjs';
import { loadManifest, loadPrompts, sha256, testDrawings, verifyStatic } from '../data/ink-didi/download.mjs';
import { EXPECTED, SEALED_COMMIT, compare } from '../ink-bench.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.resolve(HERE, '..');
const ROOT = path.resolve(BENCH, '../..');
const run = (script, args, env = {}) => spawnSync(process.execPath, [path.join(BENCH, script), ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
const tmpCache = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bench-repro-'));
const hasTool = (n) => spawnSync(n, ['--version'], { stdio: 'ignore' }).status === 0;

test('ink: manifest pins agree with the sealed record and with the committed files', () => {
  const m = loadManifest();
  verifyStatic(m); // prompts.json and ink-didi-label.mjs against their sha256 pins (CR-insensitive)
  const sealed = fs.readFileSync(path.join(BENCH, 'ink-fresh-sealed.txt'), 'utf8');
  for (const [name, want] of [['drawings_ndjson_sha256', m.testDrawings.sha256], ['strokes_jsonl_sha256', m.strokes.sha256], ['labeller_sha256', m.labeller.sha256LF]]) {
    assert.equal(new RegExp(`^${name}: (\\w+)`, 'm').exec(sealed)?.[1], want, name);
  }
  assert.match(sealed, new RegExp(`strokes: ${m.strokes.count};`));
  assert.match(sealed, new RegExp(`${m.testDrawings.count} drawings`));
  assert.equal(m.source.rangeEnd - m.source.rangeStart + 1, m.source.ndjsonBytes - m.source.rangeStart);
  assert.equal(Object.keys(loadPrompts()).length, m.prompts.count);
  for (const [id, p] of Object.entries(loadPrompts())) {
    assert.match(id, /^[0-9a-f]{40}$/);
    assert.match(p.xdotSha256, /^[0-9a-f]{64}$/);
    assert.ok(p.png.length === 2 && p.png.every((x) => Number.isInteger(x) && x > 0), id);
  }
});

test('ink: a tampered pin or a tampered prompts file is refused, loudly', () => {
  const m = loadManifest();
  assert.throws(() => verifyStatic({ ...m, labeller: { ...m.labeller, sha256LF: '0'.repeat(64) } }), /HASH MISMATCH/);
  assert.throws(() => verifyStatic({ ...m, prompts: { ...m.prompts, sha256: '0'.repeat(64) } }), /HASH MISMATCH/);
  assert.throws(() => verifyStatic({ ...m, prompts: { ...m.prompts, count: m.prompts.count + 1 } }), /entries/);
});

test('ink: the test-split filter drops the partial first line and keeps only test rows (positive and negative control)', () => {
  const row = (split, k) => JSON.stringify({ key: k, label_id: 'x', split, writing_guide: {}, drawing: [] });
  const raw = Buffer.from(`1910.0, 1913.8, tail of a cut line\n${row('train', 'a')}\n${row('test', 'b')}\n${row('valid', 'c')}\n${row('test', 'd')}\n`);
  const t = testDrawings(raw, { testDrawings: { split: 'test' } });
  assert.deepEqual(t.lines.map((l) => JSON.parse(l).key), ['b', 'd']);
  assert.equal(t.text, `${row('test', 'b')}\n${row('test', 'd')}\n`);
  assert.equal(testDrawings(Buffer.from(`cut\n${row('train', 'a')}\n`), { testDrawings: { split: 'test' } }).lines.length, 0);
});

test('findfiles: the sealed sets verify, CRLF-insensitively, and a changed byte does not', () => {
  const v = verifySealed();
  assert.deepEqual(v.map((x) => x.file), ['questions.json', 'questions.v1.json']);
  for (const x of v) assert.ok(x.ok, `${x.file}: ${x.got} != ${x.want}`);
  assert.equal(v[0].want, '25c98b4152e5b5e7adb48a79e6aa552a2352563a57525e5d0f83de90bb24dde5'); // the v2 re-seal named in BENCH-PROGRAM.md
  const body = fs.readFileSync(path.join(BENCH, 'data/findfiles-heldout/questions.json'));
  const crlf = Buffer.from(body.toString('latin1').replace(/\r?\n/g, '\r\n'), 'latin1');
  assert.equal(lfSha256(crlf), lfSha256(body));
  assert.notEqual(lfSha256(Buffer.concat([body, Buffer.from(' ')])), lfSha256(body));
});

test('findfiles: every repo pin is an https GitHub URL with a full commit sha, and the set covers the sealed questions', () => {
  const repos = loadRepos();
  const q = JSON.parse(fs.readFileSync(path.join(BENCH, 'data/findfiles-heldout/questions.json'), 'utf8'));
  assert.deepEqual(q.repos.map((r) => r.id).sort(), repos.map((r) => r.id).sort());
  for (const r of repos) {
    assert.match(r.url, /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/, r.id);
    assert.match(r.sha, /^[0-9a-f]{40}$/, r.id);
  }
});

test('root package.json: bench:ink and bench:findfiles exist and point at real files', () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
  for (const name of ['bench:ink', 'bench:findfiles']) {
    const file = /node (\S+)/.exec(scripts[name] ?? '')?.[1];
    assert.ok(file, `${name} missing`);
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${name} -> ${file}`);
  }
});

test('ink: compare() flags a drifted number and passes the published ones (positive and negative control)', () => {
  const report = { strokes: EXPECTED.strokes, drawings: EXPECTED.drawings, grouped: { ...EXPECTED.grouped }, single: { ...EXPECTED.single } };
  assert.ok(compare(report).every((c) => c.ok));
  const drift = compare({ ...report, grouped: { ...report.grouped, snapRecall: 0.7693 } });
  assert.deepEqual(drift.filter((c) => !c.ok).map((c) => c.name), ['grouped snap recall']);
  assert.match(SEALED_COMMIT, /^[0-9a-f]{40}$/);
});

test('bench:ink --dry resolves the plan from a clean checkout layout and writes nothing', () => {
  const cache = tmpCache();
  const r = run('ink-bench.mjs', ['--dry', '--cache', cache]);
  const built = fs.existsSync(path.join(ROOT, 'packages/ink/dist/shapeGroup.js'));
  assert.match(r.stdout, /^bench:ink --dry/m, r.stderr); // not silent: the CLI entry guard fires on Windows paths too
  assert.match(r.stdout, /22890 strokes/);
  if (built) {
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /dry run ok/);
  } else {
    assert.equal(r.status, 1); // prerequisite named, not a crash
    assert.match(r.stdout, /MISSING\s+packages\/ink\/dist built/);
  }
  assert.deepEqual(fs.readdirSync(cache), [], 'dry mode must not download or write');
  fs.rmSync(cache, { recursive: true, force: true });
});

test('bench:ink --check verifies pins without a cache and without the network', () => {
  const cache = tmpCache();
  const r = run('ink-bench.mjs', ['--check', '--cache', cache]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /manifest ok/);
  assert.match(r.stdout, /cache empty/);
  assert.equal(run('ink-bench.mjs', ['--check', '--strict', '--cache', cache]).status, 1, '--strict fails on an empty cache');
  fs.rmSync(cache, { recursive: true, force: true });
});

test('bench:ink --check fails when a cached file differs from its pin', () => {
  const cache = tmpCache();
  fs.writeFileSync(path.join(cache, 'test-drawings.ndjson'), 'not the sealed drawings\n');
  const r = run('ink-bench.mjs', ['--check', '--cache', cache]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL test-drawings.ndjson hash differs/);
  fs.rmSync(cache, { recursive: true, force: true });
});

test('bench:findfiles --dry resolves the plan from a clean checkout layout and clones nothing', () => {
  const cache = tmpCache();
  const r = run('findfiles-bench.mjs', ['--dry', '--cache', cache]);
  const built = fs.existsSync(path.join(ROOT, 'packages/analyzer/dist/index.js'));
  assert.match(r.stdout, /^bench:findfiles --dry: question set v2 sha256 25c98b41/m, r.stderr);
  assert.match(r.stdout, /flask: 50 questions/);
  if (built && hasTool('git') && hasTool('rg')) {
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /dry run ok/);
  } else {
    assert.equal(r.status, 1); // a missing prerequisite is named and fails; it is never a silent pass
    assert.match(r.stdout, /MISSING /);
  }
  assert.deepEqual(fs.readdirSync(cache), [], 'dry mode must not clone');
  fs.rmSync(cache, { recursive: true, force: true });
});

test('findfiles download.mjs --check runs and verifies the sealed sets without cloning', () => {
  const cache = tmpCache();
  const r = spawnSync(process.execPath, [path.join(BENCH, 'data/findfiles-heldout/download.mjs'), '--check', '--cache', cache], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /ok\s+questions\.json sha256 25c98b41/);
  assert.equal(spawnSync(process.execPath, [path.join(BENCH, 'data/findfiles-heldout/download.mjs'), '--check', '--strict', '--cache', cache], { encoding: 'utf8' }).status, 1);
  fs.rmSync(cache, { recursive: true, force: true });
});

test('docs/bench/REPRODUCE.md names every pin, every command, and marks the v1 find_files set superseded', () => {
  const md = fs.readFileSync(path.join(ROOT, 'docs/bench/REPRODUCE.md'), 'utf8');
  const m = loadManifest();
  for (const h of [m.source.rawSliceSha256, m.testDrawings.sha256, m.strokes.sha256, m.labeller.sha256LF, m.prompts.sha256, '25c98b4152e5b5e7adb48a79e6aa552a2352563a57525e5d0f83de90bb24dde5', SEALED_COMMIT]) {
    assert.ok(md.includes(h), `REPRODUCE.md is missing ${h}`);
  }
  for (const cmd of ['pnpm bench:ink --published', 'pnpm bench:ink', 'pnpm bench:findfiles', 'pnpm bench:test', 'download.mjs --check']) assert.ok(md.includes(cmd), cmd);
  assert.match(md, /superseded/i);
  for (const r of loadRepos()) assert.ok(md.includes(r.sha), `REPRODUCE.md is missing the ${r.id} pin`);
  assert.equal(sha256(Buffer.from('')).length, 64);
});
