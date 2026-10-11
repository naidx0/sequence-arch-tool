/**
 * The model list a saved profile's own provider reports:
 *
 *   GET /api/ai-models[?profile=<id>][&refresh=1]
 *     -> { ok: true,  models: string[], source: 'ollama' | 'openai' | 'anthropic', cached: boolean }
 *      | { ok: false, reason: string }
 *
 * Ollama answers `GET /api/tags`; OpenAI, LM Studio, OpenRouter and other OpenAI-compatible
 * servers answer `GET /v1/models`; Anthropic answers `GET /v1/models` with the saved key.
 *
 * THE KEY NEVER LEAVES THIS PROCESS. It is read from the saved config, sent to the provider the
 * profile already points at, and appears in no response, reason or log line. Every failure is ONE
 * sentence the panel can print as it is; nothing here hangs (4 s deadline, raced, not only signalled).
 */

import crypto from 'node:crypto';
import type http from 'node:http';
import type { AiConfig, AiProfile } from './provider.js';
import { probeContextWindow } from './localProviders.js';
import { isOriginAllowed } from './terminal.js';

export const MODEL_LIST_TIMEOUT_MS = 4_000;
export const MODEL_LIST_TTL_MS = 60_000;
export const MODEL_LIST_MAX_BYTES = 2 * 1024 * 1024;
export const MODEL_LIST_MAX_MODELS = 1_000;
const MAX_ID_CHARS = 256;

export type ModelListResult =
  | { ok: true; models: string[]; source: 'ollama' | 'openai' | 'anthropic'; cached: boolean; /** Present only when the provider listed more than were kept. */ total?: number }
  | { ok: false; reason: string };

export interface ModelListTarget {
  provider: 'anthropic' | 'openai-compatible';
  baseUrl?: string;
  apiKey?: string;
}

interface Hit {
  at: number;
  models: string[];
  source: 'ollama' | 'openai' | 'anthropic';
  total?: number;
}

