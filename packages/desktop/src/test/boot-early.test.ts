import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mock, test } from 'node:test';
import { openAppOnListening, startEngine, type OpenAppDeps, type StartEngineDeps } from '../boot';
import { ServerController, awaitServerReady } from '../server-control';

/*
 * 0.1.8.4 PERF (boot path). The first window used to wait for the startup scan, the engine spawn sat behind a
 * free-port probe and the proxy answer, and readiness was a 150 ms poll. These lock the three costs with fakes.
 */

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);
const MAIN_SRC = path.resolve(__dirname, '..', '..', 'src', 'main.ts');

function engineDeps(over: Partial<StartEngineDeps> = {}): StartEngineDeps & { calls: string[] } {
  const calls: string[] = [];
  const status = { url: 'http://127.0.0.1:1', port: 1, repoDir: null };
  return {
    calls,
    rememberedPort: () => 4321,
    controller: {
      usePort: (p, o) => void calls.push(`usePort:${p}:${o?.hint}`),
      start: (repo) => {
        calls.push(`start:${repo ?? ''}`);
        return Promise.resolve(status);
      },
    },
    proxy: { cached: { HTTPS_PROXY: 'http://cached:1' }, fresh: never(), hadCache: true },
    proxyForFirstSpawn: () => {
      calls.push('proxyForFirstSpawn');
      return never();
    },
    applyProxy: (p) => void calls.push(`apply:${p.HTTPS_PROXY ?? ''}`),
    prepareEnv: () => void calls.push('prepareEnv'),
    lastRepo: () => '/repo',
    ...over,
  };
}

test('spawn: with a cached proxy the spawn is issued before any promise (port probe, proxy) resolves', () => {
  const d = engineDeps();
  void startEngine(d); /* NOT awaited: everything below must already have happened, synchronously */
  assert.deepStrictEqual(d.calls, ['usePort:4321:true', 'prepareEnv', 'apply:http://cached:1', 'start:/repo']);
});

test('spawn: the remembered port is a hint, never probed first', () => {
  const d = engineDeps();
  void startEngine(d);
  assert.ok(d.calls.includes('usePort:4321:true'));
  assert.doesNotMatch(fs.readFileSync(MAIN_SRC, 'utf8'), /portIsFree/);
});

test('spawn: a first launch (no cache) waits for the live proxy answer and gives it to the first spawn', async () => {
  let release!: (v: { HTTPS_PROXY: string }) => void;
  const live = new Promise<{ HTTPS_PROXY: string }>((r) => (release = r));
  const d = engineDeps({
    proxy: { cached: {}, fresh: live, hadCache: false },
    proxyForFirstSpawn: (p) => p.fresh,
  });
  const started = startEngine(d);
  assert.ok(!d.calls.some((c) => c.startsWith('start:')), 'not before the proxy answer');
  release({ HTTPS_PROXY: 'http://live:9' });
  await started;
  assert.ok(d.calls.indexOf('apply:http://live:9') < d.calls.indexOf('start:/repo'), d.calls.join(','));
});

function openDeps(log: string[], over: Partial<OpenAppDeps> = {}): OpenAppDeps {
  return {
    windowAlive: () => true,
    onBootPage: () => true,
    showBoot: () => Promise.resolve(void log.push('showBoot')),
    setAppReady: (r) => void log.push(`ready:${r}`),
    loadApp: () => Promise.resolve(void log.push('loadApp')),
    settled: () => never(),
    onAttachFailed: () => void log.push('failed'),
    ...over,
  };
}

test('load: the app load is issued while the startup scan is still running', async () => {
  const log: string[] = [];
  /* settled() never resolves: a scan that has not finished. The open must complete anyway. */
  await openAppOnListening(openDeps(log));
  assert.deepStrictEqual(log, ['ready:false', 'ready:true', 'loadApp']);
});

test('load: a respawned engine blanks the old page first, a fresh boot page is not reloaded', async () => {
  const a: string[] = [];
  await openAppOnListening(openDeps(a, { onBootPage: () => false }));
  assert.deepStrictEqual(a, ['ready:false', 'showBoot', 'ready:true', 'loadApp']);
});

test('load: the attach is still watched; a stalled read is reported after the app is up, a finished one fires onAttached', async () => {
  const log: string[] = [];
  let reject!: (e: Error) => void;
  const stalled = new Promise<void>((_, r) => (reject = r));
  await openAppOnListening(openDeps(log, { settled: () => stalled }));
  assert.ok(!log.includes('failed'));
  reject(new Error('stopped'));
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(log.slice(-1), ['failed']);

  const ok: string[] = [];
  await openAppOnListening(openDeps(ok, { settled: () => Promise.resolve({}), onAttached: () => void ok.push('attached') }));
  await new Promise((r) => setImmediate(r));
  assert.ok(ok.indexOf('loadApp') < ok.indexOf('attached'), ok.join(','));
});

test('load: a destroyed window loads nothing', async () => {
  const log: string[] = [];
  await openAppOnListening(openDeps(log, { windowAlive: () => false }));
  assert.ok(!log.includes('loadApp'));
});

