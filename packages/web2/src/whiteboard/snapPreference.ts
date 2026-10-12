/* ══════════════════════════════════════════════════════════════════════════
   TIDY-UP OF A DRAWN SHAPE: the person's two switches
   packages/web2/src/whiteboard/snapPreference.ts

   `suggest` by default. A rough box becomes a clean one only after the person
   says so (Enter, or a click on the small offer that appears beside it); `auto`
   does it for them, one Ctrl+Z from the raw stroke; `off` leaves every stroke
   as drawn. Handwriting stays ink in all three: the recognizer's answer for a
   letter is "leave it".

   The second switch is the board edit log (moves, renames, tidy-ups accepted or
   undone), written to the project's own `.sequence` folder and sent nowhere.
   ON by default and opt-out, because the log is what a retrained recognizer and
   any future suggestion would learn from, and it never leaves the machine.

   Only the person's choice is stored. Anything unreadable falls back to the default.
   ══════════════════════════════════════════════════════════════════════════ */

export type SnapMode = 'auto' | 'suggest' | 'off';
export const SNAP_MODES: readonly SnapMode[] = ['auto', 'suggest', 'off'];
export const DEFAULT_SNAP_MODE: SnapMode = 'suggest';
export const SNAP_MODE_KEY = 'sequence.whiteboard.snap';
export const EDIT_LOG_KEY = 'sequence.boards.editlog';
/** Fired on `window` when either switch changes, so an open whiteboard follows without a reload. */
export const SNAP_PREF_EVENT = 'sequence:whiteboard-prefs';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): Store | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function announce(): void {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(SNAP_PREF_EVENT));
  } catch {
    /* no window: nothing is listening */
  }
}

export function readSnapMode(store: Store | undefined = storage()): SnapMode {
  try {
    const v = store?.getItem(SNAP_MODE_KEY);
    return v === 'auto' || v === 'suggest' || v === 'off' ? v : DEFAULT_SNAP_MODE;
  } catch {
    return DEFAULT_SNAP_MODE;
  }
}

export function writeSnapMode(mode: SnapMode, store: Store | undefined = storage()): void {
  try {
    store?.setItem(SNAP_MODE_KEY, mode);
  } catch {
    /* Quota or denied: the switch still moves for this session through the event. */
  }
  announce();
}

export function readEditLogEnabled(store: Store | undefined = storage()): boolean {
  try {
    return store?.getItem(EDIT_LOG_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function writeEditLogEnabled(enabled: boolean, store: Store | undefined = storage()): void {
  try {
    store?.setItem(EDIT_LOG_KEY, enabled ? 'on' : 'off');
  } catch {
    /* as above */
  }
  announce();
}
