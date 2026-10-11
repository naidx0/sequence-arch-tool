/* ══════════════════════════════════════════════════════════════════════════
   C1.1 — optional real PTY backend for `/api/terminal`
   packages/analyzer/src/server/ptyShell.ts

   `node-pty` needs a native build (pnpm 10 ignores scripts unless listed in
   `onlyBuiltDependencies`). When the binding is missing or spawn fails, the
   terminal stays on the honest pipe shell — never pretend a TTY exists.

   THE TERMINAL SHIPPED (2026-09-02 correction). This said "Terminal remains
   UNSHIPPED in web2 until C1.3–C1.6 (pane + e2e)" long after all of it landed:
   `packages/web2/src/terminal/TerminalPane.tsx` renders it, `terminal` is one of
   the six ids in `chromeTabModel.ts`'s `CHROME_TAB_DEFS`, and `terminal-pane.mjs`
   is in web2's `test:e2e` chain. A comment that says a shipped surface is
   unshipped tells the next reader not to bother looking for it.

   This module remains what it always was: the backend that makes resize/exit
   real when the PTY binding is available, and steps aside honestly when it is not.
   ══════════════════════════════════════════════════════════════════════════ */

import childProcess from 'node:child_process';
import path from 'node:path';

export type ShellBackend = 'pty' | 'pipe';

/**
 * Kill a Windows process AND every descendant it has right now, then call `done`.
 *
 * WHY THIS EXISTS (measured 2026-10-06). node-pty's own Windows kill forks
 * `conpty_console_list_agent` to list the console's processes and then, in the
 * same tick, closes the pseudoconsole. The agent attaches after the console is
 * gone, so it dies with "AttachConsole failed" on EVERY kill (40 of 40 passing
 * runs printed it) and node-pty falls back to killing only the shell's own pid.
 * Git Bash forks subshells while its profile runs; a subshell forked in the
 * instant the console closes survives, parented to a dead bash. Each orphan
 * keeps one of cygwin's 128 console slots for ever, and once they are used up
 * every new bash dies with "too many consoles in use, max consoles is 128".
 * 20 whole-file runs of terminal.test leaked 38 such orphans; the terminal
 * test "flake" was that exhaustion.
 *
 * HOW.
 *   1. `taskkill /PID <root> /T /F` at once, while the console still exists,
 *      so its walk reaches every live descendant. The caller vouches that
 *      `root` is still its process (the pty or child has not reported an exit).
 *      The tree is the root plus every pid taskkill reports terminating.
 *   2. `done` closes the console.
 *   3. ONE SWEEP AFTER, because a walk is a snapshot: under load a bash forked
 *      between it and its own death (14 orphans in 40 runs). A moment later the
 *      process table is listed, and a process is killed only if ALL hold
 *      ({@link sweepTargets}): its parent pid is in the tree; that pid is not
 *      alive now; it is not itself a tree pid; and it was created inside the
 *      kill (from just before taskkill started to when it returned), which is
 *      when such a fork happens.
 *   So a process Sequence did not start (its parent is not in the tree), one
 *   started before the kill or after it, a live process holding a killed pid
 *   and that process's children are never touched. Selection is pure and
 *   tested on hand-built tables; only the listing and the kills are I/O.
 *
 * WHY NOT LIST FIRST (tried and measured 2026-10-06): identifying the tree by
 * creation time before killing needs a PowerShell process listing, which took
 * a median 9.5 s and up to 20 s with 8 test files in parallel on 8 busy cores,
 * and when it timed out nothing was killed at all. The kill must not wait on a
 * listing; only the sweep does.
 *
 * WHAT IS LEFT. The sweep cannot tell a fork of ours from a process created
 * inside the kill window whose own parent was an UNRELATED process that died,
 * and whose pid one of our tree processes then reused, all within that window.
 * That needs a death and a reuse inside about a second; it is named here so
 * nobody reads the rules above as a proof that covers it.
 */
export function killWindowsTree(pid: number | undefined, done: () => void): void {
  if (process.platform !== 'win32' || pid === undefined || !(pid > 0)) {
    done();
    return;
  }
  const startedAt = Date.now();
  void (async () => {
    const out = await runQuiet(TASKKILL(), ['/PID', String(pid), '/T', '/F']);
    const killedAt = Date.now();
    done();
    const tree = killedPids(out ?? '', pid);
    await new Promise((r) => setTimeout(r, SWEEP_DELAY_MS));
    const now = await listWindowsProcesses();
    if (!now) return;
    for (const target of sweepTargets(tree, now, { from: startedAt - KILL_WINDOW_SLACK_MS, to: killedAt + KILL_WINDOW_SLACK_MS })) {
      await runQuiet(TASKKILL(), ['/PID', String(target), '/T', '/F']);
    }
  })().catch(() => done());
}

