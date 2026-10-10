/**
 * THE CLAUDE BRIDGE, FETCHED ON FIRST USE (and checked).
 *
 * The bridge's dependency closure includes Anthropic's Agent SDK, whose terms are "all rights
 * reserved", so the installer does not carry it. The first time Claude is needed this downloads the
 * pinned bridge release and the exact packages it depends on (claudeBridgeClosure.ts, generated from an
 * npm lock of the pinned version, the SDK's ~250 MB native binaries left out) from the npm registry
 * into the app's user-data folder, the way Zed fetches its Claude adapter. No npm, no Node install and
 * no user step: this process's own fetch, zlib and a small tar reader.
 *
 * Every tarball is checked against the sha512 pinned in the closure before a byte of it is unpacked.
 * A tree is only used once complete: it is unpacked beside the final folder and renamed into place with
 * a marker, so a killed download never leaves something half-usable. Any failure stops every worker,
 * removes the partial folder and leaves the state `failed` with a reason in plain words; the caller
 * falls back to a global install, and the download is only tried again after a growing pause.
 *
 * Network: HTTPS_PROXY / HTTP_PROXY / NO_PROXY are honoured (a CONNECT tunnel), each tarball has a
 * timeout, 3 attempts with 1 s and 4 s pauses (Retry-After respected) and a size cap. Unpacking is
 * async and yields, so the server's event loop is never held for more than a few milliseconds.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import https from 'node:https';
import path from 'node:path';
import tls from 'node:tls';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

import { CLAUDE_BRIDGE_CLOSURE, CLAUDE_BRIDGE_ENTRY, CLAUDE_BRIDGE_VERSION, type BridgePackage } from './claudeBridgeClosure.js';

export type BridgeSetupState = 'idle' | 'running' | 'done' | 'failed';

export interface BridgeSetupStatus {
  state: BridgeSetupState;
  /** Compressed bytes downloaded so far (the "12 MB" of "Setting up Claude… 12 MB"). Frozen once a download fails. */
  receivedBytes: number;
  files: number;
  totalFiles: number;
  /** Why the last download failed, in plain words (kept while a later try runs, so the card does not flip). */
  error?: string;
  failedAt?: number;
  failures: number;
}

export interface BridgeProvisioner {
  /** The bridge's entry file once a complete, verified tree is in place; else null. */
  entry(): string | null;
  status(): BridgeSetupStatus;
  /** Begin the download unless one runs, one finished, or a failure is too recent to try again. */
  start(): void;
  /** Resolves when the running download ends (tests, and the measure script). */
  idle(): Promise<void>;
}

const MARKER = '.sequence-complete';
const gunzip = promisify(zlib.gunzip) as (b: Buffer, o: zlib.ZlibOptions) => Promise<Buffer>;
const REGISTRY = 'https://registry.npmjs.org';
/** After failure n the next try waits 5 min * 2^(n-1), at most an hour. */
export function retryDelayMs(failures: number): number {
  return Math.min(5 * 60_000 * 2 ** Math.max(0, failures - 1), 3_600_000);
}
const TARBALL_TIMEOUT_MS = 60_000;
const MAX_TARBALL_BYTES = 64 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 256 * 1024 * 1024;
const BACKOFF_MS = [1000, 4000];
/** A lock whose owner has not refreshed it for this long is stale even if its pid is alive (the pid was recycled). */
const HEARTBEAT_STALE_MS = 5 * 60_000;
const HEARTBEAT_EVERY_MS = 30_000;

/** `sha512-<base64>` check. Throws with the package name on a mismatch. */
export function verifyIntegrity(buf: Buffer, integrity: string, what: string): void {
  const m = /^sha512-(.+)$/.exec(integrity);
  if (!m) throw new Error(`${what}: no sha512 integrity pinned`);
  const got = createHash('sha512').update(buf).digest('base64');
  if (got !== m[1]) throw new Error(`${what}: the download does not match its pinned checksum`);
}

