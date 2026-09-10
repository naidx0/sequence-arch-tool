import { useState, useEffect, useRef, useCallback, type CSSProperties, type ReactNode } from 'react';
/* ── THE STYLE BLOCK ────────────────────────────────────────────────────────
 * ONE ordered block, in ONE place, with the order argued rather than assumed.
 * Later sheets raise radius and padding off earlier defaults, and at equal
 * specificity the later rule wins — so the order below is load-bearing and is
 * not alphabetical, not import-graph order, and not an accident.
 *
 *   1. tokens/graphite.css  declares every custom property and pulls the two
 *                           local typefaces in. Nothing can consume a var()
 *                           that is not declared first, so this is always
 *                           first and can never move.
 *   2. styles/base.css      the reset and the document: box model, the body
 *                           typeface binding, selection, scrollbar, focus.
 *                           Reads tokens, declares no value of its own.
 *   3. shell/shell.css      the three-pane frame, its resizers and its
 *                           breakpoints. Structure before surfaces: a surface
 *                           sheet raises a radius off the frame, never the
 *                           other way round.
 *   4. canvas/board.css     the board — the field, the node card, the legend,
 *                           the one control cluster. It comes after the frame
 *                           because it sizes itself to the pane the frame gives
 *                           it, and BEFORE the two chrome sheets because it is
 *                           the surface they sit beside rather than on. It also
 *                           carries the renderer's own base.css at its top,
 *                           which must land under everything this sheet then
 *                           overrides — the handle, the attribution, the
 *                           selection rect.
 *   5. chat/chat.css        the transcript, the composer, the permission
 *                           control. A surface sheet, so it comes after the
 *                           frame it sits inside.
 *   6. rail/rail.css        the index rail — the filter, the three rungs, the
 *                           detail panel, the flow strip. A surface sheet like
 *                           chat's and in the same relation to the frame: it
 *                           sizes its rows inside the column shell.css gives
 *                           it and raises its own radius and padding off the
 *                           frame's. It comes AFTER chat and not before for the
 *                           one reason that can be argued rather than
 *                           preferred: the two are siblings that never select
 *                           each other, so the order between them decides
 *                           nothing — and where the order decides nothing, the
 *                           list follows the shell's own left-to-right reading
 *                           of the frame, chat then canvas then rail.
 *   6.5 activity/activity.css  the activity view. It is an overlay like review,
 *                           so it belongs in the same band — after every pane
 *                           sheet, because it is drawn OVER them and must be
 *                           able to raise its radius and padding off anything
 *                           it covers. It comes BEFORE review.css for the one
 *                           reason that can be argued rather than preferred:
 *                           the two are siblings that never select each other
 *                           (`.ac-scope` and `.rv-scope` are disjoint), so the
 *                           order between them decides nothing — and where the
 *                           order decides nothing the list follows the palette's
 *                           own ranking, which puts activity above review.
 *   7. review/review.css    the review overlay. AFTER every pane sheet, because
 *                           it is drawn OVER them and a surface that overlays
 *                           must be able to raise off anything it covers. It is
 *                           imported here rather than from `review/index.ts`
 *                           deliberately — that lane's own header says a sheet
 *                           that imported itself "would land wherever the
 *                           module graph happened to put it", and this file is
 *                           where the order is argued.
 *   8. styles/boot.css      the boot and attach surface. Last of the surfaces
 *                           because it overlays everything when it is shown.
 *
 * Each new sheet is added to this list with a line saying what it raises off
 * what — a sheet whose position cannot be argued does not go in.
 */
import '../tokens/graphite.css';
import '../styles/base.css';
import '../shell/shell.css';
import '../canvas/board.css';
import '../chat/chat.css';
import '../rail/rail.css';
import '../activity/activity.css';
import '../search/search.css';
import '../help/help.css';
import '../review/review.css';
import '../settings/settings.css';
import '../styles/boot.css';
import './app.css';
import './aiCanvas.css';

import { setHostCommandHandler } from './hostCommands';
import {
  INITIAL_CHROME_TABS,
  activateTab,
  syncFromWorkspaceSurface,
  openTab,
  shouldOpenAiCanvas,
  visibleCanvasTab,
  visibleWorkspacePanes,
  workspacePaneCapacity,
  fitVisiblePanesToWidth,
  readWorkspacePaneWidths,
  resolveWorkspacePaneWidths,
  resizeWorkspacePanesAt,
  WORKSPACE_PANE_MIN_PX,
  workspacePaneWidthsToMap,
  workspaceSplitGridColumns,
  writeWorkspacePaneWidths,
  type ChromeTabId,
  type ChromeTabState,
} from './chromeTabModel';
import { WorkspacePaneResizer } from './WorkspacePaneResizer';
import { ChromeTabStrip } from './ChromeTabStrip';
import { WorkspaceRail } from './WorkspaceRail';
import { ConnectedAiCanvas } from './AiCanvas';
import { TerminalPane } from '../terminal/TerminalPane';
import '../terminal/terminal.css';
import { BrowserPane } from '../browser/BrowserPane';
import '../browser/browser.css';
import {
  INITIAL_WORKSPACE_VIEWS,
  requestOpen,
  selectHumanSurface,
  setFilesOpen,
  type WorkspaceViewState,
} from './workspaceViews';
import { CanvasProvider, ConnectedBoard, DocProvider, seqdFromGraph } from '../canvas';
import { createReviewClient } from '../review';
import { setCheckpointSessionIdResolver } from '../review/writeSession';
import { RewindPanel } from '../rewind';
import { SettingsPanel, createSettingsClient } from '../settings';
import type { SettingsPane } from '../settings/settingsPanes';
import {
  SessionsPanel,
  createSessionsClient,
  openRepoSession,
  sessionsRepoRevision,
  type OpenRepoSessionResult,
} from '../sessions';
import { flushAndReload, reloadAfterSessionChange } from '../sessions/sessionPersist';
import { ConnectedActivity } from '../activity';
import { ConnectedSearch } from '../search/ConnectedSearch';
import { HelpPanel } from '../help/HelpPanel';
import { onDesktopHelp } from '../boot/desktopBridge';
import { ConnectedReview } from '../review';
import { AttachDialog, createBootTransport } from '../boot';
import { ConnectedIndexRail } from './ConnectedIndexRail';
import { startExternalStaleProbe } from './externalStaleProbe';
import { Whiteboard } from '../whiteboard/Whiteboard';
import { Icon } from '../chat/Icon';
import '../whiteboard/whiteboard.css';
import { readShellPersisted, readShellTokens } from '../shell';
import type { ShellOverlay } from '../state/types';
import { askSurfaceFromChrome } from './workspaceAskSurface';
import type { PermissionMode } from '../state/types';
import {
  readAutoEditEnabled,
  readFullAccessEnabled,
} from '../settings/autonomyPreference';
import { loadWorkspaceCountFacts } from '../settings/settingsFactsLoad';
import {
  ConnectedBootHydrate,
  ConnectedChatColumn,
  ConnectedShell,
  StoreProvider,
  createStore,
  type Store,
  useAppState,
  useStore,
} from '../state';


