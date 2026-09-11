/**
 * WORKSPACE VIEW MODEL — C+B hybrid pills toggle visibility; sessions live in
 * the left rail, not in the pill bar.
 */

import type { IconName } from '../chat/Icon';

export type ChromeTabId = 'chat' | 'architecture' | 'whiteboard' | 'ai-canvas' | 'terminal' | 'browser';

export interface ChromeTabDef {
  id: ChromeTabId;
  label: string;
  icon: IconName;
}

export const CHROME_TAB_DEFS: Record<ChromeTabId, ChromeTabDef> = {
  chat: { id: 'chat', label: 'Chat', icon: 'chatbox' },
  architecture: { id: 'architecture', label: 'Architecture', icon: 'board' },
  whiteboard: { id: 'whiteboard', label: 'Whiteboard', icon: 'frame' },
  'ai-canvas': { id: 'ai-canvas', label: 'AI Canvas', icon: 'spark' },
  terminal: { id: 'terminal', label: 'Terminal', icon: 'terminal' },
  browser: { id: 'browser', label: 'Browser', icon: 'link' },
};

/** Fixed pill order in the main workspace bar. */
export const WORKSPACE_PILLS: readonly ChromeTabId[] = [
  'chat',
  'architecture',
  'whiteboard',
  'ai-canvas',
  'terminal',
  'browser',
];

export interface ChromeTabEntry {
  id: ChromeTabId;
  minimized: boolean;
}

export interface ChromeTabState {
  /** Open views in pill-bar order (subset may be minimised). */
  tabs: ChromeTabEntry[];
  active: ChromeTabId;
}

export const INITIAL_CHROME_TABS: ChromeTabState = {
  tabs: [{ id: 'chat', minimized: false }],
  active: 'chat',
};

export function tabDef(id: ChromeTabId): ChromeTabDef {
  return CHROME_TAB_DEFS[id];
}

export function isOpen(state: ChromeTabState, id: ChromeTabId): boolean {
  return state.tabs.some((t) => t.id === id);
}

/** Views that are open and not minimised — they paint in the workspace. */
export function visibleTabs(state: ChromeTabState): ChromeTabEntry[] {
  return state.tabs.filter((t) => !t.minimized);
}

/** Visible pills in fixed bar order — each paints an equal workspace column. */
export function visibleWorkspacePanes(state: ChromeTabState): ChromeTabId[] {
  return WORKSPACE_PILLS.filter((id) => isVisible(state, id));
}

export function isVisible(state: ChromeTabState, id: ChromeTabId): boolean {
  return state.tabs.some((t) => t.id === id && !t.minimized);
}

export function activateTab(state: ChromeTabState, id: ChromeTabId): ChromeTabState {
  if (!isOpen(state, id)) {
    return openTab(state, id);
  }
  return {
    ...state,
    active: id,
    tabs: state.tabs.map((t) => (t.id === id ? { ...t, minimized: false } : t)),
  };
}

export function openTab(state: ChromeTabState, id: ChromeTabId): ChromeTabState {
  if (isOpen(state, id)) {
    return restoreTab(state, id);
  }
  return {
    active: id,
    tabs: [...state.tabs, { id, minimized: false }],
  };
}

/**
 * Toggle/focus a pill. Minimised → show. Visible but not focused → focus.
 * Visible and already focused → hide (unless it is the last visible pill).
 */
export function toggleTab(state: ChromeTabState, id: ChromeTabId): ChromeTabState {
  if (!isOpen(state, id)) {
    return openTab(state, id);
  }
  const entry = state.tabs.find((t) => t.id === id);
  if (!entry) return state;
  if (entry.minimized) {
    return restoreTab(state, id);
  }
  if (state.active !== id) {
    return { ...state, active: id };
  }
  if (visibleTabs(state).length <= 1) {
    return state;
  }
  return minimizeTab(state, id);
}

export type CanvasTabId = 'architecture' | 'whiteboard' | 'ai-canvas';

export function visibleCanvasTab(state: ChromeTabState): CanvasTabId | null {
  const active = state.active;
  if (
    (active === 'architecture' || active === 'whiteboard' || active === 'ai-canvas') &&
    isVisible(state, active)
  ) {
    return active;
  }
  const visible = visibleTabs(state).find(
    (t): t is ChromeTabEntry & { id: CanvasTabId } =>
      t.id === 'architecture' || t.id === 'whiteboard' || t.id === 'ai-canvas',
  );
  return visible?.id ?? null;
}

