/**
 * PREFERENCES THAT SURVIVE A PORT CHANGE (claims U41, U49, U60-U63).
 *
 * localStorage belongs to an origin, and the desktop shell falls back to a fresh
 * port when the remembered one is taken, so the theme, the per-chat model picks,
 * the held prompt queue and the layout used to vanish with it. The page now
 * mirrors a fixed allowlist of its localStorage keys here, to
 * `~/.sequence/ui-prefs.json`, and restores from this file when a key is missing.
 *
 * A value is the raw string localStorage holds. The allowlist is by exact key or
 * by prefix; anything else is refused, so this file cannot become a general store.
 */
import { readUserJson, writeUserJson } from './store.js';

export const UI_PREFS_FILE = 'ui-prefs.json';

/** Exact keys the page may mirror. */
export const UI_PREF_KEYS: readonly string[] = [
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
/** Key families: the held prompt queues (one key per chat) and the pane shares (one per pane count). */
export const UI_PREF_PREFIXES: readonly string[] = ['sequence:pq:v2:', 's2.panes.'];

const MAX_VALUE = 64 * 1024;
const MAX_KEYS = 400;

export const isUiPrefKey = (key: string): boolean =>
  key.length <= 400 && (UI_PREF_KEYS.includes(key) || UI_PREF_PREFIXES.some((p) => key.startsWith(p) && key.length > p.length));

export type UiPrefs = Record<string, string>;

export function readUiPrefs(dir: string): UiPrefs {
  const raw = readUserJson<unknown>(dir, UI_PREFS_FILE);
  const out: UiPrefs = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isUiPrefKey(k) && typeof v === 'string') out[k] = v;
  }
  return out;
}

/**
 * Merge `{ prefs: { key: string | null } }` into the stored map: a string sets the key, null removes it.
 * Returns the new map, or a reason when the body is not acceptable (nothing is written then).
 */
export function patchUiPrefs(dir: string, body: unknown): { ok: true; prefs: UiPrefs } | { ok: false; error: string } {
  const patch = (body as { prefs?: unknown } | null)?.prefs;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, error: 'expected { prefs: { key: string | null } }' };
  const next = readUiPrefs(dir);
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (!isUiPrefKey(k)) return { ok: false, error: `key not allowed: ${k.slice(0, 80)}` };
    if (v === null) delete next[k];
    else if (typeof v === 'string' && v.length <= MAX_VALUE) next[k] = v;
    else return { ok: false, error: `value for ${k} must be a string up to ${MAX_VALUE} characters, or null` };
  }
  if (Object.keys(next).length > MAX_KEYS) return { ok: false, error: 'too many preferences' };
  writeUserJson(dir, UI_PREFS_FILE, next);
  return { ok: true, prefs: next };
}
