import net from 'node:net';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { killTreeWindows, signalGroup } from './tree-kill';

/**
 * server-control — the runnable heart of the Sequence desktop app, kept
 * DELIBERATELY free of any `electron` import so it can be exercised end-to-end
 * with `node --test` in a plain Node process (no Electron binary needed).
 *
 * It owns the embedded-server lifecycle for the Electron main process:
 *   - find a free localhost port (once), reused across repo switches so the
 *     BrowserWindow URL stays stable;
 *   - spawn the ALREADY-BUILT analyzer CLI (`packages/analyzer/dist/cli.js`) as a
 *     CHILD PROCESS in `sequence` launch mode (`--no-open --port <free>` [+ `--repo`]),
 *     reusing the exact, already-verified server instead of reimplementing it;
 *   - poll `/` until it answers 2xx (with a timeout) so the window only loads a
 *     server that is actually ready;
 *   - cleanly kill / respawn the child on quit or on a repo change.
 *
 * Why a child process rather than importing the server in-process: the analyzer
 * is ESM and Electron's main process is most robust as CommonJS; a child process
 * sidesteps all ESM/CJS interop, and — crucially — runs the SAME binary the
 * standing gate already verifies, byte for byte.
 */

/** How the child Node executable is invoked. In Electron this is `process.execPath` (the Electron binary) run with `ELECTRON_RUN_AS_NODE=1`; in tests it is the test runner's own `process.execPath`. */
export interface ServerControllerOptions {
  /** Absolute path to the built analyzer CLI entry (`.../analyzer/dist/cli.js`). */
  cliPath: string;
  /** Executable that runs the CLI. Defaults to `process.execPath`. */
  nodeExecPath?: string;
  /** Extra env merged OVER `process.env` for the child (e.g. `{ ELECTRON_RUN_AS_NODE: '1' }`). */
  env?: NodeJS.ProcessEnv;
  /** Loopback host to bind + health-check. Default `127.0.0.1`. */
  host?: string;
  /** Explicit port. When omitted a free port is chosen at `start()` and reused for every respawn. */
  port?: number;
  /** Explicit web-viewer dist passed to the CLI as `--web`. When omitted the CLI auto-discovers it. */
  webDist?: string;
  /** Overall health-poll timeout per (re)spawn, ms. Default 30000. */
  healthTimeoutMs?: number;
  /** Health-poll interval, ms. Default 150. */
  pollIntervalMs?: number;
  /** Optional sink for child stdout/stderr + lifecycle lines. */
  onLog?: (line: string) => void;
  /**
   * Optional callback fired when the child exits UNEXPECTEDLY (not via
   * `stop()`/`setRepo()`) and the controller is not bringing it back: a crash
   * before the server was ever ready, a second crash soon after the automatic
   * respawn, or a respawn that failed.
   */
  onUnexpectedExit?: (info: { code: number | null; signal: NodeJS.Signals | null }) => void;
  /**
   * Fired after a server that crashed was respawned on the same port and
   * repo (once; see `respawnWindowMs`). The window should reload.
   */
  onRespawned?: (status: ServerStatus) => void;
  /**
   * A crashed server is respawned ONCE; a second crash within this window
   * goes to `onUnexpectedExit` (the restart dialog). Default 5 minutes.
   */
  respawnWindowMs?: number;
}

export interface ServerStatus {
  /** Base URL the BrowserWindow should load, e.g. `http://127.0.0.1:52713`. */
  url: string;
  port: number;
  /** The repo currently attached at startup, or null for a no-repo (home screen) start. */
  repoDir: string | null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ask the OS for a free TCP port on `host` by binding to `:0`, reading the
 * assigned port, then releasing it. There is an inherent (tiny, standard) TOCTOU
 * window between release and the child re-binding it; reusing the SAME port for
 * every respawn keeps that window to app startup only.
 */
export function findFreePort(host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, host, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close((err) => {
        if (err) reject(err);
        else if (port) resolve(port);
        else reject(new Error('could not determine a free port'));
      });
    });
  });
}