/**
 * The application root.
 *
 * THE STORE IS CREATED ONCE, AT MODULE SCOPE. It is not React state, it is not
 * behind a ref, and it is not rebuilt on a re-render: `createStore` is the
 * serialization point (risk R13), and a second instance is two applications
 * disagreeing about what the user typed.
 *
 * EVERY PANE IS CONNECTED, AND NONE OF THEM TAKES A PROP FROM HERE. That is
 * what makes this file three lines rather than the composer literal it used to
 * hold: the surfaces read the store through `useSyncExternalStore` and dispatch
 * back into it, so there is no place in this component for a piece of state to
 * be held and quietly diverge. Wave 2's version held the composer's draft here
 * and derived `send` on the way past; the store took both over.
 *
 * `onCommand` IS NOW PASSED, and it was the palette's worst row.
 *
 * The first `owner: 'host'` command was `composer.focus`. It was
 * deliberately unsupplied on the reasoning that focusing a textarea is a DOM
 * act no reducer can perform, and that an honest "not mounted" beats a row
 * that does nothing. Both halves were right, and the consequence was still
 * bad: `composer.focus` is the FIRST row of the palette and the default
 * selection, so the first keystroke a reader tries — Cmd/Ctrl-K, Enter — told
 * them the surface was not mounted. It was mounted. Nothing had connected it.
 *
 * The reducer still performs no DOM act. It bumps `composer.focusNonce`, and
 * the composer — the only component holding the textarea ref — does the
 * focusing. The store carries the REQUEST; the component performs it.
 *
 * ── THE PROJECTOR AND THE BOOT MOUNT ─────────────────────────────────────
 *
 * Both live below, at module scope beside the store, and both are documented
 * on the declaration they belong to rather than here.
 */

/**
 * THE PROJECTOR — the graph→document step, bound at the one place that
 * composes the application.
 *
 * WHAT THIS FIXES, IN THE WORDS OF THE MEASUREMENT. The Wave 3 gate counted
 * `[data-testid="board-node"]` in the SHIPPED BUNDLE and found ZERO. The chain
 * was two missing edges, both of them here: `createStore()` was called with no
 * projector, and `store.ts:915` — correctly — refuses to report `attached`
 * without one, because a `ScannedRepo` needs a `doc` and an empty
 * `SeqDiagramV1` invented at that point would be "a diagram this store
 * invented, painted on the one surface whose whole claim is that it is
 * grounded". The store's refusal was never the bug. The missing projector was.
 *
 * `seqdFromGraph` is the projector, lifted verbatim out of `packages/web` by
 * this same lane. IT IS CALLED WITH THE GRAPH'S OWN `nodeDetail` — the MADR
 * detail map `/archgraph.json` sent WITH the graph, in the same object,
 * deliberately (`state/types.ts`: splitting it out "would make it possible to
 * refresh one without the other"). Passing it here is what puts a node's real
 * description on its card instead of leaving the card to fall back to a bare
 * id; passing anything else would be inventing one.
 *
 * WHAT IT IS NOT ALLOWED TO DO, and what locks that: it must not fabricate
 * topology. No synthesised `part-0 → part-1` chain, no participant the scan did
 * not produce; containment comes from real `parentId` and real group
 * membership. `e2e/board-grounded.mjs` checks every `data-node-id` the board
 * paints against the set of ids a live scan produced, in a real browser, over
 * this bundle.
 */
/**
 * THE SHELL'S STATE STARTS HERE TOO, WHICH IS THE OTHER HALF OF THIS COMMIT.
 *
 * `Shell.tsx` used to build its own opening arrangement with
 * `createShellState(measureFrame(), readShellTokens(...), readShellPersisted())`
 * inside a `useState` initializer, which is why the store's `shell` slice could
 * be written by reducers nothing read. The component is controlled now, so the
 * two readings it did have to happen where the store is built or the store
 * opens on the wrong numbers:
 *
 *   `tokens`    — the seven layout numbers, read off the live cascade rather
 *                 than the mirrored constants, so the token layer stays the
 *                 single source. `Shell.tsx` reads the same declarations for
 *                 the resizers' clamps; that is two readers of one source.
 *   `persisted` — sheet 11: "The width is the user's… and remembered, because
 *                 re-sizing a panel on every launch is the definition of not
 *                 customisable." Read ONCE, here. Nothing reads it again while
 *                 the app runs, so it cannot become a second opinion.
 *
 * The frame is deliberately NOT read here: `initial.ts` measures the window
 * itself and says what to do when there is none — "the caller is expected to
 * dispatch `shell/frame` the moment it has a real measurement" — which is what
 * `Shell.tsx`'s mount effect does.
 */
/* One client for the app's lifetime, so opening Settings twice does not build
   two and the panel does not remount on every render. */
const SETTINGS_CLIENT = createSettingsClient();
const SESSIONS_CLIENT = createSessionsClient();

async function attachRepoSession(
  repoPath: string,
  sessionId: string,
): Promise<OpenRepoSessionResult> {
  const result = await openRepoSession(transport, SESSIONS_CLIENT, repoPath, sessionId);
  if (result.outcome === 'ok') await flushAndReload();
  return result;
}
const store = createStore({
  project: (graph) => seqdFromGraph(graph, graph.nodeDetail),
  tokens: readShellTokens(document.documentElement),
  persisted: readShellPersisted(),
});

/*
 * B3.3 — checkpoint sessionId must be the active chat session, or conversation
 * restore can never find the transcript on disk. Fall back inside
 * checkpointSessionId() when activeId is still null.
 */
setCheckpointSessionIdResolver(() => store.getState().session.activeId);

/* One client, module-scope, exactly like SESSIONS_CLIENT above: a client
   rebuilt on every render would be a new object identity every time, and
   the panel's effects key on it. */
const REVIEW_CLIENT = createReviewClient();

/**
 * The transport, built ONCE at module scope for the same reason the store is.
 *
 * `createBootTransport()` inline in JSX is a new object every render, and
 * `useBoot` holds it in a ref precisely because that is the natural thing to
 * write. Building it here means the ref never has to save anybody.
 */
const transport = createBootTransport();

