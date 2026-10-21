import assert from 'node:assert';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { killTreeWindows, signalGroup } from '../tree-kill';
import {
  archMatches,
  compareVersions,
  deleteList,
  isPlainFileOnDisk,
  registerUpdateOnQuit,
  shaFor,
  verifySignature,
  STRICT_VERSION,
  handoffFile,
  launchPendingUpdate,
  plainRelativeFile,
  shasumsUrl,
  type Handoff,
  type HandoffContext,
  type LaunchDeps,
} from '../updateHandoff';
import { APPIMAGE_SWAP_SCRIPT, MAC_SWAP_SCRIPT, PORTABLE_HELPER_SCRIPT } from '../updateScripts';

/*
 * The server leaves a REQUEST; main re-derives every command and trusts nothing it cannot anchor. These tests are the
 * attacks a hostile or buggy handoff.json could mount, each of which must be refused, and a positive control per kind.
 * Only a fake spawn is used for the update itself; the tree-kill test starts hidden node processes only.
 */

const WIN = process.platform === 'win32';
const tmp = (p: string): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));
const sha = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');

interface Spawned {
  cmd: string;
  args: string[];
  env: Record<string, string>;
  verbatim: boolean;
  detached: unknown;
  windowsHide: unknown;
  stdio: unknown;
}

/** A user dir with an updates folder, a fake spawn, and a SHASUMS256.txt that lists whatever the test says it lists. */
function rig(platform: string, extra: Partial<HandoffContext> = {}) {
  const userDir = tmp('seq-ho-user-');
  const updates = path.join(userDir, 'updates');
  fs.mkdirSync(updates, { recursive: true });
  const spawned: Spawned[] = [];
  const logs: string[] = [];
  const fetched: string[] = [];
  let sums = '';
  let reachable = true;
  const spawnFn = ((cmd: string, args: string[], opts: Record<string, unknown>) => {
    const env = Object.fromEntries(Object.entries((opts.env ?? {}) as Record<string, string>).filter(([k]) => k.startsWith('SEQ_')));
    spawned.push({ cmd, args, env, verbatim: !!opts.windowsVerbatimArguments, detached: opts.detached, windowsHide: opts.windowsHide, stdio: opts.stdio });
    return { on: () => undefined, unref: () => undefined };
  }) as unknown as typeof spawn;
  const deps: LaunchDeps = {
    spawnFn,
    log: (l) => void logs.push(l),
    fetchText: async (url) => {
      fetched.push(url);
      if (!reachable) throw new Error('offline');
      return sums;
    },
  };
  const ctx: HandoffContext = { userDir, platform, currentVersion: '0.1.7', arch: 'x64', execPath: '', pid: 4242, systemRoot: 'C:\\Windows', ...extra };
  const write = (h: Record<string, unknown>): void =>
    fs.writeFileSync(handoffFile(userDir), JSON.stringify({ v: 2, kind: 'nsis', version: '0.1.8', asset: 'Sequence.Setup.0.1.8.exe', createdAt: Date.now(), ...h }));
  return {
    userDir, updates, ctx, deps, spawned, logs, fetched, write,
    listing: (lines: Record<string, string>): void => void (sums = Object.entries(lines).map(([n, h]) => `${h}  ${n}`).join('\n') + '\n'),
    offline: (): void => void (reachable = false),
    pending: (): boolean => fs.existsSync(handoffFile(userDir)),
    run: (c: Partial<HandoffContext> = {}) => launchPendingUpdate({ ...ctx, ...c }, deps),
  };
}

const refused = async (r: ReturnType<typeof rig>, why: RegExp, label: string): Promise<void> => {
  const out = await r.run();
  assert.equal(out.launched, false, `${label}: launched`);
  assert.match(out.reason ?? '', why, label);
  assert.deepEqual(r.spawned, [], `${label}: nothing was spawned`);
  assert.equal(r.pending(), false, `${label}: the request is deleted`);
};

/* ── NSIS ──────────────────────────────────────────────────────────────────────────────────────────────────── */

test('nsis: a request whose file matches the SHASUMS256.txt main fetched itself launches with constant arguments, detached and hidden', { skip: !WIN }, async () => {
  const r = rig('win32');
  const exe = path.join(r.updates, 'Sequence Setup 0.1.8.exe');
  fs.writeFileSync(exe, 'real installer');
  r.listing({ 'Sequence Setup 0.1.8.exe': sha('real installer') });
  /* a hostile request tries to add its own command and arguments: they are not fields main reads */
  r.write({ staged: exe, cmd: 'C:\\Windows\\System32\\calc.exe', args: ['/D=C:\\x', '--evil'], env: { SEQ_APP: 'C:\\Users' } });
  const out = await r.run();
  assert.deepEqual(out, { launched: true });
  assert.deepEqual(r.fetched, [shasumsUrl('0.1.8')], 'main fetched the fixed release URL itself');
  assert.equal(shasumsUrl('0.1.8'), 'https://github.com/naidx0/sequence-arch-tool/releases/download/v0.1.8/SHASUMS256.txt');
  assert.equal(r.spawned.length, 1);
  assert.notEqual(r.spawned[0]!.cmd, exe, 'it runs main\'s private copy, not the staged file');
  assert.equal(path.dirname(r.spawned[0]!.cmd), r.updates);
  assert.match(path.basename(r.spawned[0]!.cmd), /^\.vetted-4242-[0-9a-f]{12}\.exe$/);
  assert.equal(fs.readFileSync(r.spawned[0]!.cmd, 'utf8'), 'real installer');
  assert.deepEqual(r.spawned[0]!.args, ['/S', '--force-run']);
  assert.deepEqual(r.spawned[0]!.env, {}, 'no environment from the request');
  assert.equal(r.spawned[0]!.detached, true);
  assert.equal(r.spawned[0]!.windowsHide, true);
  assert.equal(r.spawned[0]!.stdio, 'ignore');
  assert.equal(r.pending(), false, 'deleted before it ran: it cannot run twice');
});

