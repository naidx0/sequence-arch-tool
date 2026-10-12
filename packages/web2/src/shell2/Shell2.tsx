/* ══════════════════════════════════════════════════════════════════════════
   THE RESKIN SHELL (Decision 49) — uiarc.dev's layout, ported
   packages/web2/src/shell2/Shell2.tsx

   BArc.dc.html taken literally, less its icon rail: the session panel, the
   chat column (420px), and the main column with B's top bar (the segmented
   pill of surfaces, the branch pill) over the stage. Surfaces multi-open;
   the stage shows at most two side by side (the split dock), each with a
   capsule head holding full screen and close. The surfaces, the chat, the
   overlays, the palette and the keyboard are the product's own.

   DeepSeek's layout behaviour, kept under B's look: the chat column and the
   split dock are resized by a hairline that shows on hover (chat 400 px at
   the least, the split 20 to 80 percent, both remembered); Mod+B or the
   panel's own button collapses the sidebar; below 1024 px the sidebar folds
   and a segmented control switches between the chat and the workspace.
   ══════════════════════════════════════════════════════════════════════════ */

import {
  Fragment,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import {
  CHROME_TAB_DEFS,
  LIVE_PILLS,
  activateTab,
  isVisible,
  minimizeTab,
  shippedTabsOnly,
  type ChromeTabId,
  type ChromeTabState,
} from '../app/chromeTabModel';
import { tabStatus } from '../app/chromeTabStrip';
import { MODEL_DRAWN_PANES } from '../app/chromeTabModel';
import { useAgentRunningIn, useAgentsRunning } from '../agents/railRuns';
import { setHostCommandHandler } from '../app/hostCommands';
/* The Agents dock loads when it is opened, not at boot (perf ratchet). */
const AgentsDock = lazy(() => import('../agents/AgentsDock'));
import { KeysHost } from '../shell/KeysHost';
import { openCommandPalette } from '../shell/paletteEvent';
import { SHELL_COMMANDS, type ShellCommand } from '../shell/shellModel';
import { paletteHint } from '../shell/shortcuts';
import { LateBoot } from '../shell/LateBoot';
import { WindowControls } from '../shell/WindowControls';
import { markCut } from './softEdge';
import { ChatTitle } from '../chat/ChatTitle';
import { ConnectedChatColumn, groundedRepoName, useAppState, useStore } from '../state/connect';
import { V3CommandPalette } from '../v3/V3CommandPalette';
import { V3OverlayHost } from '../v3/V3OverlayHost';
import { prefetchArchitecture } from '../v3/prefetch';
import { S2Icon, type S2IconName } from './icons';
import { ActivityLoader } from './ActivityLoader';
import { LiveSurface } from './LiveSurface';
import { SessionPanel } from './SessionPanel';
import { SessionRail } from './SessionRail';
import { StatusBar, type StatusBarAlign } from './StatusBar';
import { useStatusBar } from './statusBarPref';
import { applyOrder, moveTo, readOrder, slotAt, writeOrder } from './surfaceOrder';
import { useReviewDock } from './reviewDockStore';
import { useMenuKeys } from './menuKeys';
import {
  roomFor,
  AGENTS_W,
  CHAT_DEFAULT,
  CHAT_MAX,
  CHAT_MIN,
  NARROW_W,
  focusShares,
  readFocusState,
  useFocusLarge,
  writeFocusState,
  SPLIT_DEFAULT,
  SPLIT_MAX,
  SPLIT_MIN,
  clampChat,
  RAIL_MIN_WIN,
  clampSplit,
  frameOf,
  nextFrame,
  SNAP_PX,
  snapToFrame,
  readChatWidth,
  readSidebarCollapsed,
  readSplit,
  PANE_MIN_PX,
  equalShares,
  readPaneShares,
  holdShares,
  resizeShares,
  writePaneShares,
  PEEK_DEFAULT,
  PEEK_MAX,
  PEEK_MIN,
  clampPeek,
  readPeekWidth,
  writePeekWidth,
  setSidebarCollapsed,
  setSidebarToggleHandler,
  toggleSidebar,
  useSidebarCollapsed,
  writeChatWidth,
  writeSplit,
} from './layoutPrefs';

/* The review dock loads the first time a turn is reviewed. */
const ReviewDock = lazy(() => import('./ReviewDock'));
/* The ASCII stage background (round 8, item 7): off the boot path, after first paint. */
const AsciiStage = lazy(() => import('./backdrop/AsciiStage'));

/** True once the first frame has painted and the browser is idle: what loads late waits for it. */
function useAfterFirstPaint(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let idle = 0;
    const raf = requestAnimationFrame(() => {
      const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      idle = ric ? ric(() => setReady(true), { timeout: 1200 }) : window.setTimeout(() => setReady(true), 200);
    });
    return () => {
      cancelAnimationFrame(raf);
      const cic = (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
      if (cic) cic(idle);
      else window.clearTimeout(idle);
    };
  }, []);
  return ready;
}

export interface Shell2Props {
  openFailure?: { message: string; retry: () => void } | null;
  onDismissOpenFailure?: () => void;
  onOpenSettings?: () => void;
  onOpenProject?: (repoPath: string, sessionId: string) => void;
  onOpenWorkspace?: (sessionId: string) => void;
}

/** At most three surfaces share the stage (round 11: Jaden names three open at once, Architecture, Files and Terminal); two below STAGE_NARROW_W. */
export const STAGE_MAX = 3;
/** Below this window width three panes cannot fit (at 1024 each is ~193px: chips and toolbars are cut), so the stage holds two. */
export const STAGE_NARROW_W = 1200;

/** The most surfaces the stage holds at this window width. */
export function stageMaxFor(width: number): number {
  return width < STAGE_NARROW_W ? 2 : STAGE_MAX;
}

export const SHELL2_INITIAL_TABS: ChromeTabState = {
  tabs: [
    { id: 'chat', minimized: false },
    { id: 'architecture', minimized: false },
  ],
  active: 'architecture',
};

/** The boards name themselves by their own tab, so their pane head floats over the surface with only its controls. */
const FLOAT_HEAD: ReadonlySet<string> = new Set(['architecture', 'whiteboard']);

const TAB_ICON: Partial<Record<ChromeTabId, S2IconName>> = {
  architecture: 'board',
  files: 'file',
  whiteboard: 'pen',
  terminal: 'term',
  agents: 'cpu',
  'ai-canvas': 'canvas',
  browser: 'globe',
};

/** One line per surface for the pill's tooltip: what opens (round 0.1.5: "I did not understand what surfaces are"). */
const CHROME_TAB_BLURB: Partial<Record<ChromeTabId, string>> = {
  architecture: 'the map of your code',
  files: 'browse and edit files',
  whiteboard: 'sketch and ask on a canvas',
  terminal: 'a shell in this project',
  agents: 'the coding agents working here',
};

/** B's order: the board first. */
const BASE_STRIP: readonly ChromeTabId[] = [...LIVE_PILLS].sort((a, b) => Number(b === 'architecture') - Number(a === 'architecture'));

function readTabs(): ChromeTabState {
  try {
    const raw = localStorage.getItem('v3.chromeTabs');
    if (!raw) return SHELL2_INITIAL_TABS;
    const parsed = JSON.parse(raw) as ChromeTabState;
    if (!parsed || !Array.isArray(parsed.tabs) || typeof parsed.active !== 'string') return SHELL2_INITIAL_TABS;
    return shippedTabsOnly(parsed) ?? SHELL2_INITIAL_TABS;
  } catch {
    return SHELL2_INITIAL_TABS;
  }
}

/** Open (or focus) a surface; one more than `max` on the stage retires the oldest other. */
export function openOnStage(state: ChromeTabState, id: ChromeTabId, max: number = STAGE_MAX): ChromeTabState {
  let next = activateTab(state, id);
  const open = LIVE_PILLS.filter((p) => isVisible(next, p));
  if (open.length > max) {
    const order = next.tabs.map((t) => t.id).filter((t) => open.includes(t) && t !== id);
    for (const old of order.slice(0, open.length - max)) next = minimizeTab(next, old);
    next = { ...next, active: id };
  }
  return next;
}

/** Retire the oldest surfaces until the stage fits `max` (a resize below the narrow width does this too). */
export function fitStage(state: ChromeTabState, max: number): ChromeTabState {
  const open = LIVE_PILLS.filter((p) => isVisible(state, p));
  if (open.length <= max) return state;
  const order = state.tabs.map((t) => t.id).filter((t) => open.includes(t));
  let next = state;
  for (const old of order.slice(0, open.length - max)) next = minimizeTab(next, old);
  return next;
}

/** Close a surface; the chat column is always there, so nothing falls back to it. */
export function closeOnStage(state: ChromeTabState, id: ChromeTabId): ChromeTabState {
  const next = minimizeTab(state, id);
  const other = LIVE_PILLS.find((p) => p !== id && isVisible(next, p));
  return { ...next, active: other ?? 'chat' };
}

/** How long the chat transcript's scrollbar stays after the last scroll event. */
export const TRANSCRIPT_BAR_MS = 900;
/** How long after a wheel, a scroll key or a press a scroll event still counts as the reader's. */
export const USER_SCROLL_MS = 400;
const SCROLL_KEYS: ReadonlySet<string> = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ']);

/** The stage column width at and under which the crumb is hidden (shell2.css `@container s2main (max-width: 640px)`); read here instead of the crumb's computed display, which lags a resize by a frame. */
export const CRUMB_HIDDEN_AT = 640;

