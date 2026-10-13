/* ══════════════════════════════════════════════════════════════════════════
   THE SHELL'S REMEMBERED LAYOUT (Decision 49, DeepSeek's behaviour)
   packages/web2/src/shell2/layoutPrefs.ts

   Three things the reader sets and the shell keeps:
     the sidebar, open or collapsed (Mod+B, or the panel's own button);
     the chat column's width (dragged; 400 px at the least);
     the split dock's divider (dragged; 20 to 80 percent of the stage).
   One reader and one writer each; the sidebar flag is a small external
   store because the page-wide keys (KeysHost) flip it from outside the shell.
   ══════════════════════════════════════════════════════════════════════════ */

import { useSyncExternalStore } from 'react';
import { prefStorage } from '../boot/prefStorage';

export const SIDEBAR_KEY = 'v3.railCollapsed';
export const CHAT_W_KEY = 'v3.chatW';
export const SPLIT_KEY = 's2.split';
export const PEEK_W_KEY = 's2.peekW';

/** B's chat column. */
export const CHAT_DEFAULT = 420;
/** The composer's bar holds +, mode, model, context and send on one row down to here. */
export const CHAT_MIN = 400;
export const CHAT_MAX = 900;
/** The split dock's divider, as the left pane's share of the stage. */
export const SPLIT_MIN = 0.2;
export const SPLIT_MAX = 0.8;
export const SPLIT_DEFAULT = 0.5;
/** Below this the window is narrow: the sidebar folds and chat and stage switch. */
export const NARROW_W = 1024;
/** The board (any surface) never gets narrower than this because a dock opened (UX audit). */
export const BOARD_MIN = 420;
/** The Agents dock's width. */
export const AGENTS_W = 360;
/** The session panel's width (B's 232; 208 at 1180 and below, as the sheet steps it). */
export const railWidth = (winW: number): number => (winW <= 1180 ? 208 : 232);

export interface Room {
  /** The sidebar folds to give the stage room. */
  foldRail: boolean;
  /** The Agents dock floats over the board instead of taking its width. */
  agentsOverlay: boolean;
  /** The review dock floats over the surface instead of splitting the stage. */
  reviewOverlay: boolean;
}

/** The ground between the cards (round 7, Mix): 8 px around the edge and between each card. */
export const CARD_GAP = 8;
/** The icon rail a folded sidebar leaves behind (New chat, Settings), so the room math keeps it. */
export const RAIL_ICON_W = 48;
/** Below this window width the panes need every pixel (they hold a 278 px seat at 1024): no rail, the header button peeks the sidebar instead. */
export const RAIL_MIN_WIN = 1200;
export const railIconWidth = (winW: number): number => (winW >= RAIL_MIN_WIN ? RAIL_ICON_W : 0);

/**
 * WHO GIVES WAY WHEN THE STAGE NEEDS ROOM. The stage keeps BOARD_MIN for each
 * surface it shows: the sidebar folds first (for the room only: the reader's
 * stored choice stands, and the sidebar peeks over the content when asked);
 * then a dock that still does not fit floats over the board rather than
 * squeezing it (at 1024 the review dock had left the board 75 px).
 *
 * Round 7 counts the cards' ground (CARD_GAP around the edge and between the
 * cards). One surface alone never folds the sidebar (Jaden: "The sidebar
 * should be always toggled... unless untoggled"), so at 1024 with the sidebar
 * and a 420 px chat the one board is 364 px wide; the sidebar's own button or
 * Mod+B gives that room back.
 */
