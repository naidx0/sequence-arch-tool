/* ══════════════════════════════════════════════════════════════════════════
   BOARD LAYOUT MEMORY — where the reader put the boxes, per repository and view
   packages/web2/src/canvas/boardLayoutMemory.ts

   Round 7, C.1. Jaden: "We need a little more depth in the architecture board,
   so we can just pick up the boxes". A box the reader dragged stays where it
   was put after a reload or a rescan, on that repository and that level of the
   Map, until they choose Reset layout (the board's More menu).

   Pure storage, the same failure rules as `visualMode.ts`: no storage, a
   corrupt record or a record from another version reads as "nothing placed",
   which is ELK's arrangement. The key is the repository root and not the scan,
   so a rescan keeps the arrangement; a board with no repository is keyed on
   its session.

   BOUNDED. At most `MAX_BOARDS` layouts are kept, the least recently written
   dropped first, so a reader who opens many repositories does not grow this
   record without limit.
   ══════════════════════════════════════════════════════════════════════════ */

export const BOARD_LAYOUT_STORAGE_KEY = 'sequence.board-layout.v1';
const VERSION = 1;
export const MAX_BOARDS = 40;

type Point = { x: number; y: number };
export type PlacedPositions = Record<string, Point>;

/** Repository (or scratch session), view, and the drilled-in path. */
export function boardLayoutKey(repoRoot: string | null, sessionId: string, opened: readonly string[]): string {
  const who = repoRoot ? `repo:${repoRoot}` : `scratch:${sessionId}`;
  return `${who}|map|${opened.join('>')}`;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

interface Record_ {
  version: number;
  /** Insertion order is recency: the last key is the last written. */
  boards: Record<string, PlacedPositions>;
}

function readAll(): Record_ {
  const empty: Record_ = { version: VERSION, boards: {} };
  const store = storage();
  if (!store) return empty;
  let raw: string | null = null;
  try {
    raw = store.getItem(BOARD_LAYOUT_STORAGE_KEY);
  } catch {
    return empty;
  }
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as Partial<Record_>;
    if (!parsed || parsed.version !== VERSION || typeof parsed.boards !== 'object' || parsed.boards === null) return empty;
    return { version: VERSION, boards: parsed.boards as Record<string, PlacedPositions> };
  } catch {
    return empty;
  }
}

function clean(positions: unknown): PlacedPositions {
  const out: PlacedPositions = {};
  if (!positions || typeof positions !== 'object') return out;
  for (const [id, p] of Object.entries(positions as Record<string, unknown>)) {
    const pt = p as Partial<Point> | null;
    if (pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) out[id] = { x: pt.x as number, y: pt.y as number };
  }
  return out;
}

export function readBoardLayout(key: string): PlacedPositions {
  return clean(readAll().boards[key]);
}

/** Saves `positions` for `key` (empty removes it). Returns false when the
 *  browser would not store it; the board still shows the arrangement. */
export function writeBoardLayout(key: string, positions: PlacedPositions): boolean {
  const store = storage();
  if (!store) return false;
  const all = readAll();
  const boards = { ...all.boards };
  delete boards[key];
  if (Object.keys(positions).length > 0) boards[key] = clean(positions);
  const keys = Object.keys(boards);
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_BOARDS))) delete boards[old];
  try {
    store.setItem(BOARD_LAYOUT_STORAGE_KEY, JSON.stringify({ version: VERSION, boards }));
    return true;
  } catch {
    return false;
  }
}
