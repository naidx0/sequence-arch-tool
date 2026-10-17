import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import type { ChildProcess } from 'node:child_process';

import { createRepoServer } from '../server/repoServer.js';
import { cliBinDirs, cliInstallCommand, createCliInstaller, type SpawnFn } from '../server/cliInstall.js';

/**
 * Claims-audit 4.2 (A2, U07, U08, U14): the Install button runs the vendor's
 * own native installer. Spawn is STUBBED everywhere: no vendor installer, no
 * network, no real CLI runs. The stub plays the installer: it prints lines,
 * optionally drops a fake `claude` into the probe's search dir, and exits.
 */

function tempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

interface Calls {
  list: { file: string; args: string[] }[];
}

/** A spawn stub: a fake child that prints `lines`, runs `during`, then closes with `code`. */
function stubSpawn(calls: Calls, lines: string[], code: number, during?: () => void): SpawnFn {
  return (file, args) => {
    calls.list.push({ file, args });
    const child = new EventEmitter() as ChildProcess & EventEmitter;
    const out = new PassThrough();
    const err = new PassThrough();
    (child as unknown as { stdout: PassThrough }).stdout = out;
    (child as unknown as { stderr: PassThrough }).stderr = err;
    setTimeout(() => {
      for (const l of lines) (code === 0 ? out : err).write(l + '\n');
      during?.();
      setTimeout(() => child.emit('close', code), 10);
    }, 5);
    return child;
  };
}

async function settle(read: () => { state: string } | null): Promise<{ state: string }> {
  let st = read();
  for (let i = 0; i < 200 && (!st || st.state === 'running'); i++) {
    await new Promise((r) => setTimeout(r, 20));
    st = read();
  }
  return st!;
}

test('the install commands are fixed constants per vendor and platform, never built from input', () => {
  const win = cliInstallCommand('claude', 'win32');
  assert.equal(win.file, 'powershell.exe');
  assert.deepEqual(win.args.slice(-2), ['-Command', 'irm https://claude.ai/install.ps1 | iex']);
  assert.equal(win.display, 'irm https://claude.ai/install.ps1 | iex');
  assert.match(cliInstallCommand('codex', 'win32').args.at(-1)!, /^irm https:\/\/chatgpt\.com\/codex\/install\.ps1 \| iex$/);
  for (const p of ['linux', 'darwin'] as const) {
    assert.equal(cliInstallCommand('claude', p).display, 'curl -fsSL https://claude.ai/install.sh | bash');
    assert.equal(cliInstallCommand('codex', p).display, 'curl -fsSL https://chatgpt.com/codex/install.sh | sh');
    /* the download must finish before anything runs, so a failed curl cannot read as a successful install */
    assert.deepEqual(cliInstallCommand('claude', p).args, ['-c', "s=$(curl -fsSL https://claude.ai/install.sh) && printf '%s\\n' \"$s\" | bash"]);
    assert.ok(cliInstallCommand('codex', p).args[1]!.startsWith('s=$(curl -fsSL https://chatgpt.com/codex/install.sh) && '));
    assert.ok(cliInstallCommand('codex', p).args[1]!.endsWith('| sh'));
  }
  assert.ok(cliBinDirs('claude', '/h', {}).includes(path.join('/h', '.local', 'bin')));
});

test('start runs the stubbed installer once, keeps its last lines, and reports done to onDone', async () => {
  const calls: Calls = { list: [] };
  const done: boolean[] = [];
  const inst = createCliInstaller({ spawnFn: stubSpawn(calls, ['Downloading Claude Code', 'Installed'], 0), platform: 'linux', binDirs: () => [], onDone: (ok) => done.push(ok) });
  const first = inst.start('claude');
  assert.ok(first.ok && first.status.state === 'running');
  const again = inst.start('claude');
  assert.ok(again.ok && again.status.state === 'running');
  const st = (await settle(() => inst.status('claude'))) as { state: string; output: string[]; exitCode: number | null };
  assert.equal(st.state, 'done');
  assert.equal(st.exitCode, 0);
  assert.deepEqual(st.output, ['Downloading Claude Code', 'Installed']);
  assert.equal(calls.list.length, 1, 'a second click while running does not start a second installer');
  assert.deepEqual(done, [true]);
});