/** Single GET; resolves with the HTTP status code, rejects on connection/timeout error. */
export function probe(url: string, timeoutMs = 2000): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const status = res.statusCode ?? 0;
      res.resume(); // drain so the socket is freed
      resolve(status);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('probe timeout')));
    req.on('error', reject);
  });
}

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  /** Returns false once the child has died, so the wait aborts instead of polling a dead port until timeout. */
  isAlive?: () => boolean;
  /** Returns true once readiness was learned another way; the poll then stops quietly. */
  isSettled?: () => boolean;
}

/**
 * The analyzer CLI prints `SEQUENCE_LISTENING <url>` once its server is
 * listening (packages/analyzer/src/cli.ts `LISTENING_PREFIX`). Since 0.1.8.1
 * (B1) that is BEFORE the repo scan: `/` answers from then on, and the scan's
 * progress is on `/api/status` (`scanning`), never part of health.
 */
export const LISTENING_PREFIX = 'SEQUENCE_LISTENING';

/** The longest stopping the server may take (app quit waits on it). */
export const KILL_BUDGET_MS = 3000;

/**
 * Watch a child's stdout for the listening line. Chunks can split a line, so
 * text is buffered until a newline. Resolves with the URL the line names.
 */
export function onListeningLine(feed: (onChunk: (chunk: string) => void) => void): Promise<string> {
  return new Promise((resolve) => {
    let buffer = '';
    let done = false;
    feed((chunk) => {
      if (done) return;
      buffer += chunk;
      let cut: number;
      while ((cut = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, cut).replace(/\r$/, '');
        buffer = buffer.slice(cut + 1);
        if (line.startsWith(`${LISTENING_PREFIX} `)) {
          done = true;
          resolve(line.slice(LISTENING_PREFIX.length + 1).trim());
          return;
        }
      }
      /* A line is never this long; keep the buffer bounded on a chatty child. */
      if (buffer.length > 4096) buffer = buffer.slice(-256);
    });
  });
}

/**
 * Poll `url` until it answers with a 2xx status (the analyzer serves the web app
 * on `/` with 200 in both the no-repo and attached states), or reject on timeout
 * / early child exit. Connection-refused during startup is expected and retried.
 */
export async function waitForHealthy(url: string, opts: WaitOptions = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const intervalMs = opts.intervalMs ?? 150;
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    if (opts.isSettled?.()) return;
    if (opts.isAlive && !opts.isAlive()) {
      const detail = lastErr ? ` (last probe: ${(lastErr as Error).message})` : '';
      throw new Error(`server process exited before it became healthy${detail}`);
    }
    try {
      const status = await probe(url, Math.min(2000, timeoutMs));
      if (status >= 200 && status < 300) return;
      lastErr = new Error(`unexpected status ${status}`);
    } catch (e) {
      lastErr = e; // ECONNREFUSED while it is still binding — keep polling
    }
    await delay(intervalMs);
  }
  const detail = lastErr ? `: ${(lastErr as Error).message}` : '';
  throw new Error(`server did not become healthy at ${url} within ${timeoutMs}ms${detail}`);
}

/** What `/api/status` says while the startup `--repo` is still being read (0.1.8.1 B1). */
export interface ScanProgress {
  done: number;
  total: number;
  path?: string;
}

/** Single GET of `/api/status` as JSON; rejects on connection/timeout/parse error. */
export function getStatusJson(baseUrl: string, timeoutMs = 2000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = http.get(`${baseUrl}/api/status`, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (body += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body) as Record<string, unknown>);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('status timeout')));
    req.on('error', reject);
  });
}

