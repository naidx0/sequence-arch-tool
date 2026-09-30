/* ══════════════════════════════════════════════════════════════════════════
   THE MODEL ALREADY RUNNING ON THIS MACHINE
   packages/analyzer/src/server/localProviders.ts

   CLAUDE.md's second non-negotiable: "Local-first: the app boots and delivers
   its core with no network and no key."

   THE ENGINE HONOURS IT AND THE PRODUCT DOES NOT SAY SO. Measured on
   2026-08-23: a full grounded answer ran against a 6.9B model on localhost with
   no key and no network — `395 nodes, 743 edges in 1.5s · coverage 143/743
   edges`. Meanwhile the shipped config points at an undeployed gateway, and the
   first failure a new reader meets is a form asking for an API key. We ask
   people to pay their way into something already running on their machine.

   ── WHAT THIS DOES AND WHAT IT REFUSES TO DO ────────────────────────────

   It asks two well-known localhost ports whether they are there, and reports
   what they said. That is all.

   It does NOT configure anything. Choosing which model answers is the reader's
   decision and it is persisted; a server that reached out and set it because it
   found something would be making a choice on their behalf and charging them
   the surprise later. The detection is an OFFER, and the offer is presented by
   Settings.

   It does NOT invent a name. Every model listed here came back from the
   endpoint; a provider that answers with an empty list is reported as present
   with no models rather than as absent, because "LM Studio is running and has
   nothing loaded" is a different thing to fix from "LM Studio is not running".

   THE PROBE IS LOCALHOST-ONLY, and that is a security property rather than a
   convenience. Both URLs are literals on 127.0.0.1. There is no configuration
   that widens them, so this cannot become a way to make the server fetch an
   arbitrary host on a client's say-so.
   ══════════════════════════════════════════════════════════════════════════ */

/** One place a local model server is conventionally reachable. */
export interface LocalProbe {
  /** How a person recognises it. */
  name: string;
  /** The OpenAI-compatible base a provider config would use. */
  baseUrl: string;
}

/**
 * The two that exist, both on 127.0.0.1 and both OpenAI-compatible.
 *
 * Literals, deliberately — see the header. A list a caller could extend is a
 * server-side request forgery with a configuration file in front of it.
 */
export const LOCAL_PROBES: readonly LocalProbe[] = [
  { name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1' },
  { name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1' },
];

export interface LocalProvider {
  name: string;
  baseUrl: string;
  /** Model ids it reported, in the order it reported them. Possibly empty. */
  models: string[];
}

/** How long to wait before deciding nothing is there. */
export const LOCAL_PROBE_TIMEOUT_MS = 1_200;

/** A localhost process does not get an unbounded response allocation. */
export const LOCAL_PROBE_MAX_RESPONSE_BYTES = 256 * 1024;

/** Settings renders one choice per model, so a probe cannot create an unbounded list. */
export const LOCAL_PROBE_MAX_MODELS = 100;

/** Refuse pathological ids rather than truncating one into a model that does not exist. */
export const LOCAL_PROBE_MAX_MODEL_ID_CHARS = 256;

/** Polling clients reuse one recent machine inventory. */
export const LOCAL_PROBE_CACHE_TTL_MS = 10_000;

/**
 * Parse `GET /v1/models`.
 *
 * TOTAL, AND SILENT ON ANYTHING UNEXPECTED. Something else may be listening on
 * that port — this runs on a developer's machine, where 1234 is a port people
 * use. A body that is not a model list means "not one of these", not an error
 * worth showing anybody.
 */
export function modelsFrom(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const out: string[] = [];
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null) continue;
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== 'string' || id === '' || id.length > LOCAL_PROBE_MAX_MODEL_ID_CHARS) continue;
    out.push(id);
    if (out.length >= LOCAL_PROBE_MAX_MODELS) break;
  }
  return out;
}