/** Two or more visible pills → multi-pane layout (resizable columns, no overlay). */
export function workspaceSplit(state: ChromeTabState): boolean {
  return visibleWorkspacePanes(state).length >= 2;
}

/** Hit target between workspace columns — matches frame resizer width. */
export const WORKSPACE_PANE_RESIZER_PX = 8;

/** Smallest workspace column a drag may leave behind. */
export const WORKSPACE_PANE_MIN_PX = 160;

/**
 * THE SEAT FLOOR — the narrowest column the frame will AUTOMATICALLY create.
 *
 * Distinct from the drag floor above, and the distinction is consent: a reader
 * who drags a resizer down to 160px chose that width and can drag it back. The
 * FRAME choosing it for them is different — the 2026-08-29 screenshot audit
 * opened five views at 1440px and every geometric check stayed green while the
 * whiteboard's empty-state prose wrapped one word per line, "KINDS" stacked
 * vertically, and the composer's model pill shrank to three letters. Inside
 * the window is not the same claim as usable, and 160px is not a column any
 * of this product's surfaces can speak in.
 *
 * 280px is the measured floor of the narrowest complete surface (the chat
 * column: composer controls + a readable line; the whiteboard empty state's
 * longest word-pair) — the same number the shell's chat overlay already
 * treats as its minimum working width. Capacity, pill refusal and the
 * narrow-window demotion all derive from THIS floor, so the refusal message
 * ("this window fits N views side by side") is a promise about legibility,
 * not just about clipping.
 */
export const WORKSPACE_PANE_SEAT_PX = 280;

/**
 * HOW MANY PANES THE FRAME CAN ACTUALLY SEAT AT `containerWidth`.
 *
 * `.shell` is `overflow: hidden` (shell/shell.css:41-54) and the split's track
 * list is written inline in px, so a pane the container cannot fit is not
 * squeezed and is not scrollable — it is PAINTED OUTSIDE THE WINDOW, with no
 * scrollbar and no indicator, while its pill still reads ON. Measured at a
 * 1152px viewport, the Browser pane sat entirely beyond the right edge; at
 * 1024 the Terminal was half off and the Browser fully off. The app was
 * claiming a view was open that the reader could not see or reach.
 *
 * The floor is not negotiable, so the COUNT is: n panes need
 * `n * SEAT + (n - 1) * RESIZER` and anything past that has nowhere usable to
 * go. The SEAT floor (not the drag floor) governs here — see its declaration:
 * geometry alone let five slivers through the 1440px audit.
 *
 * A width of 0 means NOT MEASURED YET, never "no room" — returning 0 seats on
 * the first frame of every boot would minimise the chat before it painted.
 */
export function workspacePaneCapacity(containerWidth: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return WORKSPACE_PILLS.length;
  const slot = WORKSPACE_PANE_SEAT_PX + WORKSPACE_PANE_RESIZER_PX;
  const seats = Math.floor((containerWidth + WORKSPACE_PANE_RESIZER_PX) / slot);
  return Math.min(WORKSPACE_PILLS.length, Math.max(1, seats));
}

/**
 * Minimise the panes a narrowed frame can no longer seat — newest first.
 *
 * Refusing the OPEN is only half the promise: a reader who opens four panes on
 * a wide monitor and then drags the window narrow would otherwise land back in
 * the offscreen case by another road. `tabs` is in open order, so "newest
 * first" is a walk from the end, and the focused pane is never the one taken
 * away. Minimised is the honest demotion — the view stays in the pill bar and
 * one press brings it back — where painting it offscreen was not.
 */
export function fitVisiblePanesToWidth(
  state: ChromeTabState,
  containerWidth: number,
): ChromeTabState {
  const capacity = workspacePaneCapacity(containerWidth);
  const order = state.tabs.filter((t) => !t.minimized).map((t) => t.id);
  if (order.length <= capacity) return state;

  const drop: ChromeTabId[] = [];
  for (let i = order.length - 1; i >= 0 && order.length - drop.length > capacity; i -= 1) {
    const id = order[i]!;
    if (id === state.active) continue;
    drop.push(id);
  }
  if (drop.length === 0) return state;

  let next = state;
  for (const id of drop) next = minimizeTab(next, id);
  return next;
}

export const WORKSPACE_PANE_STORAGE_KEY = 'sequence.workspace-panes.v1';

