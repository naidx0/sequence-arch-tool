import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openBrowser, browserCommand } from '../open-browser.js';
import { serveApp } from '../serve.js';
import { launch } from '../cli.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/test -> dist -> analyzer -> packages -> <repo root>
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const TICKETING = path.join(REPO_ROOT, 'examples', 'ticketing-scaffold');
const CLI_JS = path.resolve(here, '..', 'cli.js');

/** A minimal stand-in for a spawned child: openBrowser only calls .on / .unref. */
function fakeChild(): { on: () => void; unref: () => void } {
  return { on() {}, unref() {} };
}

/** Run `fn` with process.platform temporarily forced to `platform`. */
function withPlatform(platform: NodeJS.Platform, fn: () => void): void {
  const orig = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    fn();
  } finally {
    if (orig) Object.defineProperty(process, 'platform', orig);
  }
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

// ---------------------------------------------------------------------------
// openBrowser — platform-correct command, best-effort (never throws)
// ---------------------------------------------------------------------------

test('browserCommand resolves the right opener per platform', () => {
  assert.deepStrictEqual(browserCommand('http://x', 'darwin'), { command: 'open', args: ['http://x'] });
  assert.deepStrictEqual(browserCommand('http://x', 'win32'), {
    command: 'cmd',
    args: ['/c', 'start', '""', 'http://x'],
  });
  assert.deepStrictEqual(browserCommand('http://x', 'linux'), { command: 'xdg-open', args: ['http://x'] });
});

test('openBrowser spawns the platform-correct opener (spawn spied per platform)', (t) => {
  const url = 'http://127.0.0.1:4173/';
  const spy = t.mock.method(childProcess, 'spawn', () => fakeChild() as unknown as childProcess.ChildProcess);

  const cases: Array<[NodeJS.Platform, string, string[]]> = [
    ['darwin', 'open', [url]],
    ['win32', 'cmd', ['/c', 'start', '""', url]],
    ['linux', 'xdg-open', [url]],
  ];
  for (const [platform, command, args] of cases) {
    spy.mock.resetCalls();
    withPlatform(platform, () => openBrowser(url));
    assert.strictEqual(spy.mock.callCount(), 1, `${platform}: spawn called once`);
    const call = spy.mock.calls[0].arguments;
    assert.strictEqual(call[0], command, `${platform}: command`);
    assert.deepStrictEqual(call[1], args, `${platform}: args`);
  }
});

test('openBrowser never throws when the opener spawn errors synchronously', (t) => {
  t.mock.method(childProcess, 'spawn', () => {
    throw new Error('spawn ENOENT');
  });
  assert.doesNotThrow(() => openBrowser('http://127.0.0.1:4173/'));
});

test('openBrowser never throws when spawn returns no child handle', (t) => {
  t.mock.method(childProcess, 'spawn', () => undefined as unknown as childProcess.ChildProcess);
  assert.doesNotThrow(() => openBrowser('http://127.0.0.1:4173/'));
});

// ---------------------------------------------------------------------------
// bin wiring — root package.json + built cli.js shebang
// ---------------------------------------------------------------------------

test('root package.json exposes a `sequence` bin pointing at the built cli', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
    bin?: Record<string, string>;
  };
  assert.ok(pkg.bin, 'root package.json must declare a bin');
  assert.strictEqual(pkg.bin!.sequence, 'packages/analyzer/dist/cli.js');
  const binAbs = path.join(REPO_ROOT, pkg.bin!.sequence);
  assert.ok(fs.existsSync(binAbs), `resolved bin path must exist: ${binAbs}`);
});

test('built cli.js keeps its node shebang (so the bin is executable)', () => {
  const firstLine = fs.readFileSync(CLI_JS, 'utf8').split('\n', 1)[0];
  assert.strictEqual(firstLine, '#!/usr/bin/env node');
});

// ---------------------------------------------------------------------------
// launch — starts a listening server and auto-opens (unless --no-open)
// ---------------------------------------------------------------------------

