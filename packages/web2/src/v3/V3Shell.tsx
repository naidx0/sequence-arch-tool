import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

import { ConnectedAiCanvas } from '../app/AiCanvas';
import {
  CHROME_TAB_DEFS,
  WORKSPACE_PILLS,
  activateTab,
  isVisible,
  minimizeTab,
  toggleTab,
  visibleWorkspacePanes,
  type ChromeTabId,
  type ChromeTabState,
} from '../app/chromeTabModel';
import { setHostCommandHandler } from '../app/hostCommands';
import { BrowserPane } from '../browser/BrowserPane';
import { ConnectedBoard } from '../canvas/ConnectedBoard';
import { Icon } from '../chat/Icon';
import { ConnectedFilesPanel } from '../files/ConnectedFilesPanel';
import { createSessionsClient } from '../sessions/sessionsClient';
import { WindowControls } from '../shell/WindowControls';
import { ConnectedChatColumn, groundedRepoRoot, useAppState } from '../state/connect';
import { TerminalPane } from '../terminal/TerminalPane';
import { ConnectedWhiteboard } from '../whiteboard/ConnectedWhiteboard';
import { V3CommandPalette } from './V3CommandPalette';
import { V3OverlayHost } from './V3OverlayHost';
import { V3SessionsRail } from './V3SessionsRail';
import { frameOf, snapOnRelease, snapSplit } from './paneFrames';

export interface V3ShellProps {
  onOpenSettings?: () => void;
  onOpenProject?: (repoPath: string, sessionId: string) => void;
}

const RAIL_MIN = 180;
const RAIL_MAX = 420;
/* 320: the composer keeps Plan · model · effort · Send on ONE row down to here
   (below it the row goes compact via container query — never a second row). */
const CHAT_MIN = 320;
const CHAT_MAX = 1200;
/* 240: the whiteboard / AI Canvas toolbar holds one row down to here. */
const LIVE_PANE_MIN = 240;

const LIVE_PILLS: readonly ChromeTabId[] = WORKSPACE_PILLS.filter((id) => id !== 'chat');

/**
 * WHERE THE RELEASE WILL LAND, DRAWN WHILE THE DRAG IS STILL RUNNING.
 *
 * `x` is offset from the left edge of the host box — `.v3-center-panes` for the
 * chat splitter, `.v3-live-stack` for a live split — because that is the box the
 * frame is a fraction OF, and a guide measured against anything else would
 * point at a width the release does not produce.
 */
type SnapGuide = { host: 'center' | 'live'; x: number };

type DragState =
  | { kind: 'rail'; startX: number; startW: number }
  | { kind: 'chat'; startX: number; startW: number }
  | {
      kind: 'live';
      startX: number;
      leftId: ChromeTabId;
      rightId: ChromeTabId;
      startLeft: number;
      startRight: number;
      /** Left pane's offset inside `.v3-live-stack` — the guide's origin. */
      stackOffset: number;
    };