/** The width of the bar's fade edge (shell2.css .s2-surfaces[data-fade]). */
export const FADE_PX = 28;

/**
 * Which edge of a sideways scroller has more to scroll to (round 8), as
 * `data-fade` (start, end, both), so CSS fades only that edge.
 */
export function scrollFade(el: { scrollLeft: number; scrollWidth: number; clientWidth: number }): 'start' | 'end' | 'both' | null {
  const more = el.scrollWidth - el.clientWidth;
  if (more <= 1) return null;
  const start = el.scrollLeft > 1;
  const end = el.scrollLeft < more - 1;
  return start && end ? 'both' : start ? 'start' : end ? 'end' : null;
}

/**
 * Writes the scroll cues straight to the DOM: the fade edge (`data-fade`) and the grab cursor (`data-scrollable`) on
 * the bar, the grips' side (`data-more`) on its wrap. 0.1.6 G2: they were React state, so crossing an edge during a
 * drag re-rendered the whole shell (board, panes, chat) in the middle of the gesture. The CSS reads the attributes
 * either way; nothing needs the shell to render for them.
 */
function markFade(el: HTMLElement | null): ReturnType<typeof scrollFade> {
  if (!el) return null;
  const f = scrollFade(el);
  const set = (node: Element | null, name: string, value: string | null) => {
    if (!node) return;
    if (value === null) {
      if (node.hasAttribute(name)) node.removeAttribute(name);
    } else if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  };
  set(el, 'data-fade', f);
  set(el, 'data-scrollable', f ? 'true' : null);
  set(el.parentElement, 'data-more', f);
  return f;
}

/** Keeps the scroll cues on a sideways scroller current (round 11: a chevron shows each; 0.1.6: no state). */
function useScrollFade(ref: { current: HTMLElement | null }): void {
  /* After every render: opening or closing a surface changes what there is to scroll. */
  useEffect(() => void markFade(ref.current));
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const mark = () => void markFade(el);
    el.addEventListener('scroll', mark, { passive: true });
    window.addEventListener('resize', mark);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(mark);
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', mark);
      window.removeEventListener('resize', mark);
      ro?.disconnect();
    };
  }, [ref]);
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
}

type NarrowView = 'chat' | 'stage' | 'agents';

/* The doors the palette alone used to hold, now also in the chat's more menu (round 11): same rows, same words. */
const CHAT_MENU_DOORS: readonly { id: string; icon: S2IconName; note: string }[] = [
  { id: 'overlay.search', icon: 'search', note: 'Find text in the project' },
  { id: 'overlay.review', icon: 'diffi', note: 'See what changed, file by file' },
  { id: 'overlay.rewind', icon: 'undo', note: 'Undo what a turn changed' },
  { id: 'overlay.help', icon: 'spark', note: 'Keys and what you can do' },
];
const doorOf = (id: string): ShellCommand | undefined => SHELL_COMMANDS.find((c) => c.id === id);

/** One resize hairline: a separator a pointer drags and the arrow keys step. */
function Sizer({
  label,
  testId,
  className,
  min,
  max,
  now,
  valueText,
  frame,
  onDown,
  onKey,
  onReset,
}: {
  label: string;
  testId: string;
  className: string;
  min: number;
  max: number;
  now: number;
  /** What a screen reader hears, e.g. "50 percent". */
  valueText?: string;
  /** The lock frame the divider sits on (a whole percent), or null between frames. */
  frame?: number | null;
  onDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onKey: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  onReset: () => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={now}
      aria-valuetext={valueText}
      aria-keyshortcuts="ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight Home End"
      data-frame={frame ?? undefined}
      tabIndex={0}
      className={className}
      data-testid={testId}
      onPointerDown={onDown}
      onKeyDown={onKey}
      onDoubleClick={onReset}
    />
  );
}

