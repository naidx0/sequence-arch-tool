import http from 'node:http';
import type stream from 'node:stream';
import childProcess from 'node:child_process';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  loadPtyModule,
  trySpawnPty,
  type PtySpawnResult,
  type ShellBackend,
} from './ptyShell.js';

/**
 * ============================ TRUST MODEL (read me) ============================
 * This is the ONE genuine command-execution surface in Sequence. A WebSocket at
 * `/api/terminal` pipes a real login shell whose cwd is the attached repo root.
 * That shell runs as the SERVER'S user and BYPASSES every file jail / reserved-dir
 * guard / byte-cap the rest of the HTTP server enforces — because a terminal, by
 * definition, is your shell (exactly like VS Code's integrated terminal). For a
 * LOCAL, single-user IDE bound to 127.0.0.1 (you, on your machine) this is
 * expected and correct.
 *
 * C1.1: prefer a real PTY (`node-pty`) when the native binding loads; otherwise
 * fall back to plain stdio pipes. Resize is real on PTY and still a no-op on
 * pipe. web2 Terminal pane + composer ship after C1.3–C1.7 (pane + locking e2e).
 *
 * It is safe ONLY because of the layered guards below, which every upgrade passes
 * in this fixed order — path → origin → enabled → requireRepo → cap:
 *   1. PATH-SCOPED     — only `/api/terminal` upgrades; any other path is dropped.
 *   2. ORIGIN-CHECKED  — a localhost WebSocket is reachable by ANY web page the
 *                        user visits, so a cross-origin `Origin` header (a page on
 *                        http://evil.example opening ws://127.0.0.1:<port>/…) is
 *                        REJECTED. Only same-origin (Origin host === Host header)
 *                        or Origin-absent (native clients: the tests, curl) pass.
 *                        Without this, any website could run commands on your box.
 *   3. DISABLE SWITCH  — `enabled` folds the `terminalEnabled` server option and
 *                        the `SEQUENCE_DISABLE_TERMINAL` env override; when off,
 *                        every upgrade is refused.
 *   4. REQUIRE-REPO    — no shell without an attached repo; cwd is `getRoot()`.
 *   5. CONCURRENCY CAP — at most {@link MAX_TERMINALS} live shells at once.
 *
 * The transport itself is 127.0.0.1-only (the server's sole bind), and the shell's
 * stdin/stdout are NEVER written to any log.
 *
 * !!! DEPLOY GATE !!!  A MULTI-USER or NON-LOCALHOST deployment MUST disable this
 * (set `terminalEnabled: false` or `SEQUENCE_DISABLE_TERMINAL=1`) or sandbox it
 * per user (one container per session). Exposing a shell on a shared / public
 * bind hands every visitor a shell as the server user. See docs/DEPLOY_BLUEPRINT.md.
 * =============================================================================
 */

/** The single path that upgrades to a terminal shell. */
export const TERMINAL_PATH = '/api/terminal';

/** Hard ceiling on concurrent live shells (a crude but real anti-DoS guard). */
export const MAX_TERMINALS = 8;

export interface TerminalOptions {
  /** The active repo root, or null when no repo is attached. Read per-upgrade so a
   *  runtime attach/detach is reflected immediately (it closes over mutable state). */
  getRoot: () => string | null;
  /** Master switch. When false EVERY upgrade is refused (the disable switch). */
  enabled: boolean;
  /**
   * Optional extra allowed browser origin (e.g. a fixed app origin). The primary
   * check is always same-origin (Origin host === the request's Host header); this
   * only widens it. Native clients may omit Origin, but still need an allowed Host.
   */
  appOrigin?: string;
}

/** Observability handle returned by {@link attachTerminal} (used by tests/caps). */
export interface TerminalHandle {
  /** Number of live shells right now. */
  activeCount(): number;
}

interface LiveSlot {
  backend: ShellBackend;
  kill(): void;
}

/**
 * Resolve the shell binary to spawn. Honours `$SHELL`, else a per-platform default.
 */
export function resolveShell(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (env.SHELL) return env.SHELL;
  if (platform === 'win32') return env.COMSPEC ?? 'powershell.exe';
  return 'bash';
}

/** The hostname (no port) of a Host/Origin `host:port` value, lower-cased. */
function hostnameOf(hostHeader: string): string {
  const m = /^(\[[^\]]+\]|[^:]+)(?::\d+)?$/.exec(hostHeader.trim());
  return (m ? m[1] : hostHeader).toLowerCase();
}

/** Is a Host/Origin hostname a loopback name? (DNS-rebinding defense.) */
function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === '127.0.0.1' ||
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