/** Same check, hashing in 256 KB slices with a yield between, so a 3 MB tarball never holds the event loop. */
export async function verifyIntegrityAsync(buf: Buffer, integrity: string, what: string): Promise<void> {
  const m = /^sha512-(.+)$/.exec(integrity);
  if (!m) throw new Error(`${what}: no sha512 integrity pinned`);
  const h = createHash('sha512');
  for (let i = 0; i < buf.length; i += 262_144) {
    h.update(buf.subarray(i, i + 262_144));
    await new Promise<void>((r) => setImmediate(r));
  }
  if (h.digest('base64') !== m[1]) throw new Error(`${what}: the download does not match its pinned checksum`);
}

/** A failure in plain words, for the card. Looks through `cause` for the system error code. */
export function plainReason(err: unknown): string {
  const codes: string[] = [];
  const texts: string[] = [];
  for (let e: unknown = err, i = 0; e && i < 4; e = (e as { cause?: unknown }).cause, i++) {
    const x = e as { code?: string; message?: string };
    if (x.code) codes.push(x.code);
    if (x.message) texts.push(x.message);
  }
  const code = codes.join(' ');
  const text = texts.join(' ');
  if (/SOCKS/.test(text)) return "the proxy setting is a SOCKS proxy, which Sequence can't use";
  if (/^the proxy answered 407|proxy answered 407/.test(text)) return 'the proxy asked for a sign-in';
  if (/the proxy answered (\d{3})/.test(text)) return `the proxy refused the connection (${/the proxy answered (\d{3})/.exec(text)![1]})`;
  if (/EPROXYCONN/.test(code)) return 'it could not reach the proxy set in HTTPS_PROXY';
  if (/pinned checksum/.test(text)) return 'a download did not match its checksum';
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) return 'it could not find the npm registry (no network, or DNS is blocked)';
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/.test(code + text)) return 'a proxy or firewall is intercepting the connection (its certificate is not trusted)';
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EPIPE|timed out|aborted/i.test(code + text)) return 'the connection to the npm registry failed or timed out (a proxy may be needed)';
  const status = /answered (\d{3})/.exec(text)?.[1];
  if (status) return `the npm registry answered ${status}`;
  if (/ENOSPC/.test(code)) return 'the disk is full';
  /* Any other file-system error: never show a raw message with a path in it. */
  if (/^E[A-Z]+$/.test(code.split(' ')[0] ?? '') || /\bE(NOENT|ACCES|PERM|EEXIST|BUSY|MFILE)\b/.test(text)) return 'the app could not write to its data folder';
  return /[\\/]/.test(text) ? 'the download failed' : text || 'the download failed';
}

function octal(b: Buffer, from: number, to: number): number {
  const s = b.toString('latin1', from, to).replace(/\0.*$/s, '').trim();
  return s ? parseInt(s, 8) : 0;
}

function field(b: Buffer, from: number, to: number): string {
  return b.toString('utf8', from, to).replace(/\0.*$/s, '');
}

