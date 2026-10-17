/*
 * The release smoke's own logic: arguments, the verdict, and each budget with a case that must PASS and a negative
 * control that must FAIL (or SKIP where the rule says a run that proves nothing is not a pass).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  BUDGETS,
  FAKE_KEY,
  STEPS,
  SERVER_SIZE_LIMIT_BYTES,
  buildEnv,
  descendants,
  dirSize,
  envLeaks,
  internalWordsIn,
  keyFileVerdict,
  keyFilesVerdict,
  norm,
  packagedCandidates,
  parseArgs,
  repoSecretsVerdict,
  scanForSecrets,
  serverSizeVerdict,
  slowScanVerdict,
  urlVerdict,
  verdict,
  windowShownVerdict,
  writeScaleRepo,
  writeSmallRepo,
  writeSynthRepo,
} from '../lib.mjs';

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `rs-test-${name}-`));
const allIds = [...STEPS, ...BUDGETS].map((s) => s.id);

test('the step and budget ids are unique and the steps are a..j in order', () => {
  assert.equal(new Set(allIds).size, allIds.length);
  assert.deepEqual(STEPS.map((s) => s.id), 'abcdefghij'.split(''));
});

test('parseArgs: values, flags, --only subset, and errors', () => {
  const a = parseArgs(['--app', 'x.exe', '--out', 'o', '--only', 'a, b,server-size', '--keep-temp']);
  assert.deepEqual([a.app, a.out, a.only, a.keepTemp, a.errors], ['x.exe', 'o', ['a', 'b', 'server-size'], true, []]);
  assert.match(parseArgs(['--app']).errors[0], /needs a value/);
  assert.match(parseArgs(['--app', '--out', 'o']).errors[0], /--app needs a value/);
  assert.match(parseArgs(['--frobnicate']).errors[0], /unknown argument/);
  assert.match(parseArgs(['--only', 'z']).errors[0], /unknown step/);
  assert.equal(parseArgs(['-h']).help, true);
});

test('verdict: all PASS exits 0; a FAIL, a SKIP or a missing result exits 1', () => {
  const pass = (id) => ({ id, status: 'PASS', reason: '' });
  assert.equal(verdict(allIds.map(pass), allIds).exitCode, 0);
  const oneFail = allIds.map(pass);
  oneFail[3] = { id: allIds[3], status: 'FAIL', reason: 'x' };
  assert.equal(verdict(oneFail, allIds).exitCode, 1);
  const oneSkip = allIds.map(pass);
  oneSkip[oneSkip.length - 1] = { id: allIds[allIds.length - 1], status: 'SKIP', reason: 'offline' };
  assert.equal(verdict(oneSkip, allIds).exitCode, 1, 'a SKIP never counts as a pass');
  const missing = verdict(allIds.slice(1).map(pass), allIds);
  assert.equal(missing.exitCode, 1);
  assert.match(missing.rows.find((r) => r.id === allIds[0]).reason, /did not run/);
  assert.equal(verdict([], []).exitCode, 1, 'nothing ran is not a pass');
});

test('window-shown budget: under 2 s passes, at or over fails, no number fails', () => {
  assert.equal(windowShownVerdict(1500).status, 'PASS');
  assert.equal(windowShownVerdict(2000).status, 'FAIL');
  assert.equal(windowShownVerdict(21000).status, 'FAIL');
  assert.equal(windowShownVerdict(undefined).status, 'FAIL');
});

test('server-size budget: a 1 MiB dir passes, a fake server dir over 60 MiB fails, a missing one fails', () => {
  const small = tmp('srv-small');
  fs.writeFileSync(path.join(small, 'a.bin'), Buffer.alloc(1024 * 1024));
  assert.equal(serverSizeVerdict(dirSize(small)).status, 'PASS');
  const big = tmp('srv-big');
  fs.mkdirSync(path.join(big, 'packages', 'analyzer'), { recursive: true });
  const fd = fs.openSync(path.join(big, 'packages', 'analyzer', 'blob.bin'), 'w');
  fs.ftruncateSync(fd, SERVER_SIZE_LIMIT_BYTES + 1024 * 1024);
  fs.closeSync(fd);
  assert.ok(dirSize(big) > SERVER_SIZE_LIMIT_BYTES, 'the planted dir is over the limit');
  assert.equal(serverSizeVerdict(dirSize(big)).status, 'FAIL');
  assert.equal(serverSizeVerdict(0, SERVER_SIZE_LIMIT_BYTES, false).status, 'FAIL');
  fs.rmSync(small, { recursive: true, force: true });
  fs.rmSync(big, { recursive: true, force: true });
});

test('repo-secrets budget: a clean .sequence passes; a planted sk- file, an unsaved key, no repo or an untrusted repo fails', () => {
  const repo = tmp('repo');
  const dotSeq = path.join(repo, '.sequence');
  const ok = { attached: repo, trusted: true, saved: true };
  fs.mkdirSync(path.join(dotSeq, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(dotSeq, 'graph.json'), '{"nodes":[]}');
  assert.equal(repoSecretsVerdict({ ...ok, dirs: [dotSeq] }).status, 'PASS');
  fs.writeFileSync(path.join(dotSeq, 'sessions', 'ai.json'), JSON.stringify({ apiKey: FAKE_KEY }));
  const leaked = repoSecretsVerdict({ ...ok, dirs: [dotSeq] });
  assert.equal(leaked.status, 'FAIL');
  assert.match(leaked.reason, /ai\.json/);
  /* Any sk- shaped key, not only the one this run saved. */
  fs.rmSync(path.join(dotSeq, 'sessions', 'ai.json'));
  fs.writeFileSync(path.join(dotSeq, 'other.txt'), 'token sk-ant-api03-abcdefghijklmnopqrstu');
  assert.equal(scanForSecrets(dotSeq).length, 1);
  assert.equal(repoSecretsVerdict({ ...ok, saved: false, savedReason: 'HTTP 400', dirs: [dotSeq] }).status, 'FAIL');
  /* Preconditions: a clean scan with no repo attached, or an untrusted repo, proves nothing. */
  fs.rmSync(path.join(dotSeq, 'other.txt'));
  assert.equal(repoSecretsVerdict({ ...ok, dirs: [dotSeq] }).status, 'PASS');
  assert.equal(repoSecretsVerdict({ ...ok, attached: null, dirs: [dotSeq] }).status, 'FAIL');
  assert.equal(repoSecretsVerdict({ ...ok, trusted: false, trustReason: 'HTTP 409', dirs: [dotSeq] }).status, 'FAIL');
  assert.deepEqual(scanForSecrets(path.join(repo, 'nope')), [], 'a missing dir holds no secret');
  fs.rmSync(repo, { recursive: true, force: true });
});

