/**
 * The small HTTP helpers every route module shares with repoServer.ts: JSON answers, the error shape,
 * the request-body reader and the JSON content-type check. Moved out of repoServer.ts unchanged so a
 * route module can answer a request without importing the server it was split from.
 */

import type http from 'node:http';
import type { AskStreamEvent } from './askPipeline.js';

/** Cap for JSON request bodies (a posted design spec, a file write). Matches the file read cap. */
export const MAX_BODY_BYTES = 1_000_000;

export function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(payload);
}

export function sendError(res: http.ServerResponse, status: number, message: string, extra?: object): void {
  sendJson(res, status, { error: message, ...extra });
}

export function isJsonRequest(req: http.IncomingMessage): boolean {
  const ct = req.headers['content-type'] ?? '';
  return ct.includes('application/json');
}

/** Read the request body as text, rejecting once it exceeds `max` bytes. */
export function readBody(req: http.IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function startSse(res: http.ServerResponse): void {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/event-stream; charset=utf-8');
  res.setHeader('cache-control', 'no-cache');
  res.setHeader('connection', 'keep-alive');
  // Send the head NOW rather than lazily on the first body write. A client's
  // `fetch` does not resolve until the headers land, so without this the reader
  // is not even attached while the first phase of work runs.
  res.flushHeaders();
}

/**
 * The same framing as {@link writeSseEvent} for events that are NOT part of the
 * `AskStreamEvent` union — the scan-progress feed and the ACP bridge. They ride
 * the identical `data: <json>\n\n` shape so one client reader parses every
 * stream this server produces, but they are deliberately not squeezed into the
 * ask union: an ACP `session/update` reshaped into a `tool:start` row loses the
 * agent's own payload, and a scan phase is not a step of an ask.
 */
export function writeSseData(res: http.ServerResponse, event: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Answer a cancelled request (item 1.3).
 *
 * 499 is nginx's "client closed request" — not an IANA code, but the one every
 * log aggregator already reads as "the caller went away", and materially better
 * than a 200 (which claims an answer) or a 500 (which blames the server for a
 * user action). In the ordinary case the socket is already gone and nothing is
 * written at all; the write only happens for a programmatic abort where a reader
 * is still attached, which is why it is guarded rather than assumed.
 */
export function sendAborted(res: http.ServerResponse): void {
  if (res.headersSent || res.writableEnded || !res.writable) return;
  sendError(res, 499, 'request aborted by the client');
}

export function writeSseEvent(res: http.ServerResponse, event: AskStreamEvent, seq: number | null = null): void {
  /*
   * THE `id:` LINE IS WHAT MAKES A BLIP RECOVERABLE, and the ask stream did
   * not have one. `programRunStore`'s own header names exactly this as why a
   * dropped connection loses an ask while a program run survives it: with no
   * id the browser sends no `Last-Event-ID` on reconnect, and a client has
   * nothing it can say it already saw.
   *
   * Null when the turn could not be recorded - an id pointing at a log that
   * does not exist would promise a replay that cannot happen.
   */
  const id = seq === null ? '' : `id: ${seq}\n`;
  res.write(`${id}data: ${JSON.stringify(event)}\n\n`);
}

/* ============================ WAVE 1 ITEM 1.3 — CANCELLATION =================
 * Gap G3: `AbortController` appeared exactly twice in this file, both inside
 * `/api/acp/run-node`, so Stop was cosmetic on every AI route — and, the part
 * that is not merely a missing feature, THE CALL WAS STILL METERED after the
 * user stopped it (`recordUse`, below).
 *
 * The invariant these helpers establish is narrow and checkable: **a generation
 * the caller stopped is never charged to them.** `recordUse` sits strictly after
 * the awaited provider call inside the metered wrapper, so making the abort win
 * that race is the whole fix — there is no second place a charge can happen.
 *
 * The outbound provider `fetch` receives the same abort signal via
 * `ProviderStreamOptions.signal` (see {@link providerCallOptions}), so Stop
 * tears down the provider socket and the ask pipeline stops its tool loop.
 */

/** Thrown when a caller stopped the request before its provider call resolved. */
export class RequestAbortedError extends Error {
  constructor() {
    super('request aborted by the client');
    this.name = 'RequestAbortedError';
  }
}

export function isRequestAbortedError(e: unknown): boolean {
  return e instanceof RequestAbortedError || (e instanceof Error && e.name === 'RequestAbortedError');
}

/** Never begin work the caller has already stopped. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RequestAbortedError();
}

/**
 * Settle on whichever happens first: the work, or the abort.
 *
 * Deliberately a race and not a poll-after-await. Polling after the provider
 * returned would refuse to charge a generation that genuinely completed for the
 * caller a millisecond before they clicked Stop; racing gives the honest rule
 * "charged ⇔ the answer arrived before the stop did", with no free-call window
 * either side.
 */
export function raceAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) {
    // Still attach a handler so an in-flight rejection is never unhandled.
    void work.catch(() => {});
    return Promise.reject(new RequestAbortedError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new RequestAbortedError());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

/**
 * The per-request cancellation seam: one controller, aborted when the client
 * goes away before the response is finished.
 *
 * `res` 'close' rather than `req` 'close' for the same reason the ACP route
 * documents at its own listener — by the time a handler runs, `readBody` has
 * already drained and ended the request stream, so a late `req` 'close' can be
 * missed entirely. `res` 'close' also fires on NORMAL completion, which is why
 * the guard checks `writableEnded`: a finished response is not a cancellation.
 */
export function requestAbort(res: http.ServerResponse): { signal: AbortSignal; dispose: () => void } {
  const ac = new AbortController();
  const onClose = (): void => {
    if (!res.writableEnded) ac.abort();
  };
  res.on('close', onClose);
  return {
    signal: ac.signal,
    dispose: () => {
      res.off('close', onClose);
    },
  };
}

/** Does this request want an SSE response? (`accept:` header, or an explicit `?stream=1`.) */
export function wantsEventStream(req: http.IncomingMessage, url: URL): boolean {
  const accept = req.headers.accept ?? '';
  if (accept.includes('text/event-stream')) return true;
  const q = url.searchParams.get('stream');
  return q === '1' || q === 'true';
}
