/**
 * Keyless web access for agents: Browser panel, ask `fetch_url` / `web_search`,
 * and the MCP `web_fetch` / `web_search` tools (packages/mcp webTools.ts).
 *
 * Designed after OpenCode's webfetch (MIT): plain HTTP GET with a browser-like
 * User-Agent, per-format Accept header, a byte bound on the download, one retry
 * with another UA on a Cloudflare challenge, HTML to markdown by a small
 * in-repo converter, and Pi-style output truncation with an `offset` to
 * continue. No cookie jar, no Chromium, no API key.
 *
 * Every hop (the first request and each redirect) is checked by
 * {@link checkPublicUrl}: public http(s) only, no private/loopback/link-local
 * address, IPv6 included, and (with the real network) no hostname that
 * resolves to one. Redirects are followed by hand so none skips the check.
 *
 * Everything fetched is untrusted data; callers wrap it (wrapUntrustedLines).
 */

import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { HTML_CAP, htmlToFlatText, htmlToMarkdown } from './htmlMarkdown.js';
import {
  fetchUrlContent,
  isSafePublicHttpUrl,
  type FetchedSource,
  type FetchImpl,
} from '../research/liveResearch.js';
import { readUserJson } from './store.js';

export type NetFetchResponse = FetchedSource;

export async function netFetchUrl(
  rawUrl: string,
  opts: { fetchImpl?: FetchImpl } = {},
): Promise<NetFetchResponse> {
  return fetchUrlContent(rawUrl, opts);
}

/* ── settings ────────────────────────────────────────────────────────── */

/**
 * `web.enabled`, read from the user store's agent-settings.json the way the
 * other agent settings are (askAgentMap.readAgentSettings): only an explicit
 * false turns it off; a missing, corrupt or unreadable file means ON. Both
 * `{"web.enabled": false}` and `{"web": {"enabled": false}}` are read.
 */
export function readWebEnabled(storeDir: string | undefined | null): boolean {
  if (!storeDir) return true;
  let raw: unknown;
  try {
    raw = readUserJson(storeDir, 'agent-settings.json');
  } catch {
    return true;
  }
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  if (o['web.enabled'] === false) return false;
  const web = o.web;
  if (web && typeof web === 'object' && (web as Record<string, unknown>).enabled === false) return false;
  return true;
}

/* ── SSRF ────────────────────────────────────────────────────────────── */

function ipv4Private(a: number, b: number, c = 0): boolean {
  return (
    a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 192 && b === 0 && c === 0) || (a === 198 && (b === 18 || b === 19)) ||
    (a === 100 && b >= 64 && b <= 127) || a >= 224
  );
}

/** An IPv6 literal as 8 16-bit groups (embedded dotted IPv4 expanded); null when malformed. */
function v6Groups(addr: string): number[] | null {
  let low = addr.toLowerCase();
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(low);
  if (dotted) {
    const [p, q, r, t] = dotted.slice(1).map(Number) as [number, number, number, number];
    low = low.slice(0, dotted.index) + ((p << 8) | q).toString(16) + ':' + ((r << 8) | t).toString(16);
  }
  const halves = low.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const g = [...head, ...Array(fill).fill('0'), ...tail].map((x) => parseInt(x, 16));
  return g.length === 8 && g.every((x) => Number.isInteger(x) && x >= 0 && x <= 0xffff) ? g : null;
}

/** True for an address literal (v4 or v6, brackets already removed) that is not public. */
export function isPrivateAddress(addr: string): boolean {
  const kind = net.isIP(addr);
  if (kind === 4) {
    const [a, b, c] = addr.split('.').map(Number);
    return ipv4Private(a!, b!, c!);
  }
  if (kind !== 6) return false;
  const g = v6Groups(addr);
  if (!g) return true; // cannot classify: refuse
  const zero5 = g.slice(0, 5).every((x) => x === 0);
  if (g.slice(0, 7).every((x) => x === 0) && g[7]! <= 1) return true; // :: and ::1
  if (zero5 && (g[5] === 0xffff || g[5] === 0)) return ipv4Private(g[6]! >> 8, g[6]! & 255, g[7]! >> 8); // ::ffff:a.b.c.d mapped, ::a.b.c.d compatible
  if (g.slice(0, 4).every((x) => x === 0) && g[4] === 0xffff && g[5] === 0) return true; // ::ffff:0:x:x IPv4-translated
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return true; // 64:ff9b::/96 NAT64
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((g[0]! & 0xff00) === 0xff00) return true; // multicast
  return false;
}