export interface AttachWaitOptions {
  intervalMs?: number;
  /** False once the child died: the wait rejects instead of polling a dead port. */
  isAlive?: () => boolean;
  /** Each `scanning` report, for the boot screen. */
  onProgress?: (p: ScanProgress) => void;
  /** Review B: give up when no probe has been answered for this long (default 60 s). */
  noAnswerMs?: number;
  /** Review B: give up when `done` has not moved for this long while `total` > 0 (default 120 s). */
  stalledMs?: number;
  /** Tests: the clock. */
  now?: () => number;
}

/** The startup attach stopped making progress: the shell shows an error instead of spinning. */
export class AttachStalledError extends Error {}

/**
 * 0.1.8.1 B1: wait until the server has FINISHED its startup attach — attached,
 * refused (`attachFailure`), or never asked for a repo — by polling
 * `/api/status` until it no longer carries `scanning`.
 *
 * NO TIMEOUT, ON PURPOSE. Health is "the socket answers" (spawnAndWait); the
 * scan is not part of it. A big repo on a slow laptop may take minutes, and
 * that is progress to show, never a reason to quit. The wait ends early only
 * when the child dies.
 */
export async function waitForAttach(baseUrl: string, opts: AttachWaitOptions = {}): Promise<Record<string, unknown>> {
  const intervalMs = opts.intervalMs ?? 200;
  const now = opts.now ?? Date.now;
  const noAnswerMs = opts.noAnswerMs ?? 60_000;
  const stalledMs = opts.stalledMs ?? 120_000;
  /* REVIEW B: NO DEADLINE, BUT NOT FOREVER EITHER. A slow scan that keeps
     counting files is waited out however long it takes; a server that stops
     answering, or a count that stops moving, is reported instead of spinning. */
  let lastAnswer = now();
  let lastDone = -1;
  let doneMovedAt = now();
  for (;;) {
    if (opts.isAlive && !opts.isAlive()) throw new Error('server process exited during the startup scan');
    try {
      const body = await getStatusJson(baseUrl);
      lastAnswer = now();
      const scanning = body.scanning as ScanProgress | undefined;
      if (!scanning) return body;
      if (scanning.done !== lastDone) {
        lastDone = scanning.done;
        doneMovedAt = now();
      } else if (scanning.total > 0 && now() - doneMovedAt >= stalledMs) {
        throw new AttachStalledError(
          `Reading the project stopped at ${scanning.done} of ${scanning.total} files and has not moved for ${Math.round(stalledMs / 1000)} s.`,
        );
      }
      opts.onProgress?.(scanning);
    } catch (e) {
      if (e instanceof AttachStalledError) throw e;
      /* A busy event loop can miss one probe; the next one decides. */
      if (now() - lastAnswer >= noAnswerMs) {
        throw new AttachStalledError(`The Sequence engine has not answered for ${Math.round(noAnswerMs / 1000)} s while reading the project.`);
      }
    }
    await delay(intervalMs);
  }
}

/**
 * Owns one embedded analyzer server child for the desktop app. The port is
 * chosen once and reused, so `setRepo()` is a kill+respawn on the SAME port and
 * the window can simply reload the same URL.
 */
export class ServerController {
  private readonly cliPath: string;
  private readonly nodeExecPath: string;
  private readonly host: string;
  private readonly env?: NodeJS.ProcessEnv;
  private readonly webDist?: string;
  private readonly healthTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly onLog: (line: string) => void;
  private readonly onUnexpectedExit?: (info: { code: number | null; signal: NodeJS.Signals | null }) => void;
  private readonly onRespawned?: (status: ServerStatus) => void;
  private readonly respawnWindowMs: number;
  /** When the last automatic respawn happened (S1: once before the restart dialog). */
  private respawnedAt: number | null = null;

  private port: number | null;
  private child: ChildProcess | null = null;
  private childAlive = false;
  /** Whether the child was spawned `detached` (POSIX: it then leads its own process group). */
  private childDetached = false;
  private repoDir: string | null = null;
  /** True while WE are intentionally tearing the child down (stop/setRepo) — suppresses onUnexpectedExit. */
  private intentionalDown = false;