const INITIAL_TABS: ChromeTabState = {
  tabs: [
    { id: 'chat', minimized: false },
    { id: 'architecture', minimized: false },
  ],
  active: 'architecture',
};

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
    ?.platform;
  return /Mac|iPhone|iPad|iPod/i.test(ua) || platform === 'macOS';
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function readStoredWidth(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function defaultChatWidth(): number {
  const fallback =
    typeof window !== 'undefined' ? Math.round(Math.max(480, (window.innerWidth - 280) * 0.5)) : 560;
  return clamp(readStoredWidth('v3.chatW', fallback), CHAT_MIN, CHAT_MAX);
}

function readChromeTabs(): ChromeTabState {
  try {
    const raw = localStorage.getItem('v3.chromeTabs');
    if (!raw) return INITIAL_TABS;
    const parsed = JSON.parse(raw) as ChromeTabState;
    if (!parsed || !Array.isArray(parsed.tabs) || typeof parsed.active !== 'string') {
      return INITIAL_TABS;
    }
    const tabs = parsed.tabs.filter((t) => typeof t?.id === 'string');
    if (tabs.length === 0) return INITIAL_TABS;
    return { tabs, active: parsed.active as ChromeTabId };
  } catch {
    return INITIAL_TABS;
  }
}

/** Close a live pane; last live pane falls back to Chat-only rather than no-op.
 *  Prefer focusing another live pane so chat does not expand and hide the rest. */
function closeLivePane(state: ChromeTabState, id: ChromeTabId): ChromeTabState {
  const liveOpen = LIVE_PILLS.filter((p) => isVisible(state, p));
  if (liveOpen.length <= 1 && liveOpen[0] === id) {
    return activateTab(minimizeTab(state, id), 'chat');
  }
  const tabs = state.tabs.map((t) => (t.id === id ? { ...t, minimized: true } : t));
  const otherLive = LIVE_PILLS.find((p) => tabs.some((t) => t.id === p && !t.minimized));
  return { tabs, active: otherLive ?? state.active };
}

function TabIcon({ tab }: { tab: ChromeTabId }) {
  /* 14, matching `.v3-tab svg` — one size, one stroke weight. */
  return <Icon name={CHROME_TAB_DEFS[tab].icon} size={14} />;
}

function LiveSurface({ tab }: { tab: ChromeTabId }) {
  const state = useAppState();
  const repoRoot = groundedRepoRoot(state);

  if (tab === 'architecture') {
    return (
      <div className="v3-surface" data-surface="architecture">
        <div className="v3-board-wrap">
          <ConnectedBoard />
        </div>
      </div>
    );
  }
  if (tab === 'files') {
    return (
      <div className="v3-surface" data-surface="files">
        <div className="v3-files-wrap">
          <ConnectedFilesPanel />
        </div>
      </div>
    );
  }
  if (tab === 'whiteboard') {
    return (
      <div className="v3-surface" data-surface="whiteboard">
        <div className="v3-whiteboard">
          <ConnectedWhiteboard />
        </div>
      </div>
    );
  }
  if (tab === 'ai-canvas') {
    return (
      <div className="v3-surface" data-surface="ai-canvas">
        <div className="v3-ai-canvas">
          <ConnectedAiCanvas />
        </div>
      </div>
    );
  }
  if (tab === 'terminal') {
    return (
      <div className="v3-surface" data-surface="terminal">
        <div className="v3-terminal">
          <TerminalPane repoRoot={repoRoot} />
        </div>
      </div>
    );
  }
  if (tab === 'browser') {
    return (
      <div className="v3-surface" data-surface="browser">
        <div className="v3-browser">
          <BrowserPane />
        </div>
      </div>
    );
  }
  return null;
}

function readLiveWidths(): Record<string, number> {
  try {
    const raw = localStorage.getItem('v3.liveW');
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

export function V3Shell({ onOpenSettings, onOpenProject }: V3ShellProps) {
  const appState = useAppState();
  const [chromeTabs, setChromeTabs] = useState<ChromeTabState>(() => readChromeTabs());
  const [mac, setMac] = useState(false);
  const [railW, setRailW] = useState(() => readStoredWidth('v3.railW', 260));
  const [chatW, setChatW] = useState(() => defaultChatWidth());
  const [liveW, setLiveW] = useState<Record<string, number>>(() => readLiveWidths());
  const sessionsClient = createSessionsClient();
  const chatExpanded = chromeTabs.active === 'chat' && isVisible(chromeTabs, 'chat');
  const openLive = LIVE_PILLS.filter((id) => isVisible(chromeTabs, id));
  const bodyRef = useRef<HTMLDivElement>(null);
  const liveStackRef = useRef<HTMLDivElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  /* The width the chat column and the live stack share — what a frame is a
     fraction OF. Measured, never assumed from the window: the rail is
     resizable too. */
  const [centerW, setCenterW] = useState(0);
  useEffect(() => {
    const el = centerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => setCenterW(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const dragRef = useRef<DragState | null>(null);
  /* THE LANDING, HELD UNTIL THE FINGER LIFTS. pointerup carries no width of its
     own worth trusting (a release can fire at a coordinate the last move never
     reported), so the snap the guide is drawing is the snap that gets applied.
     A ref, not state: pointerup must read what the last move wrote, not what
     the last render closed over. */
  const pendingRef = useRef<(() => void) | null>(null);
  const [resizing, setResizing] = useState(false);
  const [guide, setGuide] = useState<SnapGuide | null>(null);

  /* Chat lock: open Files when a proposal streams in. */
  useEffect(() => {
    if (!appState.session.filesFocus) return;
    setChromeTabs((prev) => activateTab(prev, 'files'));
  }, [appState.session.filesFocus]);

  useEffect(() => {
    setHostCommandHandler((id) => {
      if (id === 'canvas.board') setChromeTabs((prev) => activateTab(prev, 'architecture'));
      else if (id === 'canvas.whiteboard') setChromeTabs((prev) => activateTab(prev, 'whiteboard'));
      else if (id === 'canvas.ai') setChromeTabs((prev) => activateTab(prev, 'ai-canvas'));
      else if (id === 'files.open') setChromeTabs((prev) => activateTab(prev, 'files'));
      else if (id === 'terminal.open') setChromeTabs((prev) => activateTab(prev, 'terminal'));
      else if (id === 'browser.open') setChromeTabs((prev) => activateTab(prev, 'browser'));
    });
    return () => setHostCommandHandler(null);
  }, []);

  useEffect(() => {
    const next = isMacPlatform();
    setMac(next);
    document.documentElement.setAttribute('data-platform', next ? 'mac' : 'win');
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('v3.railW', String(railW));
      localStorage.setItem('v3.chatW', String(chatW));
      localStorage.setItem('v3.liveW', JSON.stringify(liveW));
    } catch {
      /* ignore */
    }
  }, [railW, chatW, liveW]);

  useEffect(() => {
    try {
      localStorage.setItem('v3.chromeTabs', JSON.stringify(chromeTabs));
    } catch {
      /* ignore */
    }
  }, [chromeTabs]);

  /* Only re-render the guide when it actually moves: a pointermove that does
     not change the landing must not cost a render, or the fluid drag the owner
     asked for pays for a line that did not move. */
  const setSnapGuide = useCallback((host: 'center' | 'live', x: number) => {
    setGuide((prev) => (prev && prev.host === host && prev.x === x ? prev : { host, x }));
  }, []);

  /* Document-level pointer tracking so resize survives leaving the hit strip. */
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = e.clientX - drag.startX;
      if (drag.kind === 'rail') {
        setRailW(clamp(drag.startW + delta, RAIL_MIN, RAIL_MAX));
        return;
      }
      if (drag.kind === 'chat') {
        /* DRAG-TO-SNAP (owner 2026-09-18): the column follows the pointer while
           the finger is down and lands on a frame when it lifts. The guide line
           below is the only thing that moves in frame steps during the drag. */
        const total = centerRef.current?.getBoundingClientRect().width ?? 0;
        const preview = snapOnRelease(drag.startW + delta, total, CHAT_MIN, CHAT_MAX);
        setChatW(preview.width);
        setSnapGuide('center', preview.release.width);
        pendingRef.current = () => setChatW(preview.release.width);
        return;
      }
      const total = drag.startLeft + drag.startRight;
      if (total < LIVE_PANE_MIN * 2) return;
      const rawLeft = drag.startLeft + delta;
      const live = snapOnRelease(rawLeft, total, LIVE_PANE_MIN, total - LIVE_PANE_MIN);
      setLiveW((prev) => ({
        ...prev,
        [drag.leftId]: live.width,
        [drag.rightId]: total - live.width,
      }));
      const split = snapSplit(rawLeft, total, LIVE_PANE_MIN);
      /* The stack starts where the chat column and its resizer end, so a guide
         inside the stack is measured from the stack's own left edge. */
      setSnapGuide('live', drag.stackOffset + split.left);
      pendingRef.current = () =>
        setLiveW((prev) => ({
          ...prev,
          [drag.leftId]: split.left,
          [drag.rightId]: split.right,
        }));
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      /* ONE COMMIT: the snapped width and the end of the drag land in the same
         React update, so the pane's `transition` comes back in the same style
         recalc that changes its width and the snap EASES rather than jumps. */
      const apply = pendingRef.current;
      pendingRef.current = null;
      apply?.();
      setResizing(false);
      setGuide(null);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
  }, [setSnapGuide]);

  const onPillClick = useCallback((id: ChromeTabId) => {
    setChromeTabs((prev) => {
      if (id === 'chat') {
        if (prev.active === 'chat' && isVisible(prev, 'chat')) {
          const live = visibleWorkspacePanes(prev).find((p) => p !== 'chat');
          if (live) return { ...prev, active: live };
          return toggleTab(prev, 'chat');
        }
        return activateTab(prev, 'chat');
      }
      return toggleTab(prev, id);
    });
  }, []);

  const onResizePointerDown = useCallback(
    (kind: 'rail' | 'chat') => (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startW = kind === 'rail' ? railW : chatW;
      dragRef.current = { kind, startX: e.clientX, startW };
      pendingRef.current = null;
      /* `data-resizing` on the scaffold, from pointerDOWN — the glass and the
         width transitions have to be off BEFORE the first move, or the first
         frame of the drag is the blurred one the owner reported. */
      setResizing(true);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    [railW, chatW],
  );

  const onLiveResizePointerDown = useCallback(
    (leftId: ChromeTabId, rightId: ChromeTabId) => (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const stack = liveStackRef.current;
      if (!stack) return;
      const leftEl = stack.querySelector(`[data-surface="${leftId}"]`) as HTMLElement | null;
      const rightEl = stack.querySelector(`[data-surface="${rightId}"]`) as HTMLElement | null;
      if (!leftEl || !rightEl) return;
      const leftRect = leftEl.getBoundingClientRect();
      dragRef.current = {
        kind: 'live',
        startX: e.clientX,
        leftId,
        rightId,
        startLeft: leftRect.width,
        startRight: rightEl.getBoundingClientRect().width,
        stackOffset: leftRect.left - stack.getBoundingClientRect().left,
      };
      pendingRef.current = null;
      setResizing(true);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    [],
  );

  const showLive = !chatExpanded && openLive.length > 0;

  function livePaneStyle(id: ChromeTabId): CSSProperties | undefined {
    /* One open live pane must fill the stack — a leftover pixel width from a
       prior Architecture|Files split leaves a black third (owner walk). */
    if (openLive.length <= 1) {
      return { flex: '1 1 0', minWidth: LIVE_PANE_MIN };
    }
    const w = liveW[id];
    if (typeof w === 'number' && Number.isFinite(w) && w >= LIVE_PANE_MIN) {
      return { flex: `0 0 ${w}px`, width: w, minWidth: LIVE_PANE_MIN };
    }
    return { flex: '1 1 0', minWidth: LIVE_PANE_MIN };
  }

  return (
    <div className="v3-scaffold" data-resizing={resizing ? 'true' : undefined}>
      <div
        className="v3-win"
        role="application"
        aria-label="Sequence"
        data-testid="shell"
        data-platform={mac ? 'mac' : 'win'}
      >
        <header className="v3-titlebar" data-testid="v3-titlebar">
          <span className="v3-titlebar-brand">
            <svg
              className="v3-titlebar-mark"
              viewBox="0 0 64 64"
              width="16"
              height="16"
              shapeRendering="geometricPrecision"
              aria-hidden="true"
            >
              <g fill="currentColor">
                <rect x="10" y="10" width="26" height="8" rx="4" />
                <rect x="28" y="10" width="8" height="26" rx="4" />
                <rect x="28" y="28" width="26" height="8" rx="4" />
                <rect x="46" y="28" width="8" height="26" rx="4" />
                <rect x="5" y="5" width="18" height="18" rx="5" />
                <rect x="23" y="23" width="18" height="18" rx="5" />
                <rect x="41" y="41" width="18" height="18" rx="5" />
              </g>
            </svg>
            <span className="v3-titlebar-title">Sequence</span>
          </span>
          <span className="v3-titlebar-spacer" aria-hidden="true" />
          {!mac ? <WindowControls /> : null}
        </header>
        <div className="v3-body" ref={bodyRef}>
          <div className="v3-rail-slot" style={{ flexBasis: railW, width: railW }}>
            <V3SessionsRail
              client={sessionsClient}
              onOpenProject={onOpenProject}
              onOpenSettings={onOpenSettings}
              showTraffic={mac}
            />
          </div>
          <div
            className="v3-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sessions rail"
            data-testid="v3-resize-rail"
            onPointerDown={onResizePointerDown('rail')}
          />

          <main className={`v3-center${chatExpanded ? ' is-chat-expanded' : ''}`}>
            <nav className="v3-toolbar" aria-label="Workspace">
              {WORKSPACE_PILLS.map((id) => {
                const def = CHROME_TAB_DEFS[id];
                const selected = chromeTabs.active === id;
                const open = isVisible(chromeTabs, id);
                const isLive = id !== 'chat';
                return (
                  <div
                    key={id}
                    className={`v3-tab-wrap${selected ? ' is-selected' : ''}${open ? ' is-open' : ''}`}
                  >
                    <button
                      type="button"
                      className={`v3-tab${selected ? ' is-selected' : ''}${open ? ' is-open' : ''}`}
                      aria-pressed={open}
                      aria-label={def.label}
                      onClick={() => onPillClick(id)}
                    >
                      <TabIcon tab={id} />
                      <span className="v3-tab-label">{def.label}</span>
                    </button>
                    {isLive && open ? (
                      <button
                        type="button"
                        className="v3-tab-close"
                        aria-label={`Close ${def.label}`}
                        data-testid={`v3-tab-close-${id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setChromeTabs((prev) => closeLivePane(prev, id));
                          setLiveW((prev) => {
                            if (!(id in prev)) return prev;
                            const next = { ...prev };
                            delete next[id];
                            return next;
                          });
                        }}
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </nav>

            <div className="v3-center-panes" ref={centerRef}>
              {guide && guide.host === 'center' ? (
                <div
                  className="v3-snap-guide"
                  data-testid="v3-snap-guide"
                  aria-hidden="true"
                  style={{ left: guide.x }}
                />
              ) : null}
              <div
                className="v3-chat-col"
                aria-label="Chat"
                data-frame={chatExpanded ? 'full' : (frameOf(chatW, centerW) ?? 'free')}
                style={chatExpanded ? undefined : { flexBasis: chatW, width: chatW, maxWidth: chatW }}
              >
                <ConnectedChatColumn />
              </div>
              {showLive ? (
                <>
                  <div
                    className="v3-resizer"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize chat column"
                    data-testid="v3-resize-chat"
                    onPointerDown={onResizePointerDown('chat')}
                  />
                  <div className="v3-live-stack" data-testid="v3-live-stack" ref={liveStackRef}>
                    {guide && guide.host === 'live' ? (
                      <div
                        className="v3-snap-guide"
                        data-testid="v3-snap-guide"
                        aria-hidden="true"
                        style={{ left: guide.x }}
                      />
                    ) : null}
                    {openLive.map((id, index) => (
                      <Fragment key={id}>
                        {index > 0 ? (
                          <div
                            className="v3-resizer"
                            role="separator"
                            aria-orientation="vertical"
                            aria-label={`Resize ${CHROME_TAB_DEFS[openLive[index - 1]!].label} and ${CHROME_TAB_DEFS[id].label}`}
                            data-testid={`v3-resize-live-${openLive[index - 1]}-${id}`}
                            onPointerDown={onLiveResizePointerDown(openLive[index - 1]!, id)}
                          />
                        ) : null}
                        <section
                          className={`v3-live-pane${chromeTabs.active === id ? ' is-focused' : ''}`}
                          aria-label={CHROME_TAB_DEFS[id].label}
                          data-surface={id}
                          data-focused={chromeTabs.active === id ? 'true' : 'false'}
                          style={livePaneStyle(id)}
                          onMouseDown={() => {
                            if (chromeTabs.active !== id) {
                              setChromeTabs((prev) => ({ ...prev, active: id }));
                            }
                          }}
                        >
                          <header className="v3-live-pane-head">
                            <span className="v3-live-pane-title">{CHROME_TAB_DEFS[id].label}</span>
                          </header>
                          <div className="v3-live-pane-body">
                            <LiveSurface tab={id} />
                          </div>
                        </section>
                      </Fragment>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </main>
        </div>
      </div>
      <V3CommandPalette
        onOpenSurface={(id) => {
          if (id === 'canvas.whiteboard') {
            setChromeTabs((prev) => {
              const open = isVisible(prev, 'whiteboard') ? prev : toggleTab(prev, 'whiteboard');
              return activateTab(open, 'whiteboard');
            });
          }
          if (id === 'canvas.board') {
            setChromeTabs((prev) => {
              const open = isVisible(prev, 'architecture') ? prev : toggleTab(prev, 'architecture');
              return activateTab(open, 'architecture');
            });
          }
        }}
      />
      <V3OverlayHost />
    </div>
  );
}
