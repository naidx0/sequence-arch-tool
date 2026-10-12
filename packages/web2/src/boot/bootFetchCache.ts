/* ══════════════════════════════════════════════════════════════════════════
   THE BOOT GET CACHE (round 13, perf ratchet)
   packages/web2/src/boot/bootFetchCache.ts

   At boot the sidebar, the chat title, the palette, Settings' clients and the agent
   runner each read the same three lists (GET /api/sessions, /api/skills, /api/acp/agents),
   so every one of them was fetched twice (study ux/report.md, dupApi). This answers
   the second asker from the first answer: a GET of one of those three routes made within a short window shares the first response (cloned, so each caller
   reads its own body). Any write to the same route family drops the cache at once, so a
   list read after a POST, PUT or DELETE is always fresh, and nothing is kept past the window.
   Installed once, by the entry (main.tsx); tests never install it.
   ══════════════════════════════════════════════════════════════════════════ */

export const BOOT_CACHED_ROUTES: readonly string[] = ['/api/sessions', '/api/skills', '/api/acp/agents'];
/** How long a first answer may serve the second asker. Boot's duplicate reads land within this. */
export const BOOT_CACHE_MS = 2500;

type Entry = { at: number; response: Promise<Response> };

function urlOf(input: RequestInfo | URL): URL | null {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return new URL(raw, 'http://local');
  } catch {
    return null;
  }
}

function withAbort<T>(p: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return p;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Wrap `base` with the cache. Pure: returns the wrapped function; `now` is injectable for tests. */
export function bootFetchCache(base: typeof fetch, now: () => number = () => Date.now()): typeof fetch {
  const cache = new Map<string, Entry>();
  /* Bumped when any write starts and again when it settles; an answer that began under an older generation is never kept. */
  let generation = 0;
  let writing = 0;
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
    if (url && url.pathname.startsWith('/api/') && method !== 'GET' && method !== 'HEAD') {
      /* ANY write under /api/ (attach, detach, clone, file ops, session and agent changes...) may change what the lists
         say: drop everything now and again when it settles. */
      cache.clear();
      generation += 1;
      writing += 1;
      const done = () => {
        writing -= 1;
        cache.clear();
        generation += 1;
      };
      const out = base(input, init);
      out.then(done, done);
      return out;
    }
    if (!url || !BOOT_CACHED_ROUTES.includes(url.pathname) || method !== 'GET' || writing > 0) return base(input, init);
    const key = `${url.pathname}${url.search}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < BOOT_CACHE_MS) return withAbort(hit.response.then((r) => r.clone()), init?.signal ?? undefined);
    /* The shared read starts without any one caller's signal, so one caller's abort cannot cancel the others' answer;
       that caller still gets its own AbortError, here. */
    const signal = init?.signal ?? undefined;
    const started = generation;
    const response = base(input, signal ? { ...init, signal: undefined } : init);
    const entry: Entry = { at: now(), response };
    cache.set(key, entry);
    /* A failed read, or one that began before the latest write settled, is not kept. */
    const keep = (r: Response) => {
      if (!r.ok || started !== generation) if (cache.get(key) === entry) cache.delete(key);
    };
    response.then(keep, () => cache.get(key) === entry && cache.delete(key));
    return withAbort(response.then((r) => r.clone()), signal);
  }) as typeof fetch;
}