export class ModelListService {
  private readonly cache = new Map<string, Hit>();
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly timeoutMs: number = MODEL_LIST_TIMEOUT_MS,
  ) {}

  async list(target: ModelListTarget, refresh = false): Promise<ModelListResult> {
    const base = (target.baseUrl ?? '').trim().replace(/\/+$/, '');
    /* The key is part of the cache identity (as a hash), so a new key never reads the old key's list. */
    const keyTag = target.apiKey ? crypto.createHash('sha256').update(target.apiKey).digest('hex').slice(0, 12) : '';
    const id = `${target.provider}|${base}|${keyTag}`;
    const hit = this.cache.get(id);
    if (!refresh && hit && this.now() - hit.at < MODEL_LIST_TTL_MS) {
      return { ok: true, models: hit.models, source: hit.source, cached: true, ...(hit.total !== undefined ? { total: hit.total } : {}) };
    }
    /* ONE deadline for the whole refresh, whatever number of requests it takes. */
    const fresh = await this.fetchFresh(target, base, Date.now() + this.timeoutMs);
    if (!fresh.ok) return { ok: false, reason: fresh.reason };
    if (fresh.ok) this.cache.set(id, { at: this.now(), models: fresh.models, source: fresh.source, ...(fresh.total !== undefined ? { total: fresh.total } : {}) });
    return fresh;
  }

  private async fetchFresh(target: ModelListTarget, base: string, until: number): Promise<ModelListResult> {
    if (target.provider === 'anthropic') {
      if (!target.apiKey) return { ok: false, reason: 'No API key is saved for this model, so Anthropic cannot list its models.' };
      const root = (base || 'https://api.anthropic.com').replace(/\/v1$/, '');
      const body = await this.get(`${root}/v1/models?limit=1000`, {
        'x-api-key': target.apiKey,
        'anthropic-version': '2023-06-01',
      }, until);
      if (!body.ok) return body;
      const models = idsFrom(body.json, 'data');
      return models.length > 0
        ? { ok: true, models, source: 'anthropic', cached: false, ...totalOf(body.json, 'data', models) }
        : { ok: false, reason: 'Anthropic answered with no models.' };
    }

    if (base === '') return { ok: false, reason: 'This model has no base URL, so there is no server to ask.' };
    const headers: Record<string, string> = target.apiKey ? { authorization: `Bearer ${target.apiKey}` } : {};

    if (isLoopback(base)) {
      /* Ollama first: its own listing is the fuller one. A server that is not Ollama 404s this quickly. */
      const origin = base.replace(/\/v\d+$/, '');
      const tags = await this.get(`${origin}/api/tags`, headers, until);
      /* A server that did not answer in time will not answer the second question either. */
      if (!tags.ok && tags.timedOut) return tags;
      if (tags.ok) {
        const models = idsFrom(tags.json, 'models', 'name');
        if (models.length > 0) return { ok: true, models, source: 'ollama', cached: false, ...totalOf(tags.json, 'models', models) };
        if (Array.isArray((tags.json as { models?: unknown } | null)?.models)) {
          return { ok: false, reason: 'Ollama is running with no models pulled. Run `ollama pull <model-name>`.' };
        }
      }
    }
    const url = /\/v\d+$/.test(base) ? `${base}/models` : `${base}/v1/models`;
    const body = await this.get(url, headers, until);
    if (!body.ok) return body;
    const models = idsFrom(body.json, 'data');
    return models.length > 0
      ? { ok: true, models, source: 'openai', cached: false, ...totalOf(body.json, 'data', models) }
      : { ok: false, reason: 'The server answered with no models.' };
  }

  /** One bounded GET. Never throws, never leaks the key into the reason. */
  private async get(
    url: string,
    headers: Record<string, string>,
    until: number,
  ): Promise<{ ok: true; json: unknown } | { ok: false; reason: string; timedOut?: true }> {
    const budget = Math.max(1, until - Date.now());
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve('timeout');
      }, budget);
    });
    let host = 'the server';
    try {
      host = new URL(url).host;
    } catch {
      return { ok: false, reason: 'The base URL is not a valid address.' };
    }
    try {
      const res = await Promise.race([
        this.fetchImpl(url, { headers: { accept: 'application/json', ...headers }, signal: controller.signal, redirect: 'manual' }),
        deadline,
      ]);
      if (res === 'timeout') return { ok: false, reason: `${host} did not answer within ${Math.round(this.timeoutMs / 1000)} seconds.`, timedOut: true };
      if (res.status === 401 || res.status === 403) return { ok: false, reason: `${host} refused the saved key (${res.status}).` };
      if (res.status >= 300 && res.status < 400) return { ok: false, reason: `${host} redirected the request, which is not followed.` };
      if (res.status === 404) return { ok: false, reason: `${host} does not list its models (404).` };
      if (!res.ok) return { ok: false, reason: `${host} answered ${res.status}.` };
      const text = await Promise.race([capped(res), deadline]);
      if (text === 'timeout') return { ok: false, reason: `${host} did not finish answering within ${Math.round(this.timeoutMs / 1000)} seconds.`, timedOut: true };
      if (text === null) return { ok: false, reason: `${host} sent a model list that is too large to read.` };
      try {
        return { ok: true, json: JSON.parse(text) };
      } catch {
        return { ok: false, reason: `${host} did not answer with a model list.` };
      }
    } catch {
      return { ok: false, reason: `Could not reach ${host}.` };
    } finally {
      clearTimeout(timer);
    }
  }
}

async function capped(res: Response): Promise<string | null> {
  const claimed = Number(res.headers.get('content-length'));
  if (Number.isFinite(claimed) && claimed > MODEL_LIST_MAX_BYTES) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!res.body) {
    const t = await res.text();
    return Buffer.byteLength(t) <= MODEL_LIST_MAX_BYTES ? t : null;
  }
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MODEL_LIST_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

/** Ids from `{ [listKey]: [{ [idKey]: string }] }`: total, deduplicated, bounded. */
export function idsFrom(body: unknown, listKey: string, idKey = 'id'): string[] {
  const list = (body as Record<string, unknown> | null)?.[listKey];
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  for (const e of list) {
    const v = (e as Record<string, unknown> | null)?.[idKey];
    if (typeof v === 'string' && v !== '' && v.length <= MAX_ID_CHARS) seen.add(v);
    if (seen.size >= MODEL_LIST_MAX_MODELS) break;
  }
  return [...seen];
}

