import assert from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ServerController } from '../server-control';

/**
 * Locks for the quit-tree-kill fix pass (stand-in scripts only):
 *  - no timer survives stop() when a snapshotted descendant stays alive;
 *  - the shared find_files host (--find-files-host) outlives stop(), while a
 *    plain detached grandchild does not.
 */

const POSIX = process.platform !== 'win32';

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Dead = gone, or a zombie that a lazy init has not reaped yet (kill(pid, 0) still succeeds on those). */
function dead(pid: number): boolean {
  if (!alive(pid)) return true;
  try {
    return execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim().startsWith('Z');
  } catch {
    return true;
  }
}

async function waitGone(pid: number, ms: number): Promise<boolean> {
  const t0 = Date.now();
  while (!dead(pid)) {
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 25));
  }
  return true;
}

async function readPid(file: string): Promise<number> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return Number(fs.readFileSync(file, 'utf8'));
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`no pid written at ${file}`);
}

const PID_WRITE =
  "const fs = require('node:fs'); const path = require('node:path'); const f = path.join(__dirname, process.argv[2]); fs.writeFileSync(f + '.tmp', String(process.pid)); fs.renameSync(f + '.tmp', f);";

/** A stand-in server that spawns one detached grandchild per spec, then listens once all wrote their pid. */
function standIn(specs: Array<{ pidFile: string; extra: string[]; script: string[] }>): { dir: string; cli: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-quit-fix-'));
  specs.forEach((s, i) => fs.writeFileSync(path.join(dir, `d${i}.js`), [PID_WRITE, ...s.script, 'setInterval(() => {}, 1 << 30);'].join('\n')));
  const cli = path.join(dir, 'server.js');
  fs.writeFileSync(
    cli,
    [
      "const fs = require('node:fs'); const path = require('node:path'); const cp = require('node:child_process'); const http = require('node:http');",
      "const port = Number(process.argv[process.argv.indexOf('--port') + 1]);",
      `const specs = ${JSON.stringify(specs.map((s, i) => ({ pidFile: s.pidFile, extra: s.extra, js: `d${i}.js` })))};`,
      "for (const s of specs) cp.spawn(process.execPath, [path.join(__dirname, s.js), s.pidFile, ...s.extra], { detached: true, stdio: 'ignore', windowsHide: true }).unref();",
      "const s = http.createServer((q, r) => { r.statusCode = 200; r.end('ok'); });",
      "const t = setInterval(() => { if (specs.every((x) => fs.existsSync(path.join(__dirname, x.pidFile)))) { clearInterval(t); s.listen(port, '127.0.0.1', () => console.log('SEQUENCE_LISTENING http://127.0.0.1:' + port)); } }, 25);",
    ].join('\n'),
  );
  return { dir, cli };
}

function killQuiet(pid: number): void {
  if (!pid) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* gone */
  }
}