/** Pax extended header records ("<len> key=value\n") -> the keys we use. */
function paxPath(body: Buffer): string | undefined {
  let out: string | undefined;
  let i = 0;
  while (i < body.length) {
    const sp = body.indexOf(0x20, i);
    if (sp < 0) break;
    const len = parseInt(body.toString('latin1', i, sp), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const rec = body.toString('utf8', sp + 1, i + len - 1);
    if (rec.startsWith('path=')) out = rec.slice(5);
    i += len;
  }
  return out;
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

/**
 * Unpack an npm tarball (gzip + tar, entries under `package/`) into `dest`. Files only; the first path
 * segment is dropped; a name that is absolute or climbs out of `dest` is refused, links are skipped.
 * Async: gunzip runs on the thread pool, each file is written with fs.promises, and the loop yields every
 * few files, so no step holds the event loop. Returns the number of files written.
 */
export async function extractTgz(tgz: Buffer, dest: string, signal?: AbortSignal): Promise<number> {
  const tar = await gunzip(tgz, { maxOutputLength: MAX_UNPACKED_BYTES });
  const root = path.resolve(dest);
  const made = new Set<string>();
  let off = 0;
  let longName: string | undefined;
  let paxName: string | undefined;
  let files = 0;
  while (off + 512 <= tar.length) {
    signal?.throwIfAborted();
    const h = tar.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break;
    const size = octal(h, 124, 136);
    const type = String.fromCharCode(h[156] || 0x30);
    const body = tar.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      paxName = paxPath(body);
      continue;
    }
    if (type === 'g') continue;
    if (type === 'L') {
      longName = field(body, 0, body.length);
      continue;
    }
    const prefix = field(h, 345, 500);
    const name = paxName ?? longName ?? (prefix ? `${prefix}/${field(h, 0, 100)}` : field(h, 0, 100));
    paxName = undefined;
    longName = undefined;
    if (type !== '0' && type !== '\0') continue;
    const parts = name.split('/').filter((p) => p !== '' && p !== '.');
    parts.shift();
    if (parts.length === 0) continue;
    if (parts.some((p) => p === '..') || path.isAbsolute(name) || /^[A-Za-z]:/.test(name) || name.includes('\\') || parts.some((p) => p.includes(':'))) throw new Error(`unsafe path in package: ${name}`);
    const file = path.join(root, ...parts);
    if (!file.startsWith(root + path.sep)) throw new Error(`unsafe path in package: ${name}`);
    const dir = path.dirname(file);
    if (!made.has(dir)) {
      await fsp.mkdir(dir, { recursive: true });
      made.add(dir);
    }
    const mode = octal(h, 100, 108);
    await fsp.writeFile(file, body, { mode: mode & 0o111 ? 0o755 : 0o644 });
    files++;
    if (files % 8 === 0) await tick();
  }
  return files;
}

/* ---- network ---- */

export interface GetResult {
  status: number;
  body: Buffer;
  retryAfterMs?: number;
}
export type Getter = (url: string, o: { signal: AbortSignal; onBytes: (n: number) => void; maxBytes: number }) => Promise<GetResult>;

/** True when `host` matches a NO_PROXY entry: `*`, `host`, `.host`, `*.host`, `host:port`, or an IPv4 CIDR. */
export function noProxyMatches(host: string, port: string, list: string): boolean {
  const h = host.toLowerCase();
  const ip4 = (x: string): number | null => {
    const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(x);
    return m ? (((+m[1]! << 24) | (+m[2]! << 16) | (+m[3]! << 8) | +m[4]!) >>> 0) : null;
  };
  for (const raw of list.split(',')) {
    let e = raw.trim().toLowerCase();
    if (!e) continue;
    if (e === '*') return true;
    const cidr = /^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/.exec(e);
    if (cidr) {
      const a = ip4(h);
      const b = ip4(cidr[1]!);
      const bits = Number(cidr[2]);
      if (a !== null && b !== null && bits >= 0 && bits <= 32) {
        const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
        if (((a ^ b) & mask) === 0) return true;
      }
      continue;
    }
    const pm = /^(.*):(\d+)$/.exec(e);
    if (pm && !e.includes(']')) {
      if (pm[2] !== port) continue;
      e = pm[1]!;
    }
    e = e.replace(/^\*?\./, '');
    if (h === e || h.endsWith('.' + e)) return true;
  }
  return false;
}

export type ProxyChoice = { proxy: URL } | { unsupported: string } | null;

/** The proxy for `url` from the environment: a URL, an unsupported scheme (socks...), or none (NO_PROXY respected). */
export function proxyChoice(url: string, env: NodeJS.ProcessEnv = process.env): ProxyChoice {
  const u = new URL(url);
  const first = (...v: (string | undefined)[]): string | undefined => v.find((x) => x !== undefined && x.trim() !== '');
  const raw = u.protocol === 'https:' ? first(env.HTTPS_PROXY, env.https_proxy, env.ALL_PROXY, env.all_proxy) : first(env.HTTP_PROXY, env.http_proxy, env.ALL_PROXY, env.all_proxy);
  if (!raw) return null;
  if (noProxyMatches(u.hostname, u.port || (u.protocol === 'https:' ? '443' : '80'), first(env.NO_PROXY, env.no_proxy) ?? '')) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw)?.[1]?.toLowerCase();
  if (scheme && scheme !== 'http' && scheme !== 'https') return { unsupported: scheme };
  try {
    return { proxy: new URL(scheme ? raw : `http://${raw}`) };
  } catch {
    return null;
  }
}