/** Read a fetch body without trusting either Content-Length or stream length. */
async function cappedResponseText(response: Response): Promise<string | null> {
  const claimedLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(claimedLength) && claimedLength > LOCAL_PROBE_MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }

  if (!response.body) {
    const text = await response.text();
    return Buffer.byteLength(text, 'utf8') <= LOCAL_PROBE_MAX_RESPONSE_BYTES ? text : null;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > LOCAL_PROBE_MAX_RESPONSE_BYTES) {
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

/**
 * Ask one probe whether it is there.
 *
 * `null` means nothing usable answered. It never throws: a refused connection
 * is the ORDINARY case — most machines run neither of these — and an exception
 * for the ordinary case would make every caller wrap it.
 */
export async function probeLocal(
  probe: LocalProbe,
  fetchImpl: typeof fetch,
  timeoutMs = LOCAL_PROBE_TIMEOUT_MS,
): Promise<LocalProvider | null> {
  const controller = new AbortController();

  /*
   * THE TIMEOUT IS A RACE, NOT ONLY A SIGNAL — and the difference is not
   * theoretical. The first cut passed `controller.signal` and awaited the
   * fetch, which trusts the transport to honour an abort. A transport that
   * does not simply never settles, and the await never returns.
   *
   * That is exactly the trap this repository's own list names: "A hang is
   * worse than a failure — CI reads it as an infrastructure timeout, so a red
   * test becomes invisible." It cost a 600-second test run to rediscover.
   *
   * The signal is still sent, because a real fetch honours it and stopping the
   * socket is better than abandoning it. The race is what makes the deadline
   * a guarantee rather than a request.
   */
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetchImpl(`${probe.baseUrl}/models`, { signal: controller.signal, redirect: 'manual' }),
      deadline,
    ]);
    if (response === null) return null;
    if (!response.ok) return null;
    const text = await Promise.race([cappedResponseText(response), deadline]);
    if (text === null) return null;
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      /* Something is listening and it is not this. */
      return null;
    }
    /*
     * PRESENT WITH NO MODELS IS A REAL ANSWER. "Ollama is running and has
     * nothing pulled" is a different thing for the reader to fix from "Ollama
     * is not running", and collapsing them into absence would hide the one
     * they can act on in thirty seconds.
     */
    if (typeof body !== 'object' || body === null || !Array.isArray((body as { data?: unknown }).data)) {
      return null;
    }
    return { name: probe.name, baseUrl: probe.baseUrl, models: modelsFrom(body) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Everything answering locally, in probe order.
 *
 * CONCURRENT, because the common answer is that neither is there and two
 * sequential timeouts would be two and a half seconds of a reader waiting to be
 * told nothing.
 */
export async function detectLocalProviders(
  fetchImpl: typeof fetch = globalThis.fetch,
  timeoutMs = LOCAL_PROBE_TIMEOUT_MS,
): Promise<LocalProvider[]> {
  let byTimeout = detectionCache.get(fetchImpl);
  if (!byTimeout) {
    byTimeout = new Map();
    detectionCache.set(fetchImpl, byTimeout);
  }

  const cached = byTimeout.get(timeoutMs);
  if (cached?.value && cached.expiresAt > Date.now()) return cloneProviders(cached.value);
  if (cached?.pending) return cloneProviders(await cached.pending);

  const pending = Promise.all(LOCAL_PROBES.map((p) => probeLocal(p, fetchImpl, timeoutMs)))
    .then((found) => found.filter((f): f is LocalProvider => f !== null));
  byTimeout.set(timeoutMs, { expiresAt: 0, pending });

  const found = await pending;
  byTimeout.set(timeoutMs, {
    expiresAt: Date.now() + LOCAL_PROBE_CACHE_TTL_MS,
    value: cloneProviders(found),
  });
  return cloneProviders(found);
}

interface DetectionCacheEntry {
  expiresAt: number;
  value?: LocalProvider[];
  pending?: Promise<LocalProvider[]>;
}

const detectionCache = new WeakMap<typeof fetch, Map<number, DetectionCacheEntry>>();

function cloneProviders(providers: LocalProvider[]): LocalProvider[] {
  return providers.map((provider) => ({ ...provider, models: [...provider.models] }));
}

/* ══════════════════════════════════════════════════════════════════════════
   HOW BIG IS THE WINDOW THE ANSWER HAS TO FIT IN

   Max, 2026-08-24: "I can see many tokens were used, but I can't see my
   context window."

   The product could not tell him, and inventing a number was never an option -
   grounded-not-guessed is the first non-negotiable, and a made-up ceiling is
   exactly the kind of confident wrong figure this product exists to catch in
   other tools. So it asks the only party that knows.

   OLLAMA-SPECIFIC ON PURPOSE. `/api/show` is Ollama's own route, not part of
   the OpenAI-compatible surface, and it answers with the real number the model
   was built with — `granitehybrid.context_length = 1048576` for the model this
   machine runs. LM Studio has no equivalent, so it reports nothing and the UI
   says nothing: a limit we cannot read is a limit we do not draw.

   Every guard the models probe earned applies here for the same reasons, and
   they are not decoration: a loopback LITERAL derived from the probe list
   rather than from a caller's baseUrl (a list a caller could extend is a
   server-side request forgery with a configuration file in front of it),
   `redirect: 'manual'` because a followed redirect leaves localhost, the byte
   cap, and a RACED deadline rather than a bare abort signal — trusting the
   signal alone is what hung a probe for 600 seconds.
   ══════════════════════════════════════════════════════════════════════════ */

/** The largest context a model could sanely claim. Beyond this the answer is not a number we trust. */
export const LOCAL_CONTEXT_MAX_TOKENS = 100_000_000;

/**
 * Read `<arch>.context_length` out of an Ollama `/api/show` body.
 *
 * The key is prefixed with the architecture (`granitehybrid.`, `llama.`, …), so
 * it is found by suffix rather than by a list of architectures nobody can keep
 * complete. PURE, and total: anything that is not a positive integer inside the
 * sane range is "unknown", never a guess.
 *
 * ⚠ THIS IS THE TRAINED CEILING, NEVER THE EFFECTIVE WINDOW. `model_info` is
 * GGUF architecture metadata: what the weights support, not what the server will
 * run. Measured 2026-09-04 on this machine:
 *
 *     granite42-hermes   ceiling 131072    actually running   65536   (2x)
 *     granite4.2:3b      ceiling 131072    server default      4096   (32x)
 *     granite-bench      ceiling 1048576   Modelfile says     16384   (64x)
 *
 * So it must NEVER decide whether a prompt fits — it answers "yes" most
 * confidently in exactly the case that truncates. Use {@link effectiveContextFrom}
 * for that. This one is for display: "the model can go up to N".
 */
export function contextLengthFrom(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  const info = (body as { model_info?: unknown }).model_info;
  if (!info || typeof info !== 'object') return null;
  for (const [key, value] of Object.entries(info as Record<string, unknown>)) {
    if (!key.endsWith('.context_length') && key !== 'context_length') continue;
    if (typeof value !== 'number' || !Number.isInteger(value)) continue;
    if (value <= 0 || value > LOCAL_CONTEXT_MAX_TOKENS) continue;
    return value;
  }
  return null;
}

/**
 * The window the server will ACTUALLY run, read from the same `/api/show` body.
 *
 * Ollama's `parameters` block is the Modelfile, and the Modelfile's `num_ctx` is
 * the value the server honours — verified against the loaded slot: a model whose
 * parameters say 65536 reports `context_length: 65536` in `/api/ps`, exactly.
 *
 * THREE STATES, AND THE THIRD IS THE POINT:
 *
 *   a number   the Modelfile sets num_ctx, and that IS the effective window.
 *   null       no Modelfile num_ctx, so the SERVER DEFAULT applies — and
 *              `/api/show` does not report it. Unknowable from this endpoint.
 *   null       body unreadable. Same answer for a different reason; the caller
 *              cannot act differently on them, so they are not distinguished.
 *
 * The absent case is not a gap in this parser, it is the finding. It is the
 * shape that truncates: stock `granite4.2:3b` bakes no num_ctx, the running
 * server's OLLAMA_CONTEXT_LENGTH is 4096, and a 24,000-token prompt becomes
 * 4,096 at HTTP 200 with every downstream honesty field still reporting the full
 * denominator. A caller that cannot establish the window must SAY it could not —
 * the same move as `unverifiable` on the premise check — rather than emitting a
 * scope line whose denominator it no longer believes.
 *
 * PURE, and total, like its sibling. `parameters` is a plain text block, one
 * `key<whitespace>value` per line, so it is parsed rather than JSON-decoded.
 */
export function effectiveContextFrom(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  const params = (body as { parameters?: unknown }).parameters;
  if (typeof params !== 'string') return null;
  for (const line of params.split(/\r?\n/)) {
    const m = /^\s*num_ctx\s+(\d+)\s*$/.exec(line);
    if (!m) continue;
    const value = Number(m[1]);
    if (!Number.isInteger(value) || value <= 0 || value > LOCAL_CONTEXT_MAX_TOKENS) continue;
    return value;
  }
  return null;
}

/**
 * Ask a local Ollama how big `model`'s window is. `null` means "we do not know",
 * which the surface must render as silence rather than as a number.
 */
/**
 * Does this config point at the local Ollama, however the user spelled it?
 *
 * MATCHES BY MEANING, RETURNS THE LITERAL. The caller's string is parsed and
 * compared on host / port / path; what comes back is the entry from
 * {@link LOCAL_PROBES}, whose `baseUrl` is the hardcoded loopback address every
 * fetch is actually made against. So the security property is untouched — no
 * caller-supplied origin ever reaches a request — while the four spellings that
 * mean the same machine stop being four different answers.
 *
 * WHY THIS IS NOT COSMETIC. The first cut compared `p.baseUrl === baseUrl`,
 * exactly. It worked only because the shipped config happened to match the
 * probe table character for character, and every one of these turned the whole
 * context-fit planner OFF with no signal anywhere:
 *
 *     http://localhost:11434/v1     the single most natural thing to type
 *     http://127.0.0.1:11434/v1/    a trailing slash
 *     http://127.0.0.1:11434        no /v1, which provider.ts already joins
 *     HTTP://127.0.0.1:11434/V1     case
 *
 * The failure mode is the absence-of-a-signal law in its purest form: the
 * planner does not refuse, does not report `unknown`, does not exist. The user
 * gets silent truncation at HTTP 200 with a config that reads as correct.
 *
 * Loopback only, and only 11434. A non-loopback host is not "Ollama spelled
 * differently", it is somewhere else.
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function matchLocalOllama(baseUrl: string | undefined): LocalProbe | undefined {
  if (typeof baseUrl !== 'string' || baseUrl.trim() === '') return undefined;
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) return undefined;
  if (url.port !== '11434') return undefined;
  /* `/v1`, `/v1/`, `/` or empty all name the same endpoint — provider.ts joins
     `/v1` itself when it is absent. Anything else is a different service. */
  const path = url.pathname.replace(/\/+$/, '').toLowerCase();
  if (path !== '' && path !== '/v1') return undefined;
  return LOCAL_PROBES.find((p) => p.name === 'Ollama');
}

