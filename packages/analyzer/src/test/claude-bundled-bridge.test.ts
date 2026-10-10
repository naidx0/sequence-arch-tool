import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { BRIDGE_ENV, BUNDLED_BRIDGE_FILE, bundledBridgePath, bundledBridgeUsable, executableFromResolved, resolveClaudeExecutable } from '../server/claudeCli.js';
import { agentLaunch, createProviderProbe, defaultExtraDirs, rememberBinDir, type ProviderStatus } from '../server/providerProbe.js';
import { compareVersions, defaultClaudeDirs, LAUNCHER_FILE, launcherPath, MIN_CLAUDE_VERSION } from '../server/claudeCli.js';
import type { BridgeProvisioner, BridgeSetupStatus } from '../server/claudeBridgeInstall.js';

/**
 * Claude without an install step: the bridge ships inside the app, runs the person's own `claude`,
 * and a signed-in `claude` is Ready with no bridge install. Every binary here is a FAKE in a temp dir.
 */

const CAP = 15_000;
/** On Windows `claude` must be a real npm shim around a native binary (see executableFromResolved); a fake that answers `auth status --json` cannot be one, so the Ready-path tests that need it run where a script can stand in. */
const NO_FAKE_CLAUDE_ON_WINDOWS = process.platform === 'win32' ? 'a fake claude cannot be a native binary on Windows' : false;
const tmp = (p: string): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));

function fakeClaude(dir: string, signedIn: boolean): void {
  const answer = signedIn ? JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' }) : JSON.stringify({ loggedIn: false, authMethod: 'none' });
  fs.writeFileSync(path.join(dir, 'fake.mjs'), `const a = process.argv.slice(2).join(' ');\nif (a === '--version') console.log('2.1.280 (Claude Code)');\nelse if (a === 'auth status --json') { console.log(${JSON.stringify(answer)}); process.exitCode = ${signedIn ? 0 : 1}; }\nelse { console.error('unknown ' + a); process.exitCode = 2; }\n`);
  if (process.platform === 'win32') fs.writeFileSync(path.join(dir, 'claude.cmd'), `@"${process.execPath}" "%~dp0fake.mjs" %*\r\n`);
  else {
    const p = path.join(dir, 'claude');
    fs.writeFileSync(p, `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, 'fake.mjs')}" "$@"\n`);
    fs.chmodSync(p, 0o755);
  }
}

function fakeBundle(dir: string): string {
  const p = path.join(dir, BUNDLED_BRIDGE_FILE);
  fs.writeFileSync(p, '// bundle stand-in\n');
  return p;
}

function fakeGlobalBridge(dir: string): void {
  if (process.platform === 'win32') fs.writeFileSync(path.join(dir, 'claude-agent-acp.cmd'), '@exit /b 0\r\n');
  else {
    fs.writeFileSync(path.join(dir, 'claude-agent-acp'), '#!/bin/sh\nexit 0\n');
    fs.chmodSync(path.join(dir, 'claude-agent-acp'), 0o755);
  }
}

const claudeOf = (list: ProviderStatus[]): ProviderStatus => list.find((p) => p.id === 'claude')!;

