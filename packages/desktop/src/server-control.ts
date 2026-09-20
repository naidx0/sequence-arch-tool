import net from 'node:net';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';

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
  /** Optional callback fired when the child exits UNEXPECTEDLY (not via `stop()`/`setRepo()`). */
  onUnexpectedExit?: (info: { code: number | null; signal: NodeJS.Signals | null }) => void;
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

  private port: number | null;
  private child: ChildProcess | null = null;
  private childAlive = false;
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
    this.port = opts.port ?? null;
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
    });
    this.child = child;
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
    child.on('exit', (code, signal) => {
      this.childAlive = false;
      this.onLog(`[server] exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`);
      if (!this.intentionalDown && this.onUnexpectedExit) this.onUnexpectedExit({ code, signal });
    });

    return waitForHealthy(this.url, {
      timeoutMs: this.healthTimeoutMs,
      intervalMs: this.pollIntervalMs,
      isAlive: () => this.childAlive,
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

  /** SIGTERM the child and await its exit; escalate to SIGKILL after a grace period. Idempotent. */
  private killChild(): Promise<void> {
    const child = this.child;
    if (!child || !this.childAlive || child.exitCode !== null) {
      this.child = null;
      this.childAlive = false;
      return Promise.resolve();
    }
    this.intentionalDown = true;
    return new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(escalate);
        this.child = null;
        this.childAlive = false;
        resolve();
      };
      child.once('exit', finish);
      const escalate = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }, 3000);
      if (typeof escalate.unref === 'function') escalate.unref();
      try {
        child.kill('SIGTERM');
      } catch {
        finish(); // could not even signal it — treat as down
      }
    });
  }
}
