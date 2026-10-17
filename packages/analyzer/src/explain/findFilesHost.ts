/**
 * find_files: ONE index per repository, shared by every agent session.
 *
 * WHY. Every Claude/Codex session Sequence starts runs its own MCP server
 * process. When each held its own find_files index, three chats on a
 * 20,000-file repo were three ~665 MB copies of the same index. Now the index
 * lives in one small host process per repository root; each session's MCP
 * server is a client of it over a local socket (a Unix socket in a private
 * per-user directory, a named pipe on Windows), so the index is built once and
 * held once however many chats are open.
 *
 * LIFECYCLE. The first client that finds no host spawns one (this process's
 * own node binary, by absolute path, detached, no window) and keeps a
 * connection open for as long as its session lives. The host starts building
 * the moment it starts, serves every client, and exits once no client has been
 * connected for {@link FIND_FILES_HOST_IDLE_MS}. Two hosts racing for one
 * address: the loser sees the live one and exits. A host that died (crash, out
 * of memory) is respawned by the next call, at most once per 30 s per client.
 *
 * BOUNDED. The host runs with a capped V8 heap (`--max-old-space-size`, see
 * {@link FIND_FILES_HOST_NODE_FLAGS}); the index itself is compact
 * (askTermCounts.ts). find-files-shared.test.ts holds the bound on a
 * 20,000-file repo.
 *
 * NEVER STALLS. A client that cannot reach a host within its wait answers from
 * path words (findFiles `indexless`) and says the index is warming.
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { findFiles, peekFindFilesIndex, warmFindFiles, FIND_FILES_COLD_WAIT_MS, FIND_FILES_LTR_WAIT_MS, type FindFilesOptions, type FindFilesResult } from './findFiles.js';

/** Bump when the wire protocol changes, so an old host is never asked a new question. */
const PROTOCOL = 'ff1';
export const FIND_FILES_HOST_FLAG = '--find-files-host';
export const FIND_FILES_HOST_IDLE_MS = 15 * 60_000;
/** V8 flags the host runs with: a capped old space (the index is ~130 MB live at 20,000 files) and a small young space, so garbage from the build is collected instead of growing the heap. */
export const FIND_FILES_HOST_NODE_FLAGS = ['--max-old-space-size=224', '--max-semi-space-size=2', '--expose-gc'];
const RESPAWN_MS = 30_000;
/** On top of the call's own wait: how long a client waits for the host's answer before answering by path words. */
const ANSWER_GRACE_MS = 1_500;
/** How long a client waits for a host it just spawned to start listening. */
const CONNECT_MS = 1_500;

const canonical = (root: string): string => {
  let r: string;
  try {
    r = fs.realpathSync(root);
  } catch {
    r = path.resolve(root);
  }
  return process.platform === 'win32' ? r.toLowerCase() : r;
};

/** The host's address for a repository root: a named pipe on Windows, else a socket in a private per-user directory. */
export function findFilesHostAddress(root: string): string {
  const h = crypto.createHash('sha256').update(`${PROTOCOL}\0${canonical(root)}`).digest('hex').slice(0, 16);
  if (process.platform === 'win32') return `\\\\.\\pipe\\sequence-findfiles-${h}`;
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
  /* Every session must compute the same address: an explicit dir, else the per-user runtime dir, else the temp dir; /tmp when that path is too long for a socket (~104 bytes). */
  const base = process.env.SEQUENCE_FIND_FILES_HOST_DIR || process.env.XDG_RUNTIME_DIR || os.tmpdir();
  let dir = path.join(base, `sequence-ff-${uid}`);
  if (dir.length + 22 > 100) dir = path.join('/tmp', `sequence-ff-${uid}`);
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
  } catch {
    /* listen or connect reports it */
  }
  return path.join(dir, `${h}.sock`);
}

interface Req {
  id: number;
  op: 'find' | 'stats' | 'ping';
  q?: string;
  opts?: FindFilesOptions;
}

