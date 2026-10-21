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
/** Routes that answer for the attached workspace; held until the first /api/status says which workspace that is. */
export const GATED_PREFIXES: readonly string[] = ['/api/sessions', '/api/skills', '/api/acp/runs', '/api/acp/agents', '/api/canvas-doc', '/api/chat-memory'];
/** The longest a workspace read waits for a status answer that never says. */
export const GATE_MAX_MS = 20000;
/** POSTs that only compute an answer and change none of the cached lists (the board's annotate call runs at boot). They neither drop the cache nor hold it back. */
export const READ_ONLY_POSTS: readonly string[] = ['/api/annotate'];

type Entry = { at: number; response: Promise<Response>; pending?: boolean; stable?: boolean };

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
export function bootFetchCache(
  base: typeof fetch,
  now: () => number = () => Date.now(),
  /** The /api/status read the page started from index.html before this script ran (window.__seqStatus), if any. */
  prefetchedStatus: Promise<Response | null> | null = null,
  /** Tests that are not about the gate start with it open. */
  armGate = true,
  /** The /api/sessions read started beside it (window.__seqSessions): kept as the first list answer only if the status says attached. */
  prefetchedSessions: Promise<Response | null> | null = null,
): typeof fetch {
  const cache = new Map<string, Entry>();
  /* The boot window: /api/status is asked for by the page's prefetch, the boot ladder, the activity panel and the stale probe.
     Inside this window (and while one is in flight) they share one answer; after it every poll is a fresh ask. */
  const installedAt = now();
  const STATUS_KEY = '/api/status';
  /* THE WORKSPACE GATE. The server listens before it attaches its startup repository, so a read of a workspace's own data
     made in that window is answered for the HOME workspace, thrown away when the repository lands, and made again (8
     requests and a wrong-chat transcript at boot, measured). Those reads wait for the first /api/status answer. The gate
     opens on the first answer that is not "attaching", on a failed status read, on any write, or after GATE_MAX_MS. */
  let openGate: () => void = () => undefined;
  let gateOpen = !armGate;
  const gate = new Promise<void>((resolve) => {
    openGate = () => {
      gateOpen = true;
      resolve();
    };
  });
  const gateTimer = armGate ? setTimeout(openGate, GATE_MAX_MS) : undefined;
  void gate.then(() => clearTimeout(gateTimer));
  let prefetch = prefetchedStatus;
  let seed = prefetchedSessions;
  /* Bumped when any write starts and again when it settles; an answer that began under an older generation is never kept. */
  let generation = 0;
  let writing = 0;
  /* What the last /api/status said was attached; null until it has said. */
  let attachState: string | null = null;
  const wrapped = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
    if (url && method === 'GET' && !gateOpen && GATED_PREFIXES.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) {
      return withAbort(gate, init?.signal ?? undefined).then(() => wrapped(input, init));
    }
    if (url && url.pathname.startsWith('/api/') && method !== 'GET' && method !== 'HEAD' && !READ_ONLY_POSTS.includes(url.pathname)) {
      openGate();
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
    if (url && url.pathname === '/api/status' && method === 'GET') {
      /* THE STARTUP ATTACH IS A WRITE THE PAGE DID NOT MAKE. The server listens before it reads `--repo`, so a tab can read
         the chat list while it still answers for the home workspace; the status poll then says the repository is attached,
         and a list read inside the window would be handed the home answer (the open chat was a chat the server did not hold:
         `/goal` 404ed). A change of what the server says is attached drops the lists before the page sees that status. */
      const shared = cache.get(STATUS_KEY);
      if (shared && (shared.pending || (shared.stable && now() - installedAt < BOOT_CACHE_MS))) {
        return withAbort(shared.response.then((r) => r.clone()), init?.signal ?? undefined);
      }
      const started = prefetch;
      prefetch = null;
      const read = started ? started.then((r) => (r ? r.clone() : base(input, init))) : base(input, init);
      const entry: Entry = { at: now(), pending: true, response: undefined as unknown as Promise<Response> };
      const out = read.then(async (res) => {
        try {
          const body = res.ok ? ((await res.clone().json()) as { attached?: unknown; root?: unknown; scanning?: unknown; attaching?: unknown }) : null;
          /* The early list read answered for whatever the server held when it ran: it is the repository's list only when the
             FIRST status already says attached (and no attach followed it, which the state check below clears). */
          const seeded = seed;
          seed = null;
          if (seeded && body && body.attached === true) {
            const list = seeded.then((r) => (r && r.ok ? r : Promise.reject(new Error('no early list'))));
            list.catch(() => undefined);
            cache.set('/api/sessions', { at: now(), response: list });
          }
          /* Only "the server is still reading its repository" keeps the gate shut. */
          /* Only an attached answer may be handed on after it has settled: scanning and attaching answers move (the boot ladder and the
             attach progress poll them to watch the count), so those are shared only while still in flight. */
          entry.stable = !!body && body.attached === true;
          if (!body || body.attached === true || (!body.scanning && !body.attaching)) openGate();
          if (body) {
            const state = `${body.attached === true}|${typeof body.root === 'string' ? body.root : ''}`;
            if (attachState !== null && attachState !== state) {
              cache.clear();
              generation += 1;
            }
            attachState = state;
          }
        } catch {
          /* not JSON (a static file host answers index.html): nothing to learn, and nothing to wait for either. */
          openGate();
        }
        return res;
      }, (e) => {
        openGate();
        throw e;
      });
      entry.response = out;
      cache.set(STATUS_KEY, entry);
      const settle = (ok: boolean) => {
        entry.pending = false;
        if (!ok && cache.get(STATUS_KEY) === entry) cache.delete(STATUS_KEY);
      };
      out.then((r) => settle(r.ok), () => settle(false));
      return withAbort(out.then((r) => r.clone()), init?.signal ?? undefined);
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
  return wrapped;
}