/**
 * Is this upgrade's Origin acceptable? A cross-origin browser request is the core
 * threat (any site can point a WebSocket at localhost), so:
 *   - The request's Host header must be a LOOPBACK name (127.0.0.1/localhost/::1).
 *   - No Origin header (native ws client, curl, the tests) → ALLOWED.
 *   - Origin whose host:port equals the request's Host header → ALLOWED.
 *   - An explicitly configured `appOrigin` match → ALLOWED.
 *   - Anything else → REJECTED.
 */
export function isOriginAllowed(req: http.IncomingMessage, appOrigin?: string): boolean {
  const host = req.headers.host;
  if (!host) return false;

  let appHost: string | undefined;
  if (appOrigin) {
    try {
      appHost = new URL(appOrigin).host.toLowerCase();
    } catch {
      /* bad appOrigin config — it widens nothing */
    }
  }

  const requestHost = host.trim().toLowerCase();
  // DNS-rebinding guard: refuse any Host that is neither loopback nor the ONE
  // explicitly configured hosted-app Host. Merely having an appOrigin configured
  // must not make every attacker-controlled Host acceptable.
  if (!isLoopbackHostname(hostnameOf(requestHost)) && requestHost !== appHost) return false;

  const origin = req.headers.origin;
  // Native (non-browser) clients omit Origin entirely — allowed. Browsers ALWAYS
  // send it on a cross-origin WebSocket handshake, so its absence cannot be forged
  // by a malicious page.
  if (!origin) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase(); // host + (optional) :port
  } catch {
    return false; // malformed Origin — refuse
  }
  if (originHost === requestHost) return true;
  if (appHost === originHost) return true;
  return false;
}

/** Write a minimal HTTP error onto a raw upgrade socket and close it (no 101). */
function rejectUpgrade(socket: stream.Duplex, status: number, reason: string): void {
  // `reason` doubles as the HTTP reason-phrase AND a dedicated header so both the
  // browser (onerror/onclose) and the native test client can surface it.
  const line = `HTTP/1.1 ${status} ${reason}`;
  socket.end(
    `${line}\r\n` +
      'Connection: close\r\n' +
      `Sequence-Terminal-Error: ${reason}\r\n` +
      'Content-Length: 0\r\n' +
      '\r\n'
  );
}

/**
 * Attach the terminal WebSocket to an existing HTTP server. This installs a single
 * `'upgrade'` listener that runs the five ordered guards, then hands accepted
 * sockets a PTY (or pipe fallback) via {@link startShell}.
 */
export function attachTerminal(server: http.Server, opts: TerminalOptions): TerminalHandle {
  const wss = new WebSocketServer({ noServer: true });
  const live = new Set<LiveSlot>();
  let pending = 0;

  /* Warm the optional PTY binding once — never blocks upgrades if it fails. */
  void loadPtyModule();

  server.on('upgrade', (req, socket, head) => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }

    if (pathname !== TERMINAL_PATH) {
      socket.destroy();
      return;
    }

    if (!isOriginAllowed(req, opts.appOrigin)) {
      rejectUpgrade(socket, 403, 'forbidden origin');
      return;
    }

    if (!opts.enabled) {
      rejectUpgrade(socket, 403, 'terminal disabled');
      return;
    }

    const root = opts.getRoot();
    if (root === null) {
      rejectUpgrade(socket, 409, 'no repo attached — open a repository first');
      return;
    }

    if (live.size + pending >= MAX_TERMINALS) {
      rejectUpgrade(socket, 429, 'too many terminals');
      return;
    }
    pending++;
    let releasedPending = false;
    const releasePending = (): void => {
      if (releasedPending) return;
      releasedPending = true;
      pending--;
    };
    socket.once('close', releasePending);
    socket.once('error', releasePending);

    wss.handleUpgrade(req, socket, head, (ws) => {
      releasePending();
      void startShell(ws, root, live);
    });
  });

  return { activeCount: () => live.size };
}

/**
 * Kill the shell AND everything it spawned. The pipe path starts detached (its own
 * process group), so on POSIX we signal the whole GROUP with `process.kill(-pid)`.
 * PTY sessions use `pty.kill()` instead.
 */
export function killProcessTree(child: childProcess.ChildProcess): void {
  const pid = child.pid;
  if (pid !== undefined && process.platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGKILL');
      return;
    } catch {
      /* group already gone / not permitted — fall through to a direct child kill */
    }
  }
  try {
    child.kill();
  } catch {
    /* already exited */
  }
}

/**
 * Prefer a real PTY; fall back to pipe. Announces the backend once as a TEXT
 * control frame so the pane can tell which path is live — never claim PTY when
 * the binding is missing. web2 Terminal is shipped (C1.7); Browser stays unshipped.
 */
async function startShell(ws: WebSocket, cwd: string, live: Set<LiveSlot>): Promise<void> {
  await loadPtyModule();
  const shell = resolveShell();
  const pty = trySpawnPty(shell, cwd, process.env);
  if (pty) {
    startPtyShell(ws, pty, live);
    return;
  }
  startPipeShell(ws, shell, cwd, live);
}

