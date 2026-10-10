import assert from 'node:assert';
import { test } from 'node:test';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createRepoServer, type RepoServerOptions } from '../server/repoServer.js';
import { MAX_TERMINALS, TERMINAL_PATH, attachTerminal } from '../server/terminal.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/test -> dist -> analyzer -> packages -> <repo root>
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const TICKETING = path.join(REPO_ROOT, 'examples', 'ticketing-scaffold');

/** Copy the ticketing fixture into a throwaway dir so the shell never runs in examples/. */
function freshRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-term-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(TICKETING, repo, { recursive: true });
  return repo;
}

interface Server {
  port: number;
  wsUrl: string;
  close: () => Promise<void>;
}

/** Start a repo server (or a no-repo server) on an ephemeral localhost port. */
async function startServer(
  repoRoot: string | null,
  opts: Partial<RepoServerOptions> = {}
): Promise<Server> {
  const server = await createRepoServer(repoRoot, { webDist: undefined, ...opts });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  /*
   * UPGRADED SOCKETS ARE TRACKED BY HAND, BECAUSE `closeAllConnections()` DOES
   * NOT REACH THEM.
   *
   * `server.close(cb)` fires its callback only once every connection has ended,
   * and a WebSocket that has been through `upgrade` is a connection that never
   * ends on its own. The previous version called `closeAllConnections()` and a
   * comment promised that close() "can never hang" — it hung anyway, and took
   * the whole analyzer suite with it (see the note on the no-zombie test below).
   * The promise was not kept because an upgraded socket is detached from the
   * HTTP layer's own bookkeeping, so the only handle on it is the one we keep.
   */
  const upgraded = new Set<{ destroy: () => void; on: (e: string, f: () => void) => void }>();
  server.on('upgrade', (_req, socket) => {
    const sock = socket as unknown as {
      destroy: () => void;
      on: (e: string, f: () => void) => void;
    };
    upgraded.add(sock);
    sock.on('close', () => upgraded.delete(sock));
  });

  return {
    port,
    wsUrl: `ws://127.0.0.1:${port}/api/terminal`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        for (const sock of upgraded) sock.destroy();
        upgraded.clear();
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      }),
  };
}

type ConnectResult =
  | { ok: true; ws: WebSocket; frames: string[] }
  | { ok: false; status?: number; reason?: string; error?: string };

/** Attempt a terminal WS handshake; resolve on open OR on a refusal (HTTP error). */
function connect(url: string, options?: Record<string, unknown>): Promise<ConnectResult> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, options);
    /*
     * Collect text frames from socket CREATION, not from when a test attaches its own
     * listener. The server announces the shell backend synchronously as the PTY starts,
     * which on a fast conpty spawn beats any handler attached after connect() resolves —
     * the C1.1 honesty test then timed out waiting for a frame it had already missed.
     */
    const frames: string[] = [];
    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (!isBinary) frames.push(data.toString('utf8'));
    });
    ws.on('open', () => resolve({ ok: true, ws, frames }));
    ws.on('unexpected-response', (_req, res) => {
      const reason = res.headers['sequence-terminal-error'];
      res.resume(); // drain so the socket can close cleanly
      resolve({
        ok: false,
        status: res.statusCode,
        reason: typeof reason === 'string' ? reason : undefined,
      });
    });
    ws.on('error', (e: Error) => resolve({ ok: false, error: e.message }));
  });
}

/** Poll `pred` until true or `ms` elapses. */
async function waitFor(pred: () => boolean, ms: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 40));
  }
  return pred();
}

test('terminal WS announces pty or pipe backend (C1.1 honesty)', async () => {
  const repo = freshRepo();
  const srv = await startServer(repo);
  const conn = await connect(srv.wsUrl);
  try {
    assert.ok(conn.ok, `handshake should succeed, got ${JSON.stringify(conn)}`);
    if (!conn.ok) return;
    const readBackend = (): string | null => {
      for (const raw of conn.frames) {
        try {
          const msg = JSON.parse(raw) as { type?: string; backend?: string };
          if (msg.type === 'backend' && (msg.backend === 'pty' || msg.backend === 'pipe')) {
            return msg.backend;
          }
        } catch {
          /* a binary-looking text frame is not the announcement */
        }
      }
      return null;
    };
    const seen = await waitFor(() => readBackend() !== null, 3000);
    assert.ok(seen, 'the shell must announce its backend');
    const backend = readBackend();
    assert.ok(backend === 'pty' || backend === 'pipe', `unexpected backend ${backend}`);
    conn.ws.close();
  } finally {
    await srv.close();
  }
});