test('probe A: an attacker-planted exe is refused whatever it claims (a self-attested hash is not a thing any more)', { skip: !WIN }, async () => {
  const r = rig('win32');
  const evil = path.join(r.updates, 'evil.exe');
  fs.writeFileSync(evil, 'MZ attacker payload');
  r.listing({ 'Sequence.Setup.0.1.8.exe': sha('the real installer') });
  r.write({ staged: evil, file: { path: evil, sha256: sha('MZ attacker payload') }, version: '9.9.9' });
  await refused(r, /does not list|SHASUMS/, 'planted exe, new version');
  const r2 = rig('win32');
  fs.writeFileSync(path.join(r2.updates, 'evil.exe'), 'MZ attacker payload');
  r2.listing({ 'Sequence.Setup.0.1.8.exe': sha('the real installer') });
  r2.write({ staged: path.join(r2.updates, 'evil.exe') });
  await refused(r2, /does not match SHASUMS256/, 'planted exe under a real asset name');
});

test('probe A2/B/G: a staged file outside the updates folder is refused (OS temp, System32, traversal, another user dir)', { skip: !WIN }, async () => {
  for (const [label, rel] of [
    ['OS temp', path.join(tmp('seq-ho-temp-'), 'x.exe')],
    ['System32', 'C:\\Windows\\System32\\calc.exe'],
    ['traversal', '..\\..\\e.exe'],
    ['a sibling folder that merely starts with updates', '..\\updates-evil\\x.exe'],
  ] as const) {
    const r = rig('win32');
    const staged = path.isAbsolute(rel) ? rel : path.join(r.updates, rel);
    r.write({ staged });
    await refused(r, /outside the updates folder/, label);
  }
});

test('characters that break a quoted argument are refused in the staged path', { skip: !WIN }, async () => {
  for (const bad of ['a"b.exe', 'a%PATH%.exe', 'a^b.exe', 'a&calc.exe', 'a|b.exe', 'a<b.exe', 'a>b.exe', 'a\u0001b.exe']) {
    const r = rig('win32');
    r.write({ staged: path.join(r.updates, bad) });
    await refused(r, /characters that are not allowed/, JSON.stringify(bad));
  }
});

test('version and age gates: not newer, equal, older, unparseable, a day old, or from the future are all dropped', async () => {
  for (const [label, over, why] of [
    ['equal', { version: '0.1.7' }, /not newer/],
    ['older', { version: '0.1.6.9' }, /not newer/],
    ['not a version', { version: '9.9.9; calc' }, /plain release version/],
    ['a day old', { createdAt: Date.now() - 25 * 3600_000 }, /older than 24 hours/],
    ['from the future', { createdAt: Date.now() + 3600_000 }, /older than 24 hours/],
    ['a wrong shape', { v: 1 }, /not a handoff/],
    ['an unknown kind', { kind: 'rm-rf' }, /not a handoff/],
    ['a kind for another OS', { kind: 'mac-swap', asset: 'Sequence-0.1.8-mac.zip' }, /does not apply/],
    ['an asset that does not fit the kind', { asset: 'evil.sh' }, /asset name/],
    ['an asset with a path in it', { asset: '..\\x.exe' }, /asset name/],
  ] as const) {
    const r = rig('win32');
    r.write({ staged: path.join(r.updates, 'x.exe'), ...over });
    await refused(r, why, label);
    assert.deepEqual(r.fetched, [], `${label}: nothing is fetched for a request that failed the cheap checks`);
  }
  assert.equal(compareVersions('0.1.7.1', '0.1.7'), 1, 'four-part: 0.1.7.1 is newer than 0.1.7');
  assert.equal(compareVersions('0.1.8', '0.1.7.9'), 1);
  assert.equal(compareVersions('0.1.7', '0.1.7.0'), 0);
  assert.equal(compareVersions('latest', '0.1.7'), null);
});

test('a four-part release newer than the running three-part app is accepted (0.1.7.1 over 0.1.7)', { skip: !WIN }, async () => {
  const r = rig('win32');
  const exe = path.join(r.updates, 'S.exe');
  fs.writeFileSync(exe, 'x');
  r.listing({ 'S.exe': sha('x') });
  r.write({ staged: exe, asset: 'S.exe', version: '0.1.7.1' });
  assert.equal((await r.run()).launched, true);
});

test('SHASUMS256.txt unreachable: nothing runs and the request is KEPT for the next quit; a missing line or a wrong hash deletes it', { skip: !WIN }, async () => {
  const r = rig('win32');
  const exe = path.join(r.updates, 'S.exe');
  fs.writeFileSync(exe, 'x');
  r.write({ staged: exe, asset: 'S.exe' });
  r.offline();
  const out = await r.run();
  assert.equal(out.launched, false);
  assert.equal(out.kept, true);
  assert.deepEqual(r.spawned, []);
  assert.equal(r.pending(), true, 'kept for next time');
  assert.match(r.logs.join('\n'), /kept/);
  const miss = rig('win32');
  fs.writeFileSync(path.join(miss.updates, 'S.exe'), 'x');
  miss.listing({ 'Other.exe': sha('x') });
  miss.write({ staged: path.join(miss.updates, 'S.exe'), asset: 'S.exe' });
  await refused(miss, /does not list/, 'asset absent from the listing');
});

/* ── portable ──────────────────────────────────────────────────────────────────────────────────────────────── */