  constructor(opts: ServerControllerOptions) {
    this.cliPath = opts.cliPath;
    this.nodeExecPath = opts.nodeExecPath ?? process.execPath;
    this.host = opts.host ?? '127.0.0.1';
    this.env = opts.env;
    this.webDist = opts.webDist;
    this.healthTimeoutMs = opts.healthTimeoutMs ?? 30000;
    this.pollIntervalMs = opts.pollIntervalMs ?? 150;
    this.onLog = opts.onLog ?? (() => {});
    this.onUnexpectedExit = opts.onUnexpectedExit;
    this.onRespawned = opts.onRespawned;
    this.respawnWindowMs = opts.respawnWindowMs ?? 5 * 60_000;
    this.port = opts.port ?? null;
  }

  /** The running child's pid, or null. */
  get childPid(): number | null {
    return this.childAlive ? (this.child?.pid ?? null) : null;
  }

  /**
   * A server that was up died on its own: bring it back ONCE, on the same
   * port and repo, so the window can simply reload (an agent's chat resumes
   * its thread from the session store, S1). A second crash inside
   * `respawnWindowMs`, or a respawn that fails, goes to the restart dialog.
   */
  private async recover(info: { code: number | null; signal: NodeJS.Signals | null }): Promise<void> {
    const now = Date.now();
    if (this.respawnedAt !== null && now - this.respawnedAt < this.respawnWindowMs) {
      this.onUnexpectedExit?.(info);
      return;
    }
    this.respawnedAt = now;
    this.onLog(`[server] exited on its own (code=${info.code ?? 'null'} signal=${info.signal ?? 'null'}); starting it again once`);
    this.child = null;
    try {
      await this.spawnAndWait(this.repoDir);
    } catch (e) {
      this.onLog(`[server] the respawn failed: ${(e as Error).message}`);
      this.onUnexpectedExit?.(info);
      return;
    }
    this.onRespawned?.(this.status);
  }

  get url(): string {
    if (this.port == null) throw new Error('server not started');
    return `http://${this.host}:${this.port}`;
  }

  get currentRepo(): string | null {
    return this.repoDir;
  }

  get status(): ServerStatus {
    if (this.port == null) throw new Error('server not started');
    return { url: this.url, port: this.port, repoDir: this.repoDir };
  }

  /** Start the embedded server. Picks a free port if none was supplied. Optionally attach a repo up front. */
  /**
   * Ask for a specific port before `start()`.
   *
   * The port is decided by the CALLER here rather than in the constructor
   * because the shell has to check the remembered one is still free first, and
   * that is async — see `rememberedPort` in `main.ts` for why the origin has
   * to be stable at all. Ignored once a server is running: the port is the
   * origin, and moving it under a live window would empty the very storage
   * this exists to keep.
   */
  usePort(port: number): void {
    if (this.child) return;
    this.port = port;
  }

  async start(repoDir?: string): Promise<ServerStatus> {
    if (this.child) throw new Error('server already started');
    if (this.port == null) this.port = await findFreePort(this.host);
    await this.spawnAndWait(repoDir ?? null);
    return this.status;
  }