type DnsLookup = (host: string) => Promise<string[]>;

const defaultLookup: DnsLookup = async (host) => (await dns.promises.lookup(host, { all: true })).map((r) => r.address);

/**
 * The address the socket connects to is chosen HERE, at connect time, and
 * checked in the same step, so a name that answers "public" to a pre-check and
 * "127.0.0.1" a moment later (DNS rebinding) cannot reach a private address.
 */
export function guardedLookup(allowPrivate: boolean) {
  return (host: string, options: dns.LookupOptions, cb: (err: Error | null, address: string | dns.LookupAddress[], family?: number) => void): void => {
    dns.lookup(host, { ...options, all: true }, (err, addrs) => {
      if (err) return cb(err, '');
      const list = addrs as dns.LookupAddress[];
      if (!allowPrivate && list.some((x) => isPrivateAddress(x.address))) return cb(new Error('refused: host resolves to a private address'), '');
      if (options.all) return cb(null, list);
      const first = list[0];
      return first ? cb(null, first.address, first.family) : cb(new Error('no address'), '');
    });
  };
}

/** A fetch over node:http(s) whose connection goes through {@link guardedLookup}. gzip/deflate/br are decoded. */
const nodeFetch: FetchImpl = (input, init) =>
  new Promise<Response>((resolve, reject) => {
    const url = new URL(String(input));
    const allow = (process.env.SEQUENCE_RESEARCH_ALLOW_LOOPBACK ?? '').split(',').map((x) => x.trim()).includes(url.toString());
    const mod = url.protocol === 'https:' ? https : http;
    const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined), 'accept-encoding': 'gzip, deflate, br' };
    const req = mod.request(url, { method: init?.method ?? 'GET', headers, signal: init?.signal ?? undefined, lookup: guardedLookup(allow) as never }, (res) => {
      const enc = String(res.headers['content-encoding'] ?? '').toLowerCase();
      let stream: NodeJS.ReadableStream = res;
      if (enc === 'gzip' || enc === 'x-gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      const h = new Headers();
      for (const [k, v] of Object.entries(res.headers)) {
        if (k === 'set-cookie' || k === 'content-encoding' || k === 'content-length' || v === undefined) continue;
        h.set(k, Array.isArray(v) ? v.join(', ') : v);
      }
      const status = res.statusCode ?? 502;
      const noBody = status === 204 || status === 205 || status === 304;
      resolve(new Response(noBody ? null : (Readable.toWeb(stream as Readable) as ReadableStream), { status, headers: h }));
    });
    req.on('error', reject);
    req.end();
  });

/**
 * One hop's SSRF verdict. The string guard of liveResearch (schemes, names,
 * v4 ranges) plus IPv6 literals, then (when `lookup` is given and the host is
 * not a literal) every address the name resolves to.
 */
export async function checkPublicUrl(
  raw: string,
  lookup?: DnsLookup,
): Promise<{ ok: true; url: URL } | { ok: false; error: string }> {
  const base = isSafePublicHttpUrl(raw);
  if (!base.ok) return base;
  const allowlisted = (process.env.SEQUENCE_RESEARCH_ALLOW_LOOPBACK ?? '').split(',').map((s) => s.trim()).includes(raw);
  if (allowlisted) return base;
  const host = base.url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    return isPrivateAddress(host) ? { ok: false, error: 'refused private/loopback host' } : base;
  }
  if (lookup) {
    let addrs: string[];
    try {
      addrs = await lookup(host);
    } catch (e) {
      return { ok: false, error: `could not resolve ${host}: ${(e as Error).message}` };
    }
    if (addrs.length === 0) return { ok: false, error: `could not resolve ${host}` };
    if (addrs.some((a) => isPrivateAddress(a))) return { ok: false, error: 'refused: host resolves to a private address' };
  }
  return base;
}