/*
 * A LONG-LIVED NODE CHILD, NOT A SHELL, for the lifecycle tests below.
 *
 * Measured 2026-10-06: the resize test's intermittent failure was never about
 * resize. Its output under load read "bash.exe: *** fatal error - console device
 * allocation failure - too many consoles in use, max consoles is 128" — Git Bash
 * subshells left behind by earlier kills had used up cygwin's console slots, and
 * a new bash could not start. A test about our resize handling must not depend
 * on a machine-wide cygwin budget, so it drives a node child that cannot exit on
 * its own, through the product's own launch path (attachTerminal's `signIn`).
 *
 * The child prints READY, answers `size?` with its console size (pty only),
 * echoes other lines as ECHO:<line>, and with `tree` first starts a grandchild
 * DETACHED from the console and prints its pid.
 */
const CHILD_SRC = [
  "const { spawn } = require('node:child_process');",
  "if (process.argv[2] === 'tree') {",
  "  const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', process.argv[3]], { detached: true, stdio: 'ignore' });",
  '  c.unref();',
  "  process.stdout.write('GPID=' + c.pid + '\\n');",
  '}',
  "process.stdout.write('READY\\n');",
  "let buf = '';",
  "process.stdin.setEncoding('utf8');",
  "process.stdin.on('data', (d) => {",
  '  buf += d;',
  '  let i;',
  '  while ((i = buf.search(/[\\r\\n]/)) >= 0) {',
  '    const line = buf.slice(0, i).trim();',
  '    buf = buf.slice(i + 1);',
  "    if (line === 'size?') {",
  '      const s = process.stdout.isTTY ? process.stdout.getWindowSize() : [0, 0];',
  "      process.stdout.write('SIZE=' + s[0] + 'x' + s[1] + '\\n');",
  "    } else if (line) process.stdout.write('ECHO:' + line + '\\n');",
  '  }',
  '});',
  'setInterval(() => {}, 1000);',
].join('\n');

/** A bare terminal server whose `?signin=` upgrade runs the node child above. */
async function startChildServer(mode: 'plain' | 'tree', marker = ''): Promise<Server> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-term-child-'));
  const script = path.join(dir, 'child.cjs');
  fs.writeFileSync(script, CHILD_SRC);
  const server = http.createServer();
  attachTerminal(server, {
    getRoot: () => dir,
    enabled: true,
    signIn: () => ({ file: process.execPath, args: [script, mode, marker], env: process.env, cwd: dir }),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const upgraded = new Set<{ destroy: () => void }>();
  server.on('upgrade', (_req, socket) => {
    upgraded.add(socket);
    socket.on('close', () => upgraded.delete(socket));
  });
  return {
    port,
    wsUrl: `ws://127.0.0.1:${port}${TERMINAL_PATH}?signin=child`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        for (const sock of upgraded) sock.destroy();
        upgraded.clear();
      }),
  };
}

/** Resolve with the accumulated output once `pattern` matches it (bounded). */
function outputMatching(ws: WebSocket, pattern: RegExp, ms: number): Promise<{ buf: string; m: RegExpMatchArray | null }> {
  return new Promise((resolve) => {
    let buf = '';
    const onMessage = (data: Buffer): void => {
      buf += data.toString('utf8');
      const m = buf.match(pattern);
      if (m) done(m);
    };
    const done = (m: RegExpMatchArray | null): void => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve({ buf, m });
    };
    const timer = setTimeout(() => done(null), ms);
    ws.on('message', onMessage);
  });
}

function backendOf(frames: string[]): string | null {
  for (const raw of frames) {
    try {
      const msg = JSON.parse(raw) as { type?: string; backend?: string };
      if (msg.type === 'backend') return msg.backend ?? null;
    } catch {
      /* not the announcement */
    }
  }
  return null;
}