/** `{ total }` when the provider listed more entries than were kept (the cap), else nothing. */
function totalOf(body: unknown, listKey: string, kept: string[]): { total?: number } {
  const list = (body as Record<string, unknown> | null)?.[listKey];
  return Array.isArray(list) && list.length > kept.length && kept.length >= MODEL_LIST_MAX_MODELS ? { total: list.length } : {};
}

function isLoopback(base: string): boolean {
  try {
    const h = new URL(base).hostname;
    return h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1';
  } catch {
    return false;
  }
}

/** Which saved model is meant: the named profile, else the one answering now. */
export function targetFor(cfg: AiConfig | undefined, profileId: string | null): ModelListTarget | null {
  if (!cfg) return null;
  const profiles: AiProfile[] = cfg.profiles ?? [];
  if (profileId !== null && profileId !== '') {
    const p = profiles.find((x) => x.id === profileId);
    if (!p) return null;
    return { provider: p.provider, ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}), ...(p.apiKey ? { apiKey: p.apiKey } : {}) };
  }
  return { provider: cfg.provider, ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}), ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}) };
}

export interface ModelListRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  method: string;
  authOn: boolean;
  loadConfig: () => AiConfig | undefined;
  service?: ModelListService;
}

let shared: ModelListService | null = null;

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

/** Handle `GET /api/ai-models`. Returns false when the path is not ours. */
export async function handleModelListRoute(ctx: ModelListRouteContext): Promise<boolean> {
  if (ctx.url.pathname !== '/api/ai-models' || ctx.method !== 'GET') return false;
  if (ctx.authOn || !isOriginAllowed(ctx.req)) {
    send(ctx.res, 403, { ok: false, reason: 'Model lists are fetched on this machine only.' });
    return true;
  }
  const target = targetFor(ctx.loadConfig(), ctx.url.searchParams.get('profile'));
  if (!target) {
    send(ctx.res, 200, { ok: false, reason: 'That saved model was not found.' });
    return true;
  }
  shared ??= new ModelListService();
  const out = await (ctx.service ?? shared).list(target, ctx.url.searchParams.get('refresh') === '1');
  send(ctx.res, 200, out);
  return true;
}

/* ── the context window, without holding the config read hostage ──────────
 *
 * `GET /api/ai-config` used to await Ollama's `/api/show` before answering. That call takes as long as
 * the model takes to load (measured 0.9 s on a fake that sleeps 0.9 s), and Settings, the model menu and
 * the composer all wait on this one read. Now: a value seen in the last minute is answered at once (an older
 * one too, while a refresh runs behind it), and a first look waits at most `waitMs` before answering "unknown"
 * and finishing the probe for the next read.
 */
interface CtxEntry {
  value: number | null;
  at: number;
  pending: Promise<void> | null;
}
const ctxCache = new Map<string, CtxEntry>();
export const CONTEXT_FRESH_MS = 60_000;
export const CONTEXT_FIRST_WAIT_MS = 250;

export function resetContextWindowCache(): void {
  ctxCache.clear();
}

export async function contextWindowFast(
  baseUrl: string,
  model: string,
  fetchImpl: typeof fetch,
  probe: (b: string, m: string, f: typeof fetch) => Promise<number | null> = probeContextWindow,
  now: () => number = Date.now,
  waitMs: number = CONTEXT_FIRST_WAIT_MS,
): Promise<number | null> {
  const key = `${baseUrl}|${model}`;
  let e = ctxCache.get(key);
  if (!e) {
    e = { value: null, at: -Infinity, pending: null };
    ctxCache.set(key, e);
  }
  const entry = e;
  if (entry.pending === null && now() - entry.at >= CONTEXT_FRESH_MS) {
    entry.pending = probe(baseUrl, model, fetchImpl)
      .then((v) => {
        entry.value = v;
        entry.at = now();
      })
      .catch(() => {
        entry.at = now();
      })
      .finally(() => {
        entry.pending = null;
      });
  }
  if (entry.at === -Infinity && entry.pending) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([entry.pending, new Promise<void>((r) => (timer = setTimeout(r, waitMs)))]);
    clearTimeout(timer);
  }
  return entry.value;
}
