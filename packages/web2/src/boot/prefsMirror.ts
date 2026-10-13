/* PREFERENCES THAT SURVIVE A PORT CHANGE (claims U41, U49, U60-U63).

   localStorage belongs to an origin; the desktop shell can land on a new port, and the theme, font, per-chat model
   picks, held prompt queue and layout were left behind. This keeps a copy of those keys on the server
   (GET/PUT /api/ui-prefs -> ~/.sequence/ui-prefs.json):
     - ONE GET, after first paint. Nothing at boot waits on it, and a server that does not answer changes nothing:
       every read stays on localStorage.
     - A key the server has and localStorage lacks is restored (and its owner told to re-read it); a key only
       localStorage has is sent up, which is the one-time migration for people who already had preferences.
     - A key written or removed in this session is never overwritten by the restore: the person's newer choice wins.
     - Writes are batched into one PUT a moment later, and only start after the GET has answered. */

import { applyFont, FONT_EVENT, FONT_KEY, readFont } from '../settings/fontPreference';
import { applyTheme, readTheme, THEME_EVENT, THEME_KEY } from '../settings/themePreference';
import { promptQueue, QUEUE_STORAGE_PREFIX } from '../composer/promptQueue';
import { agentRuns } from '../agents/agentRuns';
import { refreshLayoutPrefs } from '../shell2/layoutPrefs';
import { isPrefKey, onPrefWrite } from './prefStorage';

const PICKS_KEY = 'sequence.chatAgentPicks.v1';
const MAX_VALUE = 64 * 1024;

type Raw = Pick<Storage, 'getItem' | 'setItem' | 'key'> & { readonly length: number };

export interface PrefsMirrorDeps {
  fetchImpl?: typeof fetch;
  raw?: Raw;
  /** Told which keys were restored from the server, to re-read them. */
  apply?: (restored: string[]) => void;
  debounceMs?: number;
}

export function applyRestored(restored: readonly string[]): void {
  if (restored.includes(THEME_KEY)) {
    applyTheme();
    window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: readTheme() }));
  }
  if (restored.includes(FONT_KEY)) {
    applyFont();
    window.dispatchEvent(new CustomEvent(FONT_EVENT, { detail: readFont() }));
  }
  for (const k of restored) if (k.startsWith(QUEUE_STORAGE_PREFIX)) promptQueue.reload(k.slice(QUEUE_STORAGE_PREFIX.length));
  if (restored.includes(PICKS_KEY)) agentRuns.adoptSavedPicks();
  if (restored.some((k) => !k.startsWith(QUEUE_STORAGE_PREFIX) && k !== THEME_KEY && k !== FONT_KEY && k !== PICKS_KEY)) refreshLayoutPrefs();
}

export function startPrefsMirror(deps: PrefsMirrorDeps = {}): { done: Promise<string[]>; stop: () => void; refused: ReadonlySet<string> } {
  const doFetch: typeof fetch = deps.fetchImpl ?? ((i, o) => globalThis.fetch(i, o));
  const raw: Raw = deps.raw ?? localStorage;
  const apply = deps.apply ?? applyRestored;
  const wait = deps.debounceMs ?? 400;
  const touched = new Set<string>();
  const pending = new Map<string, string | null>();
  let ready = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  /* The server takes about 1 MB a request, and a batch past it kills the socket: send in chunks well under that, so one
     big key can never hold the small ones back. */
  const CHUNK_CHARS = 400_000;
  const refused = new Set<string>();
  const chunks = (entries: [string, string | null][]): [string, string | null][][] => {
    const out: [string, string | null][][] = [];
    let cur: [string, string | null][] = [];
    let size = 0;
    for (const e of entries) {
      const n = e[0].length + (e[1]?.length ?? 4) + 16;
      if (cur.length > 0 && size + n > CHUNK_CHARS) {
        out.push(cur);
        cur = [];
        size = 0;
      }
      cur.push(e);
      size += n;
    }
    if (cur.length > 0) out.push(cur);
    return out;
  };
  /** One PUT. 'ok', 'refused' (a 4xx: the server will never take this), or 'later' (network or 5xx: try again). */
  const put = async (sent: [string, string | null][]): Promise<'ok' | 'refused' | 'later'> => {
    try {
      const res = await doFetch('/api/ui-prefs', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefs: Object.fromEntries(sent) }) });
      if (res.ok) return 'ok';
      return res.status >= 400 && res.status < 500 ? 'refused' : 'later';
    } catch {
      return 'later';
    }
  };
  const landed = (sent: [string, string | null][]): void => {
    for (const [k, v] of sent) if (pending.get(k) === v) pending.delete(k);
  };
  const flush = async (): Promise<void> => {
    timer = null;
    if (stopped || !ready || pending.size === 0) return;
    for (const chunk of chunks([...pending])) {
      const done = await put(chunk);
      if (done === 'ok') landed(chunk);
      else if (done === 'later') return; /* offline: the rest stays queued for the next write */
      else {
        /* A 4xx on a batch: find the key it will not take, send the others one by one, and drop the refused. */
        for (const one of chunk) {
          const r = await put([one]);
          if (r === 'ok') landed([one]);
          else if (r === 'refused') {
            pending.delete(one[0]);
            refused.add(one[0]);
            console.warn(`prefs mirror: the server refused ${one[0]}; it stays on this device only`);
          } else return;
        }
      }
    }
  };
  const schedule = (): void => {
    if (ready && timer === null && !stopped) timer = setTimeout(() => void flush(), wait);
  };
  const off = onPrefWrite((key, value) => {
    touched.add(key);
    if (value === null || value.length <= MAX_VALUE) pending.set(key, value);
    schedule();
  });

  const done = (async (): Promise<string[]> => {
    const restored: string[] = [];
    try {
      const res = await doFetch('/api/ui-prefs');
      if (res.ok) {
        const body = (await res.json()) as { prefs?: Record<string, unknown> };
        const server = body.prefs && typeof body.prefs === 'object' ? body.prefs : {};
        for (const [k, v] of Object.entries(server)) {
          if (typeof v !== 'string' || !isPrefKey(k) || touched.has(k) || raw.getItem(k) !== null) continue;
          try {
            raw.setItem(k, v);
            restored.push(k);
          } catch {
            /* storage refuses: the server copy still stands */
          }
        }
        for (let i = 0; i < raw.length; i++) {
          const k = raw.key(i);
          if (!k || !isPrefKey(k) || k in server || pending.has(k)) continue;
          const v = raw.getItem(k);
          if (v !== null && v.length <= MAX_VALUE) pending.set(k, v);
        }
      }
    } catch {
      /* no server answer: local preferences keep working */
    }
    ready = true;
    if (restored.length) apply(restored);
    schedule();
    return restored;
  })();

  return {
    done,
    refused,
    stop: () => {
      stopped = true;
      off();
      if (timer) clearTimeout(timer);
    },
  };
}
