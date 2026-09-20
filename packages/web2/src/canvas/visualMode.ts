/* ══════════════════════════════════════════════════════════════════════════
   VISUAL MODE — the per-board switch, and which way it points out of the box
   packages/web2/src/canvas/visualMode.ts

   docs/decisions/visual-board-mode-madr.md §0, amendment A1. Max, 2026-09-02:

     "I want it to be toggleable so people don't have to choose. They just load
      it, and it's always going to be doing this."

   THAT REVERSES DECISION 3 OF THE SAME FILE, which said "off, persisted per
   workspace". The persistence and the per-board scope survive the reversal
   untouched; only the DEFAULT moved, and the reason moved with it — a mode
   nobody switches on is a mode nobody sees, and the reader should not have to
   make a decision before the product looks like itself.

   SO EVERY FAILURE PATH HERE ANSWERS ON. No storage (private mode throws on
   `localStorage` access, not on read), unparseable JSON, a record from a
   version this build does not understand, a value that is not a boolean — each
   of those is "nobody has told us otherwise", and the answer to that is the
   default. The one thing that turns Visual off is a reader pressing the toggle,
   which is the only writer of `false` in this module.

   THE KEY IS THE REPOSITORY, NOT THE SCAN. `ConnectedBoard`'s `attachIdentity`
   is `root|scannedAt` and it is deliberately narrow — it re-decides things per
   scan. A preference must not be forgotten by a rescan, so `boardVisualKey`
   takes the repository root and nothing else, and a board with no repository
   behind it is keyed on its own session (the same identity `localScratch.ts`
   keys the scratch document on).
   ══════════════════════════════════════════════════════════════════════════ */

/** The versioned record, in the `chromeTabModel.ts` idiom (see
 *  `WORKSPACE_PANE_STORAGE_KEY`) so the shell has one persistence shape. */
export const VISUAL_MODE_STORAGE_KEY = 'sequence.board-visual.v1';

const VISUAL_MODE_PERSISTED_VERSION = 1;

/** A1: ON. The toggle turns it OFF. */
export const VISUAL_MODE_DEFAULT = true;

/**
 * Which board a preference belongs to.
 *
 * `repoRoot` is the attached repository's root — stable across rescans, which
 * `attachIdentity` is not. `sessionId` is the fallback for a board with no
 * repository behind it, so a scratch pad in one session does not carry its
 * preference into another.
 */
export function boardVisualKey(
  repoRoot: string | null,
  sessionId: string,
): string {
  return repoRoot ? `repo:${repoRoot}` : `scratch:${sessionId}`;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    /* Private mode throws on the ACCESSOR, before any read. */
    return null;
  }
}

function readRecord(): Record<string, unknown> | null {
  const store = storage();
  if (!store) return null;

  let raw: string | null;
  try {
    raw = store.getItem(VISUAL_MODE_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  if (record.version !== VISUAL_MODE_PERSISTED_VERSION) return null;
  return record;
}

/** What this board was left on. Absent, corrupt or unreadable ⇒ the default. */
export function readBoardVisual(key: string): boolean {
  const record = readRecord();
  if (!record) return VISUAL_MODE_DEFAULT;

  const boards = record.boards;
  if (typeof boards !== 'object' || boards === null || Array.isArray(boards)) {
    return VISUAL_MODE_DEFAULT;
  }

  const value = (boards as Record<string, unknown>)[key];
  return typeof value === 'boolean' ? value : VISUAL_MODE_DEFAULT;
}

/**
 * Remember this board's choice.
 *
 * MERGED, NOT REPLACED. One reader has several boards — a monorepo, a second
 * repository, a scratch pad — and writing only the current one would silently
 * reset every other board to the default on the next boot.
 */
export function writeBoardVisual(key: string, on: boolean): void {
  const store = storage();
  if (!store) return;

  const existing = readRecord();
  const boards =
    existing &&
    typeof existing.boards === 'object' &&
    existing.boards !== null &&
    !Array.isArray(existing.boards)
      ? { ...(existing.boards as Record<string, unknown>) }
      : {};
  boards[key] = on;

  try {
    store.setItem(
      VISUAL_MODE_STORAGE_KEY,
      JSON.stringify({ version: VISUAL_MODE_PERSISTED_VERSION, boards }),
    );
  } catch {
    /* Quota, or a private-mode write refusal. The board keeps the choice for
       this session and boots on the default next time — the same contract
       `writeWorkspacePaneWidths` states for pane widths. */
  }
}