/* ── HTML to markdown ────────────────────────────────────────────────── */

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…',
  copy: '©', reg: '®', trade: '™', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  laquo: '«', raquo: '»', bull: '•', middot: '·', times: '×', rarr: '→', larr: '←',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
      } catch {
        return m;
      }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function htmlTitle(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const t = m?.[1] ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
  return t || undefined;
}

/* ── web fetch ───────────────────────────────────────────────────────── */

export type WebFormat = 'markdown' | 'text' | 'html';

export const WEB_MAX_BYTES = 5 * 1024 * 1024;
export const WEB_OUTPUT_CAP = 50 * 1024;
export const WEB_DEFAULT_TIMEOUT_S = 30;
export const WEB_MAX_TIMEOUT_S = 120;
const MAX_REDIRECTS = 5;
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const ALT_UA = 'sequence';

const ACCEPT: Record<WebFormat, string> = {
  markdown: 'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1',
  text: 'text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1',
  html: 'text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, */*;q=0.1',
};

export interface WebFetchOptions {
  format?: WebFormat;
  /** Seconds; default 30, at most 120. */
  timeout?: number;
  /** Character offset to continue a truncated page from. */
  offset?: number;
  fetchImpl?: FetchImpl;
  /** Hostname resolver for the DNS half of the SSRF check; null skips it (tests). Default: the real resolver. */
  lookup?: DnsLookup | null;
  maxBytes?: number;
  outputCap?: number;
  /** Hard limit on the HTML conversion (worker thread); default 5s. */
  convertTimeoutMs?: number;
}

export type WebFetchResult =
  | {
      ok: true;
      url: string;
      status: number;
      contentType: string;
      format: WebFormat;
      title?: string;
      output: string;
      offset: number;
      totalChars: number;
      /** Set when the page continues past this slice: call again with offset=nextOffset. */
      nextOffset?: number;
      /** The download hit the byte bound; the page is cut. */
      downloadTruncated?: boolean;
    }
  | { ok: false; url: string; status?: number; error: string };

function textual(ctype: string): boolean {
  if (!ctype) return true;
  return /^(text\/|application\/(json|xml|xhtml|javascript|x-javascript|ld\+json|rss|atom|yaml|x-yaml|toml)|application\/[a-z.+-]*\+(json|xml))/.test(ctype) || ctype.includes('json') || ctype.includes('xml');
}

async function readBounded(res: Response, max: number): Promise<{ buf: Buffer; cut: boolean }> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max * 4) throw new Error(`response is ${declared} bytes, over the ${max}-byte limit`);
  if (!res.body) return { buf: Buffer.from(await res.arrayBuffer()).subarray(0, max), cut: false };
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  let cut = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const b = Buffer.from(value);
    if (size + b.length > max) {
      chunks.push(b.subarray(0, max - size));
      size = max;
      cut = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(b);
    size += b.length;
  }
  return { buf: Buffer.concat(chunks), cut };
}

/** Cut `text` to a slice starting at `offset` of at most `cap` characters, at a line end when one is near. */
export function sliceForContinuation(text: string, offset: number, cap: number): { output: string; nextOffset?: number } {
  const start = Math.min(Math.max(0, Math.floor(offset)), text.length);
  if (text.length - start <= cap) return { output: text.slice(start) };
  let end = start + cap;
  const nlAt = text.lastIndexOf('\n', end);
  if (nlAt > start + cap * 0.8) end = nlAt + 1;
  return { output: text.slice(start, end), nextOffset: end };
}

export function truncationNote(nextOffset: number): string {
  return `\n\n[output truncated; call again with offset=${nextOffset} to continue]`;
}

const CONVERT_TIMEOUT_MS = 5000;

export { htmlToMarkdown };

/**
 * Run the converter in a worker thread with a hard timeout (parse5 can still be
 * slow on adversarial pages; a worker can be killed, a synchronous call cannot).
 * Where the worker file is not beside this module (the one-file server bundle),
 * it runs in-process, still behind the size cap and the nesting pre-scan.
 */
/**
 * The converter worker beside this module: `htmlMarkdownWorker.js` next to
 * dist/server/netFetch.js in a build, `sequence-html-worker.cjs` next to the
 * one-file server bundle (review B: the bundle looked for the .js beside
 * itself, where it never is, so packaged builds always ran in-process).
 */