/** How long a fork already in flight gets to show up before the sweep looks. */
const SWEEP_DELAY_MS = 300;
/** Clock granularity on either side of the kill window. */
const KILL_WINDOW_SLACK_MS = 50;

const SYS32 = (): string => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
const TASKKILL = (): string => path.join(SYS32(), 'taskkill.exe');

export interface ProcRow {
  pid: number;
  ppid: number;
  /** Creation time, ms since the epoch. */
  created: number;
}

/**
 * The tree taskkill walked: the root plus every pid it reports terminating
 * ("PID <n> (child process of PID <m>)": only <n>, because <m> for the root is
 * the server itself).
 */
export function killedPids(taskkillStdout: string, root: number): number[] {
  const set = new Set<number>([root]);
  for (const m of taskkillStdout.matchAll(/PID\s+(\d+)\s*\(/g)) set.add(Number(m[1]));
  return [...set].filter((n) => Number.isInteger(n) && n > 0);
}

/** The processes the sweep kills (see {@link killWindowsTree}, step 3). */
export function sweepTargets(tree: readonly number[], now: readonly ProcRow[], killWindow: { from: number; to: number }): number[] {
  const inTree = new Set(tree);
  const alive = new Set(now.map((p) => p.pid));
  return now
    .filter(
      (p) =>
        inTree.has(p.ppid) &&
        !alive.has(p.ppid) &&
        !inTree.has(p.pid) &&
        p.created >= killWindow.from &&
        p.created <= killWindow.to,
    )
    .map((p) => p.pid);
}

function runQuiet(file: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      childProcess.execFile(file, args, { windowsHide: true, timeout: 20_000, maxBuffer: 32 << 20 }, (err, stdout) =>
        resolve(err && !stdout ? null : String(stdout ?? '')),
      );
    } catch {
      resolve(null);
    }
  });
}

/** Every process as pid, parent pid and creation time; null when the listing failed. */
async function listWindowsProcesses(): Promise<ProcRow[] | null> {
  const ps = path.join(SYS32(), 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const out = await runQuiet(ps, [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $(([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds())" }',
  ]);
  return out === null ? null : parseProcRows(out);
}

export function parseProcRows(text: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), created: Number(m[3]) });
  }
  return rows;
}

export interface PtySpawnResult {
  backend: 'pty';
  write(data: string | Buffer): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (info: { exitCode: number; signal?: number }) => void): void;
  readonly pid: number | undefined;
}

type PtyModule = {
  spawn: (
    file: string,
    args: string[] | string,
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: Record<string, string>;
    },
  ) => {
    pid: number;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(signal?: string): void;
    onData(cb: (data: string) => void): void;
    onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
  };
};

let cachedPty: PtyModule | null | undefined;

/**
 * Probe whether `node-pty` loads. Result is cached for the process lifetime.
 * Returns null when the native binding is missing (common until postinstall).
 */
export async function loadPtyModule(): Promise<PtyModule | null> {
  if (cachedPty !== undefined) return cachedPty;
  try {
    const mod = (await import('node-pty')) as PtyModule;
    if (typeof mod.spawn !== 'function') {
      cachedPty = null;
      return null;
    }
    cachedPty = mod;
    return mod;
  } catch {
    cachedPty = null;
    return null;
  }
}

/** Sync probe after {@link loadPtyModule} (or a prior successful import). */
export function ptyModuleCached(): PtyModule | null {
  return cachedPty ?? null;
}

/** Test hook — reset the load cache. */
export function resetPtyModuleCache(): void {
  cachedPty = undefined;
}

/** Test hook: use `mod` as the loaded node-pty (a fake), until the next reset. */
export function setPtyModuleForTest(mod: unknown): void {
  cachedPty = mod as PtyModule;
}

/** The node-pty (Windows) internals a never-ready close needs; see closePty. */
interface NeverReadyInternals {
  _isReady?: boolean;
  _close?: () => void;
  _agent?: { kill?: () => void; _innerPid?: unknown; _getConsoleProcessList?: () => Promise<number[]> };
}

/**
 * NODE-PTY'S WINDOWS KILL KILLS A PID FIVE SECONDS LATER, WHOEVER HOLDS IT THEN.
 *
 * Measured 2026-10-06. node-pty's ConPTY kill forks `conpty_console_list_agent`
 * to list the console's processes, then process.kill()s each one. Here the
 * agent always dies with "AttachConsole failed" (every kill, 40 of 40 runs), and
 * node-pty's fallback after a 5 s timeout is to kill the SHELL'S PID: logged,
 * the list [24384] arrived 5.01 s after that shell was closed and dead. By then
 * the pid can belong to anything. Under 8 parallel terminal test files on 8
 * busy cores, test runners and their children died with no output in 7 of 40
 * runs (and their open pseudoconsoles were left behind as orphans); with this
 * in place, 0 of 40, and none of the 522 kills our code issued hit a process
 * that was not a terminal's (checked against a process poller).
 * Our own tree kill has already ended the shell and everything under it, so
 * the list kill has nothing left to do but harm: it is replaced, on this one
 * terminal's agent, by an empty list.
 *
 * This reaches into a node-pty internal, so node-pty is pinned to an exact
 * version in packages/analyzer/package.json (pty-shell.test locks the pin).
 * Upgrading it is a deliberate change: re-run the control test in
 * pty-shell.test (node-pty's own kill lists the console, ours never does).
 */