  /**
   * Switch the served repo: kill the current child and respawn it on the SAME
   * port with `--repo <dir>`. This reuses the analyzer's TRUSTED startup `--repo`
   * path (no server security code is touched) and keeps the window URL stable.
   */
  async setRepo(repoDir: string): Promise<ServerStatus> {
    if (this.port == null) throw new Error('server not started');
    /*
     * ── THE APP SURVIVES A FOLDER IT CANNOT OPEN ──────────────────────────
     *
     * Owner, 2026-09-20: "open project also doesn't work". A switch is a kill
     * and a respawn, and when the respawn failed `spawnAndWait` killed the
     * half-started child and threw — leaving NO server on the port the window
     * is pointed at. One unscannable folder did not fail an attach; it killed
     * the app, and everything the reader tried afterwards failed too, which is
     * why the report was about "open project" rather than about that folder.
     *
     * The engine no longer exits on an unscannable `--repo` (it serves
     * unattached and says why), so this path should not fire any more. It is
     * kept because a respawn has other ways to fail — a port stolen in the
     * window between kill and bind, a disk that went away — and the rule is
     * the same for all of them: report what happened, and put the server back
     * the way it was.
     *
     * THE RECOVERY IS ALLOWED TO FAIL SILENTLY, and that is deliberate: the
     * error the caller sees must be the one that describes what they asked
     * for, not a second one about the attempt to undo it.
     */
    const previous = this.repoDir;
    await this.killChild();
    try {
      await this.spawnAndWait(repoDir);
    } catch (e) {
      try {
        await this.spawnAndWait(previous);
        this.onLog(`[server] restored the previous repo after a failed switch`);
      } catch {
        /* Nothing more to try. The original error is the one worth raising. */
      }
      throw e;
    }
    return this.status;
  }

  /**
   * B1: resolve once the started server's startup attach has settled (see
   * {@link waitForAttach}). Never times out while the child is alive.
   */
  waitUntilAttached(
    onProgress?: (p: ScanProgress) => void,
    limits: Pick<AttachWaitOptions, 'noAnswerMs' | 'stalledMs'> = {},
  ): Promise<Record<string, unknown>> {
    return waitForAttach(this.url, {
      intervalMs: this.pollIntervalMs,
      isAlive: () => this.childAlive,
      onProgress,
      ...limits,
    });
  }

  /** Stop the embedded server for good (called on app quit). Idempotent. */
  async stop(): Promise<void> {
    await this.killChild();
  }

  /** The child's last few lines, so a failure can say what IT said. */
  private lastOutput: string[] = [];