/** An app folder as the build ships it, a verified zip in updates, and a new manifest read "from the zip". */
function portable(opts: { oldFiles?: string[]; ghost?: string[]; newFiles?: string[]; extra?: string; noManifest?: boolean; appName?: string } = {}) {
  const r = rig('win32');
  const app = path.join(tmp('seq-ho-app-'), opts.appName ?? 'A B', 'Sequence');
  const oldFiles = opts.oldFiles ?? ['Sequence.exe', 'resources/app.asar', 'old-only.dll', 'sub/old2.dll'];
  for (const f of oldFiles) {
    fs.mkdirSync(path.dirname(path.join(app, f)), { recursive: true });
    fs.writeFileSync(path.join(app, f), 'old');
  }
  if (!opts.noManifest) fs.writeFileSync(path.join(app, 'app-manifest.json'), JSON.stringify({ v: 1, files: [...oldFiles, ...(opts.ghost ?? [])] }));
  if (opts.extra) fs.writeFileSync(path.join(app, opts.extra), 'mine');
  const zip = path.join(r.updates, 'Sequence-0.1.8-win.zip');
  fs.writeFileSync(zip, 'zip bytes');
  r.listing({ 'Sequence-0.1.8-win.zip': sha('zip bytes') });
  r.deps.manifestFromZip = async () => opts.newFiles ?? ['Sequence.exe', 'resources/app.asar', 'new-only.dll'];
  r.ctx.execPath = path.join(app, 'Sequence.exe');
  const req = (over: Record<string, unknown> = {}): void => r.write({ kind: 'portable', asset: 'Sequence-0.1.8-win.zip', staged: zip, ...over });
  const snapshot = (): string => JSON.stringify(fs.readdirSync(app, { recursive: true }).sort());
  return { ...r, app, zip, req, snapshot };
}

test('portable: main writes the constant helper itself, derives app/exe/pid from its own process, and lists only old-minus-new manifest files', { skip: !WIN }, async () => {
  const p = portable();
  /* planted script at the very path main will use, and a request that tries to name its own env and delete list */
  fs.writeFileSync(path.join(p.updates, 'sequence-update-4242.cmd'), '@echo off\r\ncalc.exe\r\n');
  fs.writeFileSync(path.join(p.updates, 'delete-list.txt'), 'Documents\\taxes.xlsx\r\n');
  p.req({ env: { SEQ_APP: 'C:\\Users\\victim', SEQ_DELETE: path.join(p.updates, 'delete-list.txt') }, deleteList: 'Documents\\taxes.xlsx', args: ['/c', 'calc'], cmd: 'calc.exe' });
  const before = p.snapshot();
  const out = await p.run();
  assert.deepEqual(out, { launched: true });
  const s = p.spawned[0]!;
  assert.equal(s.cmd, 'C:\\Windows\\System32\\cmd.exe');
  const script = path.join(p.updates, 'sequence-update-4242.cmd');
  assert.deepEqual(s.args, ['/d', '/v:off', '/s', '/c', `""${script}""`]);
  assert.equal(s.verbatim, true);
  assert.equal(fs.readFileSync(script, 'utf8'), PORTABLE_HELPER_SCRIPT, 'the planted script was overwritten with main\'s constant text');
  assert.equal(s.env.SEQ_APP, path.dirname(p.ctx.execPath), 'the app folder is this process\'s own');
  assert.equal(s.env.SEQ_EXE, 'Sequence.exe');
  assert.equal(s.env.SEQ_PID, '4242');
  assert.match(path.basename(s.env.SEQ_ZIP), /^\.vetted-4242-[0-9a-f]{12}\.zip$/, 'the helper unpacks main\'s private copy');
  assert.equal(fs.readFileSync(s.env.SEQ_ZIP, 'utf8'), 'zip bytes');
  assert.ok(s.env.SEQ_STAGE.startsWith(p.updates));
  assert.equal(fs.readFileSync(s.env.SEQ_DELETE, 'utf8'), 'old-only.dll\r\nsub\\old2.dll\r\n', 'old manifest minus new manifest, nothing from the request');
  assert.equal(p.snapshot(), before, 'the app folder is untouched before quit');
});