test('key-file budget: sealed passes; plain 0600 passes, plain 0644 fails; Windows ACL with Users fails', () => {
  const f = 'ai.json';
  assert.equal(keyFileVerdict({ file: f, platform: 'win32', content: '\u0001\u0002sealed-bytes' }).status, 'PASS');
  assert.equal(keyFileVerdict({ file: f, platform: 'linux', mode: 0o100600, content: FAKE_KEY }).status, 'PASS');
  assert.equal(keyFileVerdict({ file: f, platform: 'linux', mode: 0o100644, content: FAKE_KEY }).status, 'FAIL');
  assert.equal(keyFileVerdict({ file: f, platform: 'darwin', mode: undefined, content: FAKE_KEY }).status, 'FAIL');
  const own = `${f} NT AUTHORITY\\SYSTEM:(I)(F)\n    BUILTIN\\Administrators:(I)(F)\n    PC\\max:(I)(F)\n\nSuccessfully processed 1 files`;
  assert.equal(keyFileVerdict({ file: f, platform: 'win32', aclText: own, content: FAKE_KEY }).status, 'PASS');
  const wide = `${f} NT AUTHORITY\\SYSTEM:(I)(F)\n    BUILTIN\\Users:(I)(RX)\n`;
  assert.equal(keyFileVerdict({ file: f, platform: 'win32', aclText: wide, content: FAKE_KEY }).status, 'FAIL');
  assert.equal(keyFileVerdict({ file: f, platform: 'win32', aclText: `${f} Everyone:(R)`, content: FAKE_KEY }).status, 'FAIL');
  assert.equal(keyFileVerdict({ file: f, platform: 'win32', aclText: '', content: FAKE_KEY }).status, 'FAIL');
  assert.equal(keyFilesVerdict([]).status, 'FAIL', 'no user-level key file is a failure');
  assert.equal(keyFilesVerdict([{ status: 'PASS', reason: 'a' }, { status: 'FAIL', reason: 'b' }]).status, 'FAIL');
});

test('slow-scan budget: survived with the hook passes; died fails; survived without the hook is a SKIP', () => {
  assert.equal(slowScanVerdict({ hookHonoured: true, survived: true, watchedMs: 50000, detail: '' }).status, 'PASS');
  assert.equal(slowScanVerdict({ hookHonoured: true, survived: false, watchedMs: 31000, detail: 'quit' }).status, 'FAIL');
  assert.equal(slowScanVerdict({ hookHonoured: false, survived: false, watchedMs: 31000, detail: 'quit' }).status, 'FAIL');
  assert.equal(slowScanVerdict({ hookHonoured: false, survived: true, watchedMs: 50000, detail: '' }).status, 'SKIP');
});

