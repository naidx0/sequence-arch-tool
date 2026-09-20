import type {
  GetBrowseResponse,
  GetRecentResponse,
  GetStatusResponse,
  PostAttachResponse,
  PostDetachResponse,
} from '@sequence/api-types';

import type { BootTransport, WireResult } from './bootSequence';

/**
 * ITEM 2.4 — THE TRANSPORT. The only file in this lane that opens a socket.
 *
 * It is small on purpose and it has exactly one opinion, which is the one the
 * lock names: **every request is a relative, same-origin path.** That is not a
 * convention here, it is a checked precondition — {@link isSameOriginPath}
 * runs before every call and a violation throws rather than fetching.
 *
 * WHY A GUARD AND NOT A REVIEW RULE. The way a third-party host gets into a
 * local-first client is never a decision anybody argues about. It is one
 * convenient absolute URL added months later — a CDN for an icon set, a
 * telemetry beacon, an engine on `http://127.0.0.1:4173` typed in while
 * debugging and never taken out — by someone who has not read this file and has
 * no reason to. Production is same-origin (`repoServer.ts` serves `webDist`)
 * and development goes through vite's `/api` proxy, so there is no legitimate
 * absolute URL in this lane at all, today or later. A precondition says that in
 * a way a paste cannot miss.
 *
 * WHY FOUR OUTCOMES AND NO THROW ON THE WIRE. `WireResult` separates "nothing
 * answered", "something answered that is not JSON", "the server refused" and
 * "here is the body". v1's client re-implemented
 * `if (!r.ok) throw new Error(body.error ?? 'HTTP ' + r.status)` at thirty-odd
 * call sites and could not tell a refusal from an outage from a route that was
 * never built — which is why a dead engine and a rejected folder looked the
 * same on screen. The ladder in `bootSequence.ts` branches on all four, so all
 * four have to survive the transport.
 *
 * JSON IS DECIDED BY PARSING, NOT BY THE CONTENT-TYPE HEADER. A static file
 * host answers every unknown path with `index.html`, a 200, and
 * `content-type: text/html`; some answer with no content-type at all. Trusting
 * the header means trusting the very server we are trying to identify. Parsing
 * the body is the measurement.
 */

/**
 * Whether a string is a relative path this client may request.
 *
 * True only for a single leading slash followed by something that is not a
 * slash or a backslash. Both of the near-misses are deliberate:
 *   `//host/x`  is protocol-relative and absolute at run time — the classic way
 *               past a check that only looks for `https://`.
 *   `/\host/x`  is parsed as protocol-relative by browsers' URL parsers, which
 *               treat a backslash as a slash in the authority position.
 */
export function isSameOriginPath(path: string): boolean {
  if (!path.startsWith('/')) return false;
  if (path.length > 1 && (path[1] === '/' || path[1] === '\\')) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(path);
}

/** The precondition, as a call. Throws — this is a programmer error, not a
 *  wire outcome, and it must not be renderable as one. */
function requireSameOrigin(path: string): string {
  if (!isSameOriginPath(path)) {
    throw new Error(
      `boot may only request same-origin paths; refused ${JSON.stringify(path)}. ` +
        'Production is same-origin and development proxies /api — there is no absolute URL to add.',
    );
  }
  return path;
}

interface RequestInit_ {
  method: 'GET' | 'POST';
  body?: unknown;
}

async function request<T>(
  fetchImpl: typeof fetch,
  path: string,
  init: RequestInit_ = { method: 'GET' },
): Promise<WireResult<T>> {
  requireSameOrigin(path);

  let response: Response;
  try {
    response = await fetchImpl(path, {
      method: init.method,
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    /* A browser rejects with a TypeError when nothing is listening, when DNS
     * fails and when the connection is refused. All three are "nothing
     * answered" from the user's seat, and none of them is an error the app did
     * something wrong to deserve. */
    return { outcome: 'unreachable', message: (error as Error).message };
  }

  const status = response.status;
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    return { outcome: 'unreachable', message: (error as Error).message };
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { outcome: 'not-json', status };
  }

  return response.ok
    ? { outcome: 'ok', status, body: body as T }
    : { outcome: 'error', status, body };
}

/**
 * The five calls the boot lane makes, bound to a fetch.
 *
 * The fetch is a parameter so a test can hand in a recorder and assert on every
 * URL that was requested — which is half of this item's lock — without a
 * network, a server, or a global monkey-patch that outlives the test that set
 * it.
 */
export function createBootTransport(fetchImpl: typeof fetch = globalThis.fetch): BootTransport {
  return {
    status: () => request<GetStatusResponse>(fetchImpl, '/api/status'),

    archGraph: () => request<unknown>(fetchImpl, '/archgraph.json'),

    recent: () => request<GetRecentResponse>(fetchImpl, '/api/recent'),

    /*
     * The directory being browsed is an absolute SERVER-SIDE path and is
     * arbitrary user input. It travels as a query parameter, encoded, so it can
     * never become part of the request's own host — which is why the path being
     * browsed cannot defeat the same-origin guard above. An empty value means
     * "the browse root itself", which is what the route documents.
     */
    browse: (path: string | null) =>
      request<GetBrowseResponse>(fetchImpl, `/api/browse?path=${encodeURIComponent(path ?? '')}`),

    attach: (path: string) =>
      request<PostAttachResponse>(fetchImpl, '/api/attach', { method: 'POST', body: { path } }),

    /*
     * LEAVING. Reported as a trap: "how do I exit the project? That's a very
     * simple one." There was no way out - a new session opened in the same
     * repository - and POST /api/detach had existed, tested, called by nothing
     * since it was written. It was one of the twenty-one routes the
     * reachability register lists as built and unreached.
     */
    detach: () => request<PostDetachResponse>(fetchImpl, '/api/detach', { method: 'POST' }),
  };
}