export interface FindFilesHostStats {
  pid: number;
  root: string;
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  files: number;
  ltr: boolean;
  clients: number;
  builds: number;
}

/* ───────────────────────── host ───────────────────────── */

/**
 * Run the host for `root` in this process: listen, build, serve, exit when idle.
 * Resolves when it stops (another host already serves the root, or idle).
 */
export async function runFindFilesHost(root: string, opts: { idleMs?: number; exit?: boolean } = {}): Promise<'idle' | 'taken'> {
  const real = canonical(root);
  const addr = findFilesHostAddress(root);
  const idleMs = opts.idleMs ?? (Number(process.env.SEQUENCE_FIND_FILES_HOST_IDLE_MS) || FIND_FILES_HOST_IDLE_MS);
  let clients = 0;
  let lastSeen = Date.now();
  let builds = 0;
  const server = net.createServer((sock) => {
    clients++;
    lastSeen = Date.now();
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      buf += chunk;
      if (buf.length > 1 << 20) {
        sock.destroy();
        return;
      }
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let req: Req;
        try {
          req = JSON.parse(line) as Req;
        } catch {
          continue;
        }
        lastSeen = Date.now();
        void answer(req).then((out) => {
          if (!sock.destroyed) sock.write(`${JSON.stringify({ id: req.id, ...out })}\n`);
        });
      }
    });
    sock.on('error', () => undefined);
    sock.on('close', () => {
      clients--;
      lastSeen = Date.now();
    });
  });

  const answer = async (req: Req): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> => {
    try {
      if (req.op === 'ping') return { ok: true, result: PROTOCOL };
      if (req.op === 'stats') {
        const m = process.memoryUsage();
        const i = peekFindFilesIndex(root);
        const s: FindFilesHostStats = { pid: process.pid, root: real, rss: m.rss, heapUsed: m.heapUsed, heapTotal: m.heapTotal, external: m.external, arrayBuffers: m.arrayBuffers, files: i?.files.length ?? 0, ltr: Boolean(i?.ltr), clients, builds };
        return { ok: true, result: s };
      }
      if (req.op === 'find' && typeof req.q === 'string') {
        const o = req.opts ?? {};
        /* Only the options a client may set; the root is the host's own, never the request's. */
        const r = await findFiles(root, req.q, { k: o.k, budgetTokens: o.budgetTokens, waitMs: o.waitMs, noLog: o.noLog, frozenOnly: o.frozenOnly });
        return { ok: true, result: r };
      }
      return { ok: false, error: 'bad request' };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  };

  const listen = (): Promise<'ok' | 'taken'> =>
    new Promise((resolve, reject) => {
      const onErr = (err: NodeJS.ErrnoException): void => {
        server.off('listening', onOk);
        if (err.code !== 'EADDRINUSE') return reject(err);
        /* A live host answers a connect: it serves this root, so this one leaves. A dead one left its socket file behind: take it over. */
        const probe = net.connect(addr);
        probe.once('connect', () => {
          probe.destroy();
          resolve('taken');
        });
        probe.once('error', () => {
          if (process.platform === 'win32') return resolve('taken');
          try {
            fs.unlinkSync(addr);
          } catch {
            /* raced with another host */
          }
          server.once('error', (e2: NodeJS.ErrnoException) => (e2.code === 'EADDRINUSE' ? resolve('taken') : reject(e2)));
          server.once('listening', () => resolve('ok'));
          server.listen(addr);
        });
      };
      const onOk = (): void => {
        server.off('error', onErr);
        resolve('ok');
      };
      server.once('error', onErr);
      server.once('listening', onOk);
      server.listen(addr);
    });

  const got = await listen();
  if (got === 'taken') {
    server.close();
    if (opts.exit) process.exit(0);
    return 'taken';
  }
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(addr, 0o600);
    } catch {
      /* the directory is 0700 already */
    }
  }
  builds++;
  warmFindFiles(root);
  /* Once the build settles, give its garbage back (the host runs with --expose-gc). */
  void (async () => {
    for (let i = 0; i < 600 && !peekFindFilesIndex(root); i++) await new Promise((r) => setTimeout(r, 500).unref());
    await peekFindFilesIndex(root)?.ltrPending;
    (globalThis as { gc?: () => void }).gc?.();
  })();
  return new Promise((resolve) => {
    const tick = setInterval(() => {
      if (clients > 0 || Date.now() - lastSeen < idleMs) return;
      clearInterval(tick);
      server.close(() => {
        if (opts.exit) process.exit(0);
        resolve('idle');
      });
    }, Math.max(50, Math.min(30_000, idleMs / 4)));
  });
}