export function roomFor(o: { winW: number; chatW: number; agentsOpen: boolean; panes: number; review: boolean }): Room {
  const need = BOARD_MIN * Math.max(1, o.panes);
  const stage = (rail: boolean, agents: boolean) =>
    o.winW - 2 * CARD_GAP - (rail ? railWidth(o.winW) : RAIL_ICON_W) - CARD_GAP - o.chatW - CARD_GAP - (agents ? AGENTS_W + CARD_GAP : 0);
  const docksOn = o.agentsOpen || o.panes > 1;
  const foldRail = docksOn && stage(true, o.agentsOpen) < need;
  const rail = !foldRail;
  const agentsOverlay = o.agentsOpen && stage(rail, true) < BOARD_MIN * (o.review ? 1 : Math.max(1, o.panes));
  const reviewOverlay = o.review && o.panes > 1 && stage(rail, o.agentsOpen && !agentsOverlay) < need;
  return { foldRail, agentsOverlay, reviewOverlay };
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    prefStorage.setItem(key, value);
  } catch {
    /* the layout still follows for this session */
  }
}

export const clampChat = (w: number): number => Math.round(Math.min(CHAT_MAX, Math.max(CHAT_MIN, w)));
export const clampSplit = (r: number): number => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, r));

/* ── three or more surfaces: a divider between each pair (round 14) ───────
   Jaden: "Right now I have three surfaces open and I can't change the size of any surface." Two surfaces keep
   the split dock (one share, 20 to 80 percent, `s2.split`). Three and four take one share per pane, kept
   per count (`s2.panes.3`), each divider moving only the two panes it sits between, neither below PANE_MIN_PX. */
export const PANES_KEY = (n: number): string => `s2.panes.${n}`;
/** No pane is dragged narrower than this. */
export const PANE_MIN_PX = 240;
export const equalShares = (n: number): number[] => Array.from({ length: n }, () => 1 / n);
/** `raw` as `n` positive shares that sum to 1; anything else is equal shares. */
export function normalizeShares(raw: unknown, n: number): number[] {
  if (!Array.isArray(raw) || raw.length !== n) return equalShares(n);
  const nums = raw.map((x) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : NaN));
  if (nums.some(Number.isNaN)) return equalShares(n);
  const sum = nums.reduce((a, b) => a + b, 0);
  return nums.map((x) => x / sum);
}
/**
 * Move divider `i` (between pane i and i+1) by `delta` (a share of the whole): only those two panes change,
 * and neither goes below `minShare`. When the pair cannot hold two minimums it is left as it was.
 */
export function resizeShares(shares: readonly number[], i: number, delta: number, minShare: number): number[] {
  const a = shares[i];
  const b = shares[i + 1];
  if (a === undefined || b === undefined) return [...shares];
  const pair = a + b;
  if (pair < 2 * minShare) return [...shares];
  const left = Math.min(pair - minShare, Math.max(minShare, a + delta));
  const next = [...shares];
  next[i] = left;
  next[i + 1] = pair - left;
  return next;
}
/**
 * `shares` held to the minimum against the room they divide (`roomPx`, the panes' share of the stage):
 * no pane under PANE_MIN_PX; the panes above it give up the difference in proportion. When `n` minimums
 * do not fit, equal shares. An unmeasured room (0) leaves the shares as they are.
 */
export function holdShares(shares: readonly number[], roomPx: number): number[] {
  const n = shares.length;
  if (roomPx <= 0 || n === 0) return [...shares];
  const min = PANE_MIN_PX / roomPx;
  if (n * min >= 1) return equalShares(n);
  const out = [...shares];
  const pinned = new Array<boolean>(n).fill(false);
  for (let round = 0; round < n; round += 1) {
    let changed = false;
    out.forEach((s, i) => {
      if (!pinned[i] && s < min - 1e-12) {
        out[i] = min;
        pinned[i] = true;
        changed = true;
      }
    });
    if (!changed) break;
    const fixed = out.reduce((a, s, i) => a + (pinned[i] ? s : 0), 0);
    const free = out.reduce((a, s, i) => a + (pinned[i] ? 0 : s), 0);
    const target = 1 - fixed;
    if (free > 0) out.forEach((s, i) => {
      if (!pinned[i]) out[i] = (s / free) * target;
    });
  }
  return out;
}
export function readPaneShares(n: number): number[] {
  const raw = read(PANES_KEY(n));
  if (raw === null) return equalShares(n);
  try {
    return normalizeShares(JSON.parse(raw), n);
  } catch {
    return equalShares(n);
  }
}
export function writePaneShares(n: number, shares: readonly number[]): void {
  write(PANES_KEY(n), JSON.stringify(normalizeShares([...shares], n).map((x) => Math.round(x * 1000) / 1000)));
}

