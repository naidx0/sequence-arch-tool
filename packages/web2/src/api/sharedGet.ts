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
    const started = fetchImpl(url, { headers: { accept: 'application/json' } });
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