test('terminal WS accepts resize control and still round-trips after (C1.2)', async () => {
  const srv = await startChildServer('plain');
  const conn = await connect(srv.wsUrl);
  try {
    assert.ok(conn.ok, `handshake should succeed, got ${JSON.stringify(conn)}`);
    if (!conn.ok) return;
    const ws = conn.ws;

    /* Sent the instant the socket opens: before the child has printed a byte,
       which on Windows is before ConPTY is ready. */
    const ready = outputMatching(ws, /READY/, 15000);
    ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));
    const r = await ready;
    assert.ok(r.m, `child never became ready: ${JSON.stringify(r.buf)}`);

    if (backendOf(conn.frames) === 'pty') {
      /* The early resize was applied, not dropped: the child's console says so.
         The child learns a new size from SIGWINCH, which libuv hands over through a pipe of its own, so a `size?`
         that reaches a loaded child in the same wake-up as the signal can be read first and answer the old size
         (80x24, measured on Linux under CPU contention). Ask again until the child reports 120x40 or the budget
         runs out: a resize that was dropped never reports it, and the replies seen are in the failure message. */
      const deadline = Date.now() + 15000;
      const replies: string[] = [];
      let seen: number[] = [];
      while (Date.now() < deadline && !(seen[0] === 120 && seen[1] === 40)) {
        const size = outputMatching(ws, /SIZE=(\d+)x(\d+)/, 3000);
        ws.send(Buffer.from('size?\r'));
        const s = await size;
        assert.ok(s.m, `no size reply: ${JSON.stringify(s.buf)}`);
        seen = [Number(s.m[1]), Number(s.m[2])];
        replies.push(`${seen[0]}x${seen[1]}`);
        if (!(seen[0] === 120 && seen[1] === 40)) await new Promise((r) => setTimeout(r, 100));
      }
      assert.deepStrictEqual(seen, [120, 40], `the early resize never reached the child; replies: ${replies.join(', ')}`);
    }

    const echoed = outputMatching(ws, /ECHO:__RESIZE_OK__/, 15000);
    ws.send(Buffer.from('__RESIZE_OK__\r'));
    const e = await echoed;
    assert.ok(e.m, `expected marker after resize, got: ${JSON.stringify(e.buf)}`);
    ws.close();
  } finally {
    if (conn.ok) conn.ws.close();
    await srv.close();
  }
});

test('closing a terminal kills what its process started, even detached from the console (Windows tree kill)', async () => {
  /* POSIX already has its own group kill, locked by the process-group test below. */
  if (process.platform !== 'win32') return;
  /* The grandchild carries a marker on its command line. Liveness and the
     cleanup below check the marker, never the bare pid: a pid freed by the
     kill is reused within milliseconds under load, and an unconditional
     process.kill(gpid) here could kill whatever had the pid next. (The same
     hazard, inside node-pty's own kill, is disarmed in ptyShell.ts; see
     disarmConsoleListKill.) */
  const marker = `seq-tree-kill-${process.pid}-${Date.now()}`;
  const srv = await startChildServer('tree', marker);
  const conn = await connect(srv.wsUrl);
  let gpid = 0;
  let gone = false;
  try {
    assert.ok(conn.ok, `handshake should succeed, got ${JSON.stringify(conn)}`);
    if (!conn.ok) return;
    const ws = conn.ws;
    const g = await outputMatching(ws, /GPID=(\d+)/, 15000);
    assert.ok(g.m, `no grandchild pid: ${JSON.stringify(g.buf)}`);
    gpid = Number(g.m[1]);
    assert.ok(await isMarked(gpid, marker), 'grandchild should be alive before close');

    ws.close();
    const deadline = Date.now() + 15000;
    while (!(gone = !(await isMarked(gpid, marker))) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    assert.ok(gone, `grandchild (pid ${gpid}) outlived its terminal`);
  } finally {
    /* Only the process that is still ours: same pid AND the marker. */
    if (gpid && !gone && (await isMarked(gpid, marker))) {
      try {
        process.kill(gpid);
      } catch {
        /* gone between the check and the kill */
      }
    }
    if (conn.ok) conn.ws.close();
    await srv.close();
  }
});

/** Is `pid` alive and is its command line carrying `marker`? (Windows only.) */
function isMarked(pid: number, marker: string): Promise<boolean> {
  return new Promise((resolve) => {
    childProcess.execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${Math.trunc(pid)}").CommandLine`],
      { windowsHide: true },
      (_e, out) => resolve(String(out ?? '').includes(marker)),
    );
  });
}