test('bundledBridgePath: named file wins, "none" means none, else the file beside dist/ is found by walking up', () => {
  const root = tmp('seq-bridge-path-');
  const bundle = fakeBundle(root);
  assert.equal(bundledBridgePath({ [BRIDGE_ENV]: bundle }, root), bundle);
  assert.equal(bundledBridgePath({ [BRIDGE_ENV]: 'none' }, root), null, '"none" disables the bundle');
  assert.equal(bundledBridgePath({ [BRIDGE_ENV]: path.join(root, 'missing.mjs') }, root), null, 'a named file that is gone is not guessed around');
  assert.equal(bundledBridgePath({ [BRIDGE_ENV]: 'relative.mjs' }, root), null, 'a relative name is never searched against the cwd');
  /* two known places only: beside the server bundle (dist/) and one up from dist/server; never a deeper walk */
  const dist = path.join(root, 'packages', 'analyzer', 'dist');
  fs.mkdirSync(path.join(dist, 'server', 'deeper'), { recursive: true });
  const inDist = fakeBundle(dist);
  assert.equal(bundledBridgePath({}, dist), inDist);
  assert.equal(bundledBridgePath({}, path.join(dist, 'server')), inDist);
  assert.equal(bundledBridgePath({}, path.join(dist, 'server', 'deeper')), null, 'two levels down is not searched');
  assert.equal(bundledBridgePath({}, tmp('seq-bridge-empty-')), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('resolveClaudeExecutable: the user\'s own claude on PATH, an existing CLAUDE_CODE_EXECUTABLE as is, nothing when absent', () => {
  const bin = tmp('seq-claude-bin-');
  fakeClaude(bin, true);
  if (process.platform !== 'win32') {
    assert.deepEqual(resolveClaudeExecutable({ pathValue: bin, extraDirs: [], env: {} }), { path: path.join(bin, 'claude') });
  }
  assert.equal(resolveClaudeExecutable({ pathValue: tmp('seq-claude-none-'), extraDirs: [], env: {} }), null);
  const own = path.join(bin, 'claude');
  if (process.platform !== 'win32') assert.deepEqual(resolveClaudeExecutable({ pathValue: '', extraDirs: [], env: { CLAUDE_CODE_EXECUTABLE: own } }), { path: own });
  /* a JS entry is never started: the SDK would run it as a bare `node` from the opened repo */
  assert.equal(resolveClaudeExecutable({ pathValue: '', extraDirs: [], env: { CLAUDE_CODE_EXECUTABLE: path.join(bin, 'fake.mjs') } }), null);
  assert.equal(resolveClaudeExecutable({ pathValue: '', extraDirs: [], env: { CLAUDE_CODE_EXECUTABLE: path.join(bin, 'gone') } }), null, 'a stale override is not trusted');
  /* a relative PATH entry is never searched: the opened repo must not supply `claude` */
  assert.equal(resolveClaudeExecutable({ pathValue: '.', extraDirs: [], env: {} }), null);
  fs.rmSync(bin, { recursive: true, force: true });
});

test('Windows: a .cmd shim resolves to the native binary it wraps; a JS-entry shim (claude before 2.1.113) is not driven', () => {
  const dir = tmp('seq-claude-shim-');
  const head = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n';
  const pkg = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code');
  fs.mkdirSync(path.join(pkg, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'cli.js'), '');
  fs.writeFileSync(path.join(pkg, 'bin', 'claude.exe'), '');
  fs.writeFileSync(path.join(dir, 'js.cmd'), `${head}\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n`);
  assert.equal(executableFromResolved(path.join(dir, 'js.cmd'), [dir], {}), null);
  fs.writeFileSync(path.join(dir, 'native.cmd'), `${head}"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n`);
  assert.deepEqual(executableFromResolved(path.join(dir, 'native.cmd'), [dir], {}), { path: path.join(pkg, 'bin', 'claude.exe') });
  fs.writeFileSync(path.join(dir, 'custom.cmd'), '@echo off\r\ncall other.bat %*\r\n');
  assert.equal(executableFromResolved(path.join(dir, 'custom.cmd'), [dir], {}), null);
  assert.equal(bundledBridgeUsable({ bridge: '/x/claude-agent-acp.mjs', pathValue: dir, extraDirs: [], env: {} }), null, 'no claude on PATH: the bundle is not usable');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Claude Code before 2.1.40 has no `auth status --json`: the card says Update Claude Code, not "did not answer cleanly"; the floor is the first native npm release', async () => {
  assert.equal(MIN_CLAUDE_VERSION, '2.1.113');
  const bin = tmp('seq-nojson-');
  fs.writeFileSync(path.join(bin, 'fake.mjs'), `const a = process.argv.slice(2).join(' ');\nif (a === '--version') console.log('2.1.30 (Claude Code)');\nelse { console.error("error: unknown option '--json'"); process.exitCode = 1; }\n`);
  if (process.platform === 'win32') fs.writeFileSync(path.join(bin, 'claude.cmd'), `@"${process.execPath}" "%~dp0fake.mjs" %*\r\n`);
  else {
    fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(bin, 'fake.mjs')}" "$@"\n`);
    fs.chmodSync(path.join(bin, 'claude'), 0o755);
  }
  const c = claudeOf((await createProviderProbe({ pathValue: bin, extraDirs: [], capMs: CAP, bundledBridge: fakeBundle(tmp('seq-nojson-b-')), bridgeProvisioner: null }).get()).providers);
  assert.equal(c.state, 'update');
  assert.equal(c.minVersion, '2.1.113');
  fs.rmSync(bin, { recursive: true, force: true });
});

test('onboarding states: signed-in claude + bundled bridge is Ready with NO install step; signed-out is only "Sign in"', { skip: NO_FAKE_CLAUDE_ON_WINDOWS }, async () => {
  const bin = tmp('seq-ready-');
  const bundle = fakeBundle(tmp('seq-ready-bundle-'));
  fakeClaude(bin, true);
  const ready = claudeOf((await createProviderProbe({ pathValue: bin, extraDirs: [], capMs: CAP, bundledBridge: bundle, bridgeProvisioner: null }).get()).providers);
  assert.equal(ready.state, 'ready');
  assert.equal(ready.bridge, 'bundled');
  assert.equal(ready.bridgeMissing, undefined, 'nothing to install, so the Install bridge button has no reason to show');
  assert.equal(ready.adapterInstall, undefined);
  assert.equal(ready.plan, 'Claude Max');

  fakeClaude(bin, false);
  const out = claudeOf((await createProviderProbe({ pathValue: bin, extraDirs: [], capMs: CAP, bundledBridge: bundle, bridgeProvisioner: null }).get()).providers);
  assert.equal(out.state, 'signIn');
  assert.equal(out.bridgeMissing, undefined, 'only Sign in remains: not "Install bridge and sign in"');
  assert.equal(out.adapterInstall, undefined);
  fs.rmSync(bin, { recursive: true, force: true });
});

test('onboarding states: no bundle and no global bridge is still "adapter" (install offered); a global bridge alone is Ready as before', async () => {
  const bin = tmp('seq-nobundle-');
  fakeClaude(bin, true);
  const none = claudeOf((await createProviderProbe({ pathValue: bin, extraDirs: [], capMs: CAP, bundledBridge: null, bridgeProvisioner: null }).get()).providers);
  assert.equal(none.state, 'adapter');
  assert.equal(none.bridgeMissing, true);
  assert.match(none.adapterInstall ?? '', /^npm install -g /);
  fakeGlobalBridge(bin);
  const global = claudeOf((await createProviderProbe({ pathValue: bin, extraDirs: [], capMs: CAP, bundledBridge: null, bridgeProvisioner: null }).get()).providers);
  assert.equal(global.state, 'ready');
  assert.equal(global.bridge, 'global');
  fs.rmSync(bin, { recursive: true, force: true });
});

test('launch path: bundled bridge runs under this process\'s node by absolute path; the global bridge is the fallback; neither says what is missing', { skip: NO_FAKE_CLAUDE_ON_WINDOWS }, () => {
  const bin = tmp('seq-launch-');
  const bundle = fakeBundle(tmp('seq-launch-bundle-'));
  fakeClaude(bin, true);
  fakeGlobalBridge(bin);
  const l = agentLaunch('claude', { pathValue: bin, extraDirs: [], bundledBridge: bundle, bridgeProvisioner: null });
  assert.deepEqual(l, { ok: true, command: process.execPath, args: [bundle], label: 'Claude Code' });
  assert.ok(path.isAbsolute(bundle) && path.isAbsolute((l as { command: string }).command), 'no bare names: a Windows spawn does not search the cwd');
  assert.match(path.basename(bundle), /claude-agent-acp/, 'agentKindOf reads this name as the Claude bridge (access modes, _meta)');

  const fallback = agentLaunch('claude', { pathValue: bin, extraDirs: [], bundledBridge: null, bridgeProvisioner: null });
  assert.equal(fallback.ok, true);
  if (fallback.ok && process.platform !== 'win32') assert.equal(fallback.command, path.join(bin, 'claude-agent-acp'));

  fs.rmSync(path.join(bin, process.platform === 'win32' ? 'claude-agent-acp.cmd' : 'claude-agent-acp'));
  const neither = agentLaunch('claude', { pathValue: bin, extraDirs: [], bundledBridge: null, bridgeProvisioner: null });
  assert.equal(neither.ok, false);
  /* a bundle with no claude to drive is not a launch either */
  const noClaude = agentLaunch('claude', { pathValue: tmp('seq-launch-empty-'), extraDirs: [], bundledBridge: bundle, bridgeProvisioner: null });
  assert.equal(noClaude.ok, false);
  fs.rmSync(bin, { recursive: true, force: true });
});


/* ---- the default path: the bridge is downloaded on first use ---- */

function fakeProvisioner(init: { entry?: string | null; status?: Partial<BridgeSetupStatus> }): BridgeProvisioner & { starts: number } {
  const p = {
    starts: 0,
    entry: () => init.entry ?? null,
    status: (): BridgeSetupStatus => ({ state: 'idle', receivedBytes: 0, files: 0, totalFiles: 106, failures: 0, ...init.status }),
    start() {
      p.starts++;
    },
    idle: async () => {},
  };
  return p;
}

test('the launcher is built with the analyzer (a missing build fails here, it is not skipped)', () => {
  assert.ok(launcherPath(), `${LAUNCHER_FILE} is missing from dist/: pnpm --filter @sequence/analyzer build`);
});

test('onboarding: a downloaded bridge makes a signed-in claude Ready with no install step, launched through the launcher by absolute paths', { skip: NO_FAKE_CLAUDE_ON_WINDOWS }, async () => {
  const bin = tmp('seq-dl-ready-');
  fakeClaude(bin, true);
  const entry = path.join(tmp('seq-dl-tree-'), 'index.js');
  fs.writeFileSync(entry, '');
  const prov = fakeProvisioner({ entry });
  const ready = claudeOf((await createProviderProbe({ pathValue: bin, extraDirs: [], capMs: CAP, bundledBridge: null, bridgeProvisioner: prov }).get()).providers);
  assert.equal(ready.state, 'ready');
  assert.equal(ready.bridge, 'downloaded');
  assert.equal(ready.bridgeMissing, undefined);
  assert.equal(prov.starts, 0, 'nothing is downloaded twice');
  const l = agentLaunch('claude', { pathValue: bin, extraDirs: [], bundledBridge: null, bridgeProvisioner: prov });
  assert.deepEqual(l, { ok: true, command: process.execPath, args: [launcherPath()!, entry], label: 'Claude Code' });
  assert.ok(path.isAbsolute(launcherPath()!) && path.isAbsolute(entry));
  fs.rmSync(bin, { recursive: true, force: true });
});

test('onboarding: with nothing downloaded yet the fetch starts by itself and the card reads "preparing" with the bytes so far; signed out still says only Sign in', { skip: NO_FAKE_CLAUDE_ON_WINDOWS }, async () => {
  const bin = tmp('seq-dl-fetch-');
  fakeClaude(bin, true);
  const prov = fakeProvisioner({ status: { state: 'running', receivedBytes: 12_400_000, files: 40 } });
  const c = claudeOf((await createProviderProbe({ pathValue: bin, extraDirs: [], capMs: CAP, bundledBridge: null, bridgeProvisioner: prov }).get()).providers);
  assert.equal(c.state, 'preparing');
  assert.equal(c.setupBytes, 12_400_000);
  assert.equal(c.bridgeMissing, undefined, 'no Install bridge button while it is being set up');
  assert.equal(prov.starts, 1);
  fakeClaude(bin, false);
  const out = claudeOf((await createProviderProbe({ pathValue: bin, extraDirs: [], capMs: CAP, bundledBridge: null, bridgeProvisioner: prov }).get()).providers);
  assert.equal(out.state, 'signIn');
  assert.equal(out.bridgeMissing, undefined);
  assert.equal(out.setupBytes, 12_400_000);
  fs.rmSync(bin, { recursive: true, force: true });
});

test('onboarding: a failed download falls back to the global install (Install bridge) and says why', { skip: NO_FAKE_CLAUDE_ON_WINDOWS }, async () => {
  const bin = tmp('seq-dl-fail-');
  fakeClaude(bin, true);
  const prov = fakeProvisioner({ status: { state: 'failed', error: 'the registry answered 503', failedAt: Date.now() } });
  const c = claudeOf((await createProviderProbe({ pathValue: bin, extraDirs: [], capMs: CAP, bundledBridge: null, bridgeProvisioner: prov }).get()).providers);
  assert.equal(c.state, 'adapter');
  assert.equal(c.bridgeMissing, true);
  assert.match(c.adapterInstall ?? '', /^npm install -g /);
  assert.equal(c.setupError, 'the registry answered 503');
  /* and a bridge the person already installed is simply used, with no download at all */
  fakeGlobalBridge(bin);
  const prov2 = fakeProvisioner({});
  const g = claudeOf((await createProviderProbe({ pathValue: bin, extraDirs: [], capMs: CAP, bundledBridge: null, bridgeProvisioner: prov2 }).get()).providers);
  assert.equal(g.state, 'ready');
  assert.equal(g.bridge, 'global');
  assert.equal(prov2.starts, 0);
  fs.rmSync(bin, { recursive: true, force: true });
});

test('a claude older than the minimum is "Update Claude Code", not Ready, for the bundled and downloaded bridges', async () => {
  assert.ok(compareVersions('2.1.280', MIN_CLAUDE_VERSION) > 0 && compareVersions('2.1.112', MIN_CLAUDE_VERSION) < 0 && compareVersions('2.1.113', MIN_CLAUDE_VERSION) === 0 && compareVersions('2.10.0', '2.9.9') > 0);
  const bin = tmp('seq-old-');
  fakeClaude(bin, true);
  fs.writeFileSync(path.join(bin, 'fake.mjs'), fs.readFileSync(path.join(bin, 'fake.mjs'), 'utf8').replace('2.1.280', '2.0.5'));
  const bundle = fakeBundle(tmp('seq-old-bundle-'));
  const c = claudeOf((await createProviderProbe({ pathValue: bin, extraDirs: [], capMs: CAP, bundledBridge: bundle, bridgeProvisioner: null }).get()).providers);
  assert.equal(c.state, 'update');
  assert.equal(c.version, '2.0.5');
  assert.equal(c.minVersion, MIN_CLAUDE_VERSION);
  fs.rmSync(bin, { recursive: true, force: true });
});

test('the probe and the bridge search the same folders: a claude only in an npm dir learned after an install is not "Ready" for a bridge that cannot find it', { skip: NO_FAKE_CLAUDE_ON_WINDOWS }, async () => {
  for (const d of defaultClaudeDirs()) assert.ok(defaultExtraDirs().includes(d), `${d} is searched by both`);
  const learned = tmp('seq-learned-');
  fakeClaude(learned, true);
  rememberBinDir(learned);
  const bundle = fakeBundle(tmp('seq-learned-bundle-'));
  const c = claudeOf((await createProviderProbe({ pathValue: tmp('seq-learned-empty-'), capMs: CAP, bundledBridge: bundle, bridgeProvisioner: null }).get()).providers);
  assert.notEqual(c.state, 'ready', 'the bridge process would exit 1: it does not search learned dirs');
  fs.rmSync(learned, { recursive: true, force: true });
});
