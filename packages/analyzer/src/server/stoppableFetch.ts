/**
 * `fetch` whose abort really closes the connection, on every Node we support.
 *
 * Node 20 and 22 bundle an undici that, when a fetch is aborted, rejects the promise and stops reading but leaves the
 * TCP connection open: a provider that is still generating keeps generating (and billing) until it finishes, which is
 * the opposite of what Stop promises. Node 24 closes it (about 50 ms). The packaged app runs Electron's Node 24; the CLI
 * runs on whatever `engines` allows (>=20), so the difference is ours to close.
 *
 * How: undici publishes `undici:client:sendHeaders` with the request and the socket it was written to. A call that
 * carries an abort signal is tagged with a random header, so its own socket is found without guessing which of two
 * identical concurrent requests is which; the abort destroys that socket. The socket is only ever destroyed while its
 * response is still being received: once undici reports the request finished (trailers, error) the socket goes back to
 * the pool for someone else's call and is never touched.
 *
 * Where the runtime already closes (Node 24) or `fetch` is a test double that never reaches undici, this changes
 * nothing but one extra request header.
 */

import dc from 'node:diagnostics_channel';
import { randomBytes } from 'node:crypto';
import type { Socket } from 'node:net';

export const STOPPABLE_HEADER = 'x-sequence-call';

interface Call {
  socket?: Socket;
  /** The response has ended (or failed): the socket may already serve another request. */
  done: boolean;
  /** Abort was asked for before the socket was known. */
  aborted: boolean;
}

interface UndiciRequest {
  headers?: unknown;
}

const pending = new Map<string, Call>();
const byRequest = new WeakMap<object, Call>();
let listening = false;

/** The value of header `name` in undici's request headers: a flat [name, value, ...] array or a raw header block. */
function headerValue(headers: unknown, name: string): string | undefined {
  if (Array.isArray(headers)) {
    for (let i = 0; i + 1 < headers.length; i += 2) {
      if (String(headers[i]).toLowerCase() === name) return String(headers[i + 1]);
    }
    return undefined;
  }
  if (typeof headers === 'string') {
    const m = new RegExp(`(?:^|\\r\\n)${name}:\\s*([^\\r\\n]*)`, 'i').exec(headers);
    return m ? m[1].trim() : undefined;
  }
  return undefined;
}

function listen(): void {
  if (listening) return;
  listening = true;
  /* Through `dc.channel(name)` rather than `dc.subscribe('name', ...)`: the scanner reads a literal subscribe call as a pub/sub topic and
     would draw these three undici channels as empty topic nodes on Sequence's own architecture board. */
  dc.channel('undici:client:sendHeaders').subscribe((message) => {
    const m = message as { request?: UndiciRequest; socket?: Socket };
    if (!m.request || !m.socket) return;
    const id = headerValue(m.request.headers, STOPPABLE_HEADER);
    const call = id === undefined ? undefined : pending.get(id);
    if (!call) return;
    call.socket = m.socket;
    byRequest.set(m.request, call);
    if (call.aborted && !call.done) m.socket.destroy();
  });
  const finish = (message: unknown): void => {
    const request = (message as { request?: object }).request;
    const call = request ? byRequest.get(request) : undefined;
    if (call) call.done = true;
  };
  dc.channel('undici:request:trailers').subscribe(finish);
  dc.channel('undici:request:error').subscribe(finish);
}

export function fetchStoppable(url: string | URL, init: RequestInit = {}): Promise<Response> {
  const signal = init.signal;
  if (!signal) return fetch(url, init);
  listen();
  const id = randomBytes(8).toString('hex');
  const call: Call = { done: false, aborted: false };
  pending.set(id, call);
  const headers = new Headers(init.headers);
  headers.set(STOPPABLE_HEADER, id);
  const stop = (): void => {
    call.aborted = true;
    if (call.socket && !call.done) call.socket.destroy();
  };
  if (signal.aborted) stop();
  else signal.addEventListener('abort', stop, { once: true });
  const out = fetch(url, { ...init, headers });
  /* The tag is only needed until undici has written the request; forget it then so the map never grows. */
  const forget = (): void => {
    pending.delete(id);
  };
  out.then(forget, forget);
  return out;
}