/** The proxy URL only (kept for callers that just need it). */
export function proxyFor(url: string, env: NodeJS.ProcessEnv = process.env): URL | null {
  const c = proxyChoice(url, env);
  return c && 'proxy' in c ? c.proxy : null;
}

function readBody(res: http.IncomingMessage, o: { signal: AbortSignal; onBytes: (n: number) => void; maxBytes: number }): Promise<GetResult> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const ra = Number(res.headers['retry-after']);
    res.on('data', (c: Buffer) => {
      size += c.length;
      if (size > o.maxBytes) return res.destroy(new Error(`a download is larger than ${o.maxBytes} bytes`));
      chunks.push(c);
      o.onBytes(c.length);
    });
    res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks), ...(Number.isFinite(ra) ? { retryAfterMs: ra * 1000 } : {}) }));
    res.on('error', reject);
    o.signal.addEventListener('abort', () => res.destroy(new Error('aborted')), { once: true });
  });
}

/** Roots to trust: node's own, plus the PEM file named by SEQUENCE_EXTRA_CA_CERTS (a corporate proxy's CA). */
function trustedRoots(): string[] | undefined {
  const f = process.env.SEQUENCE_EXTRA_CA_CERTS?.trim();
  if (!f) return undefined;
  try {
    return [...tls.rootCertificates, fs.readFileSync(f, 'utf8')];
  } catch {
    return undefined;
  }
}

const proxyError = (msg: string, code: string): Error => Object.assign(new Error(msg), { code });

/**
 * GET with node's own http(s), through the proxy named by HTTPS_PROXY / HTTP_PROXY / ALL_PROXY when there is
 * one: a CONNECT tunnel (TLS to the registry is still verified against its name, inside the tunnel), or an
 * absolute-URI GET for an http mirror. A proxy may be http:// or https://; a SOCKS proxy is refused in words.
 * Every socket gets an error listener, so a reset can never become an uncaught exception.
 */
export const coreGet: Getter = (url, o) =>
  new Promise((resolve, reject) => {
    const u = new URL(url);
    const choice = proxyChoice(url);
    const sockets = new Set<net.Socket>();
    let settled = false;
    const watch = (s: net.Socket): net.Socket => {
      sockets.add(s);
      s.on('error', (e) => {
        if (!settled) done(e);
      });
      return s;
    };
    const done = (e?: unknown, r?: GetResult): void => {
      if (settled) return;
      settled = true;
      for (const s of sockets) s.destroy();
      if (e) reject(e);
      else resolve(r!);
    };
    const respond = (res: http.IncomingMessage): void => {
      watch(res.socket);
      void readBody(res, o).then((r) => done(undefined, r), (e) => done(e));
    };
    if (o.signal.aborted) return done(new Error('aborted'));
    const headers = { 'user-agent': 'sequence-claude-bridge-setup', connection: 'close' };
    if (choice && 'unsupported' in choice) return done(proxyError(`SOCKS proxy (${choice.unsupported}://) is set`, 'ESOCKS'));
    if (!choice) {
      const req = (u.protocol === 'https:' ? https : http).get(u, { signal: o.signal, headers, ...(u.protocol === 'https:' ? { ca: trustedRoots() } : {}) }, respond);
      req.on('error', (e) => done(e));
      return;
    }
    const proxy = choice.proxy;
    const tlsProxy = proxy.protocol === 'https:';
    const auth = proxy.username || proxy.password ? 'Basic ' + Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64') : undefined;
    const proxyOpts = { host: proxy.hostname, port: Number(proxy.port) || (tlsProxy ? 443 : 80), signal: o.signal, ...(tlsProxy ? { ca: trustedRoots() } : {}) };
    const viaProxy = (e: unknown): Error => (settled || (e as { code?: string }).code === 'ESOCKS' ? (e as Error) : proxyError(`could not reach the proxy: ${(e as Error).message}`, 'EPROXYCONN'));
    const lib = tlsProxy ? https : http;
    if (u.protocol === 'http:') {
      const req = lib.request({ ...proxyOpts, method: 'GET', path: url, headers: { ...headers, host: u.host, ...(auth ? { 'proxy-authorization': auth } : {}) } }, respond);
      req.on('error', (e) => done(viaProxy(e)));
      req.end();
      return;
    }
    const target = `${u.hostname}:${u.port || 443}`;
    const connect = lib.request({ ...proxyOpts, method: 'CONNECT', path: target, headers: { host: target, ...(auth ? { 'proxy-authorization': auth } : {}) } });
    connect.on('error', (e) => done(viaProxy(e)));
    connect.on('connect', (res, socket) => {
      watch(socket);
      if (res.statusCode !== 200) return done(proxyError(`the proxy answered ${res.statusCode}`, 'EPROXY'));
      /* No `agent: false`: with it Node ignores createConnection and goes direct, bypassing the tunnel. */
      const req = https.get(u, { signal: o.signal, headers, ca: trustedRoots(), createConnection: () => tls.connect({ socket, servername: net.isIP(u.hostname) ? undefined : u.hostname, ca: trustedRoots() }) }, respond);
      req.on('error', (e) => done(e));
    });
    connect.end();
  });