export function Shell2({ onOpenSettings, onOpenProject, onOpenWorkspace, openFailure, onDismissOpenFailure }: Shell2Props) {
  const store = useStore();
  const appState = useAppState();
  const [tabs, setTabs] = useState<ChromeTabState>(() => readTabs());
  /* The window's width: narrow below 1024; the stage's cap follows it (round 11 look). */
  const [winW, setWinW] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
  useEffect(() => {
    const on = () => setWinW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  /* The chat transcript's scrollbar shows while the READER scrolls it (shell2.css: an overlay thumb, hidden at rest), never
     while an answer streams in (owner: the stick-to-bottom scroll must not flash it). A scroll event is the reader's only
     inside a short window armed by a wheel, a scroll key, a press on the transcript or its thumb, or a touch; outside it
     the event is ignored. Scroll events do not bubble, so one capturing listener marks whichever scroller moves. */
  useEffect(() => {
    const timers = new WeakMap<Element, number>();
    let armedUntil = 0;
    let held = false;
    const inTranscript = (t: EventTarget | null): boolean => t instanceof Element && !!t.closest('.v3-transcript-wrap');
    const arm = () => {
      armedUntil = performance.now() + USER_SCROLL_MS;
    };
    const onWheel = (e: Event) => inTranscript(e.target) && arm();
    const onKey = (e: KeyboardEvent) => {
      if (!SCROLL_KEYS.has(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      /* A scroll key moves the transcript only when focus is not in a field or another scroller's control. */
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      arm();
    };
    const onDown = (e: Event) => {
      if (!inTranscript(e.target)) return;
      held = true;
      arm();
    };
    const onUp = () => {
      held = false;
      arm();
    };
    const onScroll = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || !el.matches('.v3-transcript, .v3-vlist')) return;
      if (!held && performance.now() > armedUntil) return;
      if (!el.hasAttribute('data-scrolling')) el.setAttribute('data-scrolling', '');
      window.clearTimeout(timers.get(el));
      timers.set(el, window.setTimeout(() => el.removeAttribute('data-scrolling'), TRANSCRIPT_BAR_MS));
    };
    const opt = { capture: true, passive: true } as const;
    document.addEventListener('wheel', onWheel, opt);
    document.addEventListener('touchstart', onDown, opt);
    document.addEventListener('pointerdown', onDown, opt);
    document.addEventListener('pointerup', onUp, opt);
    document.addEventListener('pointercancel', onUp, opt);
    document.addEventListener('touchend', onUp, opt);
    document.addEventListener('keydown', onKey, opt);
    document.addEventListener('scroll', onScroll, opt);
    return () => {
      document.removeEventListener('wheel', onWheel, opt);
      document.removeEventListener('touchstart', onDown, opt);
      document.removeEventListener('pointerdown', onDown, opt);
      document.removeEventListener('pointerup', onUp, opt);
      document.removeEventListener('pointercancel', onUp, opt);
      document.removeEventListener('touchend', onUp, opt);
      document.removeEventListener('keydown', onKey, opt);
      document.removeEventListener('scroll', onScroll, opt);
    };
  }, []);
  const stageMax = stageMaxFor(winW);
  /* Read by the effects and key handlers registered once, so they see the current cap. */
  const stageMaxRef = useRef(stageMax);
  stageMaxRef.current = stageMax;
  /* Narrowing the window retires the oldest surfaces that no longer fit. */
  useEffect(() => {
    setTabs((prev) => fitStage(prev, stageMax));
  }, [stageMax]);
  const [full, setFull] = useState<ChromeTabId | null>(null);
  const [mac, setMac] = useState(false);
  const [chatMenu, setChatMenu] = useState(false);
  const chatMenuRef = useRef<HTMLDivElement | null>(null);
  useMenuKeys(chatMenu, chatMenuRef, () => setChatMenu(false));
  useEffect(() => {
    if (!chatMenu) return undefined;
    const close = () => setChatMenu(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [chatMenu]);
  const [agentsOpen, setAgentsOpen] = useState(() => {
    try {
      return localStorage.getItem('v3.agentsOpen') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const m = isMacPlatform();
    setMac(m);
    document.documentElement.setAttribute('data-platform', m ? 'mac' : 'win');
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('v3.chromeTabs', JSON.stringify(tabs));
    } catch {
      /* ignore */
    }
  }, [tabs]);

  /* The surface the answer is about opens itself (as the old shell did). */
  useEffect(() => {
    if (!appState.session.filesFocus) return;
    setTabs((prev) => openOnStage(prev, 'files', stageMaxRef.current));
    setFull(null);
    setView('stage');
  }, [appState.session.filesFocus]);
  const surfaceFocus = appState.session.surfaceFocus;
  useEffect(() => {
    if (surfaceFocus === null) return;
    setTabs((prev) => openOnStage(prev, surfaceFocus, stageMaxRef.current));
    setFull(null);
    setView('stage');
  }, [surfaceFocus]);

  useEffect(() => {
    setHostCommandHandler((id) => {
      /* The sidebar is where the reader asked to be taken: unfold it, peeking over the content where the room is short. */
      if (id === 'rail.focus') {
        setSidebarCollapsed(false);
        setPeek(true);
        return;
      }
      const map: Record<string, ChromeTabId> = {
        'canvas.board': 'architecture',
        'canvas.whiteboard': 'whiteboard',
        'canvas.ai': 'ai-canvas',
        'files.open': 'files',
        'terminal.open': 'terminal',
        'browser.open': 'browser',
      };
      const tab = map[id];
      /* A surface opened from anywhere is shown: out of a full-screen pane, and out of narrow Chat. */
      if (tab) {
        setTabs((prev) => openOnStage(prev, tab, stageMaxRef.current));
        setFull(null);
        setView('stage');
      }
    });
    return () => setHostCommandHandler(null);
  }, []);

  const narrow = winW < NARROW_W;
  const [view, setView] = useState<NarrowView>('chat');
  /* The sidebar drawn OVER the content: when it is folded for room (a narrow
     window, or a dock that needs the width), opening it peeks rather than
     taking the room back or changing the reader's stored choice. */
  const [peek, setPeek] = useState(false);
  const forcedRef = useRef(false);
  /* Hide or show the chat column (the palette's "Show or hide the chat"); a Chat button in the bar brings it back. */
  const [chatHidden, setChatHidden] = useState(false);
  /* The Sessions overlay has no panel of its own: the sidebar is the session list, so it opens that. */
  const overlayKind = appState.shell.overlay?.kind;
  useEffect(() => {
    if (overlayKind !== 'sessions') return;
    setSidebarCollapsed(false);
    setPeek(true);
    store.dispatch({ type: 'shell/overlay', overlay: null });
  }, [overlayKind, store]);

  /* ── the sidebar: the reader's choice, folded for room ───────────────── */
  const collapsed = useSidebarCollapsed();
  useEffect(() => {
    setSidebarToggleHandler(() => {
      if (forcedRef.current) setPeek((v) => !v);
      else setSidebarCollapsed(!readSidebarCollapsed());
    });
    return () => setSidebarToggleHandler(null);
  }, []);
  useEffect(() => {
    if (!peek) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPeek(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [peek]);

  const toggleAgents = useCallback(() => {
    setAgentsOpen((was) => {
      try {
        localStorage.setItem('v3.agentsOpen', was ? '0' : '1');
      } catch {
        /* ignore */
      }
      /* On a narrow window the panel is a view of its own: open shows it, close returns to the chat. */
      setView((v) => (was ? (v === 'agents' ? 'chat' : v) : 'agents'));
      return !was;
    });
  }, []);

  /* ── resizing: the chat column and the split dock ──────────────────── */
  const [chatW, setChatW] = useState(() => readChatWidth());
  const [split, setSplit] = useState(() => readSplit());
  const [peekW, setPeekW] = useState(() => readPeekWidth());
  const [resizing, setResizing] = useState<'chat' | 'split' | 'peek' | 'panes' | null>(null);
  /* Three or four surfaces: one share per pane, kept per count; a count not yet dragged reads its stored shares. */
  const [paneShares, setPaneShares] = useState<Record<number, number[]>>({});
  /* "Open new surfaces large": the surface opened last (or brought forward by its name) is the large one, until a
     divider is moved by hand; the next surface opened takes the large place again. */
  const focusLarge = useFocusLarge();
  const [largeId, setLargeId] = useState<ChromeTabId | null>(() => readFocusState().large as ChromeTabId | null);
  const [focusManual, setFocusManual] = useState(() => readFocusState().manual);
  useEffect(() => writeFocusState({ large: largeId, manual: focusManual }), [largeId, focusManual]);
  const mainRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const peekRef = useRef<HTMLDivElement | null>(null);
  const latest = useRef({ chatW, split, peekW, paneShares });
  latest.current = { chatW, split, peekW, paneShares };
  /* Smooth resize (round 0.1.5, G2): a drag costs one frame of work per frame, not one React render per pixel.
     `live(dx)` writes the size straight onto the element (style only, no state) and returns the commit that stores
     it; pointer moves are coalesced to one `live` per animation frame; the last commit runs on release, once, then
     `done` persists it. Shell measurements that would re-render the shell mid-drag wait for the release. */
  const resizingRef = useRef(false);
  const afterResize = useRef<Array<() => void>>([]);
  const drag = (e: ReactPointerEvent<HTMLDivElement>, which: 'chat' | 'split' | 'peek' | 'panes', live: (dx: number) => () => void, done: () => void) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    setResizing(which);
    resizingRef.current = true;
    let pending: number | null = null;
    let frame = 0;
    let commit: (() => void) | null = null;
    const flush = () => {
      frame = 0;
      if (pending === null) return;
      commit = live(pending);
      pending = null;
    };
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      pending = ev.clientX - startX;
      if (pending !== 0) moved = true;
      if (frame === 0) frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(flush) : (flush(), 0);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (frame !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      flush();
      resizingRef.current = false;
      commit?.();
      /* "Open new surfaces large" gives way only to a divider really moved: a click or a right-click leaves it. */
      if (moved && (which === 'split' || which === 'panes')) setFocusManual(true);
      setResizing(null);
      done();
      for (const fn of afterResize.current) fn();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };
  /** What the chat divider splits: the chat and the stage beside it (0 when unmeasured). */
  const chatRoom = () => {
    const main = mainRef.current?.getBoundingClientRect().width ?? 0;
    return main > 0 ? latest.current.chatW + main : 0;
  };
  const onChatDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = chatW;
    /* The stage keeps 320 px: the chat stops growing where the stage would go below it. */
    const room = mainRef.current?.getBoundingClientRect().width ?? 0;
    const cap = room > 0 ? Math.max(CHAT_MIN, start + room - stageKeep()) : CHAT_MAX;
    const total = room > 0 ? start + room : 0;
    drag(
      e,
      'chat',
      (dx) => {
        /* The magnet: near a lock frame of the chat-and-stage room, the edge sits on it. */
        const raw = start + dx;
        const w0 = total > 0 ? snapToFrame(raw / total, SNAP_PX / total) * total : raw;
        const w = Math.min(cap, clampChat(w0));
        const col = chatRef.current;
        if (col) {
          col.style.width = `${w}px`;
          col.style.flexBasis = `${w}px`;
        }
        return () => {
          latest.current.chatW = w;
          setChatW(w);
        };
      },
      () => writeChatWidth(latest.current.chatW),
    );
  };
  const onPeekDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = peekW;
    drag(
      e,
      'peek',
      (dx) => {
        const w = clampPeek(start + dx);
        const slot = peekRef.current;
        if (slot) {
          slot.style.width = `${w}px`;
          slot.style.flexBasis = `${w}px`;
        }
        return () => {
          latest.current.peekW = w;
          setPeekW(w);
        };
      },
      () => writePeekWidth(latest.current.peekW),
    );
  };
  const stepPeek = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    const to = e.key === 'Home' ? PEEK_MIN : e.key === 'End' ? PEEK_MAX : dir !== 0 ? peekW + dir * (e.shiftKey ? 4 : 16) : null;
    if (to === null) return;
    e.preventDefault();
    const w = clampPeek(to);
    setPeekW(w);
    writePeekWidth(w);
  };
  const stepChat = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const total = chatRoom();
    const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    let to: number | null = e.key === 'Home' ? CHAT_MIN : e.key === 'End' ? CHAT_MAX : null;
    if (dir !== 0) {
      /* Arrows jump lock frame to lock frame; Shift+arrow (or an unmeasured room) steps 16 px. */
      const frame = !e.shiftKey && total > 0 ? nextFrame(chatW / total, dir, CHAT_MIN / total, Math.min(CHAT_MAX, total - stageKeep()) / total) : null;
      to = frame !== null ? frame * total : chatW + dir * 16;
    }
    if (to === null) return;
    e.preventDefault();
    const w = clampChat(to);
    setChatW(w);
    writeChatWidth(w);
  };
  const onSplitDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = splitShown();
    const width = stageRef.current?.getBoundingClientRect().width ?? 0;
    if (width <= 0) return;
    drag(
      e,
      'split',
      (dx) => {
        const s = clampSplit(snapToFrame(start + dx / width, SNAP_PX / width));
        const nodes = stageRef.current?.querySelectorAll<HTMLElement>(':scope > .s2-pane');
        if (nodes && nodes.length === 2) {
          nodes[0]!.style.flex = `${s} 1 0`;
          nodes[1]!.style.flex = `${1 - s} 1 0`;
        }
        return () => {
          latest.current.split = s;
          setSplit(s);
        };
      },
      () => writeSplit(latest.current.split),
    );
  };
  const stepSplit = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    let to: number | null = e.key === 'Home' ? SPLIT_MIN : e.key === 'End' ? SPLIT_MAX : null;
    if (dir !== 0) {
      /* Arrows jump lock frame to lock frame (25, 33, 50, 67, 75), then to the bound; Shift+arrow steps 1 percent. */
      const at = splitShown();
      to = e.shiftKey ? at + dir * 0.01 : (nextFrame(at, dir, SPLIT_MIN, SPLIT_MAX) ?? (dir > 0 ? SPLIT_MAX : SPLIT_MIN));
    }
    if (to === null) return;
    e.preventDefault();
    const r = clampSplit(to);
    setFocusManual(true);
    setSplit(r);
    writeSplit(r);
  };

  const review = useReviewDock();
  const [reviewFull, setReviewFull] = useState(false);
  const open = LIVE_PILLS.filter((id) => isVisible(tabs, id));
  /* The review takes one of the stage's two places: beside the focused surface. */
  const withReview = review ? (open.includes(tabs.active as ChromeTabId) ? [tabs.active as ChromeTabId] : open.slice(0, 1)) : open;
  const shown = review && reviewFull ? [] : full && withReview.includes(full) ? [full] : withReview;
  /* A surface that newly opens takes the large place (surfaces opened from anywhere: a command, an answer's Files). */
  const prevOpen = useRef<string[]>(open);
  useEffect(() => {
    const fresh = open.filter((id) => !prevOpen.current.includes(id));
    prevOpen.current = open;
    if (fresh.length === 0) return;
    setLargeId(fresh[fresh.length - 1]!);
    setFocusManual(false);
  }, [open.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const branch = appState.session.git.branch?.trim() || null;
  const late = useAfterFirstPaint();
  /* The surface bar scrolls when its names do not fit; fade only the side with more. */
  const barRef = useRef<HTMLElement | null>(null);
  /* Round 9 (Jaden, 10-08): the status bar centres under the chat box, not the
     whole window; with no chat box on screen it sits bottom-left. */
  const chatRef = useRef<HTMLElement | null>(null);
  const [statusAlign, setStatusAlign] = useState<StatusBarAlign>(null);
  const statusAlignRef = useRef<StatusBarAlign>(null);
  const measureStatus = useCallback(() => {
    if (resizingRef.current) return;
    const node = chatRef.current;
    const r = node && !node.hidden ? node.getBoundingClientRect() : null;
    const next = r && r.width >= 1 ? { left: Math.round(r.left), width: Math.round(r.width) } : null;
    /* Compare against the last value kept in a ref and set only on a change: a functional setState called from a
       layout effect on every render schedules a re-render even when it returns the same value, which tripled the
       commits per keystroke and per streamed chunk (perf ratchet). */
    const a = statusAlignRef.current;
    if (a === next || (a && next && a.left === next.left && a.width === next.width)) return;
    statusAlignRef.current = next;
    setStatusAlign(next);
  }, []);
  /* Every render: the rail opening or a divider drag moves the chat box. */
  useLayoutEffect(measureStatus);
  useEffect(() => {
    window.addEventListener('resize', measureStatus);
    const el = chatRef.current;
    const ro = typeof ResizeObserver !== 'undefined' && el ? new ResizeObserver(measureStatus) : null;
    if (ro && el) ro.observe(el);
    return () => {
      window.removeEventListener('resize', measureStatus);
      ro?.disconnect();
    };
  }, [measureStatus]);
  useScrollFade(barRef);
  /* Owner, 2026-10-09: "the surfaces at the very top should always show their names, always". The bar never
     folds to icons; when the names do not fit it scrolls (drag, wheel) under the edge fade. This measures the
     crumb's room only. */
  const topbRef = useRef<HTMLDivElement | null>(null);
  const measureCompact = useCallback(() => {
    if (resizingRef.current) return;
    const topb = topbRef.current;
    const bar = barRef.current;
    if (!topb || !bar) return;
    /* The crumb keeps clear of the centred pills: it may take what is left of its half. */
    const wrap = bar.parentElement;
    /* The pill indicator is absolutely placed at the OLD focused pill's right edge, and counts in the bar's scrollWidth;
       it is out of the measure and put back, on the new pill, at the end. Names never fold to icons at any width
       (owner, 0.1.6: "it should always show the names of everything"): a bar that does not fit scrolls. */
    /* The indicator is NEVER display:none'd here, not even for an instant: an element that was display:none at the
       last style recalc has no before-change style, so the move that follows starts no transition and the indicator
       jumps (0.1.6 D1). The natural width is read off the pills instead of bar.scrollWidth, which counts it. */
    const pills = bar.querySelectorAll<HTMLElement>('.s2-sp');
    const lastPill = pills.length ? pills[pills.length - 1] : null;
    /* The row's width is read first: it forces the layout, so the crumb's display below is the one the new width gives. */
    void topb.clientWidth;
    /* Round 0.1.5: the pills sit on the bar's centre while they fit between the crumb and the window buttons, and slide
       toward the free side before they would be cut (the owner's "Termi" under the fade). Only when even that room is
       short does the bar scroll. */
    if (wrap && topb.clientWidth > 0) {
      const crumbShown = !!topb.querySelector('.s2-crumb') && topb.clientWidth > CRUMB_HIDDEN_AT;
      const ctl = topb.querySelector<HTMLElement>('.shell-winctl');
      const left = crumbShown ? 112 + 24 : 4;
      const right = ctl ? ctl.offsetWidth + 8 : 4;
      const room = topb.clientWidth - left - right;
      const padR = parseFloat(getComputedStyle(bar).paddingRight) || 0;
      const natural = lastPill && lastPill.offsetWidth > 0 ? Math.ceil(lastPill.offsetLeft + lastPill.offsetWidth + padR) : bar.scrollWidth;
      const w = Math.max(0, Math.min(natural, room));
      const centred = (topb.clientWidth - w) / 2;
      const at = Math.max(left, Math.min(centred, topb.clientWidth - right - w));
      wrap.style.left = `${Math.round(at)}px`;
      wrap.style.transform = 'translateY(-50%)';
      wrap.style.maxWidth = `${Math.round(room)}px`;
    }
    if (wrap && wrap.offsetWidth > 0) topb.style.setProperty('--wrap-w', `${wrap.offsetWidth}px`);
    /* The branch goes before it is cut to a stub: the project name keeps the room, the title carries both. */
    const crumb = topb.querySelector<HTMLElement>('.s2-crumb');
    if (crumb) {
      crumb.removeAttribute('data-trim');
      const b = crumb.querySelector<HTMLElement>('.s2-crumb-b');
      if (crumb.scrollWidth > crumb.clientWidth + 1 || (b && b.clientWidth < 72)) crumb.setAttribute('data-trim', 'true');
    }
    markCut(topb);
    /* The fade edge and the grab cursor follow the size this pass settled on (they were left from the old one). */
    const focusedPill = bar.querySelector<HTMLElement>('.s2-sp.is-focused');
    if (focusedPill) {
      bar.style.setProperty('--ind-x', `${focusedPill.offsetLeft}px`);
      bar.style.setProperty('--ind-w', `${focusedPill.offsetWidth}px`);
    }
    markFade(bar);
  }, []);
  useEffect(() => {
    const again = () => measureCompact();
    afterResize.current.push(again);
    return () => {
      afterResize.current = afterResize.current.filter((fn) => fn !== again);
    };
  }, [measureCompact]);
  /* Drag to scroll (round 12; round 14: the arrow circles are gone, the drag is the way): a mouse or pen
     drag on the bar moves it sideways, the wheel and the arrow keys still work.
     A drag past 4 px is a drag, not a click: the click that ends it is swallowed. */
  /* Round 0.1.5 (G2): the bar has two drags, told apart by whether it overflows. Overflowing, a drag scrolls it (and
     the wheel does). Fitting, there is nothing to scroll, so a drag on a name moves that name: the order is the reader's
     and is remembered. */
  const [order, setOrder] = useState<string[] | null>(readOrder);
  const strip = applyOrder(BASE_STRIP, order);
  const stripRef = useRef(strip);
  stripRef.current = strip;
  const [liftId, setLiftId] = useState<ChromeTabId | null>(null);
  const refocus = useRef<ChromeTabId | null>(null);
  const dragRef = useRef<{ x: number; left: number; moved: boolean; id: number; lift: ChromeTabId | null; last: number; lastT: number; v: number } | null>(null);
  /* 0.1.6 G2 (owner: dragging the bar at 1024 is "very choppy"). Measured first (numbers in e2e/g2-surface-bar.mjs): a
     scroll drag wrote scrollLeft on every pointer event (up to 1000 a second from a mouse), crossing a fade edge or
     starting a drag re-rendered the whole shell through setState, the wheel jumped a notch at a time, and a surface
     opened off the edge snapped. Now: one scroll write per frame, the gesture's cues set on the DOM (no render),
     the wheel and the scroll-into-view eased, and a release carries the drag's speed on and slows it. */
  const barAnim = useRef<{ raf: number; pending: number | null; vel: number; target: number | null }>({ raf: 0, pending: null, vel: 0, target: null });
  const clickGuard = useRef(0);
  const barReduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const barFrame = useCallback(() => {
    const a = barAnim.current;
    a.raf = 0;
    const bar = barRef.current;
    if (!bar) return;
    const max = Math.max(0, bar.scrollWidth - bar.clientWidth);
    const clamp = (n: number) => Math.max(0, Math.min(max, n));
    if (a.pending !== null) {
      bar.scrollLeft = clamp(a.pending);
      a.pending = null;
    } else if (a.vel !== 0) {
      const before = bar.scrollLeft;
      const next = clamp(before + a.vel);
      bar.scrollLeft = next;
      a.vel *= 0.92;
      /* A write the browser rounded away (whole px at DPR 1) moved nothing: stop rather than spin. */
      if (Math.abs(a.vel) < 0.4 || next === 0 || next === max || bar.scrollLeft === before) a.vel = 0;
    } else if (a.target !== null) {
      const cur = bar.scrollLeft;
      const to = clamp(a.target);
      if (Math.abs(to - cur) < 1) {
        bar.scrollLeft = to;
        a.target = null;
      } else {
        bar.scrollLeft = cur + (to - cur) * 0.28;
        /* scrollLeft rounds to whole px at DPR 1, so a small step can round back to where it was: land and stop. */
        if (bar.scrollLeft === cur) {
          bar.scrollLeft = to;
          a.target = null;
        }
      }
    }
    if (a.pending !== null || a.vel !== 0 || a.target !== null) a.raf = requestAnimationFrame(barFrame);
  }, []);
  const barKick = useCallback(() => {
    const a = barAnim.current;
    if (!a.raf) a.raf = requestAnimationFrame(barFrame);
  }, [barFrame]);
  const barStop = useCallback(() => {
    const a = barAnim.current;
    if (a.raf) cancelAnimationFrame(a.raf);
    a.raf = 0;
    a.pending = null;
    a.vel = 0;
    a.target = null;
  }, []);
  useEffect(() => barStop, [barStop]);
  /* Brings a name fully into the bar (8 px of air each side). Glides, or jumps for the first placement and under
     reduced motion. Used when a surface is opened or focused AND when a name is clicked, which opens nothing for a
     surface that is already focused (Agents), so the click is what has to bring it in. */
  const revealPill = useCallback(
    (pill: HTMLElement | null, glide: boolean) => {
      const bar = barRef.current;
      if (!bar || !pill) return;
      /* Clear of the fade edge (FADE_PX), so the pill brought into view is never under the fade. */
      const lo = pill.offsetLeft - FADE_PX;
      const hi = pill.offsetLeft + pill.offsetWidth + FADE_PX;
      const max = Math.max(0, bar.scrollWidth - bar.clientWidth);
      const raw = lo < bar.scrollLeft ? Math.max(0, lo) : hi > bar.scrollLeft + bar.clientWidth ? hi - bar.clientWidth : null;
      const want = raw === null ? null : Math.min(max, raw);
      if (want === null || Math.abs(want - bar.scrollLeft) < 0.5) return;
      if (glide && !barReduced()) {
        barAnim.current.vel = 0;
        barAnim.current.pending = null;
        barAnim.current.target = want;
        barKick();
      } else bar.scrollLeft = want;
    },
    [barKick],
  );
  const onBarPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    const bar = barRef.current;
    if (!bar) return;
    /* A hand on the bar stops whatever was still gliding. */
    barStop();
    const overflowing = bar.scrollWidth > bar.clientWidth;
    const pill = (e.target as HTMLElement).closest<HTMLElement>('.s2-sp[data-pill]');
    const lift = !overflowing && pill ? (pill.dataset.pill as ChromeTabId) : null;
    if (!overflowing && !lift) return;
    dragRef.current = { x: e.clientX, left: bar.scrollLeft, moved: false, id: e.pointerId, lift, last: bar.scrollLeft, lastT: e.timeStamp, v: 0 };
  };
  const onBarPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    const bar = barRef.current;
    if (!d || !bar || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    if (!d.moved) {
      if (Math.abs(dx) < 4) return;
      d.moved = true;
      bar.setAttribute('data-dragging', 'true');
      if (d.lift) setLiftId(d.lift);
      bar.setPointerCapture?.(e.pointerId);
    }
    if (d.lift) {
      /* Reorder live: the name takes the slot its pointer is over; the state moves only when the slot changes. */
      const pills = Array.from(bar.querySelectorAll<HTMLElement>('.s2-sp[data-pill]'));
      const centres = pills.map((p) => {
        const r = p.getBoundingClientRect();
        return r.left + r.width / 2;
      });
      const from = stripRef.current.indexOf(d.lift);
      const to = slotAt(centres, from, e.clientX);
      if (to !== from) {
        const next = moveTo(stripRef.current, d.lift, to);
        stripRef.current = next;
        setOrder(next);
      }
      return;
    }
    /* The write waits for the frame; the speed is the drag's own, in px per ms. */
    const to = d.left - dx;
    const dt = Math.max(1, e.timeStamp - d.lastT);
    d.v = 0.7 * ((to - d.last) / dt) + 0.3 * d.v;
    d.last = to;
    d.lastT = e.timeStamp;
    barAnim.current.pending = to;
    barKick();
  };
  const endBarDrag = (e: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const bar = barRef.current;
    bar?.releasePointerCapture?.(e.pointerId);
    bar?.removeAttribute('data-dragging');
    if (d.lift) setLiftId(null);
    if (d.lift && d.moved) writeOrder(stripRef.current);
    /* The click that follows a drag is not a click on a name: refused for a moment, by the clock. */
    if (d.moved) clickGuard.current = performance.now() + 120;
    /* A fast release keeps going and slows (not under reduced motion). */
    if (d.moved && !d.lift && !barReduced() && Math.abs(d.v) > 0.12 && bar) {
      barAnim.current.vel = d.v * 16;
      barAnim.current.pending = null;
      barKick();
    }
    window.setTimeout(() => {
      if (dragRef.current === d) dragRef.current = null;
    }, 0);
  };
  const statusBarOn = useStatusBar();
  /* Split: one surface on the stage opens the next beside it; two close the other. */
  const toggleSplit = (id: ChromeTabId) => {
    setFull(null);
    if (shown.length > 1) {
      const other = shown.find((x) => x !== id);
      if (other) setTabs((prev) => activateTab(closeOnStage(prev, other), id));
      return;
    }
    const next = LIVE_PILLS.find((x) => x !== id && x !== 'architecture') ?? LIVE_PILLS.find((x) => x !== id);
    if (next) setTabs((prev) => activateTab(openOnStage(prev, next, stageMaxRef.current), id));
  };
  const running = appState.session.inFlight !== null;
  /* Booleans, not the store: Shell2 holds the board and the panes, and re-rendered them on every
     streamed chunk of every chat (speed lane; agents/railRuns.ts). */
  const agentsRunning = useAgentsRunning();
  const activeChatId = appState.session.activeId;
  /* The radar reads "something is working here": a model turn in flight OR an agent run (ACP) live in this chat. */
  const agentRunHere = useAgentRunningIn(activeChatId);
  const chatWorking = running || agentRunHere;
  /* A surface's pill carries its state: a ring while the model draws on it, a dot while it waits on you. */
  const pendingEdits = Object.values(appState.session.proposals).filter((p) => p.status === 'pending').length;
  const statusInput = {
    running: appState.session.inFlight !== null && appState.session.inFlight.phase !== 'done' && appState.session.inFlight.phase !== 'error',
    modelDrawn: new Set<ChromeTabId>(MODEL_DRAWN_PANES),
    agentsRunning,
    pendingEdits,
    pendingTopology: appState.session.topology !== null,
  };

  const reviewShown = !!review && !(full && shown.length === 1 && full === shown[0]);
  /* No surface open: the stage folds away, the bar keeps only its icons and
     the chat card comes to the middle of the window (round 7, B3). */
  const centred = !narrow && open.length === 0 && !review;
  /* With no stage to show, the chat is the whole screen: it is never hidden then. */
  const chatGone = chatHidden && !narrow && !centred;
  const revealChat = () => {
    setChatHidden(false);
    setView('chat');
  };
  const project = groundedRepoName(appState) ?? null;
  /* The focused surface wears a filled pill that slides between names (Cursor's
     layout tabs): measured off the focused name, written as two CSS variables. */
  const focusKey = centred ? '' : `${tabs.active}|${open.join(',')}`;
  useLayoutEffect(() => {
    measureCompact();
    const topb = topbRef.current;
    const ro = typeof ResizeObserver !== 'undefined' && topb ? new ResizeObserver(measureCompact) : null;
    if (ro && topb) ro.observe(topb);
    if (ro && barRef.current?.parentElement) ro.observe(barRef.current.parentElement);
    return () => ro?.disconnect();
  }, [measureCompact, focusKey, winW, narrow, chatGone, centred, project, branch]);
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const place = () => {
      const pill = focusKey ? bar.querySelector<HTMLElement>('.s2-sp.is-focused') : null;
      if (!pill) {
        bar.removeAttribute('data-ind');
        return;
      }
      /* A surface opened off the edge scrolls into view, so what was opened is never out of sight. The first
         placement jumps; every later one glides (not under reduced motion). */
      revealPill(pill, bar.getAttribute('data-ind') === 'on');
      bar.style.setProperty('--ind-x', `${pill.offsetLeft}px`);
      bar.style.setProperty('--ind-w', `${pill.offsetWidth}px`);
      bar.setAttribute('data-ind', bar.getAttribute('data-ind') ? 'on' : 'init');
    };
    place();
    /* The first placement jumps; every later one glides. */
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => bar.getAttribute('data-ind') === 'init' && bar.setAttribute('data-ind', 'on')) : 0;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    ro?.observe(bar);
    return () => {
      ro?.disconnect();
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
    };
  }, [focusKey, strip.join()]);
  /* The wheel scrolls an overflowing bar sideways (a mouse wheel only turns vertically). */
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return undefined;
    const wheel = (e: WheelEvent) => {
      if (bar.scrollWidth <= bar.clientWidth || e.ctrlKey) return;
      const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (raw === 0) return;
      e.preventDefault();
      const d = e.deltaMode === 1 ? raw * 16 : raw;
      const max = Math.max(0, bar.scrollWidth - bar.clientWidth);
      if (barReduced()) {
        bar.scrollLeft = Math.max(0, Math.min(max, bar.scrollLeft + d));
        return;
      }
      /* A notch of the wheel is a target to ease to, and notches add up, so a spin is one smooth run. */
      const a = barAnim.current;
      a.vel = 0;
      a.pending = null;
      a.target = Math.max(0, Math.min(max, (a.target ?? bar.scrollLeft) + d));
      barKick();
    };
    bar.addEventListener('wheel', wheel, { passive: false });
    return () => bar.removeEventListener('wheel', wheel);
  }, [centred, barKick]);
  /* A name moved from the keyboard keeps focus (moving its node can drop it). */
  useLayoutEffect(() => {
    const id = refocus.current;
    if (!id) return;
    refocus.current = null;
    barRef.current?.querySelector<HTMLButtonElement>(`[data-testid="s2-tab-${id}"]`)?.focus();
  });
  /* Arrow keys walk the names (Home and End jump); only the name buttons take part. */
  const onBarKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    /* Alt+arrow moves the focused name one place; plain arrows walk the names. */
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const id = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.s2-sp[data-pill]')?.dataset.pill as ChromeTabId | undefined;
      if (!id) return;
      e.preventDefault();
      const next = moveTo(stripRef.current, id, stripRef.current.indexOf(id) + (e.key === 'ArrowRight' ? 1 : -1));
      stripRef.current = next;
      refocus.current = id;
      setOrder(next);
      writeOrder(next);
      return;
    }
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    const names = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('.s2-sp-main'));
    const at = names.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? names.length - 1 : (at + (e.key === 'ArrowRight' ? 1 : -1) + names.length) % names.length;
    names[to]?.focus();
  };
  /* Who gives way when a dock opens: the sidebar first, then the dock floats over the board. */
  const room = roomFor({ winW, chatW: chatGone ? 0 : chatW, agentsOpen, panes: shown.length + (reviewShown ? 1 : 0), review: reviewShown });
  const reviewOver = !narrow && reviewShown && room.reviewOverlay;
  /* Round 7 (A7): the Agents dock never floats over the board. Where folding the
     sidebar is not enough, it takes the stage's place until it is closed. */
  const agentsSwap = !narrow && agentsOpen && room.agentsOverlay;
  /* Folded for room (narrow, or a dock needs the width): the stored choice
     stands aside, and opening it peeks over the content. */
  const forced = narrow || room.foldRail;
  forcedRef.current = forced;
  const railShut = forced ? !peek : collapsed;
  const peeking = forced && peek;
  /* Folded for room with room to spare: an icon rail keeps New chat and Settings (not below 1200, where the panes need it). */
  const railOk = forced && !narrow && winW >= RAIL_MIN_WIN;
  useEffect(() => {
    if (!forced) setPeek(false);
  }, [forced]);
  const paneCount = shown.length + (reviewShown && !reviewOver ? 1 : 0);
  /* The stage is never squeezed below what its panes can hold legibly: 240 px each (PANE_MIN_PX) and their dividers, and 320 for one. */
  const stageKeep = () => Math.max(320, PANE_MIN_PX * paneCount + 8 * Math.max(0, paneCount - 1));
  /* The room the shares divide: the stage less its dividers (8 px each), live (0 until measured). */
  const [stageW, setStageW] = useState(0);
  const stageWRef = useRef(0);
  const sharesRoom = (n: number) => (stageWRef.current > 0 ? Math.max(0, stageWRef.current - 8 * (n - 1)) : 0);
  /** A count's shares, held to the minimum against the live width: a stale store or a narrower window never leaves a sliver. */
  const heldShares = (n: number) => (focusSh && n === paneCount ? focusSh : holdShares(latest.current.paneShares[n] ?? readPaneShares(n), sharesRoom(n)));
  stageWRef.current = stageW;
  /* The shares while "Open new surfaces large" is on (null: off, one pane, or sized by hand since the last open). */
  const largeNow = largeId && shown.includes(largeId) ? largeId : shown.includes(tabs.active as ChromeTabId) ? (tabs.active as ChromeTabId) : shown[0];
  const focusSh = focusLarge && !focusManual && paneCount >= 2 && largeNow ? focusShares(paneCount, shown.indexOf(largeNow), sharesRoom(paneCount)) : null;
  const splitShown = (): number => (focusSh && paneCount === 2 ? focusSh[0]! : split);
  const sharesNow = focusSh && paneCount >= 3 ? focusSh : paneCount >= 3 ? holdShares(paneShares[paneCount] ?? readPaneShares(paneCount), sharesRoom(paneCount)) : null;
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const measure = () => {
      if (resizingRef.current) return;
      setStageW(Math.round(el.getBoundingClientRect().width));
    };
    measure();
    afterResize.current.push(measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      afterResize.current = afterResize.current.filter((fn) => fn !== measure);
    };
  }, [centred, narrow, winW, shown.length > 0]);
  /* A chat column restored wider than the open surfaces allow (a stored width, a surface opened since) gives way for this
     session, never below its own minimum; the stored choice stays. */
  const gave = useRef('');
  useLayoutEffect(() => {
    if (resizingRef.current || narrow || centred || stageW <= 0 || paneCount < 1) return;
    const keep = stageKeep();
    /* One correction per measured width: the stage re-measures after the chat gives, and only then may it give again. */
    const key = `${stageW}|${paneCount}`;
    if (stageW >= keep || chatW <= CHAT_MIN || gave.current === key) return;
    gave.current = key;
    setChatW(Math.max(CHAT_MIN, chatW - (keep - stageW)));
  }, [stageW, paneCount, chatW, narrow, centred]); // eslint-disable-line react-hooks/exhaustive-deps
  const paneFlex = (index: number) =>
    paneCount === 2 ? { flex: `${index === 0 ? splitShown() : 1 - splitShown()} 1 0` } : sharesNow ? { flex: `${sharesNow[index] ?? 1 / paneCount} 1 0` } : undefined;
  /** The panes' own widths (what the shares divide); the dividers and gaps are not in it. */
  const paneRoom = () => {
    const nodes = stageRef.current?.querySelectorAll<HTMLElement>(':scope > .s2-pane');
    let total = 0;
    nodes?.forEach((n) => {
      total += n.getBoundingClientRect().width;
    });
    return total;
  };
  const setShares = (n: number, next: number[]) => setPaneShares((prev) => ({ ...prev, [n]: next }));
  const onPaneDown = (i: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
    const n = paneCount;
    const start = heldShares(n);
    const total = paneRoom();
    if (total <= 0) return;
    drag(
      e,
      'panes',
      (dx) => {
        const next = resizeShares(start, i, dx / total, PANE_MIN_PX / total);
        const nodes = stageRef.current?.querySelectorAll<HTMLElement>(':scope > .s2-pane');
        nodes?.forEach((node, k) => {
          if (next[k] !== undefined) node.style.flex = `${next[k]} 1 0`;
        });
        return () => {
          latest.current.paneShares = { ...latest.current.paneShares, [n]: next };
          setShares(n, next);
        };
      },
      () => writePaneShares(n, latest.current.paneShares[n] ?? start),
    );
  };
  const stepPane = (i: number) => (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const n = paneCount;
    const now = heldShares(n);
    const total = paneRoom();
    if (total <= 0) return;
    const min = PANE_MIN_PX / total;
    const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    let next: number[] | null = null;
    if (dir !== 0) next = resizeShares(now, i, (dir * (e.shiftKey ? 4 : 16)) / total, min);
    else if (e.key === 'Home') next = resizeShares(now, i, -1, min);
    else if (e.key === 'End') next = resizeShares(now, i, 1, min);
    if (!next) return;
    e.preventDefault();
    setFocusManual(true);
    setShares(n, next);
    writePaneShares(n, next);
  };
  const paneDivider = (i: number) => {
    const n = paneCount;
    const now = sharesNow ?? equalShares(n);
    const total = stageRef.current ? paneRoom() : 0;
    const min = total > 0 ? Math.floor((PANE_MIN_PX / total) * 100) : 15;
    const pair = (now[i] ?? 0) + (now[i + 1] ?? 0);
    const valueNow = Math.max(min, Math.round((now[i] ?? 0) * 100));
    return (
      <Sizer
        label={`Resize surfaces ${i + 1} and ${i + 2}`}
        testId={`s2-pane-divider-${i}`}
        className={`s2-divider${resizing === 'panes' ? ' is-drag' : ''}`}
        min={min}
        max={Math.max(valueNow, Math.round((pair - min / 100) * 100))}
        now={valueNow}
        valueText={`${valueNow} percent`}
        onDown={onPaneDown(i)}
        onKey={stepPane(i)}
        onReset={() => {
          setFocusManual(true);
          const eq = equalShares(n);
          setShares(n, eq);
          writePaneShares(n, eq);
        }}
      />
    );
  };
  const splitSizer = (
    <Sizer
      label="Resize split"
      testId="s2-split-divider"
      className={`s2-divider${resizing === 'split' ? ' is-drag' : ''}`}
      min={Math.round(SPLIT_MIN * 100)}
      max={Math.round(SPLIT_MAX * 100)}
      now={Math.round(splitShown() * 100)}
      valueText={`${Math.round(splitShown() * 100)} percent`}
      frame={frameOf(splitShown())}
      onDown={onSplitDown}
      onKey={stepSplit}
      onReset={() => {
        setFocusManual(true);
        setSplit(SPLIT_DEFAULT);
        writeSplit(SPLIT_DEFAULT);
      }}
    />
  );
  const sidebarOpenButton = (
    <button type="button" className="s2-ibtn s2-g" aria-label="Show sidebar" title="Show sidebar" data-testid="s2-sidebar-open" onClick={toggleSidebar}>
      <S2Icon name="sidebar" />
    </button>
  );
  const views: readonly NarrowView[] = agentsOpen ? ['chat', 'stage', 'agents'] : ['chat', 'stage'];
  const VIEW_LABEL: Record<NarrowView, string> = { chat: 'Chat', stage: 'Workspace', agents: 'Agents' };

  return (
    <div
      className="s2 s2-app v3-scaffold"
      data-testid="shell"
      data-platform={mac ? 'mac' : 'win'}
      data-resizing={resizing ? 'true' : undefined}
      data-home={centred ? 'true' : undefined}
    >
      {narrow ? (
        <div className="s2-narrowbar">
          {railShut ? sidebarOpenButton : <span className="s2-ibtn-ph" />}
          <div className="s2-seg s2-narrow-switch" role="tablist" aria-label="Chat or workspace" data-testid="s2-narrow-switch">
            {views.map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                className={view === v ? 'is-on is-focused' : ''}
                data-testid={`s2-narrow-${v}`}
                onClick={() => setView(v)}
              >
                {VIEW_LABEL[v]}
              </button>
            ))}
          </div>
          {!mac ? <WindowControls /> : <span className="s2-ibtn-ph" />}
        </div>
      ) : null}
      {/* The ASCII ground behind the centred chat covers the whole window,
          status bar included, so it has no edge of its own (round 9: "the
          floating background overlaps"); it never takes a click. */}
      {late && !narrow ? (
        <Suspense fallback={null}>
          <AsciiStage mode={centred ? 'behind-chat' : 'under'} />
        </Suspense>
      ) : null}
      <div className="s2-row" data-view={narrow ? view : undefined} data-stage={centred ? 'none' : undefined}>
      {peeking ? <div className="s2-rail-scrim" aria-hidden="true" onClick={() => setPeek(false)} /> : null}
      {/* Folded for room (not by the reader, not narrow): a rail keeps New chat and Settings in reach. */}
      {railOk ? <SessionRail covered={peeking} onExpand={() => setPeek(true)} onOpenSettings={onOpenSettings} /> : null}
      <div
        className={`v3-rail-slot s2-panel-slot${railShut ? ' is-collapsed' : ''}${peeking ? ' is-overlay' : ''}`}
        data-collapsed={railShut ? 'true' : undefined}
        ref={peekRef}
        style={peeking ? { width: peekW, flexBasis: peekW } : undefined}
      >
        {railShut ? null : (
          <SessionPanel onOpenProject={onOpenProject} onOpenWorkspace={onOpenWorkspace} onOpenSettings={onOpenSettings} onCollapse={toggleSidebar} openFailure={openFailure} />
        )}
        {peeking ? (
          <Sizer
            label="Resize sidebar"
            testId="s2-peek-sizer"
            className={`s2-sizer s2-peek-sizer${resizing === 'peek' ? ' is-drag' : ''}`}
            min={PEEK_MIN}
            max={PEEK_MAX}
            now={peekW}
            valueText={`${peekW} pixels`}
            onDown={onPeekDown}
            onKey={stepPeek}
            onReset={() => {
              setPeekW(PEEK_DEFAULT);
              writePeekWidth(PEEK_DEFAULT);
            }}
          />
        ) : null}
      </div>
      <section
        ref={chatRef}
        className="s2-chat v3-chat-col"
        aria-label="Chat"
        data-testid="s2-chat"
        hidden={(narrow && view !== 'chat') || chatGone}
        style={narrow || centred ? undefined : { width: chatW, flexBasis: chatW }}
      >
        <div className="s2-ch">
          {/* The folded-for-room rail has its own Show sidebar; only the reader's own fold needs this one. */}
          {railShut && !narrow && !chatGone && !railOk ? sidebarOpenButton : null}
          <ChatTitle />
          {/* Round 14: the activity reads at the top of the chat, not in the surface bar's right reserve. */}
          {chatWorking ? (
            <span className="s2-working" aria-live="polite" data-testid="s2-working">
              <ActivityLoader variant="radar" testId="s2-working-radar" />
              <span className="shimmer-text">Working</span>
            </span>
          ) : null}
          <span className="s2-anchor">
            <button
              type="button"
              className="s2-ibtn s2-g"
              aria-label="More options"
              title="More options"
              aria-haspopup="menu"
              aria-expanded={chatMenu}
              data-testid="s2-chat-more"
              onClick={(e) => {
                e.stopPropagation();
                setChatMenu((v) => !v);
              }}
            >
              <S2Icon name="more" />
            </button>
            {chatMenu ? (
              <div ref={chatMenuRef} className="s2-menu s2-menu-down-right" role="menu" aria-label="More options" onClick={(e) => e.stopPropagation()}>
                <div className="s2-menu-h" role="presentation">More options</div>
                {CHAT_MENU_DOORS.map((d) => {
                  const cmd = doorOf(d.id);
                  if (!cmd?.overlay) return null;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      role="menuitem"
                      className="s2-mi"
                      data-testid={`s2-chat-menu-${d.id}`}
                      onClick={() => {
                        setChatMenu(false);
                        store.dispatch({ type: 'shell/overlay', overlay: cmd.overlay! });
                      }}
                    >
                      <S2Icon name={d.icon} />
                      <span className="s2-mi-d">
                        {cmd.label}
                        <span>{d.note}</span>
                      </span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={agentsOpen}
                  className="s2-mi"
                  data-testid="v3-agents-toggle"
                  onClick={() => {
                    setChatMenu(false);
                    toggleAgents();
                  }}
                >
                  <S2Icon name="agents" />
                  <span className="s2-mi-d">
                    Agents
                    <span>Every agent run, as a tree</span>
                  </span>
                  {agentsOpen ? <S2Icon name="check" small /> : null}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="s2-mi"
                  data-testid="s2-chat-menu-commands"
                  onClick={() => {
                    setChatMenu(false);
                    openCommandPalette();
                  }}
                >
                  <S2Icon name="bolt" />
                  <span className="s2-mi-d">
                    All commands
                    <span>{paletteHint()}</span>
                  </span>
                </button>
              </div>
            ) : null}
          </span>
        </div>
        <div className="s2-chat-body">
          <ConnectedChatColumn />
        </div>
      </section>
      {narrow || centred || chatGone ? null : (
        <Sizer
          label="Resize chat column"
          testId="s2-chat-sizer"
          className={`s2-sizer${resizing === 'chat' ? ' is-drag' : ''}`}
          min={CHAT_MIN}
          max={CHAT_MAX}
          now={chatW}
          valueText={`${chatW} pixels`}
          frame={(() => {
            const total = mainRef.current ? chatW + mainRef.current.getBoundingClientRect().width : 0;
            return total > chatW ? frameOf(chatW / total, 1.5 / total) : null;
          })()}
          onDown={onChatDown}
          onKey={stepChat}
          onReset={() => {
            setChatW(CHAT_DEFAULT);
            writeChatWidth(CHAT_DEFAULT);
          }}
        />
      )}
      <main className="s2-mainp" ref={mainRef} hidden={(narrow && view !== 'stage') || agentsSwap} data-swapped={agentsSwap ? 'agents' : undefined}>
        <div className="s2-topb" data-testid="s2-topbar" ref={topbRef}>
          {/* No surface open: the icons sit in the middle between two drag
              strips, in the flow. They used to float over one strip, and a
              frameless window lets a drag region swallow every click on
              whatever floats over it (round 9: "the surface icons at the top
              do nothing"). */}
          {chatGone ? (
            <>
              {railShut && !railOk ? sidebarOpenButton : null}
              <button type="button" className="s2-btn" data-testid="s2-focus-chat" onClick={revealChat}>Chat</button>
            </>
          ) : null}
          {centred ? <span className="s2-grow s2-drag" data-testid="s2-drag-lead" /> : null}
          {/* The top-left of the bar: where this workspace is (project, branch),
              in the same capsule format as the names it leads into. */}
          {centred ? null : (
            <span className="s2-crumb" data-testid="s2-crumb" aria-label="Workspace location" role="group" title={branch ? `${project ?? 'Workspace'} / ${branch}` : (project ?? 'Workspace')}>
              <S2Icon name="folder" small />
              <span className="s2-crumb-p" title={project ?? 'Workspace'}>{project ?? 'Workspace'}</span>
              {branch ? (
                <>
                  <span className="s2-crumb-sep" aria-hidden="true">/</span>
                  <span className="s2-branch s2-crumb-b" title={`Branch ${branch}`}>
                    <S2Icon name="branch" small />
                    <span className="s2-branch-l">{branch}</span>
                  </span>
                </>
              ) : null}
            </span>
          )}
          {/* The drag spacer comes BEFORE the pills in tree order, though it is drawn after them: Electron builds the window
              drag region in tree order and a later region wins where two overlap, so the pills (out of flow, centred over this
              spacer) must be the later one. 0.1.6: a spacer after them swallowed every click (0.1.5), and the cure of giving it
              `app-region: none` cut the whole bar out of the drag, because Chromium computes none as no-drag. */}
          <span className="s2-grow s2-drag" />
          <span className="s2-surfaces-wrap" data-testid="s2-surfaces-wrap">
          <nav
            ref={barRef}
            className="s2-surfaces"
            aria-label="Workspace"
            data-testid="s2-surfaces"
            title="Surfaces: the panels beside the chat. Click a name to open it; drag a name to reorder (Alt+arrow on the keyboard)."
            data-lifted={liftId ?? undefined}
            onKeyDown={onBarKey}
            onFocus={(e) => {
              /* A tab reached by keyboard that is out of view (or under a fade) is brought in, clear of the fade. */
              const t = e.target as HTMLElement;
              if (t.matches?.(':focus-visible')) revealPill(t.closest<HTMLElement>('.s2-sp'), true);
            }}
            onPointerDown={onBarPointerDown}
            onPointerMove={onBarPointerMove}
            onPointerUp={endBarDrag}
            onPointerCancel={endBarDrag}
            onClickCapture={(e) => {
              if (dragRef.current?.moved || performance.now() < clickGuard.current) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
          >
            <span className="s2-sp-ind" aria-hidden="true" data-testid="s2-sp-ind" />
            {strip.map((id) => {
              const on = isVisible(tabs, id);
              const focused = on && tabs.active === id;
              const label = CHROME_TAB_DEFS[id].label;
              const st = tabStatus(id, statusInput);
              return (
                <span key={id} className={`s2-sp${on ? ' is-on' : ''}${focused ? ' is-focused' : ''}${liftId === id ? ' is-lift' : ''}`} data-pill={id} data-state={focused ? 'focused' : on ? 'open' : 'closed'}>
                  <button
                    type="button"
                    className={`s2-sp-main${on ? ' is-on' : ''}${focused ? ' is-focused' : ''}`}
                    aria-pressed={on}
                    aria-current={focused ? 'true' : undefined}
                    data-testid={`s2-tab-${id}`}
                    data-tab-id={id}
                    onPointerEnter={id === 'architecture' ? prefetchArchitecture : undefined}
                    aria-label={label}
                    title={on ? `${label}: ${CHROME_TAB_BLURB[id] ?? 'surface'}` : `Open ${label}: ${CHROME_TAB_BLURB[id] ?? 'surface'}`}
                    aria-describedby={st ? `s2-tabst-${id}` : undefined}
                    /* Middle-click closes an open surface, as in every browser. */
                    onAuxClick={(e) => {
                      if (e.button !== 1 || !on) return;
                      e.preventDefault();
                      if (full === id) setFull(null);
                      setTabs((prev) => closeOnStage(prev, id));
                    }}
                    onClick={(e) => {
                      revealPill(e.currentTarget.closest<HTMLElement>('.s2-sp'), true);
                      setFull(null);
                      /* The name opens a closed surface or brings an open one forward;
                         only the × closes (round 7, B1: "closing is unclear"). */
                      if (!focused) setTabs((prev) => openOnStage(prev, id, stageMaxRef.current));
                      /* "Open new surfaces large": the name just clicked is the large one. */
                      setLargeId(id);
                      setFocusManual(false);
                    }}
                  >
                    {/* The pill is named by its surface. A waiting surface marks its icon slot; the
                        working dot (round 12, Jaden: "dot only when that surface is actively working")
                        follows the name, and only while the surface works. */}
                    {st === 'needs-input' ? (
                      <span className="s2-tabst is-needs-input" data-testid={`v3-tab-status-${id}`} id={`s2-tabst-${id}`} data-status={st} aria-label="Waiting for you" />
                    ) : (
                      <S2Icon name={TAB_ICON[id] ?? 'file'} small />
                    )}
                    <span className={`s2-seg-l${st === 'running' ? ' shimmer-text' : ''}`}>{label}</span>
                    {st === 'running' ? (
                      <span className="s2-sp-dot" aria-hidden="true" data-testid={`s2-sp-dot-${id}`} />
                    ) : null}
                    {st === 'running' ? <span className="s2-sr" role="img" aria-label="Working" id={`s2-tabst-${id}`} data-testid={`v3-tab-status-${id}`} data-status={st} /> : null}
                  </button>
                  {on ? (
                    <button
                      type="button"
                      className="s2-sp-x"
                      aria-label={`Close ${label}`}
                      title={`Close ${label}`}
                      data-testid={`v3-tab-close-${id}`}
                      onClick={() => {
                        if (full === id) setFull(null);
                        setTabs((prev) => closeOnStage(prev, id));
                      }}
                    >
                      <S2Icon name="x" small />
                    </button>
                  ) : null}
                </span>
              );
            })}
          </nav>
          <span className="s2-bar-hit" aria-hidden="true" />
          </span>
          {centred && branch ? (
            <span className="s2-btn s2-branch" title={`Branch ${branch}`}>
              <S2Icon name="branch" small />
              <span className="s2-branch-l">{branch}</span>
            </span>
          ) : null}
          {!mac && !narrow ? <WindowControls /> : null}
        </div>
        {centred ? null : (
        <div className="s2-stage" data-panes={shown.length} ref={stageRef}>
          {shown.length === 0 && !review ? (
            <div className="s2-stage-empty" data-testid="s2-stage-empty">
              <S2Icon name="board" />
              <p>Open a surface from the bar above.</p>
            </div>
          ) : (
            shown.map((id, index) => (
              <Fragment key={id}>
              <section
                className={`s2-pane${tabs.active === id ? ' is-focused' : ''}`}
                aria-label={CHROME_TAB_DEFS[id].label}
                data-surface-pane={id}
                data-focused={tabs.active === id ? 'true' : 'false'}
                style={paneFlex(index)}
                onMouseDown={() => {
                  if (tabs.active !== id) setTabs((prev) => activateTab(prev, id));
                }}
              >
                <div className={`s2-pane-head${FLOAT_HEAD.has(id) ? ' is-float' : ''}`}>
                  {FLOAT_HEAD.has(id) ? null : (
                    <span className="s2-cap is-on">
                      <S2Icon name={TAB_ICON[id] ?? 'file'} small />
                      {CHROME_TAB_DEFS[id].label}
                    </span>
                  )}
                  <span className="s2-grow" />
                  <button
                    type="button"
                    className="s2-ibtn s2-ibtn-sm"
                    aria-label={shown.length > 1 ? 'Unsplit' : 'Split'}
                    aria-pressed={shown.length > 1}
                    data-testid={`s2-pane-split-${id}`}
                    onClick={() => toggleSplit(id)}
                  >
                    <S2Icon name="split" small />
                  </button>
                  <button
                    type="button"
                    className="s2-ibtn s2-ibtn-sm"
                    aria-label={full === id ? 'Exit full screen' : 'Full screen'}
                    aria-pressed={full === id}
                    data-testid={`s2-pane-full-${id}`}
                    onClick={() => setFull(full === id ? null : id)}
                  >
                    <S2Icon name="fit" small />
                  </button>
                </div>
                <div className="s2-pane-body">
                  <LiveSurface tab={id} />
                </div>
              </section>
              {index === 0 && paneCount === 2 ? splitSizer : paneCount >= 3 && index < paneCount - 1 ? paneDivider(index) : null}
              </Fragment>
            ))
          )}
          {reviewShown ? (
            <section
              className={`s2-pane s2-pane-review${reviewOver ? ' is-overlay' : ''}`}
              aria-label="Review"
              data-overlay={reviewOver ? 'true' : undefined}
              style={reviewOver ? undefined : paneFlex(shown.length)}
            >
              <Suspense fallback={null}>
                <ReviewDock target={review} full={reviewFull} onFull={() => setReviewFull((v) => !v)} />
              </Suspense>
            </section>
          ) : null}
        </div>
        )}
      </main>
      {agentsOpen ? (
        <aside
          className={`s2-agents${narrow ? ' is-view' : ''}${agentsSwap ? ' is-swap' : ''}`}
          data-swap={agentsSwap ? 'true' : undefined}
          id="v3-agents-dock"
          data-testid={narrow ? 's2-agents-view' : 'v3-agents-dock'}
          aria-label="Agents"
          hidden={narrow && view !== 'agents'}
        >
          <Suspense fallback={null}>
            <AgentsDock open onClose={toggleAgents} width={AGENTS_W} fill={narrow || agentsSwap} />
          </Suspense>
        </aside>
      ) : null}
      </div>
      {openFailure ? (
        <div className="s2-open-failure" role="alert" data-testid="s2-project-error">
          <span>{openFailure.message}</span>
          <button type="button" className="s2-btn" onClick={openFailure.retry}>Retry opening</button>
          <button type="button" className="s2-btn" onClick={() => {
            onDismissOpenFailure?.();
            store.dispatch({ type: 'shell/overlay', overlay: { kind: 'attach' } });
          }}>Choose another folder</button>
          <button type="button" className="s2-btn" onClick={onDismissOpenFailure}>Dismiss</button>
        </div>
      ) : null}
      {statusBarOn ? <StatusBar align={statusAlign} /> : null}
      <V3CommandPalette
        onRevealChat={revealChat}
        onOpenSurface={(id) => {
          if (id === 'pane.chat') {
            /* Narrow: the chat and the workspace take turns. Wide: the chat folds away or comes back. */
            if (narrow) setView((v) => (v === 'chat' ? 'stage' : 'chat'));
            else setChatHidden((v) => !v);
          }
          if (id === 'pane.rail') toggleSidebar();
          if (id === 'pane.reset') {
            setChatW(CHAT_DEFAULT);
            writeChatWidth(CHAT_DEFAULT);
            setSplit(SPLIT_DEFAULT);
            writeSplit(SPLIT_DEFAULT);
            setPaneShares({});
            for (const n of [3, 4]) writePaneShares(n, equalShares(n));
          }
          const surface: ChromeTabId | null =
            id === 'canvas.whiteboard' ? 'whiteboard' : id === 'canvas.board' ? 'architecture' : id === 'surface.files' ? 'files' : id === 'surface.terminal' ? 'terminal' : id === 'surface.agents' ? 'agents' : null;
          if (surface) {
            setTabs((prev) => openOnStage(prev, surface, stageMaxRef.current));
            setFull(null);
            setView('stage');
          }
        }}
      />
      <V3OverlayHost />
      <KeysHost />
      <LateBoot />
    </div>
  );
}
