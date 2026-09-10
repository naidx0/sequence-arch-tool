/* ══════════════════════════════════════════════════════════════════════════
   P3 — AUTONOMY PREFERENCE (Settings opt-in for Auto-edit / Full)
   packages/web2/src/settings/autonomyPreference.ts

   Modes stronger than Propose stay OFF until the user turns them on in
   Settings. Persisted in localStorage (user-level, not repo policy). The
   permission algebra in `.sequence/permissions.json` still gates what those
   modes may touch once enabled.
   ══════════════════════════════════════════════════════════════════════════ */

export const AUTONOMY_AUTO_EDIT_KEY = 'sequence.autonomy.autoEdit';
export const AUTONOMY_FULL_KEY = 'sequence.autonomy.full';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): Store | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

export function readAutoEditEnabled(store: Store | undefined = storage()): boolean {
  try {
    return store?.getItem(AUTONOMY_AUTO_EDIT_KEY) === 'on';
  } catch {
    return false;
  }
}

export function writeAutoEditEnabled(enabled: boolean, store: Store | undefined = storage()): void {
  try {
    store?.setItem(AUTONOMY_AUTO_EDIT_KEY, enabled ? 'on' : 'off');
  } catch {
    /* Quota / denied — switch still moves for this session. */
  }
}

export function readFullAccessEnabled(store: Store | undefined = storage()): boolean {
  try {
    return store?.getItem(AUTONOMY_FULL_KEY) === 'on';
  } catch {
    return false;
  }
}

export function writeFullAccessEnabled(enabled: boolean, store: Store | undefined = storage()): void {
  try {
    store?.setItem(AUTONOMY_FULL_KEY, enabled ? 'on' : 'off');
  } catch {
    /* Quota / denied. */
  }
}