/* ───────────────────────── client ───────────────────────── */

interface Conn {
  sock: net.Socket;
  next: number;
  waiting: Map<number, (v: { ok: boolean; result?: unknown; error?: string } | null) => void>;
}

const CONNS = new Map<string, Conn>();
const CONNECTING = new Map<string, Promise<Conn | null>>();
const SPAWNED_AT = new Map<string, number>();

/** How this process starts a host: node (this binary) running `entry` with the host flag. Set by the MCP server's main. */
let hostEntry: string | null = null;
export function setFindFilesHostEntry(entry: string | null): void {
  hostEntry = entry ? path.resolve(entry) : null;
}
export function findFilesHostEntry(): string | null {
  return hostEntry;
}

function tryConnect(addr: string): Promise<net.Socket | null> {
  return new Promise((resolve) => {
    const sock = net.connect(addr);
    const done = (s: net.Socket | null): void => {
      sock.off('connect', ok);
      sock.off('error', bad);
      resolve(s);
    };
    const ok = (): void => done(sock);
    const bad = (): void => {
      sock.destroy();
      done(null);
    };
    sock.once('connect', ok);
    sock.once('error', bad);
  });
}

function wire(key: string, sock: net.Socket): Conn {
  const c: Conn = { sock, next: 1, waiting: new Map() };
  let buf = '';
  sock.setEncoding('utf8');
  /* The session's process may exit with this open. */
  sock.unref();
  sock.on('data', (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      try {
        const m = JSON.parse(line) as { id: number; ok: boolean; result?: unknown; error?: string };
        c.waiting.get(m.id)?.(m);
        c.waiting.delete(m.id);
        if (c.waiting.size === 0) sock.unref();
      } catch {
        /* a torn line from a dying host */
      }
    }
  });
  const drop = (): void => {
    if (CONNS.get(key) === c) CONNS.delete(key);
    for (const w of c.waiting.values()) w(null);
    c.waiting.clear();
  };
  sock.on('error', drop);
  sock.on('close', drop);
  CONNS.set(key, c);
  return c;
}

function spawnHost(root: string, entry: string): void {
  const key = canonical(root);
  const last = SPAWNED_AT.get(key) ?? 0;
  if (Date.now() - last < RESPAWN_MS) return;
  SPAWNED_AT.set(key, Date.now());
  try {
    const child = spawn(process.execPath, [...FIND_FILES_HOST_NODE_FLAGS, entry, FIND_FILES_HOST_FLAG, path.resolve(root)], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      /* glibc keeps one malloc arena per thread-pool thread that read a file; two is plenty for a host. */
      env: { ...process.env, MALLOC_ARENA_MAX: process.env.MALLOC_ARENA_MAX ?? '2' },
    });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    /* no host: calls answer by path words */
  }
}

