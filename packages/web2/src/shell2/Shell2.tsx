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
import { useReviewDock } from './reviewDockStore';
import { useMenuKeys } from './menuKeys';
import {
  roomFor,
  AGENTS_W,
  CHAT_DEFAULT,
  CHAT_MAX,
  CHAT_MIN,
  NARROW_W,
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

/** B's order: the board first. */
const STRIP: readonly ChromeTabId[] = [...LIVE_PILLS].sort((a, b) => Number(b === 'architecture') - Number(a === 'architecture'));

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

function markFade(el: HTMLElement | null): ReturnType<typeof scrollFade> {
  if (!el) return null;
  const f = scrollFade(el);
  if (f) el.setAttribute('data-fade', f);
  else el.removeAttribute('data-fade');
  return f;
}

/** Marks the fade edges and returns which sides have more (round 11: a chevron shows each). */
function useScrollFade(ref: { current: HTMLElement | null }): ReturnType<typeof scrollFade> {
  const [fade, setFadeState] = useState<ReturnType<typeof scrollFade>>(null);
  const last = useRef<ReturnType<typeof scrollFade>>(null);
  /* Set only on a change (perf ratchet): a setState on every render, even to the same value, re-renders the shell
     once more after every keystroke and every streamed chunk. */
  const setFade = useCallback((next: ReturnType<typeof scrollFade>) => {
    if (last.current === next) return;
    last.current = next;
    setFadeState(next);
  }, []);
  /* After every render: opening or closing a surface changes what there is to scroll. */
  useEffect(() => setFade(markFade(ref.current)));
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const mark = () => setFade(markFade(el));
    el.addEventListener('scroll', mark, { passive: true });
    window.addEventListener('resize', mark);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(mark);
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', mark);
      window.removeEventListener('resize', mark);
      ro?.disconnect();
    };
  }, [ref, setFade]);
  return fade;
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
  const mainRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const latest = useRef({ chatW, split, peekW, paneShares });
  latest.current = { chatW, split, peekW, paneShares };
  const drag = (e: ReactPointerEvent<HTMLDivElement>, which: 'chat' | 'split' | 'peek' | 'panes', move: (dx: number) => void, done: () => void) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    setResizing(which);
    const onMove = (ev: PointerEvent) => move(ev.clientX - startX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setResizing(null);
      done();
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
    const cap = room > 0 ? Math.max(CHAT_MIN, start + room - 320) : CHAT_MAX;
    const total = room > 0 ? start + room : 0;
    drag(
      e,
      'chat',
      (dx) => {
        /* The magnet: near a lock frame of the chat-and-stage room, the edge sits on it. */
        const raw = start + dx;
        const w = total > 0 ? snapToFrame(raw / total, SNAP_PX / total) * total : raw;
        setChatW(Math.min(cap, clampChat(w)));
      },
      () => writeChatWidth(latest.current.chatW),
    );
  };
  const onPeekDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = peekW;
    drag(e, 'peek', (dx) => setPeekW(clampPeek(start + dx)), () => writePeekWidth(latest.current.peekW));
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
      const frame = !e.shiftKey && total > 0 ? nextFrame(chatW / total, dir, CHAT_MIN / total, Math.min(CHAT_MAX, total - 320) / total) : null;
      to = frame !== null ? frame * total : chatW + dir * 16;
    }
    if (to === null) return;
    e.preventDefault();
    const w = clampChat(to);
    setChatW(w);
    writeChatWidth(w);
  };
  const onSplitDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = split;
    const width = stageRef.current?.getBoundingClientRect().width ?? 0;
    if (width <= 0) return;
    drag(
      e,
      'split',
      (dx) => setSplit(clampSplit(snapToFrame(start + dx / width, SNAP_PX / width))),
      () => writeSplit(latest.current.split),
    );
  };
  const stepSplit = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    let to: number | null = e.key === 'Home' ? SPLIT_MIN : e.key === 'End' ? SPLIT_MAX : null;
    if (dir !== 0) {
      /* Arrows jump lock frame to lock frame (25, 33, 50, 67, 75), then to the bound; Shift+arrow steps 1 percent. */
      to = e.shiftKey ? split + dir * 0.01 : (nextFrame(split, dir, SPLIT_MIN, SPLIT_MAX) ?? (dir > 0 ? SPLIT_MAX : SPLIT_MIN));
    }
    if (to === null) return;
    e.preventDefault();
    const r = clampSplit(to);
    setSplit(r);
    writeSplit(r);
  };

  const review = useReviewDock();
  const [reviewFull, setReviewFull] = useState(false);
  const open = LIVE_PILLS.filter((id) => isVisible(tabs, id));
  /* The review takes one of the stage's two places: beside the focused surface. */
  const withReview = review ? (open.includes(tabs.active as ChromeTabId) ? [tabs.active as ChromeTabId] : open.slice(0, 1)) : open;
  const shown = review && reviewFull ? [] : full && withReview.includes(full) ? [full] : withReview;
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
  const barFade = useScrollFade(barRef);
  /* Owner, 2026-10-09: "the surfaces at the very top should always show their names, always". The bar never
     folds to icons; when the names do not fit it scrolls (drag, wheel) under the edge fade. This measures the
     crumb's room only. */
  const topbRef = useRef<HTMLDivElement | null>(null);
  const measureCompact = useCallback(() => {
    const topb = topbRef.current;
    const bar = barRef.current;
    if (!topb || !bar) return;
    /* The crumb keeps clear of the centred pills: it may take what is left of its half. */
    const wrap = bar.parentElement;
    if (wrap && wrap.offsetWidth > 0) topb.style.setProperty('--wrap-w', `${wrap.offsetWidth}px`);
    /* The branch goes before it is cut to a stub: the project name keeps the room, the title carries both. */
    const crumb = topb.querySelector<HTMLElement>('.s2-crumb');
    if (crumb) {
      crumb.removeAttribute('data-trim');
      const b = crumb.querySelector<HTMLElement>('.s2-crumb-b');
      if (crumb.scrollWidth > crumb.clientWidth + 1 || (b && b.clientWidth < 72)) crumb.setAttribute('data-trim', 'true');
    }
  }, []);
  /* Drag to scroll (round 12; round 14: the arrow circles are gone, the drag is the way): a mouse or pen
     drag on the bar moves it sideways, the wheel and the arrow keys still work.
     A drag past 4 px is a drag, not a click: the click that ends it is swallowed. */
  const dragRef = useRef<{ x: number; left: number; moved: boolean; id: number } | null>(null);
  const [barDragging, setBarDragging] = useState(false);
  const onBarPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    const bar = barRef.current;
    if (!bar || bar.scrollWidth <= bar.clientWidth) return;
    dragRef.current = { x: e.clientX, left: bar.scrollLeft, moved: false, id: e.pointerId };
  };
  const onBarPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    const bar = barRef.current;
    if (!d || !bar || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    if (!d.moved) {
      if (Math.abs(dx) < 4) return;
      d.moved = true;
      setBarDragging(true);
      bar.setPointerCapture?.(e.pointerId);
    }
    bar.scrollLeft = d.left - dx;
  };
  const endBarDrag = (e: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    barRef.current?.releasePointerCapture?.(e.pointerId);
    setBarDragging(false);
    /* Keep `moved` just long enough for the click that follows the release to see it. */
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
  }, [measureCompact, focusKey, winW, narrow, chatGone, centred]);
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const place = () => {
      const pill = focusKey ? bar.querySelector<HTMLElement>('.s2-sp.is-focused') : null;
      if (!pill) {
        bar.removeAttribute('data-ind');
        return;
      }
      /* A surface opened off the edge scrolls into view, so what was opened is never out of sight. */
      const lo = pill.offsetLeft - 8;
      const hi = pill.offsetLeft + pill.offsetWidth + 8;
      if (lo < bar.scrollLeft) bar.scrollLeft = Math.max(0, lo);
      else if (hi > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = hi - bar.clientWidth;
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
  }, [focusKey]);
  /* Arrow keys walk the names (Home and End jump); only the name buttons take part. */
  const onBarKey = (e: ReactKeyboardEvent<HTMLElement>) => {
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
  /* The room the shares divide: the stage less its dividers (8 px each), live (0 until measured). */
  const [stageW, setStageW] = useState(0);
  const stageWRef = useRef(0);
  const sharesRoom = (n: number) => (stageWRef.current > 0 ? Math.max(0, stageWRef.current - 8 * (n - 1)) : 0);
  /** A count's shares, held to the minimum against the live width: a stale store or a narrower window never leaves a sliver. */
  const heldShares = (n: number) => holdShares(latest.current.paneShares[n] ?? readPaneShares(n), sharesRoom(n));
  stageWRef.current = stageW;
  const sharesNow = paneCount >= 3 ? holdShares(paneShares[paneCount] ?? readPaneShares(paneCount), sharesRoom(paneCount)) : null;
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const measure = () => setStageW(Math.round(el.getBoundingClientRect().width));
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [centred, narrow, winW, shown.length > 0]);
  const paneFlex = (index: number) =>
    paneCount === 2 ? { flex: `${index === 0 ? split : 1 - split} 1 0` } : sharesNow ? { flex: `${sharesNow[index] ?? 1 / paneCount} 1 0` } : undefined;
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
      (dx) => setShares(n, resizeShares(start, i, dx / total, PANE_MIN_PX / total)),
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
      now={Math.round(split * 100)}
      valueText={`${Math.round(split * 100)} percent`}
      frame={frameOf(split)}
      onDown={onSplitDown}
      onKey={stepSplit}
      onReset={() => {
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
        style={peeking ? { width: peekW, flexBasis: peekW } : undefined}
      >
        {railShut ? null : (
          <SessionPanel onOpenProject={onOpenProject} onOpenWorkspace={onOpenWorkspace} onOpenSettings={onOpenSettings} onCollapse={toggleSidebar} />
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
          <span className="s2-surfaces-wrap" data-testid="s2-surfaces-wrap" data-more={barFade ?? undefined}>
          <nav
            ref={barRef}
            className="s2-surfaces"
            aria-label="Workspace"
            data-testid="s2-surfaces"
            data-dragging={barDragging ? 'true' : undefined}
            data-scrollable={barFade ? 'true' : undefined}
            onKeyDown={onBarKey}
            onPointerDown={onBarPointerDown}
            onPointerMove={onBarPointerMove}
            onPointerUp={endBarDrag}
            onPointerCancel={endBarDrag}
            onClickCapture={(e) => {
              if (dragRef.current?.moved) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
          >
            <span className="s2-sp-ind" aria-hidden="true" data-testid="s2-sp-ind" />
            {STRIP.map((id) => {
              const on = isVisible(tabs, id);
              const focused = on && tabs.active === id;
              const label = CHROME_TAB_DEFS[id].label;
              const st = tabStatus(id, statusInput);
              return (
                <span key={id} className={`s2-sp${on ? ' is-on' : ''}${focused ? ' is-focused' : ''}`} data-pill={id} data-state={focused ? 'focused' : on ? 'open' : 'closed'}>
                  <button
                    type="button"
                    className={`s2-sp-main${on ? ' is-on' : ''}${focused ? ' is-focused' : ''}`}
                    aria-pressed={on}
                    aria-current={focused ? 'true' : undefined}
                    data-testid={`s2-tab-${id}`}
                    data-tab-id={id}
                    onPointerEnter={id === 'architecture' ? prefetchArchitecture : undefined}
                    aria-label={label}
                    title={on ? label : `Open ${label}`}
                    aria-describedby={st ? `s2-tabst-${id}` : undefined}
                    /* Middle-click closes an open surface, as in every browser. */
                    onAuxClick={(e) => {
                      if (e.button !== 1 || !on) return;
                      e.preventDefault();
                      if (full === id) setFull(null);
                      setTabs((prev) => closeOnStage(prev, id));
                    }}
                    onClick={() => {
                      setFull(null);
                      /* The name opens a closed surface or brings an open one forward;
                         only the × closes (round 7, B1: "closing is unclear"). */
                      if (!focused) setTabs((prev) => openOnStage(prev, id, stageMaxRef.current));
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
          </span>
          <span className="s2-grow s2-drag" />
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
