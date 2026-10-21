import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createRepoServer, serverSettled } from '../server/repoServer.js';
import { cmdShimArgs } from '../server/adapterInstall.js';
import { agentLaunch, CLAUDE_ACP_PACKAGE, launchForResolved, nodeForShim, searchDirs, windowsShimTarget } from '../server/providerProbe.js';
import { agentSpawnEnv } from '@sequence/acp';

/**
 * ROUND 7, A4: "It says Claude ready, but that actually doesn't work after."
 *
 * A signed-in Claude Code with no ACP bridge (claude-agent-acp) is not Ready:
 * the probe says `adapter` and names the install command. POST
 * /api/onboarding/install-adapter runs that command (the documented global
 * npm install) on the person's click, with its output as progress; when it
 * finishes the probe looks again and Claude is Ready.
 *
 * Every CLI here is a FAKE in the test's own temp dir (providerSearch searches
 * that dir alone): claude says it is signed in, and npm, asked to install the
 * bridge, prints two lines and writes a claude-agent-acp shim beside itself.
 * Nothing is downloaded.
 */

const FAKE = `const fs = require('node:fs');
const path = require('node:path');
const [name, ...args] = process.argv.slice(2);
const a = args.join(' ');
if (a === '--version') process.stdout.write('2.1.280 (Claude Code)\\n');
else if (name === 'claude' && a === 'auth status --json') process.stdout.write(JSON.stringify({ loggedIn: true, subscriptionType: 'max' }));
else if (name === 'npm' && a === 'install -g ${CLAUDE_ACP_PACKAGE}') {
  fs.appendFileSync(path.join(__dirname, 'npm-calls.txt'), a + '\\n');
  process.stdout.write('added 12 packages in 3s\\n');
  const shim = process.platform === 'win32' ? 'claude-agent-acp.cmd' : 'claude-agent-acp';
  /* With FAKE_NPM_PREFIX the bridge lands in npm's global bin, off the searched PATH (as with %APPDATA%/npm or nvm). */
  const pre = process.env.FAKE_NPM_PREFIX;
  const into = pre ? (process.platform === 'win32' ? pre : path.join(pre, 'bin')) : __dirname;
  fs.mkdirSync(into, { recursive: true });
  if (process.platform === 'win32') {
    /* npm's real cmd-shim shape and the JS it starts: Sequence only parses known shim templates (REVIEW-v3 #5). */
    const bs = String.fromCharCode(92);
    const js = ['node_modules', '@agentclientprotocol', 'claude-agent-acp', 'dist', 'index.js'];
    fs.mkdirSync(path.join(into, ...js.slice(0, -1)), { recursive: true });
    fs.writeFileSync(path.join(into, ...js), '');
    const lines = ['@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0', '',
      'IF EXIST "%dp0%' + bs + 'node.exe" (', '  SET "_prog=%dp0%' + bs + 'node.exe"', ') ELSE (', '  SET "_prog=node"', '  SET PATHEXT=%PATHEXT:;.JS;=;%', ')', '',
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%' + bs + js.join(bs) + '" %*', ''];
    fs.writeFileSync(path.join(into, shim), lines.join(String.fromCharCode(13, 10)));
  } else fs.writeFileSync(path.join(into, shim), '#!/bin/sh\\necho bridge\\n', { mode: 0o755 });
  process.stdout.write('changed 1 package\\n');
}
else if (name === 'npm' && a === 'prefix -g' && process.env.FAKE_NPM_PREFIX) process.stdout.write(process.env.FAKE_NPM_PREFIX + '\\n');
else if (name === 'npm') { process.stderr.write('npm ERR! 404 Not Found - GET ' + a + '\\n'); process.exitCode = 1; }
else { process.stderr.write('unknown ' + a); process.exitCode = 2; }
`;

function tempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function fake(dir: string, name: string): void {
  fs.writeFileSync(path.join(dir, 'fake.cjs'), FAKE);
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(dir, `${name}.cmd`), `@"${process.execPath}" "%~dp0fake.cjs" ${name} %*\r\n`);
  } else {
    const p = path.join(dir, name);
    fs.writeFileSync(p, `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, 'fake.cjs')}" ${name} "$@"\n`);
    fs.chmodSync(p, 0o755);
  }
}

