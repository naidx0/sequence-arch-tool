/**
 * C1.1 — PTY probe + spawn helpers (locking unit tests).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  killedPids,
  killWindowsTree,
  loadPtyModule,
  parseProcRows,
  sweepTargets,
  type ProcRow,
  resetPtyModuleCache,
  setPtyModuleForTest,
  trySpawnPty,
} from '../server/ptyShell.js';
import { resolveShell } from '../server/terminal.js';

/**
 * Run a support script (dist/test/support/<name>) as a child process, wait up
 * to `limitMs` for its single `RESULT {json}` line, then tree-kill it. The
 * child idles after printing, so it is always alive when killed: we hold its
 * handle, so its pid is still its own, and the tree takes every pty child and
 * conhost it started. Returns null for a result that never came.
 */
async function runInChild(name: string, limitMs: number): Promise<{ result: Record<string, unknown> | null; out: string }> {
  const script = fileURLToPath(new URL(`./support/${name}`, import.meta.url));
  const child = childProcess.spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  child.stdout!.on('data', (d) => (out += d));
  child.stderr!.on('data', (d) => (out += d));
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  let result: Record<string, unknown> | null = null;
  try {
    const deadline = Date.now() + limitMs;
    while (Date.now() < deadline && child.exitCode === null) {
      const m = /RESULT (\{.*\})/.exec(out);
      if (m) {
        result = JSON.parse(m[1]!) as Record<string, unknown>;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  } finally {
    if (child.exitCode === null) {
      await new Promise<void>((resolve) => killWindowsTree(child.pid, resolve));
      await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
    }
  }
  return { result, out };
}

describe('ptyShell (C1.1)', () => {
  it('loads node-pty or honestly returns null', async () => {
    resetPtyModuleCache();
    const mod = await loadPtyModule();
    if (mod === null) {
      assert.equal(trySpawnPty(resolveShell(), os.tmpdir(), process.env), null);
      return;
    }
    assert.equal(typeof mod.spawn, 'function');
  });

  it('spawns a PTY that can echo when the binding is present', async () => {
    resetPtyModuleCache();
    const mod = await loadPtyModule();
    if (!mod) return; // environment without native build — pipe fallback covers CI honesty

    /*
     * RETRY THE SPAWN, and treat a persistent null as the honest fallback it is.
     *
     * node-pty on Windows drives ConPTY, and its console-list helper
     * (conpty_console_list_agent.js) intermittently dies with "AttachConsole failed" when many
     * processes churn — which is exactly what a 1700-test suite does. The spawn then returns
     * null. Asserting that a loaded module ALWAYS yields a session made this test pass alone
     * and fail about three runs in four inside the full suite, which is worse than either a
     * clean pass or a clean failure.
     *
     * The PRODUCT contract is already correct and is what this locks: trySpawnPty returns a
     * real PTY or null, and terminal.ts falls back to a pipe shell and ANNOUNCES pipe (the
     * C1.1 honesty test in terminal.test.ts covers that path). So: retry a few times, and if
     * the OS still refuses a console slot, require that the refusal is the documented win32
     * one rather than silently passing. On any other platform a null here is a hard failure.
     */
    let pty: ReturnType<typeof trySpawnPty> = null;
    for (let attempt = 0; attempt < 3 && !pty; attempt++) {
      pty = trySpawnPty(resolveShell(), os.tmpdir(), process.env, 80, 24);
      if (!pty) await new Promise((r) => setTimeout(r, 250));
    }
    if (!pty) {
      assert.equal(
        process.platform,
        'win32',
        'a loaded node-pty that cannot spawn is only tolerated on win32 ConPTY',
      );
      return;
    }

    assert.equal(pty.backend, 'pty');
    let buf = '';
    pty.onData((d) => {
      buf += d;
    });
    pty.write('echo C1_PTY_OK' + String.fromCharCode(10));
    /*
     * POLL for the marker instead of sleeping a fixed 400ms.
     *
     * A shell under a 1700-test suite does not always start, read and echo inside a fixed
     * window — the spawn succeeded and the echo simply had not arrived yet, so the fixed
     * sleep failed about one run in three while proving nothing about the product. Waiting
     * UNTIL the marker (or a real timeout) tests the same claim without the race.
     */
    const deadline = Date.now() + 8000;
    while (!/C1_PTY_OK/.test(buf) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    pty.resize(100, 30); // must not throw
    pty.kill();
    assert.match(buf, /C1_PTY_OK/);
  });

  it('killedPids reads the pids taskkill terminated, not their parents, plus the root', () => {
    const out = [
      'SUCCESS: The process with PID 3120 (child process of PID 2876) has been terminated.',
      'SUCCESS: The process with PID 2876 (child process of PID 9001) has been terminated.',
    ].join('\r\n');
    assert.deepEqual(killedPids(out, 2876).sort((a, b) => a - b), [2876, 3120]);
    assert.deepEqual(killedPids('', 42), [42]);
  });

  /*
   * WHAT THE SWEEP MAY TOUCH, on hand-built process tables (pid, parent,
   * creation ms). taskkill walked the tree [100, 101] between t=3000 and
   * t=3200. Pid reuse is the whole difficulty: a pid names a process only
   * together with when it was created.
   */
  const TREE = [100, 101];
  const KILL = { from: 3000, to: 3200 };

  it('sweepTargets: only a child of a dead tree pid, created during the kill', () => {
    const now: ProcRow[] = [
      { pid: 1, ppid: 0, created: 0 }, // the server
      { pid: 110, ppid: 101, created: 3100 }, // forked by 101 as it was killed: the orphan
      { pid: 120, ppid: 101, created: 2500 }, // older than the kill: not a fork of the kill
      { pid: 121, ppid: 101, created: 4000 }, // after the kill: some later holder of 101 made it
      { pid: 140, ppid: 1, created: 3100 }, // a bystander the server started during the kill
      { pid: 150, ppid: 77, created: 3100 }, // an orphan Sequence never started
    ];
    assert.deepEqual(sweepTargets(TREE, now, KILL), [110]);
  });

  it('sweepTargets: a live process holding a killed pid, and its children, are never touched', () => {
    const now: ProcRow[] = [
      { pid: 101, ppid: 5, created: 3150 }, // pid 101 reused during the kill, alive
      { pid: 160, ppid: 101, created: 3180 }, // its child: the parent pid is alive, so not an orphan
      { pid: 100, ppid: 101, created: 3190 }, // a process now holding the root's pid
    ];
    assert.deepEqual(sweepTargets(TREE, now, KILL), []);
    /* The root's pid reused during the kill by a process whose recorded parent
       is a dead tree pid: still a live holder of a killed pid, still untouched. */
    assert.deepEqual(sweepTargets(TREE, [{ pid: 100, ppid: 101, created: 3150 }], KILL), []);
  });

  it('a pty that never became ready is still closed (node-pty would defer its kill for ever)', () => {
    if (process.platform !== 'win32') return;
    const calls: string[] = [];
    /* A fake node-pty. pid undefined, so the tree kill runs nothing and goes
       straight to closing; _innerPid is what the agent's own kill needs. */
    const fake = (ready: boolean) => ({
      spawn: () => ({
        pid: undefined,
        _isReady: ready,
        _close: () => calls.push('close'),
        _agent: { _innerPid: 1, kill: () => calls.push('agent.kill') },
        write: () => {},
        resize: () => {},
        kill: () => calls.push('deferred kill'),
        onData: () => {},
        onExit: () => {},
      }),
    });
    try {
      setPtyModuleForTest(fake(false));
      trySpawnPty('sh', os.tmpdir(), {}, 80, 24)!.kill();
      assert.deepEqual(calls, ['close', 'agent.kill'], 'closed directly, not queued behind a first byte that will never come');
      calls.length = 0;
      setPtyModuleForTest(fake(true));
      trySpawnPty('sh', os.tmpdir(), {}, 80, 24)!.kill();
      assert.deepEqual(calls, ['deferred kill'], 'a ready pty closes through node-pty as before');
    } finally {
      resetPtyModuleCache();
    }
  });

  it("closing never runs node-pty's console-list kill (it kills the shell's pid 5 s later, whoever holds it)", async () => {
    if (process.platform !== 'win32') return;
    /* In a child process (support/ptyListControl.ts says why): it can fail, never hang. */
    const { result, out } = await runInChild('ptyListControl.js', 60_000);
    assert.ok(result, `the control did not finish within 60 s (its process tree was killed). Output: ${out.slice(-600)}`);
    if (result.skipped) return;
    assert.equal(result.error, undefined, `the control failed: ${String(result.error)}`);
    assert.equal(result.controlListed, 1, "node-pty's own kill lists the console (the control)");
    assert.equal(result.oursListed, 0, 'our close never asks node-pty to list and kill');
  });

  it('closing a terminal whose child is flooding output does not stall the event loop', async () => {
    if (process.platform !== 'win32') return;
    /* support/ptyCloseStall.ts: ClosePseudoConsole runs on the JS thread and may
       wait on the output pipe draining. Measured 2026-10-06: worst stall 59 ms
       over 16 loaded runs; a second is the alarm, a timeout is a freeze. */
    const { result, out } = await runInChild('ptyCloseStall.js', 60_000);
    assert.ok(result, `closing the flooding terminal did not finish within 60 s: the close blocked. Output: ${out.slice(-600)}`);
    if (result.skipped) return;
    assert.equal(result.error, undefined, `the run failed: ${String(result.error)}`);
    assert.equal(result.exited, true, 'the terminal reported its end');
    assert.ok(Number(result.maxStallMs) < 1000, `the event loop stalled ${String(result.maxStallMs)} ms during the close`);
  });

  it('parseProcRows reads the listing and skips noise', () => {
    assert.deepEqual(parseProcRows('4 0 1000\r\n\r\nwarning: x\r\n 12 4 1791283521599 \n'), [
      { pid: 4, ppid: 0, created: 1000 },
      { pid: 12, ppid: 4, created: 1791283521599 },
    ]);
  });

  it('killWindowsTree kills the tree and leaves processes it did not start, before and after the kill, alone', async () => {
    if (process.platform !== 'win32') return;
    const forever = ['-e', 'setInterval(() => {}, 1000)'];
    /* A process is checked by a handle we hold: its pid cannot be reused while we hold it. */
    const running = (c: childProcess.ChildProcess): boolean => c.exitCode === null && c.signalCode === null;
    const before = childProcess.spawn(process.execPath, forever, { stdio: 'ignore', windowsHide: true });
    /* The tree: a root that starts a child and reports its pid on stdout. */
    const root = childProcess.spawn(
      process.execPath,
      ['-e', "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log('KID='+c.pid);setInterval(()=>{},1000)"],
      { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
    );
    let after: childProcess.ChildProcess | null = null;
    try {
      const kid = await new Promise<number>((resolve, reject) => {
        let out = '';
        root.stdout!.on('data', (d) => {
          out += d;
          const m = /KID=(\d+)/.exec(out);
          if (m) resolve(Number(m[1]));
        });
        root.on('exit', () => reject(new Error('root exited early')));
      });
      await new Promise<void>((resolve) =>
        killWindowsTree(root.pid, () => {
          after = childProcess.spawn(process.execPath, forever, { stdio: 'ignore', windowsHide: true });
          resolve();
        }),
      );
      const rootGone = new Promise<void>((r) => (running(root) ? root.once('exit', () => r()) : r()));
      await rootGone;
      /* The sweep lists the table after 300 ms; give it time to have run. */
      await new Promise((r) => setTimeout(r, 4000));
      let kidAlive = true;
      try {
        process.kill(kid, 0);
      } catch {
        kidAlive = false;
      }
      assert.equal(kidAlive, false, 'the child of the tree is gone');
      assert.equal(running(before), true, 'a process started before the kill survives');
      assert.equal(running(after!), true, 'a process started after the kill survives the sweep');
    } finally {
      for (const c of [before, root, after as childProcess.ChildProcess | null]) c?.kill();
    }
  });

  it('resize, write and kill after the process exited are no-ops, not throws', async () => {
    resetPtyModuleCache();
    const mod = await loadPtyModule();
    if (!mod) return;
    /* A child that exits by itself: the window the terminal teardown races. */
    const pty = trySpawnPty(process.execPath, os.tmpdir(), process.env, 80, 24, [
      '-e',
      "process.stdout.write('BYE')",
    ]);
    if (!pty) return; // the documented win32 console-slot refusal (see above)
    let exited = false;
    pty.onExit(() => {
      exited = true;
    });
    let killedOk = false;
    try {
      const deadline = Date.now() + 15000;
      while (!exited && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
      assert.ok(exited, 'the child should have exited by itself');
      assert.doesNotThrow(() => pty.resize(120, 40));
      assert.doesNotThrow(() => pty.write('late'));
      assert.doesNotThrow(() => pty.kill());
      killedOk = true;
    } finally {
      /* A failed assertion above must still release node-pty's console, or the
         test process never exits. */
      if (!killedOk) {
        try {
          pty.kill();
        } catch {
          /* best effort */
        }
      }
    }
  });
});

describe('node-pty pin', () => {
  it('node-pty is pinned to an exact version, because disarmConsoleListKill reaches into its internals', () => {
    const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    const spec = pkg.dependencies?.['node-pty'] ?? pkg.optionalDependencies?.['node-pty'];
    assert.ok(spec, 'node-pty is declared in packages/analyzer/package.json');
    assert.match(spec, /^\d+\.\d+\.\d+$/, `node-pty must be an exact version, got "${spec}"`);
  });
});