test('portable: a folder with a file that is not in the manifest, no manifest, or no manifest in the zip is refused', { skip: !WIN }, async () => {
  const extra = portable({ extra: 'my-notes.txt' });
  extra.req();
  await refused(extra, /not Sequence's \(my-notes\.txt/, 'extra file');
  const none = portable({ noManifest: true });
  none.req();
  await refused(none, /no app-manifest\.json/, 'no manifest');
  const nz = portable();
  nz.deps.manifestFromZip = async () => null;
  nz.req();
  await refused(nz, /new zip has no app-manifest/, 'no manifest in the zip');
});

test('portable: characters that break quoting in the app or updates path are refused', { skip: !WIN }, async () => {
  for (const name of ['a&b', 'a%b', 'a^b', "a'b&c"]) {
    const p = portable({ appName: name });
    p.req();
    await refused(p, /characters that are not allowed/, name);
  }
});

test('probe D: delete-list entries must be plain files the OLD manifest lists and the new one lacks (no wildcards, reserved names, traversal)', () => {
  const old = ['ok.dll', '*', '?x', 'resources', 'a/../b', '../escape', '/abs', 'C:/x', 'CON', 'nul.txt', 'COM1.dll', 'trail.', 'sp ace ', 'q"uote', 'p%ct', 'a&b', 'has:colon', 'fine/sub.dll', 'Documents/taxes.xlsx'];
  const got = deleteList(old, ['Documents/taxes.xlsx']);
  assert.deepEqual(got, ['ok.dll', 'resources', 'fine/sub.dll'], 'only plain relative files; "resources" is a manifest FILE entry here, and a file in the new manifest is kept');
  assert.deepEqual(deleteList(['a', 'B.dll'], ['A', 'b.DLL']), [], 'case-insensitive');
  assert.equal(deleteList(['x.dll'], []).includes('app-manifest.json'), false);
  for (const bad of ['', '*', 'a*', 'a?', '..', '../x', 'a/./b', 'a//b', '\\x', 'C:\\x', 'LPT1', 'aux.cfg', 'a\\..\\b', 'x\u0007']) assert.equal(plainRelativeFile(bad), false, JSON.stringify(bad));
  assert.equal(plainRelativeFile('resources/app.asar'), true);
  assert.equal(plainRelativeFile('locales\\en-US.pak'), true);
});

test('probe D (end to end): a hostile OLD manifest cannot get "*" or a traversal into the delete list', { skip: !WIN }, async () => {
  const p = portable({ oldFiles: ['Sequence.exe', 'keep-me.dll'], ghost: ['*', 'a/../../x', 'CON'], newFiles: ['Sequence.exe', 'keep-me.dll'] });
  p.req();
  assert.equal((await p.run()).launched, true);
  assert.equal(fs.readFileSync(p.spawned[0]!.env.SEQ_DELETE, 'utf8'), '', 'nothing unsafe is listed');
});

/* ── mac and AppImage ──────────────────────────────────────────────────────────────────────────────────────── */

test('mac: bundle and temp folder come from main\'s own execPath, the script is main\'s constant, the request cannot name either', async () => {
  const r = rig('darwin', { execPath: '/Applications/Sequence.app/Contents/MacOS/Sequence', arch: 'arm64' });
  const zip = path.join(r.updates, 'mac-update.zip');
  fs.writeFileSync(zip, 'mac zip');
  r.listing({ 'Sequence-0.1.8-arm64-mac.zip': sha('mac zip') });
  fs.writeFileSync(path.join(r.updates, 'apply-update.sh'), 'rm -rf "$HOME"\n');
  r.write({ kind: 'mac-swap', asset: 'Sequence-0.1.8-arm64-mac.zip', staged: zip, args: ['x', '1', '/tmp/evil.app', '/Applications/Sequence.app', '/Users/v'], appBundle: '/Users/v', tmpDir: '/Users/v' });
  const out = await r.run();
  assert.deepEqual(out, { launched: true });
  const s = r.spawned[0]!;
  assert.equal(s.cmd, '/bin/sh');
  assert.deepEqual([s.args[0], s.args[1], s.args[3], s.args[4]], [path.join(r.updates, 'apply-update.sh'), '4242', '/Applications/Sequence.app', '/Applications/.Sequence-update-4242']);
  assert.match(path.basename(s.args[2]!), /^\.vetted-4242-[0-9a-f]{12}\.zip$/);
  assert.equal(fs.readFileSync(s.args[2]!, 'utf8'), 'mac zip');
  assert.equal(fs.readFileSync(s.args[0]!, 'utf8'), MAC_SWAP_SCRIPT, 'the planted script was replaced by the constant one');
  assert.doesNotMatch(MAC_SWAP_SCRIPT, /\/Users|\$HOME|\/tmp/, 'no path is baked into the script');
});

test('mac: a process that is not inside an .app is refused; a zip outside updates, or with a bad hash, is refused', async () => {
  const bare = rig('darwin', { execPath: '/usr/local/bin/node' });
  fs.writeFileSync(path.join(bare.updates, 'mac-update.zip'), 'z');
  bare.listing({ 'S-mac.zip': sha('z') });
  bare.write({ kind: 'mac-swap', asset: 'S-mac.zip', staged: path.join(bare.updates, 'mac-update.zip') });
  await refused(bare, /not inside an \.app/, 'no bundle');
  const out = rig('darwin', { execPath: '/Applications/Sequence.app/Contents/MacOS/Sequence' });
  out.listing({ 'S-mac.zip': sha('z') });
  out.write({ kind: 'mac-swap', asset: 'S-mac.zip', staged: path.join(tmp('seq-ho-else-'), 'z.zip') });
  await refused(out, /outside the updates folder/, 'zip elsewhere');
  const bad = rig('darwin', { execPath: '/Applications/Sequence.app/Contents/MacOS/Sequence' });
  fs.writeFileSync(path.join(bad.updates, 'mac-update.zip'), 'tampered');
  bad.listing({ 'S-mac.zip': sha('z') });
  bad.write({ kind: 'mac-swap', asset: 'S-mac.zip', staged: path.join(bad.updates, 'mac-update.zip') });
  await refused(bad, /does not match/, 'hash');
});

test('probe F: AppImage target is $APPIMAGE and the staged file is the one beside it named for main\'s pid; the request cannot redirect either', async () => {
  const home = tmp('seq-ho-home-');
  const target = path.join(home, 'Sequence.AppImage');
  fs.writeFileSync(target, 'old');
  const staged = path.join(home, '.Sequence.AppImage.update-4242');
  fs.writeFileSync(staged, 'new appimage');
  const r = rig('linux', { appImage: target });
  r.listing({ 'Sequence-0.1.8.AppImage': sha('new appimage') });
  r.write({ kind: 'appimage-swap', asset: 'Sequence-0.1.8.AppImage', staged: path.join(home, 'evil'), args: ['-c', 'id'], target: path.join(home, '.bashrc') });
  const out = await r.run();
  assert.deepEqual(out, { launched: true });
  const s = r.spawned[0]!;
  assert.equal(s.cmd, '/bin/sh');
  assert.deepEqual([s.args[0], s.args[1], s.args[3]], [path.join(r.updates, 'appimage-swap.sh'), '4242', target]);
  assert.equal(path.dirname(s.args[2]!), home, 'the private copy is beside the target, so the swap is one rename');
  assert.match(path.basename(s.args[2]!), /^\.vetted-4242-[0-9a-f]{12}$/);
  assert.equal(fs.readFileSync(s.args[2]!, 'utf8'), 'new appimage');
  assert.equal(fs.readFileSync(s.args[0]!, 'utf8'), APPIMAGE_SWAP_SCRIPT);
  assert.equal(fs.readFileSync(path.join(home, '.bashrc'), { flag: 'a+' }).length, 0, 'the other file was not touched');
});

test('probe F: no staged file beside $APPIMAGE, a relative or odd $APPIMAGE, or a tampered file is refused', async () => {
  const home = tmp('seq-ho-home2-');
  const target = path.join(home, 'S.AppImage');
  const none = rig('linux', { appImage: target });
  none.listing({ 'S-0.1.8.AppImage': sha('n') });
  none.write({ kind: 'appimage-swap', asset: 'S-0.1.8.AppImage' });
  await refused(none, /not there/, 'no staged file');
  for (const bad of ['relative.AppImage', path.join(home, 'a"b.AppImage'), '']) {
    const r = rig('linux', { appImage: bad });
    r.listing({ 'S-0.1.8.AppImage': sha('n') });
    r.write({ kind: 'appimage-swap', asset: 'S-0.1.8.AppImage' });
    await refused(r, /APPIMAGE/, JSON.stringify(bad));
  }
  fs.writeFileSync(path.join(home, '.S.AppImage.update-4242'), 'swapped bytes');
  const t = rig('linux', { appImage: target });
  t.listing({ 'S-0.1.8.AppImage': sha('n') });
  t.write({ kind: 'appimage-swap', asset: 'S-0.1.8.AppImage' });
  await refused(t, /does not match/, 'tampered');
});

test('the constant scripts bake in no path, take everything positionally or from the environment, and the portable one never purges', () => {
  assert.match(PORTABLE_HELPER_SCRIPT, /robocopy\.exe" "%SEQ_STAGE%" "%SEQ_APP%" \/E /);
  assert.doesNotMatch(PORTABLE_HELPER_SCRIPT, /\/MIR|\/PURGE|\/MOVE/i);
  assert.match(PORTABLE_HELPER_SCRIPT, /Wait-Process -Id \(\[int\]\$env:SEQ_PID\)/);
  assert.match(PORTABLE_HELPER_SCRIPT, /for \/f "usebackq delims=" %%F in \("%SEQ_DELETE%"\) do del \/f \/q "%SEQ_APP%\\%%F"/);
  assert.match(PORTABLE_HELPER_SCRIPT, /setlocal DisableDelayedExpansion/);
  assert.doesNotMatch(PORTABLE_HELPER_SCRIPT, /goto wait|:wait|tasklist|find\.exe|ping|timeout/i, 'no polling loop');
  assert.ok(PORTABLE_HELPER_SCRIPT.split('\r\n').every((l, i, all) => !/goto restart/.test(l) || all.indexOf(':restart') > i), 'every goto jumps forward');
  for (const sh of [MAC_SWAP_SCRIPT, APPIMAGE_SWAP_SCRIPT]) {
    assert.match(sh, /^#!\/bin\/sh/);
    assert.match(sh, /kill -0 "\$PID"/);
    assert.doesNotMatch(sh, /\/Users|\/home|\/tmp|\.AppImage\b(?!")/);
  }
  assert.ok(MAC_SWAP_SCRIPT.indexOf('kill -0') < MAC_SWAP_SCRIPT.indexOf('ditto'), 'wait first, then unpack');
  assert.ok(APPIMAGE_SWAP_SCRIPT.indexOf('kill -0') < APPIMAGE_SWAP_SCRIPT.indexOf('mv -f'), 'wait first, then swap');
});

/* ── round 3 ───────────────────────────────────────────────────────────────────────────────────────────────── */

/** The shape of a real release's SHASUMS256.txt (0.1.7): the installer is listed WITH SPACES, GitHub names the asset WITH DOTS. */
const REAL_SHASUMS = (exeHash: string): string =>
  [
    `${exeHash}  Sequence Setup 0.1.7.exe`,
    '39f83a157a207f94f1f31078818e064e3543cdfd2f9c6766e7e48c627a0f1d73  Sequence-0.1.7-amd64.deb',
    '73d97a90fea6e7d9ce6bcd2056874839bb81553afba92bfe8877b6b6f7560ab1  Sequence-0.1.7-arm64-mac.zip',
    'd67bb3bca6b5266eb15aefbfd6c8eb096af784c806809588ff33c1443a66cdae  Sequence-0.1.7-arm64.dmg',
    '6a4a0ddeac572d067a645fd5ead642697d95bd826b8c58ca03cde89bd7c5932e  Sequence-0.1.7-mac.zip',
    'e3e308654214a690836a3d8e69919eb885e145574a49419a0ddf4ed3a10edd3f  Sequence-0.1.7-win.zip',
    '2d79b70720172bcc51c8f57555f5739b111094f636ebad957c61277d2cbcaea0  Sequence-0.1.7.AppImage',
    'bfe48f6be32cee5e1901b349a92ee3ddc280df6b248a0b7289e88836b97730a9  Sequence-0.1.7.dmg',
    '',
  ].join('\n');

test('F1: the real SHASUMS format (spaced installer line) matches the dotted GitHub asset name the server sends', { skip: !WIN }, async () => {
  const r = rig('win32', { currentVersion: '0.1.6' });
  const exe = path.join(r.updates, 'Sequence.Setup.0.1.7.exe');
  fs.writeFileSync(exe, 'the real setup bytes');
  r.deps.fetchText = async () => REAL_SHASUMS(sha('the real setup bytes'));
  r.write({ staged: exe, version: '0.1.7', asset: 'Sequence.Setup.0.1.7.exe' });
  const out = await r.run({ currentVersion: '0.1.6' });
  assert.equal(out.launched, true, out.reason);
  const parsed = new Map([['Sequence Setup 0.1.7.exe', 'aa'], ['Sequence.Setup.0.1.7.exe', 'bb']]);
  assert.equal(shaFor(parsed, 'Sequence.Setup.0.1.7.exe'), 'bb', 'an exact name wins');
  assert.equal(shaFor(new Map([['Sequence Setup 0.1.7.exe', 'aa']]), 'Sequence.Setup.0.1.7.exe'), 'aa');
  assert.equal(shaFor(new Map([['Sequence Setup 0.1.7.exe', 'aa']]), 'Sequence-Setup-0.1.7.exe'), null);
});

test('TOCTOU: main hashes and runs a private copy; swapping the staged file afterwards, or during the fetch, changes nothing it runs', { skip: !WIN }, async () => {
  const r = rig('win32');
  const exe = path.join(r.updates, 'S.exe');
  fs.writeFileSync(exe, 'good');
  r.listing({ 'S.exe': sha('good') });
  r.write({ staged: exe, asset: 'S.exe' });
  const out = await r.run();
  assert.equal(out.launched, true);
  const ran = r.spawned[0]!.cmd;
  fs.writeFileSync(exe, 'MZ evil after the check');
  assert.equal(fs.readFileSync(ran, 'utf8'), 'good', 'the copy that runs is the copy that was hashed');
  assert.notEqual(ran, exe);
  /* swapped while SHASUMS is being fetched: the bytes copied are hashed, so the swap is caught */
  const r2 = rig('win32');
  const exe2 = path.join(r2.updates, 'S.exe');
  fs.writeFileSync(exe2, 'good');
  r2.listing({ 'S.exe': sha('good') });
  const inner = r2.deps.fetchText!;
  r2.deps.fetchText = async (u) => {
    fs.writeFileSync(exe2, 'MZ evil during the fetch');
    return inner(u);
  };
  r2.write({ staged: exe2, asset: 'S.exe' });
  await refused(r2, /does not match/, 'swap during the fetch');
  assert.deepEqual(fs.readdirSync(r2.updates).filter((n) => n.startsWith('.vetted-')), [], 'a rejected private copy is removed');
});

test('a junction at <userDir>/updates, or a symlinked staged file, is refused (no escape from the updates folder)', { skip: !WIN }, async () => {
  const base = tmp('seq-ho-junction-');
  const elsewhere = path.join(base, 'elsewhere');
  fs.mkdirSync(elsewhere);
  fs.writeFileSync(path.join(elsewhere, 'x.exe'), 'bytes');
  const user = path.join(base, 'user');
  fs.mkdirSync(user);
  fs.symlinkSync(elsewhere, path.join(user, 'updates'), 'junction');
  const spawned: string[] = [];
  const out = await (async () => {
    fs.writeFileSync(handoffFile(user), JSON.stringify({ v: 2, kind: 'nsis', version: '0.1.8', asset: 'x.exe', staged: path.join(user, 'updates', 'x.exe'), createdAt: Date.now() }));
    return launchPendingUpdate({ userDir: user, platform: 'win32', arch: 'x64', currentVersion: '0.1.7', execPath: 'C:\\app\\S.exe', pid: 1, systemRoot: 'C:\\Windows' }, {
      fetchText: async () => `${sha('bytes')}  x.exe\n`,
      spawnFn: ((c: string) => (spawned.push(c), { on: () => undefined, unref: () => undefined })) as unknown as typeof spawn,
    });
  })();
  assert.equal(out.launched, false);
  assert.match(out.reason ?? '', /link to somewhere else/);
  assert.deepEqual(spawned, []);
  /* a staged file that is itself a symlink */
  const r = rig('win32');
  const real = path.join(base, 'real.exe');
  fs.writeFileSync(real, 'bytes');
  try {
    fs.symlinkSync(real, path.join(r.updates, 'link.exe'), 'file');
  } catch {
    return; /* creating a file symlink needs a privilege this account may not have: the junction case above is the one that matters */
  }
  r.listing({ 'link.exe': sha('bytes') });
  r.write({ staged: path.join(r.updates, 'link.exe'), asset: 'link.exe' });
  await refused(r, /not a plain file/, 'symlinked file');
});

test('F2: a second instance does not register the update hook; the first does, runs it once, and quits after it', async () => {
  const handlers: ((e: { preventDefault(): void }) => void)[] = [];
  let quits = 0;
  const host = { on: (_ev: 'will-quit', fn: (e: { preventDefault(): void }) => void) => void handlers.push(fn), quit: () => void quits++ };
  let runs = 0;
  const run = async (): Promise<void> => void runs++;
  assert.equal(registerUpdateOnQuit(host, { firstInstance: false, smoke: false, run }), false, 'second instance');
  assert.equal(registerUpdateOnQuit(host, { firstInstance: true, smoke: true, run }), false, 'smoke mode');
  assert.equal(handlers.length, 0, 'nothing registered for either');
  assert.equal(registerUpdateOnQuit(host, { firstInstance: true, smoke: false, run }), true);
  let prevented = 0;
  handlers[0]!({ preventDefault: () => void prevented++ });
  handlers[0]!({ preventDefault: () => void prevented++ });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(runs, 1, 'the update runs once however many times will-quit fires');
  assert.equal(quits, 1);
  handlers[0]!({ preventDefault: () => void prevented++ });
  assert.equal(prevented, 2, 'once finished, the next will-quit is let through');
});

test('F2 (wiring): main.ts registers the hook with firstInstance, and the stop-timeout path does not run the update', () => {
  const main = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', 'main.ts'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(main, /registerUpdateOnQuit\(app, \{\n\s+firstInstance,\n\s+smoke: SMOKE,/);
  assert.doesNotMatch(main, /app\.on\('will-quit'/, 'no unconditional will-quit runner left');
  const timeout = main.slice(main.indexOf("if (how === 'timeout')"), main.indexOf("if (how === 'timeout')") + 80);
  assert.match(timeout, /app\.exit\(0\)/);
  assert.doesNotMatch(timeout, /launchPendingUpdate|runPendingUpdate/);
  assert.match(main, /currentVersion: appVersion\(\)/);
  assert.match(main, /arch: process\.arch/);
});

test('version strings must be exactly a plain release version: no leading v, zeros, spaces, suffixes or newline', async () => {
  for (const v of ['0.1.07', 'v0.1.8', ' 0.1.8', '0.1.8 ', '0.1.8\n', '0.1.8\t', '0.1.8-beta', '00.1.8', '1.2', '1.2.3.4.5', '0.1.8+x', '']) {
    assert.equal(STRICT_VERSION.test(v), false, JSON.stringify(v));
    const r = rig('win32');
    r.write({ staged: path.join(r.updates, 'x.exe'), version: v });
    await refused(r, /plain release version/, JSON.stringify(v));
    assert.deepEqual(r.fetched, [], 'no URL is built from a version that is not plain');
  }
  for (const v of ['0.1.8', '0.1.7.1', '10.20.30', '0.0.0.0']) assert.equal(STRICT_VERSION.test(v), true, v);
});

test('the asset is pinned to this CPU: an arm64 build is never run on x64 and the reverse', async () => {
  assert.equal(archMatches('Sequence-0.1.7-arm64-mac.zip', 'arm64'), true);
  assert.equal(archMatches('Sequence-0.1.7-arm64-mac.zip', 'x64'), false);
  assert.equal(archMatches('Sequence-0.1.7-mac.zip', 'arm64'), false);
  assert.equal(archMatches('Sequence-0.1.7-mac.zip', 'x64'), true);
  assert.equal(archMatches('Sequence-0.1.7-aarch64.AppImage', 'x64'), false);
  const intel = rig('darwin', { execPath: '/Applications/Sequence.app/Contents/MacOS/Sequence', arch: 'x64' });
  const zip = path.join(intel.updates, 'mac-update.zip');
  fs.writeFileSync(zip, 'arm zip');
  intel.listing({ 'Sequence-0.1.8-arm64-mac.zip': sha('arm zip') });
  intel.write({ kind: 'mac-swap', asset: 'Sequence-0.1.8-arm64-mac.zip', staged: zip });
  await refused(intel, /not for this CPU/, 'arm64 zip on an Intel mac');
  const arm = rig('darwin', { execPath: '/Applications/Sequence.app/Contents/MacOS/Sequence', arch: 'arm64' });
  arm.listing({ 'Sequence-0.1.8-mac.zip': sha('arm zip') });
  fs.writeFileSync(path.join(arm.updates, 'mac-update.zip'), 'arm zip');
  arm.write({ kind: 'mac-swap', asset: 'Sequence-0.1.8-mac.zip', staged: path.join(arm.updates, 'mac-update.zip') });
  await refused(arm, /not for this CPU/, 'x64 zip on Apple silicon');
});

test('delete list: a file that became a folder is kept; entries that are folders, links or reached through a link are not deleted', () => {
  assert.deepEqual(deleteList(['locales', 'a.dll', 'x/y'], ['locales/en.pak', 'a.dll', 'x/z']), ['x/y'], '"locales" is a folder in the new version');
  const app = tmp('seq-ho-del-');
  fs.mkdirSync(path.join(app, 'dir'));
  fs.writeFileSync(path.join(app, 'plain.dll'), 'x');
  fs.writeFileSync(path.join(app, 'dir', 'inner.dll'), 'x');
  const outside = tmp('seq-ho-outside-');
  fs.writeFileSync(path.join(outside, 'victim.txt'), 'precious');
  fs.symlinkSync(outside, path.join(app, 'jct'), 'junction');
  assert.equal(isPlainFileOnDisk(app, 'plain.dll'), true);
  assert.equal(isPlainFileOnDisk(app, 'dir/inner.dll'), true);
  assert.equal(isPlainFileOnDisk(app, 'dir'), false, 'a folder is not a file');
  assert.equal(isPlainFileOnDisk(app, 'jct'), false, 'a junction / reparse point');
  assert.equal(isPlainFileOnDisk(app, 'jct/victim.txt'), false, 'a file reached through a junction');
  assert.equal(isPlainFileOnDisk(app, 'missing.dll'), false);
  assert.equal(fs.readFileSync(path.join(outside, 'victim.txt'), 'utf8'), 'precious');
});

test('the portable helper names its tools by System32 path (robocopy, tar, powershell), not by PATH', () => {
  assert.match(PORTABLE_HELPER_SCRIPT, /"%SystemRoot%\\System32\\robocopy\.exe" "%SEQ_STAGE%"/);
  assert.match(PORTABLE_HELPER_SCRIPT, /"%SystemRoot%\\System32\\tar\.exe"/);
  assert.match(PORTABLE_HELPER_SCRIPT, /"%SystemRoot%\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe"/);
  assert.doesNotMatch(PORTABLE_HELPER_SCRIPT, /^(robocopy|tar|powershell|find|ping|timeout) /im);
});

test('signing: with a key pinned, main fetches SHASUMS256.txt.sig and refuses an unsigned or wrongly signed listing; unreachable keeps the request', { skip: !WIN }, async () => {
  const { generateKeyPairSync, sign } = await import('node:crypto');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const text = `${sha('good')}  S.exe\n`;
  const goodSig = sign(null, Buffer.from(text, 'utf8'), privateKey).toString('base64');
  const other = generateKeyPairSync('ed25519').privateKey;
  const badSig = sign(null, Buffer.from(text, 'utf8'), other).toString('base64');
  assert.equal(verifySignature(Buffer.from(text), goodSig, pem), true);
  assert.equal(verifySignature(Buffer.from(text), badSig, pem), false);
  assert.equal(verifySignature(Buffer.from(text + 'x'), goodSig, pem), false, 'a changed listing');
  assert.equal(verifySignature(Buffer.from(text), 'not base64!', pem), false);

  const make = (sigFor: (u: string) => string | Error) => {
    const r = rig('win32');
    fs.writeFileSync(path.join(r.updates, 'S.exe'), 'good');
    const urls: string[] = [];
    r.deps.signingKey = pem;
    r.deps.fetchText = async (u) => {
      urls.push(u);
      if (u.endsWith('.sig')) {
        const v = sigFor(u);
        if (v instanceof Error) throw v;
        return v;
      }
      return text;
    };
    r.write({ staged: path.join(r.updates, 'S.exe'), asset: 'S.exe' });
    return { r, urls };
  };
  const ok = make(() => goodSig);
  assert.equal((await ok.r.run()).launched, true);
  assert.deepEqual(ok.urls, [shasumsUrl('0.1.8'), `${shasumsUrl('0.1.8')}.sig`]);
  const bad = make(() => badSig);
  await refused(bad.r, /valid signature/, 'wrong key');
  const off = make(() => new Error('offline'));
  const kept = await off.r.run();
  assert.equal(kept.kept, true);
  assert.equal(off.r.pending(), true);
  /* with no key pinned the .sig is not even asked for (HTTPS from the fixed URL is the anchor) */
  const none = rig('win32');
  fs.writeFileSync(path.join(none.updates, 'S.exe'), 'good');
  none.listing({ 'S.exe': sha('good') });
  none.write({ staged: path.join(none.updates, 'S.exe'), asset: 'S.exe' });
  assert.equal((await none.run()).launched, true);
  assert.equal(none.fetched.length, 1);
});

/* ── the tree kill, measured with hidden node processes ─────────────────────────────────────────────────────── */

const BEAT = `
const fs = require('node:fs');
let n = 0;
const t = setInterval(() => { fs.appendFileSync(process.argv[2], '.'); if (++n >= Number(process.argv[4] || 240)) { clearInterval(t); process.exit(0); } }, Number(process.argv[3] || 250));
`;
const SERVER = `
const { spawn } = require('node:child_process');
const c = spawn(process.execPath, [process.argv[2], process.argv[3]], { detached: true, stdio: 'ignore', windowsHide: true });
c.unref();
setTimeout(() => process.exit(0), 15000);
`;

/* A beat is one byte APPENDED to the file, and the count is the file's size. The first form wrote the count with writeFileSync, which
   truncates before it writes: a read between the two saw an empty file, Number('') is 0, and "both helpers are running" failed on a
   helper that was running (a loaded machine widens that window). An append never makes the file shorter. */
const beats = (f: string): number => {
  try {
    return fs.statSync(f).size;
  } catch {
    return 0;
  }
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Wait until every file has a beat (a helper under load takes a moment to start) - a condition, not a longer guess. */
async function untilBeating(files: string[], ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end && !files.every((f) => beats(f) > 0)) await sleep(50);
}
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('the beat counter never reads lower than it has read (a writer that truncates before it writes would fail this), and a file that is not there counts 0', async () => {
  const dir = tmp('seq-ho-beat-');
  const script = path.join(dir, 'beat.js');
  fs.writeFileSync(script, BEAT);
  const file = path.join(dir, 'b.txt');
  assert.equal(beats(file), 0, 'no file: no beats');
  const child = spawn(process.execPath, [script, file, '1', '3000'], { stdio: 'ignore', windowsHide: true });
  try {
    await untilBeating([file], 20_000);
    let last = 0;
    let drops = 0;
    const end = Date.now() + 1200;
    while (Date.now() < end) {
      const b = beats(file);
      if (b < last) drops++;
      last = Math.max(last, b);
    }
    assert.ok(last > 0, 'the writer beat');
    assert.equal(drops, 0, 'the count never went down');
  } finally {
    child.kill();
  }
});

test('F1: a helper the SERVER starts dies in the quit tree kill; one MAIN starts through launchPendingUpdate survives it', { timeout: 60_000, skip: !WIN }, async () => {
  const dir = tmp('seq-ho-kill-');
  const beatScript = path.join(dir, 'beat.js');
  const serverScript = path.join(dir, 'server.js');
  fs.writeFileSync(beatScript, BEAT);
  fs.writeFileSync(serverScript, SERVER);
  const fromServer = path.join(dir, 'from-server.txt');
  const fromMain = path.join(dir, 'from-main.txt');
  const server: ChildProcess = spawn(process.execPath, [serverScript, beatScript, fromServer], { stdio: 'ignore', windowsHide: true, detached: !WIN });
  const pids: number[] = [server.pid!];
  try {
    /* a valid request through the real vetting; only the program is swapped for a heartbeat, the options are the code's own */
    const r = rig('win32');
    const exe = path.join(r.updates, 'Setup.exe');
    fs.writeFileSync(exe, 'x');
    r.listing({ 'Setup.exe': sha('x') });
    r.write({ staged: exe, asset: 'Setup.exe' });
    let mainChild: ChildProcess | null = null;
    r.deps.spawnFn = ((_cmd: string, _args: string[], opts: Record<string, unknown>) => {
      mainChild = spawn(process.execPath, [beatScript, fromMain], opts as never);
      pids.push(mainChild.pid!);
      return mainChild;
    }) as unknown as typeof spawn;
    await sleep(1200);
    const out = await r.run();
    assert.equal(out.launched, true, out.reason);
    await untilBeating([fromServer, fromMain], 20_000);
    assert.ok(beats(fromServer) > 0 && beats(fromMain) > 0, 'both helpers are running before the kill');

    /* quit: the desktop ends the server's tree */
    if (WIN) await killTreeWindows(server.pid!, 8000);
    else signalGroup(server.pid!, 'SIGKILL');
    await sleep(600);
    const a1 = beats(fromServer);
    const b1 = beats(fromMain);
    await sleep(1500);
    assert.equal(beats(fromServer), a1, 'NEGATIVE CONTROL: the helper the server started was killed with its tree');
    assert.ok(beats(fromMain) > b1, 'the helper main started kept running through the same kill');
  } finally {
    for (const p of pids) {
      try {
        process.kill(p);
      } catch {
        /* already gone */
      }
    }
  }
  await sleep(500);
  assert.ok(pids.every((p) => !alive(p)), 'every process this test started is gone');
});