test('url check: 200 passes, 404 fails, offline is a SKIP, no URL fails', () => {
  assert.equal(urlVerdict({ url: 'https://x', status: 200 }).status, 'PASS');
  assert.equal(urlVerdict({ url: 'https://x', status: 404 }).status, 'FAIL');
  assert.equal(urlVerdict({ url: 'https://x', error: 'ENOTFOUND' }).status, 'SKIP');
  assert.equal(urlVerdict({ url: null }).status, 'FAIL');
});

test('internal words are found as words, any case; plain copy has none', () => {
  assert.deepEqual(internalWordsIn('Path is outside the JAIL boundary (browseRoot)'), ['jail', 'boundary', 'browseRoot']);
  assert.deepEqual(internalWordsIn('Sequence can only open folders inside your home folder.'), []);
  assert.equal(norm('  Set a   long\nTask '), 'set a long task');
});

test('buildEnv: fake home, user store inside it, no keys, no real PATH; envLeaks catches the real home', () => {
  const base = { SystemRoot: 'C:\\Windows', PATH: 'C:\\Users\\max\\AppData\\Roaming\\npm', ANTHROPIC_API_KEY: 'sk-real', TEMP: 'C:\\T' };
  const env = buildEnv({ base, platform: 'win32', fakeHome: 'C:\\T\\home', gitDir: 'C:\\Git\\cmd' });
  assert.equal(env.USERPROFILE, 'C:\\T\\home');
  assert.equal(env.HOME, 'C:\\T\\home');
  assert.equal(env.SEQUENCE_USER_DIR, path.join('C:\\T\\home', '.sequence'));
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.ok(!env.PATH.includes('npm'), 'the real PATH (agent CLIs) is not inherited');
  assert.ok(env.PATH.includes('C:\\Git\\cmd'));
  assert.deepEqual(envLeaks(env, 'C:\\Users\\max'), []);
  assert.ok(envLeaks({ ...env, USERPROFILE: 'C:\\Users\\max' }, 'C:\\Users\\max').length > 0, 'negative control: the real home is a leak');
  assert.ok(envLeaks({ ...env, OPENAI_API_KEY: 'x' }, 'C:\\Users\\max').length > 0, 'negative control: a key is a leak');
  const posix = buildEnv({ base: { LANG: 'C' }, platform: 'linux', fakeHome: '/tmp/h', gitDir: null });
  assert.equal(posix.XDG_CONFIG_HOME, path.join('/tmp/h', '.config'));
});

test('packaged app candidates match tools/desktop-smoke.mjs', () => {
  assert.equal(path.basename(packagedCandidates('r', 'win32')[0]), 'Sequence.exe');
  assert.equal(packagedCandidates('r', 'darwin').length, 2);
  assert.equal(path.basename(packagedCandidates('r', 'linux')[0]), 'sequence');
});

