/**
 * The gateway request handler.
 *
 * Security invariants (the whole point of this service):
 *   - The funded `OPENROUTER_API_KEY` is attached ONLY to the downstream request
 *     to OpenRouter. It is never returned to a caller, never placed in a log,
 *     and never echoed in an error body.
 *   - Caller `Authorization` headers and the caller-token allowlist are likewise
 *     never logged or returned.
 *   - Only `model` + `messages` (+ our server `max_tokens`) are forwarded
 *     downstream; every other client field is dropped.
 *   - Logs carry only method, path, status, model, and byte sizes.
 */
import http from 'node:http';
import { currentMonthYear, remapModel, type GatewayConfig } from './config.js';
import type { SpendStore } from './store.js';
import type { RateLimiter } from './rateLimit.js';

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export const consoleLogger: Logger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};

export interface GatewayDeps {
  config: GatewayConfig;
  store: SpendStore;
  /** Injected so tests never hit the network. Defaults to global `fetch`. */
  fetch?: typeof fetch;
  rateLimiter: RateLimiter;
  now?: () => Date;
  logger?: Logger;
}

interface ResolvedDeps extends Required<Omit<GatewayDeps, 'fetch'>> {
  fetch: typeof fetch;
}

function resolve(deps: GatewayDeps): ResolvedDeps {
  return {
    config: deps.config,
    store: deps.store,
    fetch: deps.fetch ?? fetch,
    rateLimiter: deps.rateLimiter,
    now: deps.now ?? (() => new Date()),
    logger: deps.logger ?? consoleLogger,
  };
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('content-length', String(payload.length));
  res.end(payload);
}

/** Send raw upstream bytes back verbatim, preserving status + content-type. */
function sendRaw(res: http.ServerResponse, status: number, contentType: string, bytes: Buffer): void {
  res.statusCode = status;
  res.setHeader('content-type', contentType);
  res.setHeader('content-length', String(bytes.length));
  res.end(bytes);
}

/** Read the request body, aborting with a flag if it exceeds `cap` bytes. */
function readBody(req: http.IncomingMessage, cap: number): Promise<{ bytes: Buffer; tooLarge: boolean }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (bytes: Buffer, tooLarge: boolean) => {
      if (settled) return;
      settled = true;
      resolve({ bytes, tooLarge });
    };
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total > cap) {
        finish(Buffer.alloc(0), true);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => finish(Buffer.concat(chunks), false));
    req.on('error', () => finish(Buffer.concat(chunks), false));
  });
}

/** Read an upstream `Response` body, capping the buffered size. */
async function readCapped(res: Response, cap: number): Promise<{ bytes: Buffer; tooLarge: boolean }> {
  const reader = res.body?.getReader?.();
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { bytes: buf, tooLarge: buf.length > cap };
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > cap) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        return { bytes: Buffer.alloc(0), tooLarge: true };
      }
      chunks.push(Buffer.from(value));
    }
  }
  return { bytes: Buffer.concat(chunks), tooLarge: false };
}

/** Extract the bearer token from an Authorization header, or null. */
function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}

/**
 * Handle `POST /v1/chat/completions`. Returns nothing; writes the response.
 * All error paths return an OpenAI-ish `{error:{message}}` so the client renders
 * any non-2xx as its "add your key" nudge.
 */