function announceBackend(ws: WebSocket, backend: ShellBackend): void {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify({ type: 'backend', backend }));
  } catch {
    /* ignore */
  }
}

function startPtyShell(ws: WebSocket, pty: PtySpawnResult, live: Set<LiveSlot>): void {
  const slot: LiveSlot = { backend: 'pty', kill: () => pty.kill() };
  live.add(slot);
  let closed = false;
  const teardown = (): void => {
    if (closed) return;
    closed = true;
    live.delete(slot);
    pty.kill();
  };

  announceBackend(ws, 'pty');

  pty.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(Buffer.from(data, 'utf8'));
      } catch {
        /* ignore */
      }
    }
  });

  pty.onExit(({ exitCode, signal }) => {
    const why =
      signal != null && signal !== 0
        ? `shell exited (signal ${signal})`
        : `shell exited (code ${exitCode ?? 0})`;
    if (ws.readyState === ws.OPEN) {
      try {
        ws.close(1000, why);
      } catch {
        /* ignore */
      }
    }
    teardown();
  });

  ws.on('message', (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      pty.write(data);
      return;
    }
    let msg: unknown;
    try {
      msg = JSON.parse(data.toString('utf8'));
    } catch {
      return;
    }
    if (msg && typeof msg === 'object' && (msg as { type?: unknown }).type === 'resize') {
      const cols = Number((msg as { cols?: unknown }).cols);
      const rows = Number((msg as { rows?: unknown }).rows);
      /*
       * A FAILING RESIZE MUST NOT TAKE THE SESSION WITH IT.
       *
       * On Windows, node-pty drives ConPTY and a resize makes it enumerate
       * console processes through a helper it spawns, `conpty_console_list_agent`
       * — which dies with "AttachConsole failed" on this machine, reproducibly.
       * A resize is a COSMETIC operation: the shell is fine, the socket is fine,
       * and losing the session because the terminal got wider is a much worse
       * outcome than a pane whose columns are briefly stale.
       *
       * THIS GUARD IS HYGIENE, NOT THE FIX, and that was established rather than
       * assumed: the e2e check failed twice, then passed twice — including once
       * with this guard removed. The agent crashes in its own process, so a
       * try/catch here could never have caught it. The failure is INTERMITTENT,
       * the same ConPTY fragility `pty-shell.test.ts` already records ("fail
       * about three runs in four inside the full suite"), and the e2e check that
       * covers it retries rather than asserting once and hoping.
       */
      if (Number.isFinite(cols) && Number.isFinite(rows)) {
        try {
          pty.resize(cols, rows);
        } catch {
          /* Stale columns beat a dropped shell. */
        }
      }
    }
  });

  ws.on('close', teardown);
  ws.on('error', teardown);
}

function startPipeShell(
  ws: WebSocket,
  shell: string,
  cwd: string,
  live: Set<LiveSlot>,
): void {
  let child: childProcess.ChildProcess;
  try {
    child = childProcess.spawn(shell, [], {
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLUMNS: '80',
        LINES: '24',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
  } catch (e) {
    try {
      ws.close(1011, `shell failed to start: ${(e as Error).message}`);
    } catch {
      /* socket already gone */
    }
    return;
  }

  const slot: LiveSlot = {
    backend: 'pipe',
    kill: () => killProcessTree(child),
  };
  live.add(slot);
  let closed = false;

  const teardown = (): void => {
    if (closed) return;
    closed = true;
    live.delete(slot);
    killProcessTree(child);
  };

  announceBackend(ws, 'pipe');

  const forward = (chunk: Buffer): void => {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(chunk);
      } catch {
        /* ignore */
      }
    }
  };
  child.stdout?.on('data', forward);
  child.stderr?.on('data', forward);

  child.on('error', (e) => {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.close(1011, `shell error: ${e.message}`);
      } catch {
        /* ignore */
      }
    }
    teardown();
  });

  child.on('exit', (code, signal) => {
    const why = signal ? `shell exited (${signal})` : `shell exited (code ${code ?? 0})`;
    if (ws.readyState === ws.OPEN) {
      try {
        ws.close(1000, why);
      } catch {
        /* ignore */
      }
    }
    teardown();
  });

  ws.on('message', (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      if (child.stdin && !child.stdin.destroyed) child.stdin.write(data);
      return;
    }
    let msg: unknown;
    try {
      msg = JSON.parse(data.toString('utf8'));
    } catch {
      return;
    }
    if (msg && typeof msg === 'object' && (msg as { type?: unknown }).type === 'resize') {
      /* Pipe: no winsize — accepted as a no-op (documented). */
      return;
    }
  });

  ws.on('close', teardown);
  ws.on('error', teardown);
}

export type { ShellBackend };