test('a failing installer ends failed with its own last line, verbatim', async () => {
  const calls: Calls = { list: [] };
  const done: boolean[] = [];
  const inst = createCliInstaller({ spawnFn: stubSpawn(calls, ['curl: (6) Could not resolve host: claude.ai'], 6), platform: 'linux', binDirs: () => [], onDone: (ok) => done.push(ok) });
  inst.start('claude');
  const st = (await settle(() => inst.status('claude'))) as { state: string; error?: string; exitCode: number | null };
  assert.equal(st.state, 'failed');
  assert.equal(st.error, 'curl: (6) Could not resolve host: claude.ai');
  assert.equal(st.exitCode, 6);
  assert.deepEqual(done, [false]);
  /* Try again is allowed after a failure. */
  inst.start('claude');
  assert.equal(calls.list.length, 2);
});

test('a spawn that throws, and an unknown provider, are plain refusals', () => {
  const inst = createCliInstaller({
    spawnFn: () => {
      throw new Error('spawn powershell.exe ENOENT');
    },
    platform: 'win32',
  });
  const r = inst.start('codex');
  assert.ok(r.ok);
  assert.equal(r.status.state, 'failed');
  assert.match(r.status.error ?? '', /ENOENT/);
  const bad = inst.start('rm -rf');
  assert.ok(!bad.ok && bad.status === 404);
});

const FAKE = `const [name, ...args] = process.argv.slice(2);
const a = args.join(' ');
if (a === '--version') process.stdout.write('2.1.280 (Claude Code)\\n');
else if (a === 'auth status --json') process.stdout.write(JSON.stringify({ loggedIn: false }));
else { process.stderr.write('unknown ' + a); process.exitCode = 2; }
`;

function dropFake(dir: string): void {
  fs.writeFileSync(path.join(dir, 'fake.cjs'), FAKE);
  if (process.platform === 'win32') fs.writeFileSync(path.join(dir, 'claude.cmd'), `@"${process.execPath}" "%~dp0fake.cjs" claude %*\r\n`);
  else {
    const p = path.join(dir, 'claude');
    fs.writeFileSync(p, `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, 'fake.cjs')}" claude "$@"\n`);
    fs.chmodSync(p, 0o755);
  }
}

function call(port: number, method: string, p: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown> }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('POST install-adapter {kind:"cli"} runs the fixed command (spawn stubbed), then the probe moves install -> signIn', async () => {
  const bin = tempDir('seq-cli-bin-');
  const store = tempDir('seq-cli-store-');
  const calls: Calls = { list: [] };
  const server = await createRepoServer(null, {
    webDist: undefined,
    browseRoot: store,
    recentStoreDir: store,
    userConfigDir: store,
    providerSearch: { pathValue: bin, extraDirs: [], capMs: 15_000 },
    cliInstallSpawn: stubSpawn(calls, ['Installing Claude Code...', 'Done'], 0, () => dropFake(bin)),
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    const before = await call(port, 'GET', '/api/onboarding/providers?refresh=1');
    const c0 = (before.json.providers as Record<string, unknown>[]).find((p) => p.id === 'claude')!;
    assert.equal(c0.state, 'install');
    assert.equal(calls.list.length, 0, 'nothing runs until the click');

    assert.equal((await call(port, 'POST', '/api/onboarding/install-adapter', { provider: 'claude', kind: 'nope' })).status, 400);
    const started = await call(port, 'POST', '/api/onboarding/install-adapter', { provider: 'claude', kind: 'cli' });
    assert.equal(started.status, 202);
    assert.match(String(started.json.command), /claude\.ai\/install\.(sh|ps1)/);
    let cur = started.json as { state: string };
    for (let i = 0; i < 200 && cur.state === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 20));
      cur = (await call(port, 'GET', '/api/onboarding/install-adapter?provider=claude&kind=cli')).json as { state: string };
    }
    assert.equal(cur.state, 'done', JSON.stringify(cur));
    assert.equal(calls.list.length, 1);

    const after = await call(port, 'GET', '/api/onboarding/providers');
    const c1 = (after.json.providers as Record<string, unknown>[]).find((p) => p.id === 'claude')!;
    assert.equal(c1.installed, true);
    assert.equal(c1.state, 'signIn');
    /* The bridge job is a different job: kind cli never touched it. */
    assert.deepEqual((await call(port, 'GET', '/api/onboarding/install-adapter?provider=claude')).json, { state: 'idle' });
    /* An unknown provider has no CLI installer. */
    assert.equal((await call(port, 'POST', '/api/onboarding/install-adapter', { provider: 'cursor', kind: 'cli' })).status, 404);
  } finally {
    await new Promise<void>((r) => {
      server.close(() => r());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
  }
});