async function showBody(
  baseUrl: string,
  model: string,
  fetchImpl: typeof fetch,
  timeoutMs = LOCAL_PROBE_TIMEOUT_MS,
): Promise<unknown | null> {
  /* The origin comes from the KNOWN PROBE LIST, not from the caller's baseUrl.
     `matchLocalOllama` compares by MEANING and returns the LITERAL, so a user who
     typed `localhost` is recognised while the address fetched is still the
     hardcoded one — which is what keeps this from becoming a request forgery
     with a config file in front of it. */
  const probe = matchLocalOllama(baseUrl);
  if (!probe || model.trim() === '') return null;
  const origin = probe.baseUrl.replace(/\/v1$/, '');

  const controller = new AbortController();
  const deadline = new Promise<null>((resolve) => {
    const timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
    if (typeof timer === 'object' && timer && 'unref' in timer) timer.unref();
  });

  try {
    const response = await Promise.race([
      fetchImpl(`${origin}/api/show`, {
        method: 'POST',
        signal: controller.signal,
        redirect: 'manual',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model }),
      }),
      deadline,
    ]);
    if (!response || !response.ok) return null;
    const text = await Promise.race([cappedResponseText(response), deadline]);
    if (text === null) return null;
    return JSON.parse(text) as unknown;
  } catch {
    /* Unreachable, aborted, or not JSON. All of them mean the same thing to the
       reader, and it is not a number. */
    return null;
  } finally {
    controller.abort();
  }
}