test('ready: resolves on the listening event with no timer ticking, and no poll ever starts', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let listen!: () => void;
    const listening = new Promise<void>((r) => (listen = r));
    let polls = 0;
    const ready = awaitServerReady({
      listening,
      onDeath: () => undefined,
      timeoutMs: 30_000,
      timeoutMessage: 'late',
      fallback: { afterMs: 1500, run: () => (polls++, never()) },
    });
    listen();
    assert.strictEqual(await ready, 'listening', 'resolved with the clock at 0');
    mock.timers.tick(60_000);
    assert.strictEqual(polls, 0, 'the fallback poll was cancelled by the line');
  } finally {
    mock.timers.reset();
  }
});

test('ready: the fallback poll starts only after the silence, and the child dying rejects at once', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let polls = 0;
    const silent = awaitServerReady({
      listening: never(),
      onDeath: () => undefined,
      timeoutMs: 30_000,
      timeoutMessage: 'late',
      fallback: { afterMs: 1500, run: () => (polls++, Promise.resolve()) },
    });
    mock.timers.tick(1499);
    assert.strictEqual(polls, 0);
    mock.timers.tick(1);
    assert.strictEqual(await silent, 'poll');
    assert.strictEqual(polls, 1);

    let die!: (e: Error) => void;
    const dying = awaitServerReady({ listening: never(), onDeath: (cb) => (die = cb), timeoutMs: 30_000, timeoutMessage: 'late' });
    die(new Error('exited'));
    await assert.rejects(dying, /exited/);

    const slow = awaitServerReady({ listening: never(), onDeath: () => undefined, timeoutMs: 30_000, timeoutMessage: 'too slow' });
    mock.timers.tick(30_000);
    await assert.rejects(slow, /too slow/);
  } finally {
    mock.timers.reset();
  }
});

/** A stand-in engine that exits at once when its port is taken, as the real one does. */
function fakeEngine(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-boot-early-'));
  const file = path.join(dir, 'cli.js');
  fs.writeFileSync(
    file,
    [
      "const http = require('node:http');",
      "const port = Number(process.argv[process.argv.indexOf('--port') + 1]);",
      "const s = http.createServer((q, r) => { r.statusCode = 200; r.end('ok'); });",
      "s.on('error', () => process.exit(1));",
      "s.listen(port, '127.0.0.1', () => console.log('SEQUENCE_LISTENING http://127.0.0.1:' + port));",
    ].join('\n'),
  );
  return file;
}

test('port hint: a remembered port something else holds (even answering 200) falls back to a free one without the restart dialog', async () => {
  const foreign = http.createServer((_q, r) => r.end('foreign'));
  await new Promise<void>((r) => foreign.listen(0, '127.0.0.1', r));
  const taken = (foreign.address() as net.AddressInfo).port;
  const logs: string[] = [];
  let exits = 0;
  const controller = new ServerController({
    cliPath: fakeEngine(),
    nodeExecPath: process.execPath,
    healthTimeoutMs: 20_000,
    pollIntervalMs: 50,
    onLog: (l) => logs.push(l),
    onUnexpectedExit: () => void exits++,
  });
  try {
    controller.usePort(taken, { hint: true });
    const status = await controller.start();
    assert.notStrictEqual(status.port, taken, logs.join('\n'));
    assert.ok(logs.some((l) => l.includes('remembered port')), logs.join('\n'));
    assert.strictEqual(exits, 0, 'a stale hint is not a failed start');
    assert.ok(logs.includes('[server] ready (listening line)'), logs.join('\n'));
  } finally {
    await controller.stop();
    await new Promise((r) => foreign.close(r));
  }
});

test('port hint: a free remembered port is used as it is', async () => {
  const probeSrv = net.createServer();
  await new Promise<void>((r) => probeSrv.listen(0, '127.0.0.1', r));
  const free = (probeSrv.address() as net.AddressInfo).port;
  await new Promise((r) => probeSrv.close(r));
  const controller = new ServerController({ cliPath: fakeEngine(), nodeExecPath: process.execPath, healthTimeoutMs: 20_000 });
  try {
    controller.usePort(free, { hint: true });
    assert.strictEqual((await controller.start()).port, free);
  } finally {
    await controller.stop();
  }
});

test('main.ts: the engine start precedes window creation, and no scan wait stands in front of the app load', () => {
  const src = fs.readFileSync(MAIN_SRC, 'utf8').replace(/\r\n/g, '\n');
  const boot = src.slice(src.indexOf('async function bootstrap'));
  assert.ok(boot.indexOf('startEngine({') > 0 && boot.indexOf('startEngine({') < boot.indexOf('createWindow();'), 'spawn is issued before createWindow');
  assert.doesNotMatch(src, /await controller\.waitUntilAttached/);
  assert.doesNotMatch(src, /await portIsFree|await proxyForFirstSpawn/);
  /* The only wait left on the attach is the background watchdog, and it is not a 150 ms poll. */
  assert.match(src, /ATTACH_WATCH_MS = 1000/);
});