/**
 * SETTINGS, WITH THE FACTS IT NEEDS.
 *
 * Graph size still comes from the store (one answer to "how big is this graph").
 * Session / recent / memory / hooks counts used to be HARDCODED null/0 here —
 * Memory forever said "has not answered", Session history never counted —
 * while `/api/sessions`, `/api/recent`, `/api/chat-memory`, and `/api/hooks`
 * all answered. Fetch those once when Settings mounts.
 *
 * Counts the server owns and this component has not asked for stay NULL rather
 * than zero. Null renders "waiting"; zero renders "none, and we checked".
 */
function ConnectedSettings({
  pane,
  onLeaveRepo,
  onOpenFolder,
}: {
  pane?: SettingsPane;
  onLeaveRepo?: () => void;
  onOpenFolder?: () => void;
}) {
  const store = useStore();
  const state = useAppState();
  /* Narrowed INLINE rather than through a boolean: TypeScript does not carry a
     discriminant through a variable, and hoisting the check is what turned
     `state.repo.repo` into an error here. */
  const repo =
    state.repo.phase === 'attached' || state.repo.phase === 'stale' ? state.repo.repo : null;
  const graph = repo?.graph ?? null;
  const unscanned = (graph as { unscanned?: { files: number }[] } | null)?.unscanned;

  /* Shell chat + rail when open, plus the always-present workspace column.
     Do not invent "3" — board open/minimized lives in ShellComposition local
     state, not the store, so this count is shell chrome only. */
  const paneCount =
    1 +
    (state.shell.chat.open ? 1 : 0) +
    (state.shell.rail.open ? 1 : 0);

  const [recentCount, setRecentCount] = useState(0);
  const [sessionCount, setSessionCount] = useState<number | null>(null);
  const [memoryAvailable, setMemoryAvailable] = useState<boolean | null>(null);
  const [hookCount, setHookCount] = useState<number | null>(null);
  const [pluginCount, setPluginCount] = useState<number | null>(null);
  const [pluginError, setPluginError] = useState<string | null>(null);
  const [pluginAskWired, setPluginAskWired] = useState<boolean | null>(null);
  const [mcpServerCount, setMcpServerCount] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    void (async () => {
      const next = await loadWorkspaceCountFacts({
        recent: () => transport.recent(),
        sessions: () => SESSIONS_CLIENT.list(controller.signal),
        memory: () =>
          fetch('/api/chat-memory', { signal: controller.signal })
            .then(async (r) => {
              if (!r.ok) return null;
              try {
                return (await r.json()) as { turns?: unknown[] };
              } catch {
                return null;
              }
            })
            .catch(() => null),
        hooks: () => SETTINGS_CLIENT.hooks(controller.signal),
        plugins: async () => {
          try {
            const r = await fetch('/api/plugins', { signal: controller.signal });
            if (!r.ok) return { outcome: 'error' as const };
            const body = (await r.json()) as {
              ok: boolean;
              plugins: unknown[];
              error?: string;
              askWired: boolean;
            };
            return { outcome: 'ok' as const, body };
          } catch {
            return { outcome: 'unreachable' as const };
          }
        },
        mcp: async () => {
          try {
            const r = await fetch('/api/mcp', { signal: controller.signal });
            if (!r.ok) return { outcome: 'error' as const };
            const body = (await r.json()) as { document: { servers: Record<string, unknown> } };
            return { outcome: 'ok' as const, body };
          } catch {
            return { outcome: 'unreachable' as const };
          }
        },
      });
      if (!live) return;
      setRecentCount(next.recentCount);
      setSessionCount(next.sessionCount);
      setMemoryAvailable(next.memoryAvailable);
      setHookCount(next.hookCount);
      setPluginCount(next.pluginCount);
      setPluginError(next.pluginError);
      setPluginAskWired(next.pluginAskWired);
      setMcpServerCount(next.mcpServerCount);
    })();
    return () => {
      live = false;
      controller.abort();
    };
  }, []);

  return (
    <SettingsPanel
      /* The pane the overlay asked for. It has carried one from the
         beginning and the panel never read it. */
      {...(pane ? { pane } : {})}
      client={SETTINGS_CLIENT}
      onAutonomyChange={(enabled) =>
        store.dispatch({ type: 'composer/permission-enabled', enabled })
      }
      {...(onLeaveRepo ? { onLeaveRepo } : {})}
      {...(onOpenFolder ? { onOpenFolder } : {})}
      facts={{
        repoName: repo?.repoName ?? null,
        recentCount,
        sessionCount,
        memoryAvailable,
        graphNodes: graph?.nodes.length ?? 0,
        graphEdges: graph?.edges.length ?? 0,
        unreadFiles: (unscanned ?? []).reduce((n, r) => n + r.files, 0),
        paneCount,
        hookCount,
        pluginCount,
        pluginError,
        pluginAskWired,
        mcpServerCount,
      }}
    />
  );
}

/**
 * THE BOARD REGION — two boards, one at a time, plus the index rail beneath.
 *
 * Owner walk 2026-08-22: "We have this architecture board right here, and
 * we're going to have a separate kind of whiteboard you can switch tabs
 * between. The whiteboard is just like a Miro board where you can literally
 * just draw from scratch."
 *
 * TABS RATHER THAN A MODE, and the reason is not layout. The architecture
 * board is DERIVED — every node from a parser, every edge citing a file and a
 * line. The whiteboard holds whatever somebody drew, with no evidence behind
 * any of it. Overlaid on one surface, those become indistinguishable within a
 * week, and a sketch would sit beside a finding in the same visual language.
 * Two documents, two grounds, one at a time.
 *
 * THE TAB SWITCHER MOVED WITH THE PANE (Decision 5): the board lives in the
 * frame's RIGHT region now, so the tablist that switches it lives there too.
 * The index rail sits beneath the boards — the same pane, the "in-depth
 * breakdown" the owner named as what attaching should open.
 *
 * WHAT MOVED OUT OF THIS COMPONENT: the boot branch. It used to return the
 * boot surface when nothing was drawable, because the boot surface lived in
 * whatever slot held the canvas. Decision 5 gives the pre-board world its own
 * region (the shell's workspace), so the choice between the two is made where
 * it is a fact — the composition below reads attachment once and mounts one
 * or the other.
 */
type CanvasTab = 'board' | 'whiteboard';

type WorkspaceSurface = 'chat' | 'architecture' | 'whiteboard' | 'ai-canvas' | 'terminal' | 'browser';

function workspacePaneTestId(id: ChromeTabId): string {
  if (id === 'chat') return 'shell-workspace-chat';
  if (id === 'architecture') return 'shell-workspace-board';
  return `shell-workspace-pane-${id}`;
}

