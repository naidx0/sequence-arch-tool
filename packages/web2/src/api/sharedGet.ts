/* ══════════════════════════════════════════════════════════════════════════
   ONE GET PER URL IN FLIGHT
   packages/web2/src/api/sharedGet.ts

   Measured on 0.1.2 in Chromium (tools/measure/surface-load.mjs, with the
   patch that fixed /api/sessions applied): at boot `/api/ai-config` was read
   three times in the same instant -- the store's model label (connect.tsx),
   the composer's effort hydrate (settingsClient.read) and the model picker
   (modelPicker.list) -- and `/api/sessions/<id>` twice, by the canvas doc
   channel and the goal-run hook. Each reader wants a different field of the
   same answer, so each keeps its own parsing; they now share the request.

   Concurrent GETs of one URL share one fetch and each caller gets its own
   clone of the Response. A GET after that fetch settles goes to the network
   again, so a read after a save still sees the save. A caller's abort cancels
   only that caller's wait, never the shared request. Keyed by the fetch in
   use, so one test's mock never answers another test's call.
   ══════════════════════════════════════════════════════════════════════════ */

const inFlight = new WeakMap<typeof fetch, Map<string, Promise<Response>>>();

/*
 * PREFETCHED ON HOVER, TAKEN ON CLICK. `prefetchGet` starts a GET a person is
 * about to make (a chat row under the pointer) and keeps its answer for a few
 * seconds. The next `sharedGet` of that URL takes it, ONCE, instead of going
 * to the network; anything later goes to the network as before, so the "a
 * read after a save sees the save" rule above still holds after one use.
 */
const warm = new WeakMap<typeof fetch, Map<string, { response: Promise<Response>; until: number }>>();
export const PREFETCH_TTL_MS = 10_000;

export function prefetchGet(url: string, fetchImpl: typeof fetch = fetch, now: () => number = Date.now): void {
  let byUrl = warm.get(fetchImpl);
  if (byUrl === undefined) {
    byUrl = new Map();
    warm.set(fetchImpl, byUrl);
  }
  const held = byUrl.get(url);
  if (held && held.until > now()) return;
  const response = fetchImpl(url, { headers: { accept: 'application/json' } });
  const map = byUrl;
  const entry = { response, until: now() + PREFETCH_TTL_MS };
  map.set(url, entry);
  /* A failed prefetch is forgotten; the real read will try for itself. */
  response.then(
    (r) => {
      if (!r.ok && map.get(url) === entry) map.delete(url);
    },
    () => {
      if (map.get(url) === entry) map.delete(url);
    },
  );
}

function takeWarm(url: string, fetchImpl: typeof fetch, now: number): Promise<Response> | undefined {
  const byUrl = warm.get(fetchImpl);
  const held = byUrl?.get(url);
  if (!byUrl || !held) return undefined;
  byUrl.delete(url);
  return held.until > now ? held.response : undefined;
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function untilAborted<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

export async function sharedGet(
  url: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (signal?.aborted) throw abortError();
  let byUrl = inFlight.get(fetchImpl);
  if (byUrl === undefined) {
    byUrl = new Map();
    inFlight.set(fetchImpl, byUrl);
  }
  let shared = byUrl.get(url);
  if (shared === undefined) {
    const map = byUrl;
    const started = takeWarm(url, fetchImpl, Date.now()) ?? fetchImpl(url, { headers: { accept: 'application/json' } });
    shared = started;
    map.set(url, started);
    const forget = () => {
      if (map.get(url) === started) map.delete(url);
    };
    started.then(forget, forget);
  }
  const res = await untilAborted(shared, signal);
  /* Never read the shared original: every caller parses its own copy. A test
     double without clone() is handed over as it is. */
  return typeof res.clone === 'function' ? res.clone() : res;
}

/**
 * Stop new callers joining the GET of `url` now in flight (a write has just made its answer stale).
 * Callers already waiting on it keep their copy; the next `sharedGet` goes to the network.
 */
export function dropInFlight(url: string, fetchImpl: typeof fetch = fetch): void {
  inFlight.get(fetchImpl)?.delete(url);
  warm.get(fetchImpl)?.delete(url);
}