test('terminal WS close reason reports shell exit (C1.2)', async () => {
  if (process.platform === 'win32') return;
  const repo = freshRepo();
  const srv = await startServer(repo);
  const conn = await connect(srv.wsUrl);
  try {
    assert.ok(conn.ok, `handshake should succeed, got ${JSON.stringify(conn)}`);
    if (!conn.ok) return;
    const ws = conn.ws;

    const reason = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no close after exit')), 8000);
      ws.on('close', (_code, buf) => {
        clearTimeout(timer);
        resolve(Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf ?? ''));
      });
      ws.send(Buffer.from('exit 7\n'));
    });

    assert.match(reason, /shell exited/i);
  } finally {
    await srv.close();
  }
});

test('terminal WS spawns a repo-scoped shell and round-trips a marker', async () => {
  const repo = freshRepo();
  const srv = await startServer(repo);
  const conn = await connect(srv.wsUrl);
  try {
    assert.ok(conn.ok, `handshake should succeed, got ${JSON.stringify(conn)}`);
    if (!conn.ok) return;
    const ws = conn.ws;

    /* Resolves on the marker; the bound only catches a shell that never answers.
       It is not 5 s because a real Git Bash under a CPU-saturated machine took
       longer than that just to print its prompt (measured 2026-10-06: 11 of 40
       runs at 8 parallel files plus 8 busy cores returned only ConPTY's
       preamble at 5 s). This test is about the round trip, not about startup
       speed. */
    const output = await new Promise<string>((resolve) => {
      let buf = '';
      const timer = setTimeout(() => resolve(buf), 30000);
      ws.on('message', (data: Buffer) => {
        buf += data.toString('utf8');
        if (buf.includes('__MARKER__')) {
          clearTimeout(timer);
          resolve(buf);
        }
      });
      // BINARY frame = raw stdin. `echo` writes the marker to stdout (a pipe shell
      // does not echo the typed command, but the command's OUTPUT flows back).
      ws.send(Buffer.from('echo __MARKER__\n'));
    });

    assert.ok(
      output.includes('__MARKER__'),
      `expected __MARKER__ in shell output, got: ${JSON.stringify(output)}`
    );
    ws.close();
  } finally {
    await srv.close();
  }
});

/*
 * THE DEFAULT WORKSPACE IS A PROJECT (round 7, B6; Jaden: "Terminal: start a
 * project... The default workspace should be a project"). With nothing
 * attached the shell opens in the home workspace, the same folder the file
 * APIs jail to (`~/.sequence/workspace`, made by ensureWorkspace).
 */
test('with no repo attached, the terminal opens in the home workspace folder', async () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-term-home-')));
  const userConfigDir = path.join(home, 'store');
  const srv = await startServer(null, { userConfigDir });
  const conn = await connect(srv.wsUrl);
  try {
    assert.ok(conn.ok, `handshake should succeed with no repo, got ${JSON.stringify(conn)}`);
    if (!conn.ok) return;
    const ws = conn.ws;
    const ws0 = fs.realpathSync(path.join(home, 'store', 'workspace'));
    const marker = path.join(ws0, '__here__.txt');
    /* A relative write lands in the shell's cwd; cmd, PowerShell and sh all read this line. */
    ws.send(Buffer.from('echo here> __here__.txt\r'));
    const landed = await waitFor(() => fs.existsSync(marker), 30000);
    assert.ok(landed, `expected the shell's cwd to be ${ws0}`);
    const closed = new Promise<void>((r) => ws.on('close', () => r()));
    ws.close();
    await closed;
  } finally {
    await srv.close();
    /* Best effort: on Windows the exiting shell can hold its cwd a moment longer. */
    try {
      fs.rmSync(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 });
    } catch {
      /* the run's isolated temp root goes with the run */
    }
  }
});