async function handleChat(req: http.IncomingMessage, res: http.ServerResponse, d: ResolvedDeps): Promise<void> {
  const { config, store, logger } = d;

  // 0. Misconfiguration ⇒ 500, but never crash-loop: the process stays up.
  if (!config.openrouterApiKey) {
    logger.error('gateway misconfigured: OPENROUTER_API_KEY is not set');
    sendJson(res, 500, { error: { message: 'gateway misconfigured' } });
    return;
  }

  // 1. Caller auth (authenticate the APP, never a user secret).
  const token = bearerToken(req.headers['authorization']);
  if (config.callerTokens !== null) {
    if (!token || !config.callerTokens.includes(token)) {
      sendJson(res, 401, { error: { message: 'unauthorized' } });
      return;
    }
  }

  // 2. Abuse rate-limit (best-effort, per-instance).
  const rlKey = token ?? 'anonymous';
  if (!d.rateLimiter.allow(rlKey)) {
    sendJson(res, 429, { error: { message: 'rate limit exceeded — slow down' } });
    return;
  }

  // 3. Body: byte cap ⇒ 413, then parse + validate.
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > config.maxRequestBytes) {
    sendJson(res, 413, { error: { message: 'request body too large' } });
    return;
  }
  const { bytes, tooLarge } = await readBody(req, config.maxRequestBytes);
  if (tooLarge) {
    sendJson(res, 413, { error: { message: 'request body too large' } });
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    sendJson(res, 400, { error: { message: 'invalid JSON body' } });
    return;
  }
  const body = parsed as Record<string, unknown>;
  if (!body || !Array.isArray(body.messages)) {
    sendJson(res, 400, { error: { message: 'missing required field: messages[]' } });
    return;
  }

  // 4. Global spend backstop (authoritative). At/over ⇒ 402.
  const monthYear = currentMonthYear(d.now());
  const spend = store.read(monthYear);
  if (spend >= config.globalSpendBackstopUsd) {
    sendJson(res, 402, { error: { message: 'free tier exhausted — add your own key' } });
    return;
  }

  // 5. Build the downstream request: model remap + strip everything unknown +
  //    impose the server token cap. Only these three fields go out.
  const model = remapModel(body.model, config);
  const downstreamBody = JSON.stringify({
    model,
    messages: body.messages,
    max_tokens: config.serverMaxTokens,
  });
  const downstreamHeaders: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${config.openrouterApiKey}`,
  };
  if (config.httpReferer) downstreamHeaders['HTTP-Referer'] = config.httpReferer;
  if (config.xTitle) downstreamHeaders['X-Title'] = config.xTitle;

  const reqBytes = Buffer.byteLength(downstreamBody);
  let upstream: Response;
  try {
    upstream = await d.fetch(`${config.openrouterBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: downstreamHeaders,
      body: downstreamBody,
    });
  } catch (e) {
    // Network/fetch errors cannot contain our request headers; surface reason only.
    logger.error(`upstream fetch failed model=${model} reqBytes=${reqBytes} err=${(e as Error).message}`);
    sendJson(res, 502, { error: { message: 'upstream request failed' } });
    return;
  }

  const { bytes: upBytes, tooLarge: upTooLarge } = await readCapped(upstream, config.maxResponseBytes);
  if (upTooLarge) {
    logger.error(`upstream response exceeded cap model=${model} status=${upstream.status}`);
    sendJson(res, 502, { error: { message: 'upstream response too large' } });
    return;
  }

  if (upstream.ok) {
    // Success ⇒ meter the global counter, then return the OpenAI body VERBATIM.
    store.add(monthYear, config.estCostPerCall);
    logger.info(
      `proxied model=${model} status=${upstream.status} reqBytes=${reqBytes} respBytes=${upBytes.length} spend=${store.read(monthYear).toFixed(4)}`
    );
    sendRaw(res, upstream.status, upstream.headers.get('content-type') ?? 'application/json', upBytes);
    return;
  }

  // Upstream error: map 5xx→502, pass 4xx through, and return a SANITIZED error
  // (never the raw upstream body — belt-and-braces so nothing can leak).
  const outStatus = upstream.status >= 500 ? 502 : upstream.status;
  logger.warn(`upstream non-2xx model=${model} upstreamStatus=${upstream.status} mappedStatus=${outStatus}`);
  sendJson(res, outStatus, { error: { message: 'upstream error', upstreamStatus: upstream.status } });
}

/** Build the `(req,res)` listener implementing all three routes. */
export function createRequestListener(deps: GatewayDeps): http.RequestListener {
  const d = resolve(deps);
  return (req, res) => {
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';
    const path = url.split('?')[0];

    if (method === 'GET' && path === '/healthz') {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (method === 'GET' && path === '/v1/usage') {
      // Same caller-token gate as the proxy: when SEQUENCE_GATEWAY_TOKEN is
      // configured (callerTokens !== null), reading the spend counter requires the
      // app bearer token — so the global spend figure is not exposed to anonymous
      // callers on a public bind. Unset (dev) ⇒ open, matching the proxy route.
      if (d.config.callerTokens !== null) {
        const token = bearerToken(req.headers['authorization']);
        if (!token || !d.config.callerTokens.includes(token)) {
          sendJson(res, 401, { error: { message: 'unauthorized' } });
          return;
        }
      }
      const monthYear = currentMonthYear(d.now());
      sendJson(res, 200, {
        globalSpendToDate: d.store.read(monthYear),
        backstop: d.config.globalSpendBackstopUsd,
        monthYear,
      });
      return;
    }
    if (method === 'POST' && path === '/v1/chat/completions') {
      handleChat(req, res, d).catch((e) => {
        d.logger.error(`unhandled error: ${(e as Error).message}`);
        if (!res.headersSent) sendJson(res, 500, { error: { message: 'internal error' } });
      });
      return;
    }
    sendJson(res, 404, { error: { message: 'not found' } });
  };
}

/** Build (but do not start) an `http.Server` wired to `deps`. */
export function createGateway(deps: GatewayDeps): http.Server {
  return http.createServer(createRequestListener(deps));
}