/* ── the sidebar peeking over the boards (round 14) ───────────────────────
   Jaden: "you should be able to drag it to make it smaller instead of it being stuck at one size." When the
   sidebar is folded for room, Show sidebar opens it over the content; that sheet takes the chat column's
   handle, between these bounds, and is remembered. */
export const PEEK_DEFAULT = 264;
export const PEEK_MIN = 208;
export const PEEK_MAX = 420;
export const clampPeek = (w: number): number => Math.round(Math.min(PEEK_MAX, Math.max(PEEK_MIN, w)));
export function readPeekWidth(): number {
  const n = Number(read(PEEK_W_KEY));
  return Number.isFinite(n) && n > 0 ? clampPeek(n) : PEEK_DEFAULT;
}
export function writePeekWidth(w: number): void {
  write(PEEK_W_KEY, String(clampPeek(w)));
}

/* ── lock frames (round 9) ────────────────────────────────────────────────
   Jaden: "dragging dividers left and right snaps to lock frames (25%, 33%,
   50%, and so on)". A divider dragged near a frame is pulled onto it (the
   magnet: SNAP_PX either side); the arrow keys jump frame to frame and
   Shift+arrow steps finely. */

/** The lock frames, as a share of what the divider splits. */
export const SNAP_FRAMES: readonly number[] = [0.25, 1 / 3, 0.5, 2 / 3, 0.75];
/** The magnet: within this many pixels of a frame, the divider sits on it. */
export const SNAP_PX = 14;

/** `ratio` pulled onto the nearest frame when within `threshold` (a share of the whole), else unchanged. */
export function snapToFrame(ratio: number, threshold: number, frames: readonly number[] = SNAP_FRAMES): number {
  let best = ratio;
  let gap = threshold;
  for (const f of frames) {
    const d = Math.abs(ratio - f);
    if (d <= gap) {
      gap = d;
      best = f;
    }
  }
  return best;
}

/** The frame a divider sits on (as a whole percent), or null between frames. */
export function frameOf(ratio: number, tolerance = 0.001, frames: readonly number[] = SNAP_FRAMES): number | null {
  const f = frames.find((x) => Math.abs(x - ratio) <= tolerance);
  return f === undefined ? null : Math.round(f * 100);
}

/**
 * The next frame from `ratio` in `dir` (+1 right, -1 left) that lies within
 * [min, max]; null when there is none that way.
 */
export function nextFrame(ratio: number, dir: 1 | -1, min: number, max: number, frames: readonly number[] = SNAP_FRAMES): number | null {
  const inside = frames.filter((f) => f >= min - 1e-9 && f <= max + 1e-9);
  const ahead = dir > 0 ? inside.filter((f) => f > ratio + 0.001) : inside.filter((f) => f < ratio - 0.001).reverse();
  return ahead[0] ?? null;
}

export function readChatWidth(): number {
  const n = Number(read(CHAT_W_KEY));
  return Number.isFinite(n) && n > 0 ? clampChat(n) : CHAT_DEFAULT;
}

export function writeChatWidth(w: number): void {
  write(CHAT_W_KEY, String(clampChat(w)));
}

export function readSplit(): number {
  const raw = read(SPLIT_KEY);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? clampSplit(n) : SPLIT_DEFAULT;
}

export function writeSplit(r: number): void {
  write(SPLIT_KEY, String(Math.round(clampSplit(r) * 1000) / 1000));
}

/* ── "Open new surfaces large" (0.1.6, owner) ─────────────────────────────
   "A feature that lets you auto adjust your surface to be the main surface by how recently you opened it. If on,
   if you click on files, it'll take up like 75% instead of splitting stuff evenly. If off, it keeps adding like
   now." Off by default. On, the surface opened last takes FOCUS_SHARE of the stage and the others share the rest
   (never below PANE_MIN_PX each); opening another makes it the large one; dragging a divider keeps the reader's
   sizes until the next surface opens. Stored like the other layout prefs; Settings reads and writes it through
   the same store (settings/SurfaceFocusSetting.tsx), so the stage follows the switch at once. */
