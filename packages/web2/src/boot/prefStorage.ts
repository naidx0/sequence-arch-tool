/* THE STORAGE THE MIRRORED PREFERENCES WRITE THROUGH (claims U41, U49, U60-U63).
   Same shape as the part of localStorage they use, so reads are unchanged and keep working with no server. A write
   or removal of an allowlisted key is also announced to whoever mirrors it (prefsMirror.ts), which copies it to the
   server. The allowlist must match analyzer/src/server/uiPrefs.ts; prefsMirror.test.ts checks that. */

export const PREF_KEYS: readonly string[] = [
  'seq.theme',
  'seq.font',
  'sequence.chatAgentPicks.v1',
  'v3.railCollapsed',
  'v3.chatW',
  's2.split',
  's2.peekW',
  's2.openLarge',
  's2.openLarge.state',
];
export const PREF_PREFIXES: readonly string[] = ['sequence:pq:v2:', 's2.panes.'];

export const isPrefKey = (key: string): boolean => PREF_KEYS.includes(key) || PREF_PREFIXES.some((p) => key.startsWith(p) && key.length > p.length);

type Watcher = (key: string, value: string | null) => void;
const watchers = new Set<Watcher>();

/** Called after each write or removal of a mirrored key. Returns the remover. */
export function onPrefWrite(fn: Watcher): () => void {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

function tell(key: string, value: string | null): void {
  if (!isPrefKey(key)) return;
  for (const w of [...watchers]) {
    try {
      w(key, value);
    } catch {
      /* a mirror that fails never fails the write */
    }
  }
}

export const prefStorage = {
  getItem: (key: string): string | null => localStorage.getItem(key),
  setItem(key: string, value: string): void {
    localStorage.setItem(key, value);
    tell(key, value);
  },
  removeItem(key: string): void {
    localStorage.removeItem(key);
    tell(key, null);
  },
  get length(): number {
    return localStorage.length;
  },
  key: (index: number): string | null => localStorage.key(index),
};