const WORKSPACE_PANE_PERSISTED_VERSION = 1;

/** Remembered pixel widths per pill id (only visible panes are written). */
export type WorkspacePaneWidthMap = Partial<Record<ChromeTabId, number>>;

function finitePositive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Fit pane widths into the split body minus resizer gutters. */
export function clampWorkspacePaneWidths(widths: readonly number[], usable: number): number[] {
  const n = widths.length;
  if (n === 0) return [];
  const minTotal = n * WORKSPACE_PANE_MIN_PX;
  if (usable <= minTotal) {
    /*
     * THE FLOOR CANNOT WIN AGAINST THE FRAME.
     *
     * This used to return n * MIN whatever the container was, so a frame too narrow to
     * seat its panes got a track total LARGER than itself: at a 544px container with four
     * panes the result was 4*160 + 3*8 = 664, i.e. 120px painted past the right edge with
     * overflow:hidden and no scrollbar — the offscreen defect arriving by a second road.
     * Below the floor every pane shares the shortfall equally instead.
     */
    const equalShare = usable / n;
    return Array.from({ length: n }, () => equalShare);
  }

  /*
   * WATER-FILL, rather than scale-then-clamp.
   *
   * The old body scaled every width by usable/sum and then re-applied Math.max(MIN, w).
   * Raising a pane back to the floor AFTER scaling adds width that nothing takes away, so
   * just above the floor the total overshot the frame: n=4 at usable=641 summed to 659.48,
   * n=6 at 961 summed to 1036.83. Pin the panes that fall below the floor AT the floor, then
   * share what is left proportionally among the rest, and repeat until nothing new sinks.
   * The result is exact: the widths always sum to the usable width.
   */
  const asked = widths.map((w) => (Number.isFinite(w) && w > 0 ? w : usable / n));
  const pinned = new Array<boolean>(n).fill(false);
  for (;;) {
    const freeIdx = pinned.map((p, i) => (p ? -1 : i)).filter((i) => i >= 0);
    if (freeIdx.length === 0) break;
    const budget = usable - pinned.filter(Boolean).length * WORKSPACE_PANE_MIN_PX;
    const askedSum = freeIdx.reduce((a, i) => a + asked[i]!, 0);
    const scale = askedSum > 0 ? budget / askedSum : 0;
    const sinking = freeIdx.filter((i) => asked[i]! * scale < WORKSPACE_PANE_MIN_PX);
    if (sinking.length === 0) {
      const out = new Array<number>(n);
      for (let i = 0; i < n; i += 1) {
        out[i] = pinned[i] ? WORKSPACE_PANE_MIN_PX : asked[i]! * scale;
      }
      return out;
    }
    for (const i of sinking) pinned[i] = true;
  }
  return Array.from({ length: n }, () => usable / n);
}

/** Resolve column widths for the current visible pills and container width. */
export function resolveWorkspacePaneWidths(
  panes: readonly ChromeTabId[],
  containerWidth: number,
  persisted: WorkspacePaneWidthMap,
): number[] {
  const n = panes.length;
  if (n === 0) return [];
  const resizerTotal = Math.max(0, n - 1) * WORKSPACE_PANE_RESIZER_PX;
  const usable = Math.max(0, containerWidth - resizerTotal);
  const equal = usable / n;
  const widths = panes.map((id) => finitePositive(persisted[id]) ?? equal);
  return clampWorkspacePaneWidths(widths, usable);
}

/** Drag the gutter between `resizerIndex` and `resizerIndex + 1`. */
export function resizeWorkspacePanesAt(
  widths: readonly number[],
  resizerIndex: number,
  delta: number,
): number[] {
  if (resizerIndex < 0 || resizerIndex >= widths.length - 1 || delta === 0) {
    return [...widths];
  }
  const left = widths[resizerIndex]!;
  const right = widths[resizerIndex + 1]!;
  const newLeft = left + delta;
  const newRight = right - delta;
  if (newLeft < WORKSPACE_PANE_MIN_PX || newRight < WORKSPACE_PANE_MIN_PX) {
    return [...widths];
  }
  const next = [...widths];
  next[resizerIndex] = newLeft;
  next[resizerIndex + 1] = newRight;
  return next;
}