function WorkspacePaneBody({
  id,
  indexOpen,
  onIndexOpenChange,
}: {
  id: ChromeTabId;
  indexOpen: boolean;
  onIndexOpenChange: (open: boolean) => void;
}) {
  switch (id) {
    case 'chat':
      return <ConnectedChatColumn />;
    case 'ai-canvas':
      return <ConnectedAiCanvas />;
    case 'terminal':
      return <TerminalPane />;
    case 'browser':
      return <BrowserPane />;
    case 'architecture':
      return (
        <BoardRegion tab="board" indexOpen={indexOpen} onIndexOpenChange={onIndexOpenChange} />
      );
    case 'whiteboard':
      return (
        <BoardRegion
          tab="whiteboard"
          indexOpen={indexOpen}
          onIndexOpenChange={onIndexOpenChange}
        />
      );
    default:
      return null;
  }
}

/**
 * Active tab body for the Chrome-style workspace.
 * A single visible pill fills the body; two or more paint resizable columns.
 */
/**
 * MEASURE A LIVE ELEMENT, AND RE-ATTACH WHEN THE ELEMENT ITSELF CHANGES.
 *
 * THE VERSION THIS REPLACES NEVER RAN. It was a `useLayoutEffect` keyed on the
 * ref OBJECT, and a ref object is stable for the life of the component: the
 * effect fired exactly once, on the boot render — where only the Chat pill is
 * open and no split element exists — read `null`, returned, and never fired
 * again when the split later mounted. So `width` stayed 0 and the hook handed
 * back its hardcoded 960 fallback forever. Measured in the shipped bundle at
 * 1920x1080: two panes drew `476px 8px 476px` inside a 1704px container, and
 * resizing the window 1920 → 1280 → 1920 changed nothing at all. 744px of the
 * workspace was dead space, and the app looked broken with no way to tell why.
 *
 * A CALLBACK REF CANNOT HAVE THAT BUG. React invokes it with the element on
 * mount and with `null` on unmount, so the observer attaches to whatever is
 * actually on screen — including an element that appears three renders later.
 * The identity is stable (`useCallback([])`), so a re-render never re-attaches
 * it, and the observer is disconnected before a new one is made.
 */