/** Adapter for tests and mirrors: a fetch implementation as a Getter. */
function fetchGetter(f: typeof fetch): Getter {
  return async (url, o) => {
    const res = await f(url, { signal: o.signal });
    if (!res.ok) return { status: res.status, body: Buffer.alloc(0), ...(res.headers.get('retry-after') ? { retryAfterMs: Number(res.headers.get('retry-after')) * 1000 } : {}) };
    const chunks: Buffer[] = [];
    let size = 0;
    const reader = res.body?.getReader();
    for (;;) {
      const r = reader ? await reader.read() : { done: true as const, value: undefined };
      if (r.done) break;
      size += r.value.length;
      if (size > o.maxBytes) throw new Error(`a download is larger than ${o.maxBytes} bytes`);
      chunks.push(Buffer.from(r.value));
      o.onBytes(r.value.length);
    }
    return { status: res.status, body: Buffer.concat(chunks) };
  };
}

/* ---- install folder ---- */

async function renameWithRetry(from: string, to: string): Promise<void> {
  let last: unknown;
  for (let i = 0; i < 10; i++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (e) {
      last = e;
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES' && code !== 'ENOTEMPTY') break;
      /* Defender or the indexer holds a freshly written file for a moment: wait and try again. */
      await new Promise((r) => setTimeout(r, 100 * (i + 1)));
    }
  }
  try {
    await fsp.cp(from, to, { recursive: true });
    await fsp.rm(from, { recursive: true, force: true });
  } catch {
    throw last instanceof Error ? last : new Error(String(last));
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

interface LockFile {
  pid: number;
  at: number;
  token: string;
}

/**
 * Take `<dir>/.lock` (create-exclusive). A live owner keeps it fresh with a heartbeat; a lock whose pid is
 * dead, or whose heartbeat stopped for 5 minutes (a recycled pid), is stale and is moved aside atomically, so
 * only one taker wins. Returns a release that removes the lock only if it is still ours.
 */
function takeLock(dir: string, now: number): { release: () => void; heartbeat: () => void } | null {
  const lock = path.join(dir, '.lock');
  fs.mkdirSync(dir, { recursive: true });
  const token = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  const mine = (): boolean => {
    try {
      return (JSON.parse(fs.readFileSync(lock, 'utf8')) as LockFile).token === token;
    } catch {
      return false;
    }
  };
  for (let i = 0; i < 3; i++) {
    try {
      fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: now, token } satisfies LockFile), { flag: 'wx' });
      return {
        release: () => {
          if (mine()) fs.rmSync(lock, { force: true });
        },
        heartbeat: () => {
          if (mine()) fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: Date.now(), token } satisfies LockFile));
        },
      };
    } catch {
      try {
        const held = JSON.parse(fs.readFileSync(lock, 'utf8')) as LockFile;
        if (pidAlive(held.pid) && now - held.at < HEARTBEAT_STALE_MS) return null;
      } catch {
        /* unreadable: stale */
      }
      try {
        fs.renameSync(lock, `${lock}.stale-${token}`);
        fs.rmSync(`${lock}.stale-${token}`, { force: true });
      } catch {
        /* someone else moved it first: look again */
      }
    }
  }
  return null;
}