type Json = Record<string, unknown>;

function call(port: number, method: string, p: string, body?: unknown): Promise<{ status: number; json: Json }> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port, path: p, method, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Json }));
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('a signed-in Claude without its bridge is "adapter", Install bridge runs npm once, then Claude is ready', async () => {
  const bin = tempDir('seq-bridge-bin-');
  const store = tempDir('seq-bridge-store-');
  fake(bin, 'claude');
  fake(bin, 'npm');
  const server = await createRepoServer(null, {
    webDist: undefined,
    browseRoot: store,
    recentStoreDir: store,
    userConfigDir: store,
    providerSearch: { pathValue: bin, extraDirs: [], capMs: 15_000 },
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    const before = await call(port, 'GET', '/api/onboarding/providers?refresh=1');
    const claude = (before.json.providers as Json[]).find((p) => p.id === 'claude')!;
    assert.equal(claude.state, 'adapter', 'signed in, but Sequence cannot drive it: not Ready');
    assert.equal(claude.adapterInstall, `npm install -g ${CLAUDE_ACP_PACKAGE}`);
    assert.equal(fs.existsSync(path.join(bin, 'npm-calls.txt')), false, 'nothing runs until the person asks');

    /* Connect says the same, with the command. */
    const connect = await call(port, 'POST', '/api/acp/agents/connect', { provider: 'claude' });
    assert.equal(connect.status, 409);
    assert.equal(connect.json.state, 'adapter');
    assert.match(String(connect.json.error), /needs its bridge, claude-agent-acp/);

    const started = await call(port, 'POST', '/api/onboarding/install-adapter', { provider: 'claude' });
    assert.equal(started.status, 202);
    assert.equal(started.json.command, `npm install -g ${CLAUDE_ACP_PACKAGE}`);
    let st = started.json;
    for (let i = 0; i < 200 && st.state === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      st = (await call(port, 'GET', '/api/onboarding/install-adapter?provider=claude')).json;
    }
    assert.equal(st.state, 'done', JSON.stringify(st));
    assert.equal(st.exitCode, 0);
    assert.deepEqual(st.output, ['added 12 packages in 3s', 'changed 1 package']);
    assert.equal(fs.readFileSync(path.join(bin, 'npm-calls.txt'), 'utf8'), `install -g ${CLAUDE_ACP_PACKAGE}\n`, 'npm ran once, with the documented arguments');

    const after = await call(port, 'GET', '/api/onboarding/providers');
    assert.equal((after.json.providers as Json[]).find((p) => p.id === 'claude')!.state, 'ready');

    /* An unknown provider has no bridge; a non-JSON body is refused. */
    assert.equal((await call(port, 'POST', '/api/onboarding/install-adapter', { provider: 'codex' })).status, 404);
  } finally {
    await new Promise<void>((r) => {
      server.close(() => r());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
    await serverSettled(server);
    fs.rmSync(bin, { recursive: true, force: true });
    fs.rmSync(store, { recursive: true, force: true });
  }
});

test('Install bridge with no npm on this machine says so', async () => {
  const bin = tempDir('seq-bridge-nonpm-');
  const store = tempDir('seq-bridge-store-');
  fake(bin, 'claude');
  const server = await createRepoServer(null, { webDist: undefined, browseRoot: store, recentStoreDir: store, userConfigDir: store, providerSearch: { pathValue: bin, extraDirs: [], capMs: 15_000 } });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    const r = await call(port, 'POST', '/api/onboarding/install-adapter', { provider: 'claude' });
    assert.equal(r.json.state, 'failed');
    assert.match(String(r.json.error), /npm was not found/);
  } finally {
    await new Promise<void>((res) => {
      server.close(() => res());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
    fs.rmSync(bin, { recursive: true, force: true });
    fs.rmSync(store, { recursive: true, force: true });
  }
});

test('a bridge npm installs off the searched PATH is found: npm prefix -g joins the probe search after the install', async () => {
  const bin = tempDir('seq-bridge-bin-');
  const store = tempDir('seq-bridge-store-');
  const prefix = tempDir('seq-bridge-prefix-');
  fake(bin, 'claude');
  fake(bin, 'npm');
  process.env.FAKE_NPM_PREFIX = prefix;
  const server = await createRepoServer(null, {
    webDist: undefined,
    browseRoot: store,
    recentStoreDir: store,
    userConfigDir: store,
    providerSearch: { pathValue: bin, extraDirs: [], capMs: 15_000 },
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    const before = await call(port, 'GET', '/api/onboarding/providers?refresh=1');
    assert.equal((before.json.providers as Json[]).find((p) => p.id === 'claude')!.state, 'adapter');
    let st = (await call(port, 'POST', '/api/onboarding/install-adapter', { provider: 'claude' })).json;
    for (let i = 0; i < 200 && st.state === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      st = (await call(port, 'GET', '/api/onboarding/install-adapter?provider=claude')).json;
    }
    assert.equal(st.state, 'done', JSON.stringify(st));
    assert.equal(fs.existsSync(path.join(bin, process.platform === 'win32' ? 'claude-agent-acp.cmd' : 'claude-agent-acp')), false, 'the bridge is NOT beside npm');
    const after = await call(port, 'GET', '/api/onboarding/providers?refresh=1');
    assert.equal((after.json.providers as Json[]).find((p) => p.id === 'claude')!.state, 'ready', 'found in npm prefix -g, not stuck at Needs bridge');
  } finally {
    delete process.env.FAKE_NPM_PREFIX;
    await new Promise<void>((r) => {
      server.close(() => r());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
    await serverSettled(server);
    for (const d of [bin, store, prefix]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('Windows: the npm shim runs by its resolved absolute path through cmd.exe, never a bare npm looked up in the cwd', () => {
  const npm = 'C:\\Program Files\\nodejs\\npm.cmd';
  assert.deepEqual(cmdShimArgs(npm, ['install', '-g', CLAUDE_ACP_PACKAGE]), ['/d', '/s', '/c', `""${npm}" install -g ${CLAUDE_ACP_PACKAGE}"`]);
});

test('0012 production path: without a per-server search, the install remembers npm\'s global bin process-wide, so the probe AND the agent launch find the bridge', async () => {
  const bin = tempDir('seq-bridge-bin-');
  const store = tempDir('seq-bridge-store-');
  const prefix = tempDir('seq-bridge-prefix-');
  fake(bin, 'claude');
  fake(bin, 'npm');
  process.env.FAKE_NPM_PREFIX = prefix;
  /* The default search includes %APPDATA%
pm, where a real machine may already hold claude-agent-acp: point it at an empty folder so the control below is about this test's bin only. */
  const appData = process.env.APPDATA;
  process.env.APPDATA = tempDir('seq-bridge-appdata-');
  /* No extraDirs: the default search, which is where rememberBinDir adds npm's bin. */
  const server = await createRepoServer(null, { webDist: undefined, browseRoot: store, recentStoreDir: store, userConfigDir: store, providerSearch: { pathValue: bin, capMs: 15_000 } });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    assert.equal(agentLaunch('claude', { pathValue: bin }).ok, false, 'control: no bridge before the install');
    let st = (await call(port, 'POST', '/api/onboarding/install-adapter', { provider: 'claude' })).json;
    for (let i = 0; i < 200 && st.state === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      st = (await call(port, 'GET', '/api/onboarding/install-adapter?provider=claude')).json;
    }
    assert.equal(st.state, 'done', JSON.stringify(st));
    const after = await call(port, 'GET', '/api/onboarding/providers?refresh=1');
    assert.equal((after.json.providers as Json[]).find((p) => p.id === 'claude')!.state, 'ready');
    const launch = agentLaunch('claude', { pathValue: bin });
    assert.ok(launch.ok, JSON.stringify(launch));
    const where = process.platform === 'win32' ? prefix : path.join(prefix, 'bin');
    assert.ok(launch.ok && [launch.command, ...launch.args].some((a) => a.startsWith(where)), `the launch runs the bridge in npm's bin: ${JSON.stringify(launch)}`);
  } finally {
    if (appData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = appData;
    delete process.env.FAKE_NPM_PREFIX;
    await new Promise<void>((r) => {
      server.close(() => r());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
    await serverSettled(server);
    for (const d of [bin, store, prefix]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('S-new2 Windows: a bridge or claude npm shim launches as node + the package\'s own JS by absolute path, never `cmd /c <bare name>` (a repo\'s .bat would win the cwd lookup)', () => {
  const dir = tempDir('seq-shim-');
  const pkg = path.join(dir, 'node_modules', '@agentclientprotocol', 'claude-agent-acp', 'dist');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'index.js'), '');
  fs.writeFileSync(path.join(dir, 'node.exe'), '');
  /* npm's cmd-shim, verbatim shape (a node.exe beside it is the interpreter, not the target). */
  const shim = path.join(dir, 'claude-agent-acp.cmd');
  fs.writeFileSync(
    shim,
    '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@agentclientprotocol\\claude-agent-acp\\dist\\index.js" %*\r\n',
  );
  /* On Windows the node.exe beside the shim runs it, as the shim itself prefers; elsewhere `node.exe` is not a node. */
  const node = process.platform === 'win32' ? path.join(dir, 'node.exe') : process.execPath;
  assert.deepEqual(launchForResolved(shim, []), { command: node, args: [path.join(pkg, 'index.js')] });
  assert.deepEqual(launchForResolved(shim, ['auth', 'login']).args.slice(1), ['auth', 'login']);
  /* A shim that is no known template: cmd.exe with the ABSOLUTE shim path, quoted for /s /c, never the bare name. */
  const broken = path.join(dir, 'claude.cmd');
  fs.writeFileSync(broken, '@"%~dp0\\node_modules\\gone\\cli.js" %*\r\n');
  const l = launchForResolved(broken, ['auth', 'login']);
  assert.deepEqual(l.args, cmdShimArgs(broken, ['auth', 'login']), JSON.stringify(l));
  assert.equal(l.verbatim, true);
  /* A plain binary is itself. */
  assert.deepEqual(launchForResolved('/usr/bin/claude-agent-acp', []), { command: '/usr/bin/claude-agent-acp', args: [] });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('REVIEW-v3 #5 Windows: only exact npm / pnpm shim templates are parsed; anything else runs through cmd /d /s /c, quoted', () => {
  const dir = tempDir('seq-shim5-');
  const pkg = path.join(dir, 'node_modules', '@agentclientprotocol', 'claude-agent-acp', 'dist');
  fs.mkdirSync(pkg, { recursive: true });
  const js = path.join(pkg, 'index.js');
  fs.writeFileSync(js, '');
  const head = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n';
  const npm = `${head}\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@agentclientprotocol\\claude-agent-acp\\dist\\index.js" %*\r\n`;
  const write = (name: string, text: string) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, text);
    return p;
  };
  /* npm (LF too), pnpm (with and without the NODE_PATH block), npm's older shape, npm's native-binary shape. */
  assert.deepEqual(windowsShimTarget(write('a.cmd', npm))?.args, [js]);
  assert.deepEqual(windowsShimTarget(write('b.cmd', npm.replace(/\r\n/g, '\n')))?.args, [js]);
  const pnpmBody = '@IF EXIST "%~dp0\\node.exe" (\r\n  "%~dp0\\node.exe"  "%~dp0\\node_modules\\@agentclientprotocol\\claude-agent-acp\\dist\\index.js" %*\r\n) ELSE (\r\n  @SET PATHEXT=%PATHEXT:;.JS;=;%\r\n  node  "%~dp0\\node_modules\\@agentclientprotocol\\claude-agent-acp\\dist\\index.js" %*\r\n)\r\n';
  const nodePath = '@IF NOT DEFINED NODE_PATH (\r\n  @SET "NODE_PATH=C:\\x\\node_modules"\r\n) ELSE (\r\n  @SET "NODE_PATH=C:\\x\\node_modules;%NODE_PATH%"\r\n)\r\n';
  assert.deepEqual(windowsShimTarget(write('c.cmd', `@SETLOCAL\r\n${nodePath}${pnpmBody}`))?.args, [js]);
  assert.deepEqual(windowsShimTarget(write('d.cmd', `@SETLOCAL\r\n${pnpmBody}`))?.args, [js]);
  assert.deepEqual(windowsShimTarget(write('e.cmd', pnpmBody.replace('(\r\n  @SET PATHEXT', '(\r\n  @SETLOCAL\r\n  @SET PATHEXT')))?.args, [js]);
  const exe = path.join(dir, 'node_modules', 'tool', 'tool.exe');
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, '');
  assert.deepEqual(windowsShimTarget(write('f.cmd', `${head}"%dp0%\\node_modules\\tool\\tool.exe"   %*\r\n`)), { command: exe, args: [] });
  /* Not a template: a user's wrapper with its own flags, a shim with node options, the two pnpm targets disagreeing, anything appended. */
  for (const [name, text] of [
    ['w1.cmd', '@echo off\r\nnode "%~dp0\\node_modules\\@agentclientprotocol\\claude-agent-acp\\dist\\index.js" --model opus %*\r\n'],
    ['w2.cmd', npm.replace('"%_prog%"  "%dp0%', '"%_prog%" --max-old-space-size=4096 "%dp0%')],
    ['w3.cmd', `@SETLOCAL\r\n${pnpmBody.replace(/index\.js" %\*\r\n\)\r\n$/, 'other.js" %*\r\n)\r\n')}`],
    ['w4.cmd', `${npm}echo pwned\r\n`],
  ] as const) {
    const shim = write(name, text);
    assert.equal(windowsShimTarget(shim), null, name);
    const l = launchForResolved(shim, ['--x']);
    assert.deepEqual(l, { command: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', `""${shim}" --x"`], verbatim: true }, name);
  }
  /* A path cmd.exe would split without /s and the outer quotes. */
  assert.deepEqual(cmdShimArgs('C:\\Program Files (x86)\\npm\\a&b.cmd', ['auth', 'login']), ['/d', '/s', '/c', '""C:\\Program Files (x86)\\npm\\a&b.cmd" auth login"']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('REVIEW-v3 #5: a shim\'s script runs on a real node (beside the shim, else on PATH) before Sequence\'s own executable; relative PATH entries are never searched', () => {
  const dir = tempDir('seq-shim-node-');
  const bin = path.join(dir, 'bin');
  const npmDir = path.join(dir, 'npm');
  fs.mkdirSync(bin);
  fs.mkdirSync(npmDir);
  const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
  const shim = path.join(npmDir, 'claude-agent-acp.cmd');
  fs.writeFileSync(shim, '');
  /* Nothing found: this process's executable (Sequence.exe in the app). */
  assert.equal(nodeForShim(shim, []), process.execPath);
  /* A node on the searched PATH. */
  fs.writeFileSync(path.join(bin, nodeName), '');
  fs.chmodSync(path.join(bin, nodeName), 0o755);
  assert.equal(nodeForShim(shim, [bin]), path.join(bin, nodeName));
  /* The node beside the shim wins, as the shim itself prefers it. */
  fs.writeFileSync(path.join(npmDir, nodeName), '');
  assert.equal(nodeForShim(shim, [bin]), path.join(npmDir, nodeName));
  /* Relative entries are dropped from the search. */
  const d = path.delimiter;
  assert.deepEqual(searchDirs(`.${d}bin${d}${bin}${d}..${path.sep}x${d}"${npmDir}"`, ['rel/extra', bin]), [bin, npmDir]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('REVIEW-v3 #5: ELECTRON_RUN_AS_NODE reaches an agent only when the agent is Sequence\'s own Electron binary', () => {
  const base = { PATH: '/bin', ELECTRON_RUN_AS_NODE: '1' };
  const exe = '/Applications/Sequence.app/Contents/MacOS/Sequence';
  assert.deepEqual(agentSpawnEnv('/usr/local/bin/node', base, exe, true), { PATH: '/bin' });
  assert.deepEqual(agentSpawnEnv('/usr/local/bin/claude-agent-acp', base, exe, true), { PATH: '/bin' });
  assert.equal(agentSpawnEnv(exe, base, exe, true), base, 'Sequence.exe runs the script as node: the flag stays for that spawn');
  assert.deepEqual(agentSpawnEnv(exe, base, exe, false), { PATH: '/bin' }, 'not Electron: never');
  assert.deepEqual(base, { PATH: '/bin', ELECTRON_RUN_AS_NODE: '1' }, 'the server env itself is untouched');
  const plain = { PATH: '/bin' };
  assert.equal(agentSpawnEnv('/usr/local/bin/node', plain, exe, true), plain);
});