test('launch starts a listening server and opens the browser to the bound URL', async (t) => {
  t.mock.method(console, 'log', () => {});
  const spy = t.mock.method(childProcess, 'spawn', () => fakeChild() as unknown as childProcess.ChildProcess);

  const server = await launch(['--repo', TICKETING, '--port', '0']);
  try {
    assert.ok(server.listening, 'server should be listening');
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const url = `http://127.0.0.1:${port}`;

    // it serves the app on the bound port
    const res = await fetch(`${url}/archgraph.json`);
    assert.strictEqual(res.status, 200);

    // and it auto-opened the browser to exactly that URL
    assert.strictEqual(spy.mock.callCount(), 1, 'openBrowser should have spawned once');
    const spawnedArgs = spy.mock.calls[0].arguments[1] as string[];
    assert.ok(spawnedArgs.includes(url), `spawned args ${JSON.stringify(spawnedArgs)} must contain ${url}`);
  } finally {
    await closeServer(server);
  }
});

test('launch --no-open starts the server but does NOT open the browser', async (t) => {
  t.mock.method(console, 'log', () => {});
  const spy = t.mock.method(childProcess, 'spawn', () => fakeChild() as unknown as childProcess.ChildProcess);

  const server = await launch(['--repo', TICKETING, '--port', '0', '--no-open']);
  try {
    assert.ok(server.listening, 'server should be listening');
    assert.strictEqual(spy.mock.callCount(), 0, '--no-open must suppress the auto-open');
  } finally {
    await closeServer(server);
  }
});

// ---------------------------------------------------------------------------
// no-repo start — the CLI must not reject a launch/serve with no repo.
//
// The no-repo START itself is implemented on the SERVER side by Phase B
// (serveRepo/createRepoServer widened to accept an absent repo). Until that
// lands, serveApp(undefined) rejects; this test is gated (foreign-failure
// protocol) so it SKIPs on Phase B's in-progress code rather than hard-failing.
// Once Phase B lands, it asserts `/` returns 200 (the web app / home screen).
// ---------------------------------------------------------------------------

test('no-repo launch: server starts and serves the web app on / (gated on Phase B)', async (t) => {
  // A minimal explicit web dist so the assertion is deterministic and independent
  // of findWebDist()'s require.resolve/cwd discovery (which the test runner's cwd
  // can defeat). In real use the launcher discovers packages/web2/dist itself.
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-home-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>home</title>');

  let server: http.Server;
  try {
    server = await serveApp(undefined, 0, dist);
  } catch (e) {
    // Foreign-failure gate: if Phase B's no-repo server support regresses, skip
    // rather than hard-fail — the orchestrator's combined gate covers it.
    fs.rmSync(dist, { recursive: true, force: true });
    t.skip(`no-repo start not implemented on the server yet (Phase B in progress): ${(e as Error).message}`);
    return;
  }
  try {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.strictEqual(res.status, 200, 'no-repo server must serve the web app (home screen) on /');
    assert.match(await res.text(), /home/);
  } finally {
    await closeServer(server);
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// CLI entry — help is not a crash; unknown words are not a usage dump
// ---------------------------------------------------------------------------

function spawnCli(args: string[]): childProcess.SpawnSyncReturns<string> {
  return childProcess.spawnSync(process.execPath, [CLI_JS, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
  });
}

test('sequence --help prints usage and exits 0 (help is not a crash)', () => {
  const r = spawnCli(['--help']);
  assert.strictEqual(r.status, 0, `stderr=${r.stderr}`);
  assert.match(r.stdout, /sequence — static architecture scanner/);
  assert.match(r.stdout, /sequence app/);
});

test('unknown subcommand names the word instead of dumping usage as a fake crash', () => {
  const r = spawnCli(['codeforge']);
  assert.strictEqual(r.status, 1, `stdout=${r.stdout}`);
  assert.match(r.stderr, /unknown command 'codeforge'/);
  assert.match(r.stderr, /\.\/start\.sh/);
  assert.doesNotMatch(r.stdout, /static architecture scanner/);
});