export interface ProvisionerOptions {
  /** Where trees live: `<dir>/<version>/`. The app's user-store folder. */
  dir: string;
  fetchImpl?: typeof fetch;
  getter?: Getter;
  closure?: readonly BridgePackage[];
  version?: string;
  entry?: string;
  /** Replaces https://registry.npmjs.org in tarball URLs (a mirror; the measure script). Defaults to SEQUENCE_NPM_REGISTRY. */
  registry?: string;
  now?: () => number;
  concurrency?: number;
  /** Pauses between attempts of one tarball (tests pass zeros). */
  backoffMs?: readonly number[];
  tarballTimeoutMs?: number;
  maxTarballBytes?: number;
}

export function createBridgeProvisioner(opts: ProvisionerOptions): BridgeProvisioner {
  const closure = opts.closure ?? CLAUDE_BRIDGE_CLOSURE;
  const version = opts.version ?? CLAUDE_BRIDGE_VERSION;
  const entryRel = opts.entry ?? CLAUDE_BRIDGE_ENTRY;
  const get = opts.getter ?? (opts.fetchImpl ? fetchGetter(opts.fetchImpl) : coreGet);
  const registry = (opts.registry ?? process.env.SEQUENCE_NPM_REGISTRY ?? REGISTRY).replace(/\/+$/, '');
  const now = opts.now ?? Date.now;
  const backoff = opts.backoffMs ?? BACKOFF_MS;
  const final = path.join(opts.dir, version);
  const st: BridgeSetupStatus = { state: 'idle', receivedBytes: 0, files: 0, totalFiles: closure.length, failures: 0 };
  let running: Promise<void> | null = null;
  let frozen = false;

  const entry = (): string | null => {
    const e = path.join(final, ...entryRel.split('/'));
    return fs.existsSync(path.join(final, MARKER)) && fs.existsSync(e) ? e : null;
  };

  async function fetchOne(p: BridgePackage, signal: AbortSignal): Promise<Buffer> {
    const url = p.resolved.replace(/^https:\/\/registry\.npmjs\.org/, registry);
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      signal.throwIfAborted();
      const ctl = new AbortController();
      const onAbort = (): void => ctl.abort();
      signal.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => ctl.abort(new Error('timed out')), opts.tarballTimeoutMs ?? TARBALL_TIMEOUT_MS);
      let wait = backoff[attempt] ?? 0;
      let counted = 0;
      try {
        const r = await get(url, { signal: ctl.signal, maxBytes: opts.maxTarballBytes ?? MAX_TARBALL_BYTES, onBytes: (n) => { counted += n; if (!frozen) st.receivedBytes += n; } });
        if (r.status !== 200) {
          if (r.retryAfterMs !== undefined) wait = Math.max(wait, Math.min(r.retryAfterMs, 10_000));
          throw new Error(`${p.name}: the registry answered ${r.status}`);
        }
        await verifyIntegrityAsync(r.body, p.integrity, `${p.name}@${p.version}`);
        return r.body;
      } catch (e) {
        if (!frozen) st.receivedBytes -= counted;
        last = ctl.signal.aborted && !signal.aborted ? new Error(`${p.name}: timed out`) : e;
        /* A checksum mismatch is not a flaky network, and an abort is not ours to retry. */
        if (/pinned checksum/.test((e as Error).message) || signal.aborted) break;
        if (/answered (4\d\d)/.test((e as Error).message) && !/answered (408|429)/.test((e as Error).message)) break;
        if (attempt < 2) await new Promise((r) => setTimeout(r, wait));
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      }
    }
    throw last instanceof Error ? last : new Error(String(last));
  }

  async function sweep(keepCurrent: boolean): Promise<void> {
    let names: string[] = [];
    try {
      names = await fsp.readdir(opts.dir);
    } catch {
      return;
    }
    for (const n of names) {
      const owner = /\.partial-(\d+)$/.exec(n)?.[1];
      /* A partial folder whose process is alive belongs to a download in progress: never touched. */
      if (owner !== undefined && Number(owner) !== process.pid && pidAlive(Number(owner))) continue;
      if (owner !== undefined) await fsp.rm(path.join(opts.dir, n), { recursive: true, force: true });
    }
    if (!keepCurrent) return;
    /* Older releases: keep the newest previous one (agents.json may still name its path until the next Start chatting). */
    const old = names.filter((n) => /^\d+\.\d+\.\d+$/.test(n) && n !== version).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const n of old.slice(1)) await fsp.rm(path.join(opts.dir, n), { recursive: true, force: true });
  }

  async function run(lock: { release: () => void; heartbeat: () => void }): Promise<void> {
    const beat = setInterval(lock.heartbeat, HEARTBEAT_EVERY_MS);
    beat.unref();
    const tmp = `${final}.partial-${process.pid}`;
    const ctl = new AbortController();
    try {
      await sweep(false);
      await fsp.mkdir(tmp, { recursive: true });
      const queue = [...closure];
      let firstError: unknown;
      const worker = async (): Promise<void> => {
        for (let p = queue.shift(); p && !ctl.signal.aborted; p = queue.shift()) {
          try {
            const buf = await fetchOne(p, ctl.signal);
            await extractTgz(buf, path.join(tmp, ...p.path.split('/')), ctl.signal);
            if (!ctl.signal.aborted && !frozen) st.files++;
          } catch (e) {
            if (firstError === undefined) firstError = e;
            /* Stop every other worker at once and freeze the numbers the card shows. */
            frozen = true;
            queue.length = 0;
            ctl.abort();
            return;
          }
        }
      };
      await Promise.allSettled(Array.from({ length: opts.concurrency ?? 6 }, worker));
      if (firstError !== undefined) throw firstError;
      if (!fs.existsSync(path.join(tmp, ...entryRel.split('/')))) throw new Error(`the bridge's entry (${entryRel}) is missing from the download`);
      await fsp.writeFile(path.join(tmp, MARKER), JSON.stringify({ version, packages: closure.length, at: now() }));
      if (entry()) {
        /* Another process finished first: its tree may already be in use. Keep it. */
        await fsp.rm(tmp, { recursive: true, force: true });
      } else {
        await fsp.rm(final, { recursive: true, force: true });
        await renameWithRetry(tmp, final);
      }
      st.state = 'done';
      delete st.error;
      await sweep(true);
    } catch (e) {
      /* Every worker has stopped (allSettled above), so nothing re-creates the folder. */
      await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
      st.state = 'failed';
      st.error = plainReason(e);
      st.failedAt = now();
      st.failures++;
    } finally {
      clearInterval(beat);
      lock.release();
    }
  }

  return {
    entry,
    status: () => ({ ...st }),
    start() {
      if (running || entry()) return;
      if (st.state === 'failed' && st.failedAt !== undefined && now() - st.failedAt < retryDelayMs(st.failures)) return;
      const lock = takeLock(opts.dir, now());
      if (!lock) {
        /* Another Sequence process is fetching it: look again in a moment instead of fetching twice. */
        if (st.state === 'idle') st.state = 'running';
        return;
      }
      /* A try after a failure keeps the failed state (and its reason, and frozen numbers) until it succeeds. */
      if (st.state !== 'failed') st.state = 'running';
      frozen = st.state === 'failed';
      if (!frozen) {
        st.receivedBytes = 0;
        st.files = 0;
        delete st.error;
      }
      running = run(lock).finally(() => {
        running = null;
      });
    },
    idle: async () => {
      await running;
    },
  };
}

/** A progress label for the card: "12 MB" (one decimal under 10 MB). */
export function megabytes(bytes: number): string {
  const mb = bytes / 1e6;
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}