test('a descendant that ignores SIGTERM leaves no poll timer after stop() resolves, and the forced kill is logged', { skip: !POSIX }, async () => {
  const { dir, cli } = standIn([{ pidFile: 'stubborn.pid', extra: [], script: ["process.on('SIGTERM', () => {});"] }]);
  const logs: string[] = [];
  const controller = new ServerController({ cliPath: cli, nodeExecPath: process.execPath, healthTimeoutMs: 20_000, pollIntervalMs: 100, onLog: (l) => logs.push(l) });
  const timers = (): number => (process as unknown as { getActiveResourcesInfo(): string[] }).getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  let stubborn = 0;
  try {
    await controller.start();
    stubborn = await readPid(path.join(dir, 'stubborn.pid'));
    await controller.stop();
    /* stop() resolved by the budget; the stubborn one was SIGKILLed by the escalation. */
    assert.ok(await waitGone(stubborn, 2000), 'the escalation ends the SIGTERM-ignoring descendant');
    /* Let a re-armed 10 ms poll (the defect) show itself, then count what is left. */
    const before = timers();
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(timers() <= before, `no timer may keep re-arming after stop() (${before} -> ${timers()})`);
    assert.ok(
      logs.some((l) => l.includes('stop held up') && l.includes(String(stubborn))),
      `the forced kill names the holdout pid (${logs.join(' | ')})`,
    );
  } finally {
    await controller.stop().catch(() => undefined);
    killQuiet(stubborn);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a descendant carrying --find-files-host survives stop(); a plain detached grandchild does not', { skip: !POSIX }, async () => {
  const { dir, cli } = standIn([
    { pidFile: 'host.pid', extra: ['--find-files-host', '/some/repo'], script: [] },
    { pidFile: 'plain.pid', extra: [], script: [] },
  ]);
  const controller = new ServerController({ cliPath: cli, nodeExecPath: process.execPath, healthTimeoutMs: 20_000, pollIntervalMs: 100 });
  let host = 0;
  let plain = 0;
  try {
    await controller.start();
    host = await readPid(path.join(dir, 'host.pid'));
    plain = await readPid(path.join(dir, 'plain.pid'));
    await controller.stop();
    assert.ok(await waitGone(plain, 2000), 'a normal detached grandchild is ended');
    assert.ok(!dead(host), 'the shared find_files host outlives stop()');
  } finally {
    await controller.stop().catch(() => undefined);
    killQuiet(host);
    killQuiet(plain);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a lingering earlier teardown finishing late does not orphan the child a later setRepo spawned', { skip: !POSIX }, async () => {
  const { dir, cli } = standIn([{ pidFile: 'any.pid', extra: [], script: [] }]);
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-quit-fix-repo-'));
  let release = false;
  const controller = new ServerController({
    cliPath: cli,
    nodeExecPath: process.execPath,
    healthTimeoutMs: 20_000,
    pollIntervalMs: 100,
    /* The first teardown's descendant poll reads "alive" until released. */
    isAlive: () => !release,
  });
  let first = 0;
  let second = 0;
  try {
    await controller.start();
    first = controller.childPid!;
    const lingering = controller.stop(); // not awaited: its server exits, its poll keeps going
    await new Promise((r) => setTimeout(r, 300));
    await controller.setRepo(repo); // the old child already exited, so this spawns a new one at once
    second = controller.childPid!;
    assert.ok(second && second !== first, 'a new child is live');
    release = true;
    await lingering; // the older teardown finishes now
    assert.strictEqual(controller.childPid, second, 'the older teardown must not clear the newer child');
    assert.ok(!dead(second), 'the newer child is still running');
  } finally {
    release = true;
    await controller.stop().catch(() => undefined);
    killQuiet(first);
    killQuiet(second);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('after stop() resolves at the budget, the liveness probe is not polled again and no timer re-arms', { skip: !POSIX }, async () => {
  const { dir, cli } = standIn([{ pidFile: 'any.pid', extra: [], script: [] }]);
  let probes = 0;
  const controller = new ServerController({
    cliPath: cli,
    nodeExecPath: process.execPath,
    healthTimeoutMs: 20_000,
    pollIntervalMs: 100,
    /* Every snapshotted descendant "stays alive" (a zombie under a lazy init, a D-state process, a reused pid). */
    isAlive: () => {
      probes++;
      return true;
    },
  });
  const timers = (): number => (process as unknown as { getActiveResourcesInfo(): string[] }).getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  let pid = 0;
  try {
    await controller.start();
    pid = await readPid(path.join(dir, 'any.pid'));
    const t0 = Date.now();
    await controller.stop();
    assert.ok(Date.now() - t0 >= 2900, 'with a descendant that never reads as dead, stop() ends at the budget');
    const probesAtResolve = probes;
    const timersAtResolve = timers();
    await new Promise((r) => setTimeout(r, 200));
    assert.strictEqual(probes, probesAtResolve, 'no liveness poll after stop() resolved');
    assert.ok(timers() <= timersAtResolve, `no new timer handles (${timersAtResolve} -> ${timers()})`);
  } finally {
    await controller.stop().catch(() => undefined);
    killQuiet(pid);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