function disarmConsoleListKill(t: NeverReadyInternals): void {
  if (process.platform !== 'win32' || !t._agent || typeof t._agent._getConsoleProcessList !== 'function') return;
  t._agent._getConsoleProcessList = () => Promise.resolve([]);
}

/**
 * Spawn a real PTY shell, or return null so the caller can fall back to pipes.
 */
export function trySpawnPty(
  shell: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  cols = 80,
  rows = 24,
  /** Arguments for `shell`; empty for an interactive shell. */
  args: readonly string[] = [],
  /** Windows: `args` is a command line quoted already (cmd.exe `/s /c`); passed through as one string. */
  verbatim = false,
): PtySpawnResult | null {
  const mod = ptyModuleCached();
  if (!mod) return null;
  try {
    const cleanEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
      if (typeof v === 'string') cleanEnv[k] = v;
    }
    cleanEnv.TERM = cleanEnv.TERM || 'xterm-256color';
    const pty = mod.spawn(shell, verbatim && process.platform === 'win32' ? args.join(' ') : [...args], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: cleanEnv,
    });
    /*
     * LIFECYCLE STATE, because node-pty's own calls are not safe at every point.
     * On Windows a resize after the shell exited throws "Cannot resize a pty that
     * has already exited" — and when that resize was queued inside node-pty
     * (it defers calls until ConPTY is ready) the throw happens in node-pty's
     * callback, where no caller's try/catch can reach it. So: a resize waits for
     * the first output (the pty is ready by then), only the latest size is kept,
     * and resize and kill are no-ops once the shell has exited or been killed.
     */
    let exited = false;
    let killed = false;
    let ready = false;
    let pendingSize: { cols: number; rows: number } | null = null;
    const applyResize = (c: number, r: number): void => {
      if (exited || killed) return;
      try {
        pty.resize(c, r);
      } catch {
        /* exited between the check and the call — stale columns beat a crash */
      }
    };
    pty.onData(() => {
      if (ready) return;
      ready = true;
      if (pendingSize) {
        const s = pendingSize;
        pendingSize = null;
        applyResize(s.cols, s.rows);
      }
    });
    pty.onExit(() => {
      exited = true;
      pendingSize = null;
    });
    /*
     * A PTY THAT NEVER BECAME READY MUST STILL CLOSE. node-pty on Windows defers
     * kill() until the first byte arrives. A shell that dies at start never
     * sends one (measured 2026-10-06 under heavy load: exit 0xC0000142,
     * STATUS_DLL_INIT_FAILED, ready false, the kill still queued), so its
     * pseudoconsole stayed open: headless conhosts left running and a test
     * process that could not exit for 35 minutes. For a never-ready terminal
     * this does what node-pty's deferred kill would have done (close its
     * sockets, then the agent's kill, which closes the pseudoconsole), and only
     * when the shell's pid is known: the agent forks a helper with it.
     */
    const closePty = (): void => {
      try {
        const t = pty as unknown as NeverReadyInternals;
        disarmConsoleListKill(t);
        if (
          process.platform === 'win32' &&
          t._isReady === false &&
          typeof t._close === 'function' &&
          typeof t._agent?.kill === 'function' &&
          typeof t._agent._innerPid === 'number'
        ) {
          t._close();
          t._agent.kill();
          return;
        }
        pty.kill();
      } catch {
        /* already dead */
      }
    };
    return {
      backend: 'pty',
      pid: pty.pid,
      write(data) {
        if (exited || killed) return;
        pty.write(typeof data === 'string' ? data : data.toString('utf8'));
      },
      resize(c, r) {
        if (!(c > 0 && r > 0) || exited || killed) return;
        if (!ready) {
          pendingSize = { cols: c, rows: r };
          return;
        }
        applyResize(c, r);
      },
      kill() {
        if (killed) return;
        killed = true;
        pendingSize = null;
        /* After exit there is no tree left to walk, but node-pty still holds the
           console and its socket worker until kill() — skipping it keeps the
           process alive. */
        if (exited) {
          closePty();
          return;
        }
        /* Tree first (the console must still exist for the walk to find the
           shell's children), then close the pseudoconsole. */
        killWindowsTree(pty.pid, closePty);
      },
      onData(cb) {
        pty.onData(cb);
      },
      onExit(cb) {
        pty.onExit(cb);
      },
    };
  } catch {
    return null;
  }
}