test('terminal WS is refused when no repo is attached and the workspace cannot be made (409)', async () => {
  /* A store dir whose parent is a FILE: ensureWorkspace throws, as on a read-only home. */
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-term-ro-')));
  const blocker = path.join(home, 'not-a-dir');
  fs.writeFileSync(blocker, 'x');
  const srv = await startServer(null, { userConfigDir: path.join(blocker, 'store') });
  try {
    const conn = await connect(srv.wsUrl);
    assert.strictEqual(conn.ok, false, 'no-repo, no-workspace upgrade must be refused');
    if (!conn.ok) {
      assert.strictEqual(conn.status, 409, `expected 409, got ${conn.status} / ${conn.error}`);
      assert.match(conn.reason ?? '', /no repo/i);
    }
  } finally {
    await srv.close();
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('terminal WS rejects a cross-origin upgrade (403)', async () => {
  const repo = freshRepo();
  const srv = await startServer(repo);
  try {
    // A malicious page on http://evil.example pointing a WebSocket at localhost.
    const conn = await connect(srv.wsUrl, { origin: 'http://evil.example' });
    assert.strictEqual(conn.ok, false, 'cross-origin upgrade must be refused');
    if (!conn.ok) {
      assert.strictEqual(conn.status, 403, `expected 403, got ${conn.status} / ${conn.error}`);
      assert.match(conn.reason ?? '', /origin/i);
    }
  } finally {
    await srv.close();
  }
});

test('terminal WS rejects a forged non-loopback Host (DNS-rebinding defense) (403)', async () => {
  const repo = freshRepo();
  const srv = await startServer(repo);
  try {
    // Simulate DNS rebinding: a page on attacker.example rebound to 127.0.0.1 would
    // send Host: attacker.example (which matches its own Origin). The loopback-Host
    // guard rejects it even though Origin would equal Host.
    const conn = await connect(srv.wsUrl, {
      headers: { host: `attacker.example:${srv.port}` },
    });
    assert.strictEqual(conn.ok, false, 'non-loopback Host must be refused');
    if (!conn.ok) {
      assert.strictEqual(conn.status, 403, `expected 403, got ${conn.status} / ${conn.error}`);
      assert.match(conn.reason ?? '', /origin/i);
    }
  } finally {
    await srv.close();
  }
});

test('terminal WS is refused when disabled via terminalEnabled:false (403)', async () => {
  const repo = freshRepo();
  const srv = await startServer(repo, { terminalEnabled: false });
  try {
    const conn = await connect(srv.wsUrl);
    assert.strictEqual(conn.ok, false, 'disabled terminal must refuse every upgrade');
    if (!conn.ok) {
      assert.strictEqual(conn.status, 403, `expected 403, got ${conn.status} / ${conn.error}`);
      assert.match(conn.reason ?? '', /disabled/i);
    }
  } finally {
    await srv.close();
  }
});

test('the concurrency cap is atomic: a burst of MAX_TERMINALS+extra never exceeds the cap', async () => {
  const repo = freshRepo();
  const srv = await startServer(repo);
  const EXTRA = 5;
  const total = MAX_TERMINALS + EXTRA;
  try {
    // Fire ALL upgrades concurrently so they race the async handleUpgrade — the
    // exact TOCTOU window a non-atomic cap (check now, live.add later) leaves open.
    const results = await Promise.all(
      Array.from({ length: total }, () => connect(srv.wsUrl))
    );
    const opened = results.filter((r): r is Extract<ConnectResult, { ok: true }> => r.ok);
    const refused = results.filter((r) => !r.ok);

    // The invariant: no more than MAX_TERMINALS shells are ever live at once, no
    // matter how many upgrades arrive in the same tick.
    assert.ok(
      opened.length <= MAX_TERMINALS,
      `never exceed the cap: ${opened.length} open > ${MAX_TERMINALS}`
    );
    // The cap actually engaged — the surplus was refused, and with a 429.
    assert.ok(
      refused.length >= total - MAX_TERMINALS,
      `at least ${total - MAX_TERMINALS} refusals, got ${refused.length}`
    );
    for (const r of refused) {
      if (!r.ok) assert.strictEqual(r.status, 429, `cap refusal must be 429, got ${r.status}`);
    }

    for (const o of opened) o.ws.close();
  } finally {
    await srv.close();
  }
});

test('teardown kills a backgrounded grandchild via the process-group signal', async () => {
  // POSIX-only: the group kill needs setsid + negative-pid signalling. On Windows
  // the fallback is a direct child.kill(), which this test cannot observe.
  if (process.platform === 'win32') return;
  const repo = freshRepo();
  const srv = await startServer(repo);
  const conn = await connect(srv.wsUrl);
  try {
    assert.ok(conn.ok, `handshake should succeed, got ${JSON.stringify(conn)}`);
    if (!conn.ok) return;
    const ws = conn.ws;

    // Background a long-lived grandchild and print ITS pid (`$!`). A non-interactive
    // pipe shell has no job control, so the background job stays in the shell's
    // process group and must die with the group on teardown.
    const gpid = await new Promise<number>((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error(`no grandchild pid, got: ${buf}`)), 5000);
      ws.on('message', (data: Buffer) => {
        buf += data.toString('utf8');
        const m = buf.match(/GPID=(\d+)/);
        if (m) {
          clearTimeout(timer);
          resolve(Number(m[1]));
        }
      });
      ws.send(Buffer.from('sleep 300 & echo GPID=$!\n'));
    });

    // The grandchild is alive right now.
    assert.doesNotThrow(() => process.kill(gpid, 0), 'grandchild should be alive before close');

    // Closing the socket tears the shell down; the process-GROUP kill must reap the
    // backgrounded grandchild too (a plain child.kill() would leave it orphaned).
    ws.close();
    const gone = await waitFor(() => {
      try {
        process.kill(gpid, 0);
        return false;
      } catch {
        return true; // ESRCH — the grandchild was reaped with the group
      }
    }, 5000);
    assert.ok(gone, `backgrounded grandchild (pid ${gpid}) should be dead after teardown`);
  } finally {
    await srv.close();
  }
});

test('closing the socket kills the shell child (no zombie)', async () => {
  /*
   * POSIX-only, for exactly the reason the process-group test above is: `$$` is
   * a POSIX shell variable, and on Windows `resolveShell()` returns `COMSPEC`
   * (cmd.exe) or `powershell.exe`, neither of which expands it. No pid ever
   * arrives, so there is nothing to probe. Windows tears the shell down with a
   * direct `child.kill()` instead, which this test cannot observe.
   *
   * THE MISSING GUARD HERE HUNG THE ENTIRE ANALYZER SUITE. On Windows the pid
   * promise rejected after 5s; `ws.close()` sits on the success path, so the
   * upgraded socket was still open when the `finally` awaited `srv.close()` —
   * and that never resolves while an upgraded socket is alive. The file printed
   * all 8 results and then never exited, so `node --test` hung for ever. Two
   * lanes read "full suite" numbers off a run that had silently stopped at file
   * 131 of 143, and CLAUDE.md still carries the workaround. Both halves are
   * fixed: the guard below, and a close() that drops upgraded sockets.
   */
  if (process.platform === 'win32') return;
  const repo = freshRepo();
  const srv = await startServer(repo);
  const conn = await connect(srv.wsUrl);
  try {
    assert.ok(conn.ok, `handshake should succeed, got ${JSON.stringify(conn)}`);
    if (!conn.ok) return;
    const ws = conn.ws;

    // `$$` is the spawned shell's own PID — capture it from stdout.
    const pid = await new Promise<number>((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error(`no PID captured, got: ${buf}`)), 5000);
      ws.on('message', (data: Buffer) => {
        buf += data.toString('utf8');
        const m = buf.match(/PID=(\d+)/);
        if (m) {
          clearTimeout(timer);
          resolve(Number(m[1]));
        }
      });
      ws.send(Buffer.from('echo PID=$$\n'));
    });

    // The shell is alive right now (kill(pid, 0) is a liveness probe, sends nothing).
    assert.doesNotThrow(() => process.kill(pid, 0), 'shell should be alive before close');

    // Closing the socket must kill the child (the anti-zombie lifecycle guard).
    ws.close();
    const gone = await waitFor(() => {
      try {
        process.kill(pid, 0);
        return false; // still alive (or a not-yet-reaped zombie)
      } catch {
        return true; // ESRCH — reaped and gone
      }
    }, 5000);
    assert.ok(gone, `shell (pid ${pid}) should be dead after the socket closed`);
  } finally {
    /* On the failing path `ws.close()` above was never reached. Closing here as
     * well means a failure tears its own socket down instead of leaving one
     * open for `srv.close()` to wait on for ever. */
    if (conn.ok) conn.ws.close();
    await srv.close();
  }
});