export const FOCUS_LARGE_KEY = 's2.openLarge';
/** The large surface's share of the stage when it is not held back by the others' minimum. */
export const FOCUS_SHARE = 0.75;

/** One share per pane, the pane at `largeIdx` taking FOCUS_SHARE and the rest splitting what is left evenly, held to the minimum. */
export function focusShares(n: number, largeIdx: number, roomPx: number): number[] {
  if (n < 2 || largeIdx < 0 || largeIdx >= n) return equalShares(n);
  const rest = (1 - FOCUS_SHARE) / (n - 1);
  return holdShares(
    Array.from({ length: n }, (_, i) => (i === largeIdx ? FOCUS_SHARE : rest)),
    roomPx,
  );
}

const focusListeners = new Set<() => void>();
let focusFallback: boolean | null = null;
const focusSnapshot = (): boolean => focusFallback ?? read(FOCUS_LARGE_KEY) === '1';
function focusSubscribe(fn: () => void): () => void {
  focusListeners.add(fn);
  return () => focusListeners.delete(fn);
}
export function readFocusLarge(): boolean {
  return focusSnapshot();
}
export function setFocusLarge(on: boolean): void {
  try {
    prefStorage.setItem(FOCUS_LARGE_KEY, on ? '1' : '0');
    focusFallback = null;
  } catch {
    focusFallback = on;
  }
  for (const fn of focusListeners) fn();
}
/** Which surface is the large one and whether the reader sized the stage by hand since it opened; kept so a reload shows the same stage. */
export const FOCUS_STATE_KEY = 's2.openLarge.state';
export interface FocusState {
  large: string | null;
  manual: boolean;
}
export function readFocusState(): FocusState {
  try {
    const v = JSON.parse(read(FOCUS_STATE_KEY) ?? 'null') as { large?: unknown; manual?: unknown } | null;
    return { large: typeof v?.large === 'string' ? v.large : null, manual: v?.manual === true };
  } catch {
    return { large: null, manual: false };
  }
}
export function writeFocusState(s: FocusState): void {
  write(FOCUS_STATE_KEY, JSON.stringify(s));
}
/** Whether new surfaces open large; re-renders when the setting flips. */
export function useFocusLarge(): boolean {
  return useSyncExternalStore(focusSubscribe, focusSnapshot, () => false);
}

/* ── the sidebar flag ─────────────────────────────────────────────────── */

const listeners = new Set<() => void>();
/* Storage is the record; this only stands in when storage refuses a write. */
let fallback: boolean | null = null;

function snapshot(): boolean {
  return fallback ?? read(SIDEBAR_KEY) === '1';
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Tell every reader of the sidebar flag and the open-large flag to read storage again (after a restore from the server). */
export function refreshLayoutPrefs(): void {
  fallback = null;
  focusFallback = null;
  for (const fn of listeners) fn();
  for (const fn of focusListeners) fn();
}

export function setSidebarCollapsed(on: boolean): void {
  try {
    prefStorage.setItem(SIDEBAR_KEY, on ? '1' : '0');
  } catch {
    fallback = on;
  }
  for (const fn of listeners) fn();
}

export function readSidebarCollapsed(): boolean {
  return snapshot();
}

/* The mounted shell decides what a toggle means (on a narrow window it
   opens the sidebar over the chat rather than changing the stored choice). */
let toggleHandler: (() => void) | null = null;

export function setSidebarToggleHandler(fn: (() => void) | null): void {
  toggleHandler = fn;
}

/** What Mod+B and the panel's button do. */
export function toggleSidebar(): void {
  if (toggleHandler) toggleHandler();
  else setSidebarCollapsed(!snapshot());
}

/** Whether the reader collapsed the sidebar; re-renders when it flips. */
export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