function useMeasuredWidth(): { ref: (element: HTMLElement | null) => void; width: number } {
  const [width, setWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((element: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!element) {
      /* Do NOT zero the width here: unmount is not a measurement, and a 0 read
         back as "no room" would minimise panes on the way past. */
      return;
    }

    const measure = () => {
      const next = element.clientWidth || element.getBoundingClientRect().width;
      setWidth(next > 0 ? next : 0);
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observerRef.current = observer;
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return { ref, width };
}

/** `.shell-cb-rail`'s fixed column (shell/shell.css:340-344), for the one
 *  frame before the observer has reported. Never a substitute for a
 *  measurement — a fallback that ships as the real answer is how the 960px
 *  above survived three rounds. */
const WORKSPACE_RAIL_PX = 216;

function fallbackWorkspaceWidth(): number {
  const frame = typeof window === 'undefined' ? 0 : window.innerWidth;
  return Math.max(WORKSPACE_PANE_MIN_PX, frame - WORKSPACE_RAIL_PX);
}

function WorkspacePane({
  tabs,
  containerWidth,
  indexOpen,
  onIndexOpenChange,
  onActivateTab,
}: {
  tabs: ChromeTabState;
  /** Measured `.shell-cb-body` width; 0 until the observer has reported. */
  containerWidth: number;
  indexOpen: boolean;
  onIndexOpenChange: (open: boolean) => void;
  onActivateTab: (id: ChromeTabId) => void;
}) {
  const panes = visibleWorkspacePanes(tabs);
  const splitWidth = containerWidth > 0 ? containerWidth : fallbackWorkspaceWidth();
  const persistedRef = useRef(readWorkspacePaneWidths());
  const [paneWidths, setPaneWidths] = useState<number[]>([]);
  const [draggingResizer, setDraggingResizer] = useState<number | null>(null);
  const paneKey = panes.join(',');

  useEffect(() => {
    if (panes.length < 2) {
      setPaneWidths([]);
      return;
    }
    setPaneWidths(resolveWorkspacePaneWidths(panes, splitWidth, persistedRef.current));
  }, [paneKey, splitWidth]);

  const persistWidths = (widths: number[]) => {
    const map = workspacePaneWidthsToMap(panes, widths);
    persistedRef.current = map;
    writeWorkspacePaneWidths(map);
  };

  if (panes.length === 0) {
    return (
      <div className="shell-workspace-empty" data-testid="shell-workspace-empty">
        Select a tab above
      </div>
    );
  }

  if (panes.length === 1) {
    return (
      <WorkspacePaneBody
        id={panes[0]!}
        indexOpen={indexOpen}
        onIndexOpenChange={onIndexOpenChange}
      />
    );
  }

  const gridColumns =
    paneWidths.length === panes.length
      ? workspaceSplitGridColumns(paneWidths)
      : workspaceSplitGridColumns(resolveWorkspacePaneWidths(panes, splitWidth, persistedRef.current));

  const cells: ReactNode[] = [];
  panes.forEach((id, index) => {
    cells.push(
      <section
        key={id}
        className={[
          'shell-workspace-split-pane',
          `shell-workspace-pane-${id}`,
          tabs.active === id ? 'shell-workspace-pane-focused' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        data-testid={workspacePaneTestId(id)}
        data-pane={id}
        data-focused={tabs.active === id ? 'true' : 'false'}
        onPointerDownCapture={() => {
          if (tabs.active !== id) onActivateTab(id);
        }}
      >
        <WorkspacePaneBody
          id={id}
          indexOpen={indexOpen}
          onIndexOpenChange={onIndexOpenChange}
        />
      </section>,
    );

    const nextId = panes[index + 1];
    if (nextId != null) {
      const leftWidth =
        paneWidths[index] ??
        resolveWorkspacePaneWidths(panes, splitWidth, persistedRef.current)[index] ??
        WORKSPACE_PANE_MIN_PX;
      const rightWidth =
        paneWidths[index + 1] ??
        resolveWorkspacePaneWidths(panes, splitWidth, persistedRef.current)[index + 1] ??
        WORKSPACE_PANE_MIN_PX;
      cells.push(
        <WorkspacePaneResizer
          key={`resizer-${id}-${nextId}`}
          leftPane={id}
          rightPane={nextId}
          leftWidth={leftWidth}
          rightWidth={rightWidth}
          dragging={draggingResizer === index}
          onDragStart={() => setDraggingResizer(index)}
          onDragEnd={() => {
            setDraggingResizer(null);
            setPaneWidths((current) => {
              if (current.length === panes.length) persistWidths(current);
              return current;
            });
          }}
          onResize={(nextLeft) => {
            setPaneWidths((current) => {
              const base =
                current.length === panes.length
                  ? current
                  : resolveWorkspacePaneWidths(panes, splitWidth, persistedRef.current);
              const delta = nextLeft - (base[index] ?? nextLeft);
              return resizeWorkspacePanesAt(base, index, delta);
            });
          }}
        />,
      );
    }
  });

  return (
    <div
      className="shell-workspace-split"
      data-testid="shell-workspace-split"
      data-workspace-split="resizable"
      data-dragging={draggingResizer != null ? 'true' : 'false'}
      style={{ gridTemplateColumns: gridColumns } as CSSProperties}
    >
      {cells}
    </div>
  );
}

function applyTabToViews(state: WorkspaceViewState, tabId: ChromeTabId): WorkspaceViewState {
  if (tabId === 'chat') return selectHumanSurface(state, 'chat');
  if (tabId === 'architecture') return selectHumanSurface(state, 'architecture');
  if (tabId === 'whiteboard') return selectHumanSurface(state, 'whiteboard');
  if (tabId === 'ai-canvas') return state;
  return state;
}

function viewsFromTabClose(state: WorkspaceViewState, tabId: ChromeTabId): WorkspaceViewState {
  if (tabId === 'architecture' || tabId === 'whiteboard') {
    return { ...state, boardOpen: false, boardMinimized: false };
  }
  return state;
}

function BoardRegion({
  tab,
  indexOpen,
  onIndexOpenChange,
}: {
  tab: CanvasTab;
  indexOpen: boolean;
  onIndexOpenChange: (open: boolean) => void;
}) {
  const activeStore = useStore();
  const state = useAppState();

  const repoRoot =
    state.repo.phase === 'attached' || state.repo.phase === 'stale' ? state.repo.repo.root : null;

  /*
   * ── WHAT THE WHITEBOARD CAN POINT AT, AND WHERE ITS QUESTIONS GO ───────
   *
   * `WbNodeRef` had a type, a renderer and a stylesheet and nothing created
   * one, so the whiteboard's only structural link back to the scan was
   * unreachable — the missing half of "not just visually, but in real structure
   * within the project". It needs the graph to point at, and it needs somewhere
   * for a finished drawing to go.
   *
   * THE REQUEST LANDS IN THE COMPOSER, NEVER ON THE WIRE. The owner's
   * constraint on the board's Generate gate — "Generate is an explicit act with
   * a confirmation step" — is the same constraint here, and this is the same
   * shape `ConnectedBoard` already uses for it: draft plus chips, and the
   * reader presses send.
   */
  const graph =
    state.repo.phase === 'attached' || state.repo.phase === 'stale' ? state.repo.repo.graph : null;

  const onAsk = (request: { prompt: string; nodeIds: string[] }) => {
    activeStore.dispatch({ type: 'composer/draft', text: request.prompt });
    for (const nodeId of request.nodeIds) {
      /*
       * THE LABEL COMES FROM THE LIVE GRAPH, NOT FROM THE DRAWING.
       *
       * `WbNodeRef` stores the label "as it read at the time" and is explicit
       * that it is a POINTER, never a copy — "a whiteboard that copied a node's
       * substance would be a second, staler answer to a question the graph
       * already answers". A sketch made three weeks ago can name a service that
       * has since been renamed or deleted.
       *
       * So a reference whose node is GONE adds no chip. The prompt still names
       * it, because the reader wrote it; what is refused is a grounded chip
       * pointing at nothing, which is the one thing a chip promises not to be.
       */
      const node = graph?.nodes.find((n) => n.id === nodeId);
      if (!node) continue;
      activeStore.dispatch({
        type: 'composer/chip-add',
        chip: {
          /* Derived from the ref, so the same service chosen twice does not
             stack two identical chips — the rule `chipFromMention` follows. */
          id: `node:${node.id}`,
          kind: 'node',
          ref: node.id,
          label: node.label,
          nodeKind: node.kind,
        },
      });
    }
  };

  return (
    <div className="boardregion" data-testid="board-region">
      <div className="boardregion-canvas">
        {/* Workspace tabs live in the appbar; this region is the boards. */}
        <div className="canvastabs-body" data-testid="canvas-region">
          {tab === 'board' ? (
            <ConnectedBoard />
          ) : (
            <Whiteboard repoRoot={repoRoot} graph={graph} onAsk={onAsk} />
          )}
        </div>
      </div>
      {/* Index rail only when attached; collapsed by default so the board owns
          first glance (owner: bottom ledger eats the canvas). */}
      {repoRoot ? (
        <>
          {indexOpen ? (
            <div
              className="boardregion-rail"
              data-testid="board-region-rail"
              data-collapsed="false"
            >
              <button
                type="button"
                className="boardregion-rail-toggle"
                data-testid="board-index-toggle"
                aria-expanded
                onClick={() => onIndexOpenChange(false)}
              >
                <span className="boardregion-rail-chev" aria-hidden="true">
                  ▸
                </span>
                Index
              </button>
              <div className="boardregion-rail-body">
                <ConnectedIndexRail />
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="boardregion-index-tab"
              data-testid="board-index-toggle"
              aria-expanded={false}
              title="Show files and functions"
              onClick={() => onIndexOpenChange(true)}
            >
              Index
            </button>
          )}
        </>
      ) : null}
    </div>
  );
}

/**
 * WHICH OVERLAY IS OPEN — the prop whose absence made two buttons do nothing.
 *
 * `ShellSlice.overlay` says WHETHER an overlay is open; this says WHICH, and
 * `Shell.tsx` refuses to paint a scrim without it (`shell.overlay &&
 * renderOverlay`). Nothing passed it. So `ConnectedBoard`'s empty state and
 * `BootSurface` both dispatched `{kind:'attach'}` into a slice that was read by
 * nobody and rendered by nobody, and a real browser clicking either button got
 * ZERO DIALOGS while `Board.test.tsx:315` reported the feature working.
 *
 * EVERY KIND IN THE UNION IS ANSWERED HERE, AND THE TWO UNBUILT ONES SAY SO.
 * Returning null for them would put an empty box on a scrim — the "opaque sheet
 * pinned over the whole canvas… it reads as a crash" that sheet 08.5 names — and
 * would also silently re-enable their rows in the command surface, because
 * `Shell.tsx` disables an overlay command only when there is NO renderer at
 * all — a renderer that answers a kind with null is indistinguishable, from
 * the palette's side, from one that answers it properly.
 * A row that opens a panel saying which wave builds it is honest; a row that
 * opens a blank rectangle is not.
 *
 * `role="dialog"` IS ON THE CONTENT, NOT ON THE SHELL'S HOST. Each overlay names
 * itself: `AttachDialog` carries its own role and label, and the not-yet panels
 * carry theirs below. See the overlay host in Shell.tsx for why the wrapper does
 * not repeat it.
 */
function OverlayHost({
  overlay,
  close,
  onLeaveRepo,
  onOpenFolder,
}: {
  overlay: ShellOverlay;
  close: () => void;
  onLeaveRepo?: () => void;
  onOpenFolder?: () => void;
}) {
  const store = useStore();
  const state = useAppState();
  const repoRevision = sessionsRepoRevision(state.repo);

  if (overlay.kind === 'attach') {
    return (
      <AttachDialog
        transport={transport}
        onAttached={(draft) => {
          /* Two dispatches, in this order, and neither is optional. The draft
             is what makes the board drawable — `loadRepo` applies the projector
             to it — and closing is what stops the dialog sitting over the board
             it just produced. */
          store.dispatch({ type: 'repo/loaded', draft, at: Date.now() });
          close();
        }}
        onClose={close}
      />
    );
  }

  /*
   * WAVE 5 IS THIS ARM, AND IT REPLACES A NOT-YET PANEL RATHER THAN SITTING
   * BESIDE ONE. `ConnectedReview` reads the graph, the turns and the proposals
   * off the store itself.
   *
   * SCOPE IS THE SUBJECT. Chat's "Proposed edits" row opens review ON the
   * turn's proposal (`opens: 'review'` + a real `proposalId`). That must load
   * the session `last-turn` scope — Unstaged is the working tree and was the
   * inverted fix that made Accept unreachable from the proposal door (Seat Gate
   * 4). The command palette's "Review the working tree" still passes the empty
   * proposal id and keeps the default Unstaged scope.
   */
  if (overlay.kind === 'review') {
    const fromProposal = overlay.proposalId !== '';
    return <ConnectedReview scope={fromProposal ? 'last-turn' : undefined} />;
  }

  /*
   * P9 IS THIS ARM, AND IT REPLACES NOTHING — it is a kind the union did not
   * have. `ConnectedActivity` reads no store: a run list is not application
   * state, it is a remote reading owned by the engine, and every copy of it
   * inside the client is a copy that can be stale in a way the reader cannot
   * see. It holds its own for exactly as long as this overlay is open.
   *
   * DESKTOP NOTIFICATIONS ARE DELIBERATELY NOT HERE, AND THIS IS THE FOLLOW-UP
   * NOTE. Codex pairs its activity view with them and the pairing is most of
   * why theirs answers the question "from outside the app". A notification is an
   * OS permission surface — a prompt the user must be asked for, at a moment
   * chosen by us, with a decision that persists past the session — and that is
   * its own ruling to make, not a detail of this one.
   */
  if (overlay.kind === 'activity') return <ConnectedActivity />;

  /*
   * SEARCH WAS SERVED AND UNREACHABLE. The route is correct and jailed to the
   * same choke point `GET /api/file` uses, so a search cannot become a wider
   * door — and no client had ever fetched it, with no test, so deleting it
   * would have turned nothing red. This arm is the whole of the missing half.
   */
  if (overlay.kind === 'search') return <ConnectedSearch />;

  /* Onboarding was one Ctrl-K hint. This is the page that hint should always
     have led to, generated from the palette's own command list so it cannot
     claim a surface the product does not have. */
  if (overlay.kind === 'help') return <HelpPanel />;

  /*
   * SETTINGS IS BUILT, and it mattered more than a missing panel usually does:
   * the free-tier message tells a user to add their own key, and there was no
   * way to add one. The whole path out of "the free default is unavailable"
   * ended here, so a real user's first blocked question was also their last.
   */
  /*
   * REWIND IS BUILT, AND IT NEVER RAN. The engine takes a pre-write baseline
   * of every file it changes and can put the tree back exactly; the client had
   * simply never sent the sessionId those baselines are filed under, so every
   * checkpoint list came back empty and undo had nothing to undo. It reuses
   * the review lane's client because rewind undoes the writes that lane makes,
   * and the write session id already lives there.
   */
  if (overlay.kind === 'rewind') {
    return (
      <div role="dialog" aria-label="Rewind" data-testid="overlay-rewind">
        <RewindPanel
          client={REVIEW_CLIENT}
          /* A restore rewrites files underneath the graph, so the scan the
             board is drawing is stale the moment it lands. Same reload the
             session switch takes, and for the same reason: this package has no
             cross-slice reload path, and a board drawn from the pre-restore
             tree beside files from the post-restore one is worse than a reload
             the reader was told about. */
          onRestored={() => window.location.reload()}
        />
      </div>
    );
  }

  if (overlay.kind === 'settings') {
    return (
      <div role="dialog" aria-label="Settings" data-testid="overlay-settings">
        <ConnectedSettings
          pane={overlay.pane}
          {...(onLeaveRepo ? { onLeaveRepo } : {})}
          {...(onOpenFolder ? { onOpenFolder } : {})}
        />
      </div>
    );
  }

  /*
   * SESSIONS IS BUILT. The engine kept a full index on disk the whole time —
   * `.sequence/sessions/index.json`, with titles, modes and an `activeId` — so
   * work the user had already done was reachable by the server and not by them.
   */
  return (
    <div role="dialog" aria-label="Sessions" data-testid="overlay-sessions">
      <SessionsPanel
        client={SESSIONS_CLIENT}
        repoRevision={repoRevision}
        /* A full reload, and the panel says so on the control. The chat, the
           board and the scan all hang off the active session, and this package
           has no cross-slice reload path — leaving a reader with one session's
           transcript beside another's board would be worse than a reload they
           were told about. */
        onSwitched={() => {
          reloadAfterSessionChange();
        }}
        onOpenRepoSession={attachRepoSession}
      />
    </div>
  );
}

/**
 * ITEM playback — WHY THERE ARE NOW TWO PROVIDERS AND NOT ONE.
 *
 * `CanvasProvider` holds the ONE `CanvasSlice` the board and the index rail
 * share. Before it, the rail held a playback cursor in `useState` and the board
 * held a canvas slice in a private `useReducer`, and the two never met: clicking
 * a traced function drew a hop list and moved nothing on the board, while the
 * panel's heading claimed it played there. Both files documented the gap in
 * comments; the user-visible string kept asserting the behaviour.
 *
 * IT IS INSIDE `StoreProvider`, NOT BESIDE IT, because it seeds itself from
 * `store.getState().canvas` — the store's own empty value is the starting
 * point, so there is no second literal describing an empty board.
 *
 * `DocProvider` holds the ONE `.seqd` every surface edits, and sits INSIDE
 * `CanvasProvider` because the ordering encodes the dependency: a document can
 * be edited with no camera pointed at it, but a camera framing a document that
 * does not exist is the S0 case the canvas slice already handles. Nothing in
 * this file reads either channel — both are consumed by the surfaces below.
 *
 * IT WRAPS THE WHOLE SHELL AND NOT JUST THE CANVAS REGION. The rail reads the
 * same slice, and the rail is a sibling column; a provider around
 * `<CanvasRegion/>` alone would put the two surfaces back in two trees, which is
 * the entire defect. The day the canvas family folds into `state/store.ts`,
 * this component disappears and nothing else in this file moves.
 */
/**
 * THE SESSIONS SIDEBAR — Decision 5's LEFT pane, persistent at wide
 * breakpoints.
 *
 * THE LIST IS GATED ON ATTACHMENT, AND THAT IS NOT A LAZINESS. Sessions live
 * under the attached repository's own `.sequence/`, so with nothing attached
 * there is no index to read — fetching one would draw a permanent failure line
 * in a pane the reader has not done anything to yet. The sidebar still mounts,
 * because its bottom line is the frame's persistent settings entry; before any
 * repository is attached it says what attaching will put here.
 */
function ConnectedSessionsSidebar() {
  const store = useStore();
  const state = useAppState();
  const repoRevision = sessionsRepoRevision(state.repo);

  return (
    <div className="sessions-side shell-scope" data-testid="sessions-side" data-shell-surface="opaque">
      <div className="sessions-side-scroll">
        <SessionsPanel
          client={SESSIONS_CLIENT}
          repoRevision={repoRevision}
          /* A full reload, and the panel says so on the control. The chat,
             the board and the scan all hang off the active session, and this
             package has no cross-slice reload path. */
          onSwitched={() => {
            reloadAfterSessionChange();
          }}
          onOpenRepoSession={attachRepoSession}
        />
      </div>
      <footer className="sessions-side-foot">
        {/* THE PERSISTENT SETTINGS ENTRY, bottom-left (Decision 5). It opens
            the SAME overlay the palette command opens — one settings flow,
            several doors. Wave 0 exposed `gear`; this is its host. */}
        <button
          type="button"
          className="shell-btn sessions-gear"
          data-testid="shell-settings-gear"
          title="Provider, notifications, hooks and this workspace"
          onClick={() =>
            store.dispatch({
              type: 'shell/overlay',
              overlay: { kind: 'settings', pane: 'provider' },
            })
          }
        >
          <Icon name="gear" size={14} />
          Settings
        </button>
      </footer>
    </div>
  );
}

/**
 * THE COMPOSITION — which region holds what, decided once, from workspace tabs.
 *
 * Owner P2.5: default opens to chat alone. Architecture / Whiteboard mount the
 * board pane on demand. Engine-attached hydrate (`--repo`) still settles the
 * store via `ConnectedBootHydrate` so Architecture has a graph when opened.
 *
 * It lives BELOW `StoreProvider` because it reads the store directly, and it
 * takes `appStore` only for the host commands that must reach the store the
 * App component created.
 */
function ShellComposition({ appStore }: { appStore: Store }) {
  const state = useAppState();
  const [views, setViews] = useState<WorkspaceViewState>(INITIAL_WORKSPACE_VIEWS);
  const [chromeTabs, setChromeTabs] = useState<ChromeTabState>(INITIAL_CHROME_TABS);
  const [viewNotice, setViewNotice] = useState<string | null>(null);

  const canvasVisible = visibleCanvasTab(chromeTabs);
  const surface: WorkspaceSurface =
    canvasVisible === 'ai-canvas'
      ? 'ai-canvas'
      : !views.boardOpen
        ? 'chat'
        : views.boardKind === 'whiteboard'
          ? 'whiteboard'
          : 'architecture';
  const boardTabActive = visibleWorkspacePanes(chromeTabs).some((id) => id !== 'chat');
  const repoAttached =
    state.repo.phase === 'attached' || state.repo.phase === 'stale';
  const repoRevision = sessionsRepoRevision(state.repo);

  /* The workspace body's own width — the only honest input to the column
     arithmetic and to how many pills the frame can seat. Measured, never
     guessed; see useMeasuredWidth for what the guess cost. */
  const { ref: workspaceBodyRef, width: workspaceBodyWidth } = useMeasuredWidth();
  const paneCapacity = workspacePaneCapacity(workspaceBodyWidth);

  /* A frame dragged narrower must give the panes back, not paint them past the
     right edge of an overflow:hidden shell. Same object out when nothing needs
     demoting, so this settles in one pass. */
  useEffect(() => {
    if (workspaceBodyWidth <= 0) return;
    setChromeTabs((prev) => fitVisiblePanesToWidth(prev, workspaceBodyWidth));
  }, [workspaceBodyWidth]);

  const onChromeTabsChange = (next: ChromeTabState) => {
    const prevIds = chromeTabs.tabs.map((t) => t.id);
    const nextIds = next.tabs.map((t) => t.id);
    const prevActive = chromeTabs.active;
    setChromeTabs(next);

    if (next.active !== prevActive) {
      setViews((prev) => applyTabToViews(prev, next.active));
    }

    for (const id of prevIds) {
      if (!nextIds.includes(id)) {
        setViews((prev) => viewsFromTabClose(prev, id as ChromeTabId));
      }
    }
  };

  /* Keep ask wire surface in sync with workspace chrome + overlays
     (deictic "this workflow" / "what am I looking at"). */
  useEffect(() => {
    appStore.dispatch({
      type: 'composer/ask-surface',
      surface: askSurfaceFromChrome({
        workspace: surface,
        overlayKind: state.shell.overlay?.kind ?? null,
      }),
    });
  }, [appStore, surface, state.shell.overlay?.kind]);

  const ensureChatVisible = () => {
    setChromeTabs((prev) => openTab(prev, 'chat'));
  };

  const applyHostOpen = (req: Parameters<typeof requestOpen>[1]) => {
    ensureChatVisible();
    if (req === 'terminal') {
      setViewNotice(null);
      setChromeTabs((tabs) => openTab(tabs, 'terminal'));
      return;
    }
    if (req === 'browser') {
      setViewNotice(null);
      setChromeTabs((tabs) => openTab(tabs, 'browser'));
      return;
    }
    setViews((prev) => {
      const result = requestOpen(prev, req);
      if (!result.ok) {
        setViewNotice(result.reason);
        return prev;
      }
      setViewNotice(null);
      return result.state;
    });
    const surfaceForSync: WorkspaceSurface =
      req === 'whiteboard'
        ? 'whiteboard'
        : req === 'architecture' || req === 'files'
          ? 'architecture'
          : 'chat';
    setChromeTabs((tabs) => syncFromWorkspaceSurface(tabs, surfaceForSync));
  };

  const openFilesView = () => {
    applyHostOpen('files');
  };

  const openFolder = () => {
    appStore.dispatch({ type: 'shell/overlay', overlay: { kind: 'attach' } });
  };

  const leaveRepo = () => {
    void transport.detach().then((answer) => {
      if (answer.outcome === 'ok') {
        setViewNotice(null);
        appStore.dispatch({ type: 'repo/detached' });
        setViews((prev) => selectHumanSurface(prev, 'chat'));
        return;
      }
      const message =
        answer.outcome === 'unreachable'
          ? answer.message
          : answer.outcome === 'not-json'
            ? 'the server did not answer with JSON'
            : answer.outcome === 'error'
              ? typeof (answer.body as { error?: unknown } | null)?.error === 'string'
                ? (answer.body as { error: string }).error
                : `request failed (${answer.status})`
              : 'could not leave this repository';
      setViewNotice(message);
    });
  };

  /* Auto-open AI Canvas when agent draws — live OR newly landed (finish shows it). */
  const canvasBlocks = state.session.canvasDoc.blocks;
  const sessionActiveId = state.session.activeId;
  const canvasToolRunning = Boolean(
    state.session.inFlight?.work.some(
      (r) => r.status === 'running' && /^Called canvas\.write_/.test(r.verb),
    ),
  );
  const knownCanvasBlockIds = useRef<Set<string> | null>(null);
  const seededForSession = useRef<string | null>(null);
  useEffect(() => {
    const sessionKey = sessionActiveId ?? '';
    if (seededForSession.current !== sessionKey) {
      seededForSession.current = sessionKey;
      knownCanvasBlockIds.current = new Set(canvasBlocks.map((b) => b.id));
      if (
        canvasToolRunning ||
        canvasBlocks.some((b) => b.status === 'live' || b.status === 'pending')
      ) {
        setChromeTabs((prev) => openTab(openTab(prev, 'chat'), 'ai-canvas'));
      }
      return;
    }
    const known = knownCanvasBlockIds.current ?? new Set<string>();
    knownCanvasBlockIds.current = known;
    const open = shouldOpenAiCanvas({
      blocks: canvasBlocks,
      knownBlockIds: known,
      canvasToolRunning,
    });
    for (const b of canvasBlocks) known.add(b.id);
    if (open) {
      setChromeTabs((prev) => openTab(openTab(prev, 'chat'), 'ai-canvas'));
    }
  }, [canvasBlocks, canvasToolRunning, sessionActiveId]);
  const topologyId = state.session.topology?.id ?? null;
  useEffect(() => {
    if (topologyId) applyHostOpen('architecture');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open on new proposal id only
  }, [topologyId]);

  /* Work-row opens (canvas / rail) reach the host through hostCommands. */
  useEffect(() => {
    setHostCommandHandler((id) => {
      if (id === 'canvas.board') {
        applyHostOpen('architecture');
        return;
      }
      if (id === 'canvas.whiteboard') {
        applyHostOpen('whiteboard');
        return;
      }
      if (id === 'canvas.ai') {
        setChromeTabs((prev) => openTab(prev, 'ai-canvas'));
        return;
      }
      if (id === 'rail.focus') {
        applyHostOpen('files');
        return;
      }
      if (id === 'terminal.open') {
        applyHostOpen('terminal');
        return;
      }
      if (id === 'browser.open') {
        applyHostOpen('browser');
      }
    });
    return () => setHostCommandHandler(null);
  }, [appStore]);

  /* P5 — engine fs.watch marks /api/status stale; poll into repo/stale.external. */
  useEffect(() => startExternalStaleProbe({ store: appStore }), [appStore]);

  return (
    <ConnectedShell
      tabLayout
      boardMounted={boardTabActive}
      tabWorkspace={
        <div className="shell-cb" data-testid="shell-cb">
          <WorkspaceRail
            repoRevision={repoRevision}
            onOverlay={(overlay) => appStore.dispatch({ type: 'shell/overlay', overlay })}
            onOpenRepoSession={attachRepoSession}
          />
          <div className="shell-cb-main">
            <ChromeTabStrip
              state={chromeTabs}
              onChange={onChromeTabsChange}
              repoAttached={repoAttached}
              onOpenFiles={openFilesView}
              notice={viewNotice}
              capacity={paneCapacity}
              onRefused={setViewNotice}
            />
            <div className="shell-cb-body" ref={workspaceBodyRef}>
              <WorkspacePane
                tabs={chromeTabs}
                containerWidth={workspaceBodyWidth}
                indexOpen={views.filesOpen}
                onIndexOpenChange={(open) => setViews((prev) => setFilesOpen(prev, open))}
                onActivateTab={(id) => onChromeTabsChange(activateTab(chromeTabs, id))}
              />
            </div>
          </div>
        </div>
      }
      chat={<ConnectedChatColumn />}
      sessions={<ConnectedSessionsSidebar />}
      rail={<div />}
      onCommand={(id) => {
        if (id === 'composer.focus') appStore.dispatch({ type: 'composer/focus' });
        if (id === 'canvas.whiteboard') applyHostOpen('whiteboard');
        if (id === 'canvas.board') applyHostOpen('architecture');
        if (id === 'repo.detach') {
          leaveRepo();
        }
      }}
      renderOverlay={(overlay, close) => (
        <OverlayHost
          overlay={overlay}
          close={close}
          onLeaveRepo={leaveRepo}
          onOpenFolder={openFolder}
        />
      )}
    />
  );
}

export function App({ appStore = store }: { appStore?: Store } = {}) {

  /*
   * THE DESKTOP HELP MENU OPENS THE SAME PAGE THE PALETTE OPENS.
   *
   * One help page, two doors. A person who double-clicked an application looks
   * at the menu bar before they guess a chord, and the register's onboarding
   * row — corrected from done to "OVERSTATED — not built" — was one Ctrl-K
   * hint and nothing else.
   *
   * `onDesktopHelp` returns a no-op unsubscribe in a browser tab, so this is
   * the same three lines in both builds rather than a branch somebody forgets.
   */
  useEffect(
    () =>
      onDesktopHelp(() =>
        appStore.dispatch({ type: 'shell/overlay', overlay: { kind: 'help' } }),
      ),
    [appStore],
  );

  /* P3 — hydrate Auto-edit / Full from Settings prefs before the first ask. */
  useEffect(() => {
    const enabled: PermissionMode[] = ['plan', 'propose'];
    if (readAutoEditEnabled()) enabled.push('autoEdit');
    if (readFullAccessEnabled()) enabled.push('full');
    if (enabled.length > 2) {
      appStore.dispatch({ type: 'composer/permission-enabled', enabled });
    }
  }, [appStore]);

  return (
    <StoreProvider store={appStore}>
      <ConnectedBootHydrate transport={transport} />
      <CanvasProvider>
        <DocProvider>
          <ShellComposition appStore={appStore} />
        </DocProvider>
      </CanvasProvider>
    </StoreProvider>
  );
}