test('fixtures: the synthetic repo has the asked-for module count; the small repo has its files', () => {
  const root = tmp('synth');
  writeSynthRepo(path.join(root, 'big'), 250);
  const count = fs.readdirSync(path.join(root, 'big', 'src'), { recursive: true }).filter((f) => String(f).endsWith('.ts')).length;
  assert.equal(count, 250);
  writeSmallRepo(path.join(root, 'small'));
  assert.ok(fs.existsSync(path.join(root, 'small', 'src', 'a.ts')));
  /* The scale repo copies real code files only, and tops up with synthetic modules to the asked-for count. */
  const pk = path.join(root, 'packages');
  fs.mkdirSync(path.join(pk, 'one', 'src', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(pk, 'one', 'src', 'a.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(pk, 'one', 'src', 'deep', 'b.tsx'), 'export const b = 2;\n');
  fs.writeFileSync(path.join(pk, 'one', 'src', 'notes.md'), '# not code\n');
  assert.equal(writeScaleRepo(path.join(root, 'scale'), pk, 10), 10);
  assert.ok(fs.existsSync(path.join(root, 'scale', 'one', 'src', 'deep', 'b.tsx')));
  assert.ok(!fs.existsSync(path.join(root, 'scale', 'one', 'src', 'notes.md')));
  assert.equal(fs.readdirSync(path.join(root, 'scale', 'synthetic', 'src'), { recursive: true }).filter((f) => String(f).endsWith('.ts')).length, 8);
  fs.rmSync(root, { recursive: true, force: true });
});

test('descendants: the whole tree under a pid, nothing else', () => {
  const rows = [
    { pid: 10, ppid: 1 },
    { pid: 11, ppid: 10 },
    { pid: 12, ppid: 11 },
    { pid: 20, ppid: 1 },
  ];
  assert.deepEqual(descendants(rows, 10).map((r) => r.pid).sort(), [11, 12]);
  assert.deepEqual(descendants(rows, 99), []);
});

test('slow-scan survival: stayed up and reached the app URL passes; a data: boot page at the end fails', async () => {
  const { slowScanSurvival } = await import('../lib.mjs');
  const up = { quit: false, mainAnswered: true, becameVisible: true, hiddenAfterShown: false, finalUrl: 'http://127.0.0.1:5123/', statusAnswered: true, bootTexts: ['Reading 120 of 3,000 files…'] };
  const ok = slowScanSurvival(up);
  assert.equal(ok.survived, true);
  assert.match(ok.detail, /Reading 120 of 3,000/);
  /* Negative control: still on the data: boot page, no http load at the end. */
  const stuck = slowScanSurvival({ ...up, finalUrl: 'data:text/html;charset=utf-8,%3C!doctype', statusAnswered: false });
  assert.equal(stuck.survived, false);
  assert.match(stuck.detail, /never reached the app URL/);
  assert.equal(slowScanSurvival({ ...up, quit: true }).survived, false);
  assert.equal(slowScanSurvival({ ...up, mainAnswered: false }).survived, false);
  assert.equal(slowScanSurvival({ ...up, hiddenAfterShown: true }).survived, false);
  assert.equal(slowScanSurvival({ ...up, becameVisible: false }).survived, false);
  assert.equal(slowScanSurvival({ ...up, statusAnswered: false }).survived, false);
});

test('release notes: own link is exact (not fetched); published links must answer 200; 404 fails; offline skips', async () => {
  const { releaseNotesVerdict, RELEASES_URL } = await import('../lib.mjs');
  const own = `${RELEASES_URL}0.1.8.1`;
  assert.equal(own, 'https://github.com/naidx0/sequence-arch-tool/releases/tag/v0.1.8.1');
  const pub = [
    { version: '0.1.8', url: `${RELEASES_URL}0.1.8`, status: 200 },
    { version: '0.1.7.1', url: `${RELEASES_URL}0.1.7.1`, status: 200 },
  ];
  assert.equal(releaseNotesVerdict({ appVersion: '0.1.8.1', ownUrl: own, published: pub }).status, 'PASS');
  /* (a) the own link must be exactly the tag page for this version. */
  assert.equal(releaseNotesVerdict({ appVersion: '0.1.8.1', ownUrl: `${RELEASES_URL}0.1.8`, published: pub }).status, 'FAIL');
  assert.equal(releaseNotesVerdict({ appVersion: '0.1.8.1', ownUrl: 'https://github.com/naidx0/sequence-arch-tool/blob/main/CHANGELOG.md', published: pub }).status, 'FAIL');
  assert.equal(releaseNotesVerdict({ appVersion: '0.1.8.1', ownUrl: null, published: pub }).status, 'FAIL');
  assert.equal(releaseNotesVerdict({ appVersion: null, ownUrl: own, published: pub }).status, 'FAIL');
  /* (b) negative control: a published version's link answering 404 fails. */
  const r404 = releaseNotesVerdict({ appVersion: '0.1.8.1', ownUrl: own, published: [pub[0], { ...pub[1], status: 404 }] });
  assert.equal(r404.status, 'FAIL');
  assert.match(r404.reason, /v0\.1\.7\.1 .* 404/);
  assert.equal(releaseNotesVerdict({ appVersion: '0.1.8.1', ownUrl: own, published: [] }).status, 'FAIL', 'nothing published to check is not a pass');
  assert.equal(releaseNotesVerdict({ appVersion: '0.1.8.1', ownUrl: own, published: [{ ...pub[0], status: undefined, error: 'ENOTFOUND' }] }).status, 'SKIP');
  assert.equal(releaseNotesVerdict({ appVersion: '0.1.8.1', ownUrl: own, published: [{ ...pub[0], status: undefined, error: 'ENOTFOUND' }, { ...pub[1], status: 404 }] }).status, 'FAIL', 'a 404 fails even when another link is offline');
});

test('parseArgs: --release-dir', () => {
  assert.equal(parseArgs(['--release-dir', 'x/release']).releaseDir, 'x/release');
  assert.deepEqual(parseArgs(['--', '--release-dir', 'r']).errors, [], 'pnpm run passes a bare -- through');
  assert.match(parseArgs(['--release-dir']).errors[0], /needs a value/);
});