/**
 * Ask a local Ollama how big `model`'s window is. `null` means "we do not know",
 * which the surface must render as silence rather than as a number.
 *
 * ⚠ THE TRAINED CEILING. See {@link contextLengthFrom}: this is for display, and
 * it must never decide whether a prompt fits. {@link probeEffectiveContext} is
 * the one for that.
 */
export async function probeContextWindow(
  baseUrl: string,
  model: string,
  fetchImpl: typeof fetch,
  timeoutMs = LOCAL_PROBE_TIMEOUT_MS,
): Promise<number | null> {
  const body = await showBody(baseUrl, model, fetchImpl, timeoutMs);
  return body === null ? null : contextLengthFrom(body);
}

/**
 * The window the server will ACTUALLY run for `model` — the Modelfile `num_ctx`.
 *
 * `null` is a real and important answer: no Modelfile `num_ctx` means the server
 * default applies and `/api/show` does not report it, which is precisely the
 * configuration that truncates silently. A caller must treat null as "unknown"
 * and say so, never as "fine". See {@link effectiveContextFrom}.
 */
export async function probeEffectiveContext(
  baseUrl: string,
  model: string,
  fetchImpl: typeof fetch,
  timeoutMs = LOCAL_PROBE_TIMEOUT_MS,
): Promise<number | null> {
  const body = await showBody(baseUrl, model, fetchImpl, timeoutMs);
  return body === null ? null : effectiveContextFrom(body);
}

/** True when this config points at the local Ollama the probes know about. */
export function isLocalOllama(provider: string, baseUrl: string | undefined): boolean {
  return provider === 'openai-compatible' && matchLocalOllama(baseUrl) !== undefined;
}