export function workspacePaneWidthsToMap(
  panes: readonly ChromeTabId[],
  widths: readonly number[],
): WorkspacePaneWidthMap {
  const map: WorkspacePaneWidthMap = {};
  panes.forEach((id, index) => {
    const width = widths[index];
    if (width != null && Number.isFinite(width)) {
      map[id] = width;
    }
  });
  return map;
}

/**
 * CSS grid track list: pane, resizer, pane, …
 *
 * THE LAST TRACK ABSORBS THE ROUNDING, and that is not tidiness. Rounding each
 * width on its own lets the error accumulate: six equal panes in a 1064px body
 * are 170.67 each, six `171px` tracks plus the gutters come to 1066, and the
 * last two pixels of the last pane are painted past the right edge of an
 * `overflow: hidden` shell. Measured — the Browser pane's right edge read 1282
 * in a 1280 window. Carrying the remainder makes the track total exactly the
 * width the widths summed to.
 */
export function workspaceSplitGridColumns(widths: readonly number[]): string {
  const total = Math.round(widths.reduce((a, b) => a + b, 0));
  const parts: string[] = [];
  let placed = 0;
  widths.forEach((width, index) => {
    const last = index === widths.length - 1;
    const px = last ? total - placed : Math.round(width);
    placed += px;
    parts.push(`${px}px`);
    if (!last) {
      parts.push(`${WORKSPACE_PANE_RESIZER_PX}px`);
    }
  });
  return parts.join(' ');
}

export function workspacePaneResizerTestId(left: ChromeTabId): string {
  return `shell-workspace-resizer-${left}`;
}

export function readWorkspacePaneWidths(): WorkspacePaneWidthMap {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(WORKSPACE_PANE_STORAGE_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

  const record = parsed as Record<string, unknown>;
  if (record.version !== WORKSPACE_PANE_PERSISTED_VERSION) return {};

  const widths = record.widths;
  if (typeof widths !== 'object' || widths === null || Array.isArray(widths)) return {};

  const map: WorkspacePaneWidthMap = {};
  for (const id of WORKSPACE_PILLS) {
    const value = finitePositive((widths as Record<string, unknown>)[id]);
    if (value != null) map[id] = value;
  }
  return map;
}

export function writeWorkspacePaneWidths(widths: WorkspacePaneWidthMap): void {
  const payload = {
    version: WORKSPACE_PANE_PERSISTED_VERSION,
    widths,
  };
  try {
    window.localStorage.setItem(WORKSPACE_PANE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Private-mode quota — default equal split on next boot.
  }
}

export function minimizeTab(state: ChromeTabState, id: ChromeTabId): ChromeTabState {
  if (!isOpen(state, id)) return state;
  const tabs = state.tabs.map((t) => (t.id === id ? { ...t, minimized: true } : t));
  let active = state.active;
  if (active === id) {
    const next = tabs.find((t) => !t.minimized);
    active = next?.id ?? id;
  }
  return { tabs, active };
}

export function restoreTab(state: ChromeTabState, id: ChromeTabId): ChromeTabState {
  if (!isOpen(state, id)) return state;
  return {
    active: id,
    tabs: state.tabs.map((t) => (t.id === id ? { ...t, minimized: false } : t)),
  };
}

/** Legacy close → minimise (pills have no ×). */
export function closeTab(state: ChromeTabState, id: ChromeTabId): ChromeTabState {
  return minimizeTab(state, id);
}

/**
 * Whether the host should open AI Canvas: live/pending draw, canvas tool
 * running, or a newly landed block the seat has not seen yet (finish still
 * shows the diagram — owner 2026-08-27).
 */
export function shouldOpenAiCanvas(opts: {
  blocks: ReadonlyArray<{ id: string; status?: string | null }>;
  knownBlockIds: ReadonlySet<string>;
  canvasToolRunning?: boolean;
}): boolean {
  if (opts.canvasToolRunning) return true;
  if (opts.blocks.some((b) => b.status === 'live' || b.status === 'pending')) return true;
  return opts.blocks.some(
    (b) => !opts.knownBlockIds.has(b.id) && (b.status === 'landed' || b.status == null),
  );
}

/** Map legacy workspace surface selection to pill opens. */
export function syncFromWorkspaceSurface(
  state: ChromeTabState,
  surface: 'chat' | 'architecture' | 'whiteboard' | 'ai-canvas',
): ChromeTabState {
  if (surface === 'chat') {
    return activateTab(openTab(state, 'chat'), 'chat');
  }
  return activateTab(openTab(state, surface), surface);
}