  private spawnAndWait(repoDir: string | null): Promise<void> {
    const port = this.port;
    if (port == null) throw new Error('server not started');
    const args = [this.cliPath, '--no-open', '--port', String(port)];
    if (this.webDist) args.push('--web', this.webDist);
    if (repoDir) args.push('--repo', repoDir);

    /* Each start gets its own account; a previous child's complaint must not
       be reported as this one's. */
    this.lastOutput = [];

    const child = spawn(this.nodeExecPath, args, {
      env: { ...process.env, ...this.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      /* The server is the parent of every agent, git and probe process; a hidden
         console here is inherited by all of them. */
      windowsHide: true,
    });
    this.child = child;
    this.childDetached = false;
    this.childAlive = true;
    this.repoDir = repoDir;
    this.intentionalDown = false;

    /*
     * THE CHILD'S LAST WORDS ARE KEPT, because they are the only place the
     * real reason is written.
     *
     * Measured 2026-09-20: a folder with no manifests made the server print
     * "Neither a service manifest nor any recognizable package manifest or
     * source was found in ML - Max, so there's nothing to scan yet" and exit.
     * The shell reported "connect ECONNREFUSED 127.0.0.1:60416" — true, and
     * about a socket, while the sentence the reader needed had already been
     * printed and thrown away.
     *
     * Bounded to the last few lines: a server that logs for a minute before
     * dying must not hand a dialog box a minute of log.
     */
    const remember = (line: string): void => {
      this.lastOutput.push(line);
      if (this.lastOutput.length > 8) this.lastOutput.shift();
    };
    /* READY WHEN THE CHILD SAYS SO. The analyzer prints its listening line the
       moment `/` can answer; waiting for it saves up to one poll interval
       (150 ms) on every launch. The poll stays as the fallback for a CLI that
       does not print the line (an older bundle), and it is what notices a
       server that never comes up. */
    let listened = false;
    const listening = onListeningLine((push) => child.stdout?.on('data', (b: Buffer) => push(String(b)))).then(() => {
      listened = true;
    });
    child.stdout?.on('data', (b: Buffer) => {
      const line = String(b).trimEnd();
      remember(line);
      this.onLog(`[server] ${line}`);
    });
    child.stderr?.on('data', (b: Buffer) => {
      const line = String(b).trimEnd();
      remember(line);
      this.onLog(`[server:err] ${line}`);
    });
    child.on('error', (e) => {
      this.childAlive = false;
      this.onLog(`[server] spawn error: ${e.message}`);
    });
    let ready = false;
    child.on('exit', (code, signal) => {
      if (this.child === child) this.childAlive = false;
      this.onLog(`[server] exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`);
      if (this.intentionalDown || this.child !== child) return;
      /* Up and serving, then gone: respawn once. Never ready: the start failed, say so. */
      if (ready) void this.recover({ code, signal });
      else this.onUnexpectedExit?.({ code, signal });
    });

    const polled = waitForHealthy(this.url, {
      timeoutMs: this.healthTimeoutMs,
      intervalMs: this.pollIntervalMs,
      isAlive: () => this.childAlive,
      isSettled: () => listened,
    });
    return Promise.race([listening, polled]).then(() => {
      ready = true;
      this.onLog(listened ? '[server] ready (listening line)' : '[server] ready (health poll)');
    }).catch(async (e) => {
      // A child that never became healthy must not be left running.
      await this.killChild();
      const said = this.lastOutput.join('\n').trim();
      if (said === '') throw e;
      /* The socket error stays — it is how we know the child never bound —
         but the child's own account comes first, because that is the half a
         reader can act on. */
      throw new Error(`${said}\n\n(${(e as Error).message})`);
    });
  }

  /**
   * End the child AND its whole process tree, and await it; never longer than
   * KILL_BUDGET_MS. Idempotent. See tree-kill.ts for why.
   *
   * Windows: `taskkill /PID <pid> /T /F` at once, while the root is alive.
   * There is no graceful step: SIGTERM there is TerminateProcess on the root
   * alone (the analyzer has no handler either way), and a dead root takes the
   * walk with it, leaving a detached descendant unreachable. libuv's job
   * object ends the root's NON-detached children with it, which is why the
   * codex tree died in the live gate; a detached one breaks away from the job.
   *
   * Elsewhere: SIGTERM, then SIGKILL at the budget, to the process group when
   * the child was spawned detached (it leads its own group), else to the pid.
   */
  private killChild(): Promise<void> {
    const child = this.child;
    if (!child || !this.childAlive || child.exitCode !== null) {
      this.child = null;
      this.childAlive = false;
      return Promise.resolve();
    }
    this.intentionalDown = true;
    const pid = child.pid;
    const detached = this.childDetached;
    return new Promise<void>((resolve) => {
      let exited = false;
      let treeDone = process.platform !== 'win32';
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(escalate);
        this.child = null;
        this.childAlive = false;
        resolve();
      };
      const maybeFinish = (): void => {
        if (exited && treeDone) finish();
      };
      child.once('exit', () => {
        exited = true;
        maybeFinish();
      });
      const hardKill = (): void => {
        if (pid !== undefined && detached && process.platform !== 'win32' && signalGroup(pid, 'SIGKILL')) return;
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      };
      /* The budget: whatever is still pending is forced, and quit is not held. */
      const escalate = setTimeout(() => {
        hardKill();
        finish();
      }, KILL_BUDGET_MS);
      if (typeof escalate.unref === 'function') escalate.unref();

      if (process.platform === 'win32' && pid !== undefined) {
        void killTreeWindows(pid, KILL_BUDGET_MS).then(() => {
          treeDone = true;
          /* taskkill could not reach the root (it raced its own exit): signal it directly. */
          if (!exited) hardKill();
          maybeFinish();
        });
        return;
      }
      try {
        if (!(pid !== undefined && detached && signalGroup(pid, 'SIGTERM'))) child.kill('SIGTERM');
      } catch {
        finish(); // could not even signal it — treat as down
      }
    });
  }
}