/** A connection to the host for `root`, spawning it if none answers, within `ms`. Null when none could be reached in time. */
async function hostConn(root: string, entry: string, ms: number): Promise<Conn | null> {
  const key = canonical(root);
  const have = CONNS.get(key);
  if (have && !have.sock.destroyed) return have;
  const inflight = CONNECTING.get(key);
  if (inflight) return inflight;
  const p = (async (): Promise<Conn | null> => {
    const addr = findFilesHostAddress(root);
    const until = Date.now() + ms;
    let sock = await tryConnect(addr);
    if (!sock) spawnHost(root, entry);
    for (let delay = 25; !sock && Date.now() < until; delay = Math.min(200, delay * 2)) {
      await new Promise((r) => setTimeout(r, Math.min(delay, Math.max(0, until - Date.now()))));
      sock = await tryConnect(addr);
    }
    return sock ? wire(key, sock) : null;
  })();
  CONNECTING.set(key, p);
  try {
    return await p;
  } finally {
    CONNECTING.delete(key);
  }
}

function ask(c: Conn, op: Req['op'], ms: number, extra: Partial<Req> = {}): Promise<{ ok: boolean; result?: unknown; error?: string } | null> {
  const id = c.next++;
  return new Promise((resolve) => {
    /* An open call keeps this process alive; an idle connection does not. */
    c.sock.ref();
    const t = setTimeout(() => {
      c.waiting.delete(id);
      if (c.waiting.size === 0) c.sock.unref();
      resolve(null);
    }, ms);
    c.waiting.set(id, (v) => {
      clearTimeout(t);
      resolve(v);
    });
    c.sock.write(`${JSON.stringify({ id, op, ...extra })}\n`);
  });
}

/** Start (or reach) the shared host for `root` without waiting for its index. Safe to call on every session start. */
export function warmFindFilesShared(root: string, entry = hostEntry): void {
  if (!entry) {
    warmFindFiles(root);
    return;
  }
  void hostConn(root, entry, 10_000).catch(() => null);
}

/**
 * find_files through the shared host. Without a host entry (tests, a library
 * caller) it is the in-process {@link findFiles}. Never waits longer than the
 * call's own wait plus a short grace: an unreachable or slow host is answered
 * by path words.
 */
export async function findFilesShared(root: string, question: string, opts: FindFilesOptions & { entry?: string | null } = {}): Promise<FindFilesResult> {
  const entry = opts.entry === undefined ? hostEntry : opts.entry;
  const { entry: _e, ...o } = opts;
  if (!entry || process.env.SEQUENCE_FIND_FILES_SHARED === '0') return findFiles(root, question, o);
  const t0 = performance.now();
  if (!fs.existsSync(root)) return findFiles(root, question, { ...o, indexless: true });
  const c = await hostConn(root, entry, CONNECT_MS);
  if (c) {
    const used = performance.now() - t0;
    const wait = Math.max(0, (o.waitMs ?? FIND_FILES_COLD_WAIT_MS + FIND_FILES_LTR_WAIT_MS) - used);
    const r = await ask(c, 'find', wait + ANSWER_GRACE_MS, { q: question, opts: { ...o, waitMs: o.waitMs === undefined ? undefined : wait } });
    if (r?.ok) return r.result as FindFilesResult;
  }
  return findFiles(root, question, { ...o, indexless: true });
}

/** The shared host's own numbers (tests, diagnostics). Null when none answers. */
export async function findFilesHostStats(root: string, entry = hostEntry): Promise<FindFilesHostStats | null> {
  if (!entry) return null;
  const c = await hostConn(root, entry, CONNECT_MS);
  const r = c ? await ask(c, 'stats', 5_000) : null;
  return r?.ok ? (r.result as FindFilesHostStats) : null;
}

/** Close this process's connections (tests). */
export function closeFindFilesHostConnections(): void {
  for (const c of CONNS.values()) c.sock.destroy();
  CONNS.clear();
  SPAWNED_AT.clear();
}

/** Run as a host when this process was started with the host flag (entry scripts call this first). True when it did. */
export function maybeRunFindFilesHost(argv: readonly string[] = process.argv): boolean {
  const i = argv.indexOf(FIND_FILES_HOST_FLAG);
  if (i < 0 || !argv[i + 1]) return false;
  void runFindFilesHost(argv[i + 1]!, { exit: true }).catch(() => process.exit(1));
  return true;
}