export function htmlWorkerFile(from: string = import.meta.url): string | null {
  for (const name of ['./htmlMarkdownWorker.js', './sequence-html-worker.cjs']) {
    try {
      const p = fileURLToPath(new URL(name, from));
      if (fs.existsSync(p)) return p;
    } catch {
      /* not a file URL */
    }
  }
  return null;
}

export async function convertHtml(
  html: string,
  opts: { baseUrl?: string; markup?: boolean },
  timeoutMs: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const capped = html.length > HTML_CAP ? html.slice(0, HTML_CAP) : html;
  const file = htmlWorkerFile();
  if (!file) return { ok: true, text: htmlToMarkdown(capped, opts) };
  return new Promise((resolve) => {
    let done = false;
    const worker = new Worker(file!, { workerData: { html: capped, opts } });
    const finish = (r: { ok: true; text: string } | { ok: false }): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false }), timeoutMs);
    worker.once('message', (text: string) => finish({ ok: true, text }));
    worker.once('error', () => {
      /* the worker could not run (not a timeout): do it here, behind the same guards */
      try {
        finish({ ok: true, text: htmlToMarkdown(capped, opts) });
      } catch {
        finish({ ok: false });
      }
    });
  });
}

export async function webFetch(rawUrl: string, opts: WebFetchOptions = {}): Promise<WebFetchResult> {
  const format = opts.format ?? 'markdown';
  const timeoutS = Math.min(WEB_MAX_TIMEOUT_S, Math.max(1, opts.timeout ?? WEB_DEFAULT_TIMEOUT_S));
  /* Only an explicit option bypasses the connect-time guard (a test seam); globalThis.fetch is never consulted. */
  const injected = opts.fetchImpl;
  const fetchImpl: FetchImpl = injected ?? nodeFetch;
  /* The real connection is guarded at connect time (nodeFetch); the pre-check resolves too, for a clear refusal before any socket. */
  const lookup = opts.lookup === undefined ? (injected ? undefined : defaultLookup) : (opts.lookup ?? undefined);
  const maxBytes = opts.maxBytes ?? WEB_MAX_BYTES;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutS * 1000);
  let current = rawUrl;
  try {
    let ua = BROWSER_UA;
    let retried = false;
    for (let hop = 0; hop <= MAX_REDIRECTS + 1; hop += 1) {
      const safe = await checkPublicUrl(current, lookup);
      if (!safe.ok) return { ok: false, url: current, error: safe.error };
      const res = await fetchImpl(safe.url.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'user-agent': ua, accept: ACCEPT[format], 'accept-language': 'en-US,en;q=0.9' },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        if (hop >= MAX_REDIRECTS) return { ok: false, url: current, status: res.status, error: `more than ${MAX_REDIRECTS} redirects` };
        current = new URL(res.headers.get('location')!, safe.url).toString();
        await res.body?.cancel().catch(() => undefined);
        continue;
      }
      if (res.status === 403 && res.headers.get('cf-mitigated') === 'challenge' && !retried) {
        retried = true;
        ua = ALT_UA;
        await res.body?.cancel().catch(() => undefined);
        hop -= 1;
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return { ok: false, url: safe.url.toString(), status: res.status, error: `HTTP ${res.status}` };
      }
      const contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (!textual(contentType)) {
        await res.body?.cancel().catch(() => undefined);
        return { ok: false, url: safe.url.toString(), status: res.status, error: `not a text page (${contentType}); only text, HTML, JSON and XML are fetched` };
      }
      const { buf, cut } = await readBounded(res, maxBytes);
      if (!contentType && buf.subarray(0, 1024).includes(0)) {
        return { ok: false, url: safe.url.toString(), status: res.status, error: 'not a text page (no content type, binary data)' };
      }
      const body = buf.toString('utf8');
      const isHtml = contentType.includes('html') || (!contentType && /^\s*<(!doctype|html)/i.test(body));
      const title = isHtml ? htmlTitle(body) : undefined;
      let full: string;
      if (format === 'html' || !isHtml) full = body;
      else {
        const conv = await convertHtml(body, { baseUrl: safe.url.toString(), markup: format === 'markdown' }, opts.convertTimeoutMs ?? CONVERT_TIMEOUT_MS);
        if (!conv.ok) {
          if (format === 'markdown') return { ok: false, url: safe.url.toString(), status: res.status, error: 'page too complex to convert; use format=text or html' };
          full = htmlToFlatText(body.length > HTML_CAP ? body.slice(0, HTML_CAP) : body);
        } else full = conv.text;
      }
      const offset = Math.max(0, Math.floor(opts.offset ?? 0));
      const { output, nextOffset } = sliceForContinuation(full, offset, opts.outputCap ?? WEB_OUTPUT_CAP);
      return {
        ok: true,
        url: safe.url.toString(),
        status: res.status,
        contentType,
        format,
        ...(title ? { title } : {}),
        output,
        offset,
        totalChars: full.length,
        ...(nextOffset !== undefined ? { nextOffset } : {}),
        ...(cut ? { downloadTruncated: true } : {}),
      };
    }
    return { ok: false, url: current, error: 'too many redirects' };
  } catch (e) {
    const name = (e as Error).name;
    return { ok: false, url: current, error: name === 'AbortError' ? `timed out after ${timeoutS}s` : (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/* ── web search (hosted Exa MCP, no key) ─────────────────────────────── */

export const EXA_MCP_URL = 'https://mcp.exa.ai/mcp';

export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
}

export type WebSearchResult = { ok: true; results: WebSearchHit[]; note?: string } | { ok: false; error: string };

/** The JSON-RPC message out of a plain JSON or `text/event-stream` body. */
function rpcMessage(body: string): { result?: { content?: { type?: string; text?: string }[]; isError?: boolean }; error?: { message?: string } } | null {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    try {
      const j = JSON.parse(line.slice(5).trim());
      if (j && typeof j === 'object') return j;
    } catch {
      /* next data line */
    }
  }
  return null;
}

/** Exa's text answer: blocks separated by `---`, each `Title:` / `URL:` / ... / `Highlights:` (or `Text:`). */
export function parseExaText(text: string): WebSearchHit[] {
  const hits: WebSearchHit[] = [];
  for (const block of text.split(/\n-{3,}\n/)) {
    const title = /^Title:\s*(.*)$/m.exec(block)?.[1]?.trim();
    const url = /^URL:\s*(\S+)/m.exec(block)?.[1];
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const body = /^(?:Highlights|Text|Summary):\s*\n?([\s\S]*)$/m.exec(block)?.[1] ?? '';
    const snippet = body.replace(/\s+/g, ' ').replace(/(?:\.\.\.\s*)+/g, '... ').trim().slice(0, 400);
    hits.push({ title: title && title !== 'N/A' ? title : url, url, snippet });
  }
  return hits;
}

export async function webSearch(
  query: string,
  opts: { numResults?: number; fetchImpl?: FetchImpl; timeout?: number } = {},
): Promise<WebSearchResult> {
  const q = query.trim();
  if (!q) return { ok: false, error: 'empty search query' };
  const n = Math.min(20, Math.max(1, Math.floor(opts.numResults ?? 8)));
  const fetchImpl: FetchImpl = opts.fetchImpl ?? ((i, init) => fetch(i, init));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), (opts.timeout ?? 25) * 1000);
  try {
    const res = await fetchImpl(EXA_MCP_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'web_search_exa', arguments: { query: q, type: 'auto', numResults: n, livecrawl: 'fallback', contextMaxCharacters: 10000 } },
      }),
    });
    if (!res.ok) return { ok: false, error: `search service answered HTTP ${res.status}; try again later or use web_fetch on a known URL` };
    const msg = rpcMessage(await res.text());
    if (!msg) return { ok: false, error: 'search service returned an unreadable answer' };
    if (msg.error) return { ok: false, error: `search service error: ${msg.error.message ?? 'unknown'}` };
    const text = (msg.result?.content ?? []).map((c) => (c.type === 'text' ? c.text ?? '' : '')).join('\n');
    if (msg.result?.isError) return { ok: false, error: `search service error: ${text.slice(0, 200)}` };
    const results = parseExaText(text).slice(0, n);
    return results.length > 0 ? { ok: true, results } : { ok: true, results: [], note: 'no results' };
  } catch (e) {
    const msg = (e as Error).name === 'AbortError' ? 'timed out' : (e as Error).message;
    return { ok: false, error: `web search is unreachable (${msg}); no results were invented` };
  } finally {
    clearTimeout(timer);
  }
}
