/* ══════════════════════════════════════════════════════════════════════════
   THE BOARD, WIRED — items 3.4 and 3.5
   packages/web2/src/canvas/ConnectedBoard.tsx

   This is the only file on this lane that knows the store exists. `Board.tsx`
   takes props and dispatches a `CanvasAction`; everything about which store, or
   whether there is one, lives here — the same shape `state/connect.tsx` uses
   for the chat column and the shell.

   ── ITEM 3.5, THE WAVE-3 ACCEPTANCE GATE ─────────────────────────────────

   ONE ACTION. A click on a grounded node selects it AND makes it a context chip
   in the composer, through `composer/chip-add` — the store's own action, the
   same one the `@` picker uses, so a node chip and a mention chip are the same
   object and the composer has one list rather than two.

   THIS IS THE THING THAT DOES NOT EXIST TODAY. In v1 the button is rendered
   only on `design:draw-*` nodes, so the grounded graph cannot talk to the agent
   at all, on any scanned node. §8.6: "That is not an engine defect and not a
   stylesheet defect. It is a shell defect, it is one day of work, and it is the
   single action every winning competitor converged on."

   ── THE HANDBACK, STATED PLAINLY ─────────────────────────────────────────

   THE CANVAS SLICE IS REDUCED HERE, NOT IN `state/store.ts`, AND THAT IS A
   FILE-OWNERSHIP DECISION RATHER THAN A DESIGN ONE.

   `store.ts` ships eighteen actions and not one of them writes `state.canvas` —
   the store lane's own report says the canvas surfaces are Wave 3's and "there
   is no state either reads yet". Adding the canvas family means editing
   `store.ts`, which belongs to that lane; twelve agents sharing files cost this
   project a full repair cycle, so this lane does not.

   What is here instead is arranged so the fold is mechanical and cannot drift:

     · `canvasReduce` is a PURE function over the frozen `CanvasSlice`. It
       invents no state, and it derives `rung` at its single exit exactly the
       way `store.ts` derives `composer.send`.
     · It is seeded from `store.getState().canvas`, so the store's own empty
       value is the starting point rather than a second one declared here.
     · The composer chip goes to the REAL store. The one thing that crosses
       between the board and the thread already goes through the one funnel.

   THE FOLD, when the store lane takes it, is: add `CanvasAction` to `Action`,
   add one case that returns `{...state, canvas: canvasReduce(state.canvas,
   action)}`, and change the two lines below from `useReducer` to `useStore`.
   Nothing else moves, and no shape changes.

   ── ITEM playback — HALF OF THAT FOLD IS TAKEN ───────────────────────────

   THE PRIVATE `useReducer` IS GONE. The canvas slice now comes from
   `canvasChannel.tsx`, one level up, so the index rail and the board read and
   write ONE slice instead of two. That is what makes a click on a traced
   function reach this component at all — see that file's header for why the
   provider sits in `canvas/` rather than in `state/store.ts`, and for what is
   left of the fold (the same one case block, unchanged in shape).

   THIS COMPONENT IS WHERE A FLOW MEETS THE DOCUMENT, and nowhere else can be.
   `canvasReduce` is pure and has no graph, so it cannot know whether a hop's
   endpoint is a node the board draws; `flowForFunction` emits hops at whatever
   level the scan can prove, which on this repository is the FILE level for
   every single flow (measured — see `flowFocus.ts`). The resolution therefore
   happens here, against the projection actually on screen, and is dispatched
   back as `canvas/flow-focus`. It is the same shape as the ELK effect below:
   compute what needs the document, dispatch the result, let the reducer decide
   whether anything moved.
   ══════════════════════════════════════════════════════════════════════════ */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Board, MetaStripBoundary, type BoardEdgeless, type BoardEmpty, type BoardPlayback } from './Board.js';

/* THE SAME SPLIT `Board` DECLARES, for the same reason: a reader who never
   opens the whole-repository view never downloads its chunk. */
const AnatomyPanel = lazy(() =>
  import('./visual/AnatomyPanel.js').then((module) => ({ default: module.AnatomyPanel })),
);
import type { BoardNode } from './NodeCard.js';
import { layoutKeyFor } from './layoutKey.js';
import { useCanvas } from './canvasChannel.js';
import { useDoc } from './docChannel.js';
import { offerToInk } from './snapToEdit.js';
import { readSnapMode } from '../whiteboard/snapPreference';
import type { BoardMenuTarget } from './BoardMenu.js';
import { buildGenerateRequest, isGeneratable } from './generateGate.js';
import { docEdit } from './docEdit.js';
import { serviceInterior } from '@sequence/export';
import type { SeqDiagramNode } from '@sequence/schema';
import {
  classifySeqDiagramLayout,
  inferSeqDiagramKind,
  seqDiagramLayoutForKind,
} from '@sequence/schema';
import { FONT_EVENT } from '../settings/fontPreference';
import { boardFarScale, cardBox, annotatedCountForLayout, clearCardWidthMemo } from './cardBox.js';
import { glanceFont, titleFont } from './textFit.js';
import { openableIdsOf } from './openableIds.js';
import { visibilityAt } from './lod.js';
import { anatomyPanel, indexAnatomy } from './anatomy.js';
import { annotationsForScan, type Annotations } from './annotateClient.js';
import { lookupDim, parentLookup, resolveFlow, selectionDim, teachDim } from './flowFocus.js';
import {
  circularLayoutPositions,
  elkGraphFor,
  frameAspect,
  GROUP_PAD,
  layoutOffThread,
  positionsFrom,
  fitZoomFor,
  pickLayout,
  placeOrphanRow,
  routesFrom,
  sizesFrom,
  splitOrphans,
  type ElkPoint,
} from './layout.js';
import {
  BOX_BUDGET,
  boxesWithoutBudget,
  compositeDocument,
  evidenceFor,
  importEdges,
  type CompositeGroup,
} from './composite.js';
import { mergeSamePair, proofFromScan, sourceReadPairs } from './edgeLines.js';
import { EMPTY_GROUP_H } from './nestedBoxes.js';
import { useBoardView } from './useBoardView.js';
import { collapse as collapseView, expandWithBudget, neighbourhood, tracePath } from './viewState.js';
import { BoardControls } from './BoardControls.js';
import { LazyAgentInspector, LazyAgentOverlay, LazyBoardMenu, LazyEdgeEvidence, preloadBoardExtras } from './preloadable.js';
import { FIT_FLOOR, autoExpandStep, rankGroups, startAutoExpand, type AutoExpandState } from './autoExpand.js';
/* Opened by a click (a line, a right-click), never on first paint: loaded
   then, out of boot JS (perf ratchet, bootJsBytes). */
const EdgeEvidence = LazyEdgeEvidence.Component;
const BoardMenu = LazyBoardMenu.Component;
/* Only an agent-workflow document draws it, so it loads when first drawn. */
const WorkflowLaunchBar = LazyWorkflowLaunchBar.Component;
const AgentInspector = LazyAgentInspector.Component;
/* THE AGENT OVERLAY LOADS AFTER THE FIRST BOARD: it draws nothing of its
   own and its stream opens 1.5 s after mount anyway, so its code (the light
   book, the chip text) stays out of boot JS (perf ratchet, bootJsBytes). */
const AgentOverlay = LazyAgentOverlay.Component;
/* Round 8: the drawing layer, its capture and its palette (boards/ArchDraw).
   Loaded with the board's extras after the first layout, or on Draw. */
const ArchMarks = LazyArchMarks.Component;
const ArchCapture = LazyArchCapture.Component;
const ArchPalette = LazyArchPalette.Component;
import { SWITCHER_VIEWS, VIEW_ENABLED, linesOf, viewForShortcut, type SwitchableView, type ViewBox } from './views/viewModel.js';

const GridView = lazy(() => import('./views/GridView.js'));
const FlowView = lazy(() => import('./views/FlowView.js'));
const DiffView = lazy(() => import('./views/DiffView.js'));
const HotspotsView = lazy(() => import('./views/HotspotsView.js'));
import { ViewMenu } from './views/ViewMenu.js';
import type { DiffMarks } from './views/historyModel.js';
import { projectDocument, type Projection } from './project.js';
import { scanFacts } from './scanFacts.js';
import { boardVisualKey, readBoardVisual, writeBoardVisual } from './visualMode.js';
import { boardLayoutKey, readBoardLayout, writeBoardLayout } from './boardLayoutMemory.js';
import type { CanvasAction } from './canvasReduce.js';
import { useAppState, useStore } from '../state';
import { architectureReference, type ArchRefNode } from '../askInPlace/askReference';
import { regionAround, unionBox } from '../askInPlace/snapshotGeometry';
import { useAskInPlace } from '../askInPlace/useAskInPlace';
import type { GenerateOutcome } from './NodeSurfacePanel';
/* The node surface panel draws only when a node's surface is opened: it loads then, not at boot. */
const NodeSurfacePanel = lazy(() => import('./NodeSurfacePanel').then((m) => ({ default: m.NodeSurfacePanel })));
import { generateFlow } from './flowsClient';
import { SURFACE_KINDS, nodeSurface, workflowAsk, type WorkflowAudience } from './nodeSurface';
import { followGitEvents } from '../git/boardReload';
import { groundedRepoRoot } from '../state/connect';
import { requestHostCommand } from '../app/hostCommands';
import { BoardTabs } from './boards/BoardTabs.js';
import { boardsApi, setActiveWhiteboard, useBoardDoc, useBoardsIndex } from './boards/boardsClient.js';
import { ARCH_BOARD_ID, nextBoardName } from './boards/boardsModel.js';
import type { ArchTool } from './boards/ArchDraw.js';
import { LazyArchCapture, LazyArchMarks, LazyArchPalette } from './preloadable.js';
import { registerBoardExporter, type BoardPng } from '../chat/boardPngBus.js';
import { silhouetteOf } from './kinds.js';
import {
  isScratchDoc,
  loadScratchDoc,
  resolveScratchSessionId,
  scratchStorage,
  writeScratch,
} from './localScratch.js';
import { rememberBoardForFlush } from '../sessions/sessionPersist.js';
import { toBoardSeqd, worthPersistingBoard } from '../sessions/boardMemory.js';
import { deriveScanLiveStatus } from '../app/scanProgressModel.js';
import { LazyWorkflowLaunchBar } from './preloadable.js';
import { useWorkflowLaunch } from './useWorkflowLaunch.js';
import { knownFullWorkflowTier, suggestFullWorkflowTier } from './workflowTierHint.js';
import {
  programNodeStatusForBoardNode,
  subscribeBoardRunOverlay,
  type BoardRunOverlay,
} from './workflowRunOverlay.js';

/** The empty projection. One object, so `useMemo` below has something stable to
 *  return and the board does not remount on every render of an empty board. */
const NOTHING: Projection = { nodes: [], edges: [], positions: {} };

/** What the board says after "Ask an agent": nothing when the run went to
 *  chat (the agent chip on the box already says so), the failure otherwise. */
export function askNote(r: { ok: boolean; text: string; handedOff?: boolean }): string | null {
  if (r.handedOff) return null;
  return r.ok ? r.text || 'The agent answered with nothing.' : r.text;
}

/** Whether an engine with a project answers this page (`GET /api/status` says `attached: true`). False for a graph
 *  served from a static host, whose `/api/git/events` would be index.html. */
async function engineHasProject(): Promise<boolean> {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return false;
    return ((await res.json()) as { attached?: unknown })?.attached === true;
  } catch {
    return false;
  }
}

/** The post-attach fit's key: the arrangement, without the far band, which
 *  is a zoom and not an arrangement (see the call site). */
export function attachFitKeyFor(base: string | null | undefined, layoutKey: string): string | null {
  /* The far band is the segment before the font epoch (`…|f0|n3`, see layoutKey); it used to be the last segment,
     and a pattern anchored there stopped matching when the epoch was appended, so every band crossing refitted. */
  return base ? `${base}|${layoutKey.replace(/\|f[01](?=\|n\d+$|$)/, '')}` : null;
}

/* The local edit log (opt-out, never sent anywhere) loads when the first edit happens, so it
   adds nothing to the boot bundle. */
function logBoardEdit(...args: Parameters<typeof import('../whiteboard/boardEditLog').logBoardEdit>): void {
  void import('../whiteboard/boardEditLog').then((m) => m.logBoardEdit(...args)).catch(() => undefined);
}

/** The shape session's idle grouping window (`GROUP_IDLE_MS` in @sequence/ink/shape, pinned
 *  by archSketchModel.test.tsx): inlined so the shape package stays out of the boot chunk. */
const SKETCH_IDLE_MS = 900;
/* The longest the give-up waits for the shape model to load before the old rules run anyway. */
const SKETCH_MODEL_WAIT_MS = 5000;

export function ConnectedBoard() {
  const store = useStore();
  const state = useAppState();

  const { canvas, dispatch } = useCanvas();
  const { session, dispatch: editDoc } = useDoc();
  const [menu, setMenu] = useState<BoardMenuTarget | null>(null);
  const [runOverlay, setRunOverlay] = useState<BoardRunOverlay | null>(null);
  /*
   * DRAW MODE IS LOCAL, and deliberately. It is a transient TOOL state — which
   * hand the reader is using this second — not something the rail, the composer
   * or a persisted session has any business knowing. `CanvasSlice` is the state
   * two surfaces have to agree about; this is not that.
   */
  /*
   * OPENING A SERVICE. The owner's ruling was SYSTEMS LAYER ONLY, no nesting —
   * "but a service must still be openable", which is not a contradiction:
   * opening REPLACES the view rather than nesting inside it, so one level is on
   * screen at a time and the level changes.
   *
   * `null` is the systems layer. Local, because it is where the READER is
   * looking, not something the rail or a persisted session needs to agree
   * about — the same reason draw mode is local.
   */
  /*
   * THE WAY DOWN, so Back can go up ONE level. Owner, 2026-09-22: the system,
   * then a service's modules, then a module's files — three zooms, still one
   * on screen at a time. Back from a module's files lands on the service's
   * modules, not on the system. The last entry is the level on screen.
   */
  /* THE VIEW STATE IS IN THE URL HASH (viewState.ts, §3.2): what is drawn
     alone, what is expanded, the focus, imports, direction. A reload or a
     shared link opens the same board. Keyed on the repository's root, so a
     rescan keeps the view and a different repository starts fresh. */
  const viewIdentity =
    state.repo.phase === 'attached' || state.repo.phase === 'stale' ? state.repo.repo.root : null;
  const [boardView, updateView] = useBoardView(viewIdentity);
  const openedPath = boardView.opened;
  const setOpenedPath = useCallback(
    (fn: (path: string[]) => string[]) =>
      /* A new level is a new set of ids: what was expanded or focused on the
         level being left means nothing on the next one. */
      updateView((v) => ({ ...v, opened: fn(v.opened), expanded: [], focus: undefined })),
    [updateView],
  );
  const openedService = openedPath[openedPath.length - 1] ?? null;
  /* ROUND 7, C.4 — WHAT THE READER JUST OPENED, so the board frames that
     (readably, eased) when its arrangement lands instead of fitting the whole
     board. `id` null: the whole new level after a drill-in. */
  const [focusRequest, setFocusRequest] = useState<{ id: string | null; seq: number; now?: boolean } | null>(null);
  const askFocus = useCallback(
    (id: string | null) => setFocusRequest((r) => ({ id, seq: (r?.seq ?? 0) + 1 })),
    [],
  );
  const openNode = useCallback(
    (nodeId: string) => {
      askFocus(null);
      setOpenedPath((path) => (path[path.length - 1] === nodeId ? path : [...path, nodeId]));
    },
    [setOpenedPath, askFocus],
  );
  /*
   * ANATOMY — WHICH NODE HAS ITS CONTENTS DRAWN INSIDE IT.
   *
   * A THIRD GESTURE, AND IT DOES NOT TOUCH `openedService` ABOVE. Open is
   * navigation and still replaces the view one level at a time — the board's
   * standing ruling, locked by `boardMenuRendered.test.tsx`, and the reason a
   * crumb trail built against it was reverted (docs/COMPETITIVE-GAPS-2026-08-22
   * §33). A plain click is still selection. This draws one node's children as a
   * packed treemap INSIDE that node's own footprint: no board node, no board
   * edge, no second structural level, no crumb trail.
   *
   * LOCAL, for the same reason `openedService` and `drawing` are: it is where
   * the reader is looking, not something the rail or a persisted session has to
   * agree about. ONE AT A TIME — two open walls would be two 129px objects
   * competing for the same reading, and the treemap's claim is comparative.
   */
  const [anatomyNodeId, setAnatomyNodeId] = useState<string | null>(null);
  /* THE WHOLE-REPOSITORY VIEW. Separate state from `anatomyNodeId` because it
     has no card: that one names the card whose slot paints the panel, and this
     one has no card to name. See `Board`'s `onOpenRepoAnatomy`. */
  const [repoAnatomy, setRepoAnatomy] = useState(false);
  /** Measured by Board (legend + tools rows); anchors the interior bar. */
  const [furnitureBand, setFurnitureBand] = useState(96);
  const [drawing, setDrawing] = useState(false);
  /* Which Draw tool: Sketch is the structural gesture (a box becomes a node);
     the rest annotate (boards/ArchDraw.tsx). Local, like `drawing`. */
  const [archTool, setArchTool] = useState<ArchTool>('sketch');
  const [proposalLayoutDirection, setProposalLayoutDirection] = useState<'LR' | 'TD' | null>(null);
  /* What the last stroke did, said out loud. See `inkToEdit`: silence after a
     stroke is indistinguishable from a dropped event. */
  const [inkNote, setInkNote] = useState<string | null>(null);
  const drawnEdgeSeq = useRef(0);
  /* Sketch's grouped shape reading: the session (loaded on the first stroke),
     the latest applier it calls, and the "not a box" timer. */
  const sketchArmGen = useRef(0);
  const sketchSession = useRef<Promise<import('../whiteboard/snapSession').SnapSession> | null>(null);
  const sketchApply = useRef<((results: import('@sequence/ink').InkResult[]) => void) | null>(null);
  const sketchSeq = useRef(0);
  const sketchUndecided = useRef<{ id: string; points: { x: number; y: number }[] }[]>([]);
  const sketchPairs = useRef(new Map<string, number>());
  const sketchGiveUp = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sketchRecent = useRef<{ id: string; points: { x: number; y: number }[] }[]>([]);
  /* The session's own sentence ("2 drawn connections are now in the code; 1 is still a
     claim.") reaches the reader through the board's ink-note line. */
  useEffect(() => {
    if (session.lastNote) setInkNote(session.lastNote);
  }, [session.lastNote, session.doc]);
  useEffect(
    () => () => {
      if (sketchGiveUp.current) clearTimeout(sketchGiveUp.current);
      void sketchSession.current?.then((snap) => snap.dispose()).catch(() => undefined);
    },
    [],
  );
  const flowConvert = useRef<(point: { x: number; y: number }) => { x: number; y: number }>(
    (point) => point,
  );

  /* THE BOARD IS GROUNDED OR IT IS BLANK. `repo.phase` is the only thing that
     says a document exists, and the document is read off the phase's own
     payload — never off an optional field that a failed scan could leave
     stale. `stale` still paints: a stale graph is still a graph, and the
     staleness bar says so elsewhere. */
  const scanned =
    state.repo.phase === 'attached' || state.repo.phase === 'stale'
      ? state.repo.repo.doc
      : state.repo.phase === 'scanning' && state.repo.previous
        ? state.repo.previous.doc
        : null;

  const scanning =
    state.repo.phase === 'scanning'
      ? state.repo
      : null;

  const [scanNow, setScanNow] = useState(() => Date.now());
  useEffect(() => {
    if (!scanning) return;
    setScanNow(Date.now());
    const id = window.setInterval(() => setScanNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [scanning?.startedAt, scanning !== null]);

  const scanStatusLine = useMemo(() => {
    if (!scanning) return null;
    return deriveScanLiveStatus({
      startedAt: scanning.startedAt,
      progress: scanning.progress,
      now: scanNow,
      repoName: scanning.repoName,
      rescan: scanning.previous !== null,
    });
  }, [scanning, scanNow]);

  /* ══ THE CAMERA FIT LATCH — one fit per ARRANGEMENT, not one per attach ═══

     Board.tsx fits once per distinct value of this key and never again, so what
     the key names is exactly what the camera is allowed to follow. It named the
     REPOSITORY, and the repository is not the only thing that moves the cards.

     TWO MEASURED DEFECTS, both of them this key being too narrow:

       · Double-clicking a service replaces the whole document — the systems
         layer's 392x486 arrangement becomes `svc:analyzer`'s interior, a
         different coordinate space entirely — and the camera did not move. At
         the systems framing the reader lands on the top-left corner of a column
         nearly 3,000px tall; if they had panned at all first, the interior is
         off screen and the board looks empty with no error and no explanation.
         Same on the way back out.
       · Adding workspace panes took the board pane 448 -> 287 -> 206 -> 158px
         wide. The layout re-packs at every quarter-step of the frame's aspect
         (see `layoutKey`), so the cards moved every time — and the camera held
         the transform it had been given at 448px. Measured in the shipped
         bundle: 158px-wide pane, `scale(0.989316)` still on the viewport, a
         930px-tall column inside a 719px pane, nothing re-fitted, no scrollbar,
         no note. The board simply clipped.

     SO THE KEY NAMES EVERY INPUT TO THE ARRANGEMENT: which repository, which
     level, and what shape the frame is. It deliberately does NOT name the
     frame's pixel size — `frameAspect` is quantised to quarter steps for the
     reason it was quantised in the first place, so a resizer drag does not move
     the camera under the reader's hand on every pixel; it moves once, when the
     pane changes SHAPE and the layout changes with it.

     WHAT IT STILL DOES NOT DO, and must not: nothing here re-fits after a pan,
     a zoom, a selection or an edit. The camera is the reader's between
     arrangements. It is only when the arrangement they were looking at has been
     replaced that following it is a service rather than an interruption. */
  /* WHICH SCAN THIS IS. Split out from the fit key because two latches want
     different halves of it: the camera follows the arrangement (below), while
     the derived-connector default is a decision about THIS SCAN and must not be
     re-taken every time the reader drags a pane — that would switch a toggle
     back on after they switched it off. */
  const attachIdentity =
    state.repo.phase === 'attached' || state.repo.phase === 'stale'
      ? `${state.repo.repo.root}|${state.repo.repo.scannedAt}`
      : null;
  /* `layoutKey` (below) joins the key once it exists: any new arrangement —
     the imports toggle, a group expanded, an annotation that made a card
     taller — is an arrangement the camera has not seen. */
  const attachFitBase = attachIdentity
    ? `${attachIdentity}|${openedService ?? ''}|` +
      `${frameAspect(canvas.frame.width, canvas.frame.height)}`
    : null;

  /*
   * THE EDITED DOCUMENT WINS, AND THAT IS THE WHOLE OF "the board can be
   * edited". Painting `scanned` here would make every create, rename and delete
   * a no-op on screen while the session dutifully recorded it — the shape of
   * defect this package has already paid for twice, where the state was right
   * and no surface read it.
   *
   * The fallback is not a second opinion. `DocProvider` adopts the scan in an
   * effect, so there is exactly one commit between a repo attaching and the
   * session holding its document; without the fallback that commit paints an
   * empty board and the attach visibly flickers.
   */
  const grounded = session.doc ?? scanned;

  const workflowDoc = session.doc ?? grounded;
  const workflow = useWorkflowLaunch({ doc: workflowDoc });
  useEffect(() => subscribeBoardRunOverlay(setRunOverlay), []);
  const selectedAgentId = useMemo(() => {
    const id = canvas.selection.nodeIds[0];
    if (!id || !workflowDoc) return null;
    const node = workflowDoc.nodes.find((n) => n.id === id);
    return node?.kind === 'agent' ? id : null;
  }, [canvas.selection.nodeIds, workflowDoc]);
  const pauseWorkflowRun = useCallback(async () => {
    if (!workflow.activeRunId) return;
    await fetch(`/api/program/runs/${encodeURIComponent(workflow.activeRunId)}/pause`, {
      method: 'POST',
    });
  }, [workflow.activeRunId]);
  const resumeWorkflowRun = useCallback(async () => {
    if (!workflow.activeRunId) return;
    await fetch(`/api/program/runs/${encodeURIComponent(workflow.activeRunId)}/resume`, {
      method: 'POST',
    });
  }, [workflow.activeRunId]);

  const repoAttached =
    state.repo.phase === 'attached' || state.repo.phase === 'stale';
  const scratchSessionId = resolveScratchSessionId(state.session.activeId);

  /* ══ MADR A1 — VISUAL IS ON, AND THE TOGGLE TURNS IT OFF ═════════════════

     Max, 2026-09-02: "I want it to be toggleable so people don't have to
     choose. They just load it, and it's always going to be doing this."

     LOCAL STATE, LIKE DRAW AND LIKE THE OPENED SERVICE, and for the same
     reason those two give: `CanvasSlice` is the state two surfaces have to
     agree about, and this is not that. The rail does not care how the board
     draws a card, and no persisted session does either — what persists is the
     reader's own preference, in their own browser, keyed on the board.

     THE KEY IS THE REPOSITORY ROOT AND NOT `attachIdentity`. That identity
     carries `scannedAt` on purpose (a rescan re-decides the derived-connector
     default), and a preference must survive a rescan. `visualMode.ts` says so
     in its header. */
  const visualRepoRoot =
    state.repo.phase === 'attached' || state.repo.phase === 'stale'
      ? state.repo.repo.root
      : null;
  const visualKey = boardVisualKey(visualRepoRoot, scratchSessionId);
  const [visual, setVisual] = useState(() => readBoardVisual(visualKey));
  /* The key changes under this component when a repository attaches — the
     board goes from `scratch:<session>` to `repo:<root>` without unmounting —
     so the preference is re-read rather than carried across. A repository the
     reader turned Visual off on must open with it off. */
  useEffect(() => {
    setVisual(readBoardVisual(visualKey));
  }, [visualKey]);
  const onToggleVisual = useCallback(() => {
    const next = !visual;
    setVisual(next);
    writeBoardVisual(visualKey, next);
  }, [visual, visualKey]);

  /* ══ ROUND 7, C.1 — THE BOXES STAY WHERE THE READER PUT THEM ═════════════
     Per repository and level of the Map (boardLayoutMemory.ts). Loaded when
     the repository, the scan or the level changes — a new scan resets the
     canvas slice first (canvasChannel.tsx), so the load lands after it — and
     written on every drop and keyboard nudge, which is every `canvas/position`
     the board dispatches. Reset layout (More) forgets them. */
  const layoutMemKey = boardLayoutKey(visualRepoRoot, scratchSessionId, openedPath);
  const placedNow = useRef(canvas.positions);
  placedNow.current = canvas.positions;
  useEffect(() => {
    const saved = readBoardLayout(layoutMemKey);
    if (Object.keys(saved).length === 0 && Object.keys(placedNow.current).length === 0) return;
    dispatch({ type: 'canvas/positions', positions: saved });
  }, [layoutMemKey, attachIdentity, dispatch]);
  const boardDispatch = useCallback(
    (action: CanvasAction) => {
      dispatch(action);
      if (action.type === 'canvas/position') {
        logBoardEdit('architecture', 'move', { id: action.nodeId.slice(0, 60) });
        writeBoardLayout(layoutMemKey, {
          ...readBoardLayout(layoutMemKey),
          [action.nodeId]: { x: action.x, y: action.y },
        });
      }
    },
    [dispatch, layoutMemKey],
  );
  const resetLayout = useCallback(() => {
    writeBoardLayout(layoutMemKey, {});
    dispatch({ type: 'canvas/positions', positions: {} });
  }, [dispatch, layoutMemKey]);

  /* No repo: hydrate the session-scoped scratch pad from localStorage when the
     server left no boardSeqd for this session. */
  useEffect(() => {
    if (repoAttached || session.doc !== null) return;
    const storage = scratchStorage();
    if (!storage) return;
    editDoc({
      type: 'doc/base',
      doc: loadScratchDoc(storage, scratchSessionId),
      forSessionId: scratchSessionId,
    });
  }, [repoAttached, scratchSessionId, session.doc, editDoc]);

  /* Persist Architecture overlay to the active session's boardSeqd. */
  useEffect(() => {
    const activeId = state.session.activeId;
    if (!activeId || !worthPersistingBoard(session.doc, session.edits)) return;
    /* Refuse to write another thread's board into this session id (New Chat race). */
    if (session.forSessionId !== activeId) return;
    rememberBoardForFlush(activeId, session.doc, session.edits);
    void fetch(`/api/sessions/${encodeURIComponent(activeId)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ boardSeqd: toBoardSeqd(session.doc!) }),
    }).catch(() => {
      /* Best effort — same contract as chat-memory. */
    });
  }, [state.session.activeId, session.doc, session.edits, session.forSessionId]);

  /* Autosave scratch after each accepted edit when not on a scanned repo. */
  useEffect(() => {
    if (repoAttached || session.doc === null || !isScratchDoc(session.doc)) return;
    if (session.forSessionId !== scratchSessionId) return;
    const storage = scratchStorage();
    if (!storage) return;
    writeScratch(storage, scratchSessionId, session.doc);
  }, [repoAttached, scratchSessionId, session.doc, session.forSessionId]);

  /* The scanned graph the document was projected from. It is read for exactly
     one purpose — to be able to say WHY the board has no connectors in the
     scan's own numbers rather than in a guess. */
  const graph =
    state.repo.phase === 'attached' || state.repo.phase === 'stale'
      ? state.repo.repo.graph
      : state.repo.phase === 'scanning' && state.repo.previous
        ? state.repo.previous.graph
        : null;

  /* A HINT, NOT A FIRST-PAINT FACT: whether the launch bar offers the full council. Working it out is a
     blast-radius pass over the whole graph (33-50 ms on codeforge), which sat in front of the first board
     paint. A graph already answered (Architecture reopened) takes the stored answer in the same render; a new
     one is worked out when the thread is idle, and the bar offers it a frame or two later. */
  const [suggestFullTier, setSuggestFullTier] = useState<boolean>(() => knownFullWorkflowTier(graph) ?? false);
  useEffect(() => {
    const known = knownFullWorkflowTier(graph);
    if (known !== undefined) {
      setSuggestFullTier(known);
      return undefined;
    }
    setSuggestFullTier(false);
    const work = () => setSuggestFullTier(suggestFullWorkflowTier(graph));
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(work, { timeout: 2000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(work, 0);
    return () => window.clearTimeout(id);
  }, [graph]);

  /* The interior, when one is open. Computed from the SCANNED graph rather than
     the edited document: what is inside a service is a fact about the
     repository, and a drawn node has no interior to show. */
  const interior = useMemo(
    () =>
      openedService && graph
        ? serviceInterior(graph, openedService, { nodeDetail: graph.nodeDetail })
        : null,
    [openedService, graph],
  );
  /* Where Back lands: the level above this one, named, or the system. */
  const backTo =
    openedPath.length > 1
      ? (graph?.nodes.find((n) => n.id === openedPath[openedPath.length - 2])?.label ??
        openedPath[openedPath.length - 2])
      : null;

  /* ══ ANATOMY, COMPUTED FROM THE SCANNED GRAPH ════════════════════════════

     THE INDEX IS BUILT ONCE PER GRAPH, not once per open. `indexAnatomy` walks
     every node to roll sizes up recursively, and doing that per card — or per
     render — would be the same class of defect as v1's per-edge box map that
     `Board.tsx`'s header records at ~960 allocations a drag frame.

     ROLLED UP RECURSIVELY, NEVER BY DIRECT CHILDREN. `anatomy.ts` carries the
     worked example; the short version is that a direct-child count reports the
     REPO ROOT — 0 direct file children, 969 file descendants — as empty. */
  const anatomyIndex = useMemo(() => (graph ? indexAnatomy(graph) : null), [graph]);
  const anatomy = useMemo(
    () =>
      graph && anatomyIndex && anatomyNodeId && anatomyIndex.node(anatomyNodeId)
        ? anatomyPanel(graph, anatomyNodeId, anatomyIndex)
        : null,
    [graph, anatomyIndex, anatomyNodeId],
  );
  const anatomyKind = anatomyNodeId ? anatomyIndex?.node(anatomyNodeId)?.kind : undefined;

  /* THE REPOSITORY'S OWN ANATOMY, computed only while the door is open.
     `indexAnatomy` already walked every node once for the card panels; this
     reuses that index rather than walking again. The repo node is found by KIND
     rather than by the literal id "repo", because the id is the scanner's and a
     spelling is not a contract. */
  const repoNode = useMemo(() => graph?.nodes.find((n) => n.kind === 'repo') ?? null, [graph]);
  const repoPanel = useMemo(
    () =>
      repoAnatomy && graph && anatomyIndex && repoNode
        ? anatomyPanel(graph, repoNode.id, anatomyIndex)
        : null,
    [repoAnatomy, graph, anatomyIndex, repoNode],
  );

  /**
   * What a part DOES, in the scanner's own words — `detail.whatItDoes`.
   *
   * Owner, 2026-09-21: the anatomy list gave a name, a line count and a
   * percentage, and he asked what each part IS. The sentence already exists on
   * the node; nothing was drawing it here.
   *
   * GROUNDED, NOT GUESSED. It reads the node and returns null when the node
   * has nothing to say. A part whose scan produced no description shows no
   * description, rather than one written to keep the column even.
   *
   * FROM `nodeDetail`, NOT FROM THE NODE. This read `node.detail.whatItDoes`
   * off `graph.nodes`, and an `ArchNode` has no `detail` field — the server
   * sends the sentence beside the graph, in `graph.nodeDetail`. So the column
   * never rendered for anybody. `meta.description`, the scan's own line on
   * the node, is the fallback.
   */
  const partRole = useCallback(
    (cellId: string): string | null => {
      const fromServer = graph?.nodeDetail?.[cellId]?.whatItDoes;
      if (typeof fromServer === 'string' && fromServer.trim() !== '') return fromServer;
      const says = graph?.nodes?.find((n) => n.id === cellId)?.meta?.description;
      return typeof says === 'string' && says.trim() !== '' ? says : null;
    },
    [graph],
  );

  /* A wall belongs to the node it was opened on, and Open replaces the view.
     Carrying it across would leave a treemap of a service drawn on whatever
     card happened to inherit the id one level down. */
  useEffect(() => setAnatomyNodeId(null), [openedService]);

  /* ESCAPE CLOSES IT — the same key the menu uses, and the reason is the same:
     a thing you can open and not close is a trap. `capture` is not used, so a
     menu or a dialog with its own Escape handler still gets first refusal. */
  useEffect(() => {
    if (!anatomyNodeId) return;
    function onKey(event: KeyboardEvent) {
      /* The board took this Esc for a level above (Draw, the selection) —
         one level per press (round 7, C.5). */
      if (event.key === 'Escape' && !event.defaultPrevented) setAnatomyNodeId(null);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [anatomyNodeId]);

  /* THE SAME KEY CLOSES THE WHOLE-REPOSITORY VIEW, for the same reason. A view
     that replaces the board and can only be left by one button is a trap the
     first time that button is off screen. */
  useEffect(() => {
    if (!repoAnatomy) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setRepoAnatomy(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [repoAnatomy]);

  /*
   * ══ S4 — THE PROPOSAL GHOST ═════════════════════════════════════════════
   *
   * "Nodes and edges the agent proposes, drawn DASHED over the grounded
   * document with one Accept/Deny bar. The rail never shows any of it —
   * unaccepted topology is not part of the index."
   *
   * The ghost is merged into the document for PROJECTION AND LAYOUT ONLY, so it
   * is laid out by the same engine as everything else and lands where it would
   * actually go. It is never written to `session.doc`: that is what Accept is
   * for, and a ghost that had already edited the document would make Deny a
   * second edit rather than a refusal.
   *
   * This state was recorded as blocked on draw mode. It is not —
   * `TopologyProposal.turnId` says the ghost comes from an ASK, so an agent can
   * propose a service without anybody picking up a pen.
   */
  const proposal = canvas.view.state === 'S4' ? canvas.view.proposal : null;
  const proposalProjection = useMemo(() => {
    if (interior && !proposal) return { doc: interior.doc, addedNodeIds: [] as string[] };
    if (!proposal) return { doc: grounded, addedNodeIds: [] as string[] };
    if (!grounded) {
      const nodes = proposal.nodes.map((n) => ({
        id: n.id,
        kind: n.kind,
        label: n.label,
        ...(n.detail ? { detail: n.detail } : {}),
      }));
      const edges = proposal.edges.map((e) => ({
        id: e.id,
        from: e.from,
        to: e.to,
        family: e.family,
        ...(e.label ? { label: e.label } : {}),
      }));
      const kind = inferSeqDiagramKind({ nodes, edges });
      const layout = seqDiagramLayoutForKind(kind, edges);
      const diagramFamily: 'process' | 'software' =
        kind === 'agent-workflow' || kind === 'service-flow' ? 'process' : 'software';
      return {
        doc: {
          version: 1 as const,
          kind,
          title: proposal.title ?? 'Proposed architecture',
          grounded: { graphId: `proposal:${proposal.id}` },
          meta: { diagramFamily },
          layout,
          nodes,
          edges,
        },
        addedNodeIds: nodes.map((n) => n.id),
      };
    }
    /* Proposed ids that already exist are dropped rather than duplicated: an
       agent proposing a node the repo has is proposing an EDGE to it, and two
       cards with one id is a board that cannot say which one was clicked. */
    const have = new Set(grounded.nodes.map((n) => n.id));
    const addedNodes = proposal.nodes.filter((n) => !have.has(n.id));
    return {
      doc: {
        ...grounded,
        nodes: [...grounded.nodes, ...addedNodes],
        edges: [...grounded.edges, ...proposal.edges],
      },
      addedNodeIds: addedNodes.map((n) => n.id),
    };
  }, [grounded, proposal, interior]);

  const doc = proposalProjection.doc;

  useEffect(() => {
    setProposalLayoutDirection(null);
  }, [proposal?.id]);

  const layoutDoc = useMemo(() => {
    if (!doc || proposalLayoutDirection === null) return doc;
    return {
      ...doc,
      layout: {
        engine: doc.layout?.engine ?? 'layered-flow',
        direction: proposalLayoutDirection,
      },
    };
  }, [doc, proposalLayoutDirection]);

  /* TOP TO BOTTOM until the reader picks a direction (0.1.6, the owner:
     "vertical layering by default"). Auto direction still lays out both and
     takes LR only when it fits clearly larger (pickLayout). A direction the
     reader chose, or a proposal's own, is kept. */
  const directionChoice: 'LR' | 'TD' | null =
    boardView.dir === 'TB' ? 'TD' : boardView.dir === 'LR' ? 'LR' : null;
  const setDirectionChoice = useCallback(
    (d: 'LR' | 'TD' | null) => updateView((v) => ({ ...v, dir: d === 'TD' ? 'TB' : d })),
    [updateView],
  );
  const layoutProfile = useMemo(() => {
    if (!layoutDoc) return null;
    const profile = classifySeqDiagramLayout(layoutDoc);
    if (proposal || profile.engine !== 'layered-flow') return profile;
    const direction = directionChoice ?? 'TD';
    return { ...profile, direction };
  }, [layoutDoc, proposal, directionChoice]);
  /* The board picks the direction itself (both are laid out, the better fit
     is drawn) while the reader has not chosen one. */
  const autoDirection =
    !!layoutProfile && !proposal && directionChoice === null && layoutProfile.engine === 'layered-flow';
  /* ══ THE COMPOSITE BOARD — groups expanded in place ══════════════════════
     The grouping rules live in `composite.ts`; this only holds which groups
     the reader expanded. Expanding draws a group's members inside its frame,
     links lifted to whatever is visible. Focus (the old Open) still draws one
     group alone. A proposal is drawn as it was proposed, never expanded. */
  const expanded = boardView.expanded;
  /* Framed (groups as frames) or flat (an expanded group replaced by its
     members). Local: a way of looking, not part of the shared link. */
  const [flat, setFlat] = useState(false);
  /* DIFF ON THE MAP: what DiffView found (views/historyModel.ts), set only
     while it is open. A module the branch deleted is drawn as a ghost box. */
  const [diffMarks, setDiffMarks] = useState<DiffMarks | null>(null);
  const composite = useMemo(() => {
    const c =
      doc && !proposal
        ? compositeDocument(doc, graph, expanded, { nodeDetail: graph?.nodeDetail, flat })
        : {
            doc,
            parentOf: {} as Record<string, string>,
            groups: [] as CompositeGroup[],
            merged: {} as Record<string, number>,
          };
    const ghosts = diffMarks?.ghosts ?? [];
    if (!c.doc || ghosts.length === 0) return c;
    const parentOf = { ...c.parentOf };
    for (const g of ghosts) if (g.parentId) parentOf[g.id] = g.parentId;
    return {
      ...c,
      doc: { ...c.doc, nodes: [...c.doc.nodes, ...ghosts.map((g) => ({ id: g.id, kind: 'module' as const, label: g.label }))] },
      parentOf,
    };
  }, [doc, proposal, graph, expanded, flat, diffMarks]);
  /* EXPAND UNDER THE 50-BOX BUDGET (§3.2): expanding past it first collapses
     the least recently expanded sibling; what is still over rolls into the
     group's +N chip. Collapsing a group collapses what is open inside it. */
  const scanParent = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n.parentId])), [graph]);
  const toggleExpand = useCallback(
    (nodeId: string) => {
      const parentOf = (id: string) => scanParent.get(id) ?? undefined;
      updateView((v) => ({
        ...v,
        expanded: v.expanded.includes(nodeId)
          ? collapseView(v.expanded, nodeId, parentOf)
          : doc
            ? expandWithBudget(v.expanded, nodeId, parentOf, (list) => boxesWithoutBudget(doc, graph, list))
            : v.expanded,
      }));
    },
    [updateView, scanParent, doc, graph],
  );
  /* ══ EXPAND ALL, AS FAR AS THE PANE CAN READ IT (autoExpand.ts) ══════════ */
  const [auto, setAuto] = useState<AutoExpandState | null>(null);
  const handTried = useRef<string | null>(null);
  const onArrangedFit = useCallback(
    (fitZoom: number) => {
      const parentOf = (id: string) => scanParent.get(id) ?? undefined;
      const hand = handTried.current;
      handTried.current = null;
      const labelOfNode = (id: string) => graph?.nodes.find((n) => n.id === id)?.label ?? id;
      if (hand && fitZoom < FIT_FLOOR && boardView.expanded.includes(hand)) {
        updateView((v) => ({ ...v, expanded: collapseView(v.expanded, hand, parentOf) }));
        setInkNote(`No room to open ${labelOfNode(hand)} here without cutting boxes off. Close a group, or use Focus.`);
        return;
      }
      if (!auto || auto.done) return;
      const step = autoExpandStep(auto, fitZoom, (id) =>
        doc ? boxesWithoutBudget(doc, graph, [...boardView.expanded, id]) <= BOX_BUDGET : false,
      );
      setAuto(step.state);
      if (step.collapse) {
        const c = step.collapse;
        updateView((v) => ({ ...v, expanded: collapseView(v.expanded, c, parentOf) }));
      } else if (step.expand) {
        const e = step.expand;
        updateView((v) => (v.expanded.includes(e) ? v : { ...v, expanded: [...v.expanded, e] }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auto, boardView.expanded, scanParent, doc, graph, updateView],
  );
  const grouped = useMemo(() => {
    if (!composite.doc) return NOTHING;
    const projected = projectDocument(composite.doc);
    if (composite.groups.length === 0) return projected;
    const groupOf = new Map(composite.groups.map((g) => [g.id, g]));
    /* The seed (before ELK answers) places members in a column inside their
       frame, relative to it — the same frame of reference ELK answers in. */
    const positions = { ...projected.positions };
    for (const g of composite.groups) {
      g.memberIds.forEach((id, i) => {
        positions[id] = { x: GROUP_PAD.side, y: GROUP_PAD.top + i * 64 };
      });
    }
    return {
      ...projected,
      positions,
      nodes: projected.nodes.map((node) => {
        const parentId = composite.parentOf[node.id];
        const group = groupOf.get(node.id);
        if (!parentId && !group) return node;
        return {
          ...node,
          ...(parentId ? { parentId } : {}),
          ...(group ? { group: { shown: group.memberIds.length, total: group.total, tests: group.tests } } : {}),
        };
      }),
    };
  }, [composite]);
  /* FOCUS AND HIDDEN (§3.2): with a focus, only the cards within `proximity`
     hops of it are drawn (and the frames that hold them); hidden ids are never
     drawn. Both are filters on what the composite board would draw. */
  const projection = useMemo(() => {
    const focus = boardView.focus;
    const hidden = new Set(boardView.hidden);
    const focusOn = focus && grouped.nodes.some((n) => n.id === focus);
    if (!focusOn && hidden.size === 0) return grouped;
    let keep = new Set(grouped.nodes.map((n) => n.id));
    if (focusOn) {
      keep = neighbourhood(focus, grouped.edges, boardView.proximity);
      const parent = new Map(grouped.nodes.map((n) => [n.id, n.parentId]));
      for (const id of [...keep]) {
        let up = parent.get(id);
        while (up && !keep.has(up)) {
          keep.add(up);
          up = parent.get(up);
        }
      }
    }
    for (const id of hidden) keep.delete(id);
    return {
      ...grouped,
      nodes: grouped.nodes.filter((n) => keep.has(n.id)),
      edges: grouped.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
    };
  }, [grouped, boardView.focus, boardView.hidden, boardView.proximity]);
  const ghostNodeIds = useMemo(() => {
    const projected = new Set(projection.nodes.map((n) => n.id));
    return proposalProjection.addedNodeIds.filter((id) => projected.has(id));
  }, [projection.nodes, proposalProjection.addedNodeIds]);

  /* ══ DERIVED CONNECTORS — OFF UNTIL ASKED FOR ═══════════════════════════

     Owner walk 2026-08-22: "Between the services, they might not be directly
     connected, but there could be some type of dotted lines or maybe a dot
     connector that shows how the analyzer or whatever it outputs can interact
     with the next board."

     THE DEFAULT BOARD STAYS THE HONEST ONE. Everything drawn without this
     toggle is something the scan READ. What this adds is an inference — files
     in one service import files in another, counted — and the reader opts into
     the weaker claim rather than being handed it as though it were the same
     kind of fact.

     `project.ts` still skips `kind === 'import'`, so this never turns an import
     into a call. It is a fourth proof state with its own dotted, hairline,
     quietest-ink language, and its label counts imports and never says
     "calls". */
  const showDerived = boardView.showImports;
  const setShowDerived = useCallback(
    (fn: (on: boolean) => boolean) => updateView((v) => ({ ...v, showImports: fn(v.showImports) })),
    [updateView],
  );

  const derived = useMemo(() => {
    if (!graph) return [];
    /* Lifted to whatever is drawn: a member of an expanded group carries its
       own imports; a collapsed group carries its members'. Only between two
       cards this board is actually drawing.

       PACKAGE-LEVEL IMPORTS ARE THE ARCHITECTURE (stream 3b, owner review): in
       a monorepo the package-to-package imports are what the board is for, so
       imports lifted to two TOP-LEVEL boxes are always drawn, one line per
       pair, any count. "Imports" (hidden by default) hides only the
       file-level ones: imports between members inside expanded groups. */
    const all = importEdges(
      graph,
      projection.nodes.map((n) => n.id),
      composite.parentOf,
      1,
    );
    const topLevel = (id: string) => composite.parentOf[id] === undefined;
    /* A pair the document already joins with an import roll-up (an opened
       service's modules) is not drawn twice. */
    const rolledUp = new Set(
      projection.edges.filter((e) => /\bimports?$/.test(e.label ?? '')).map((e) => `${e.source}->${e.target}`),
    );
    return all
      .filter((d) => !rolledUp.has(`${d.source}->${d.target}`))
      .filter((d) => (topLevel(d.source) && topLevel(d.target)) || (showDerived && d.imports >= 3))
      .map((d) => ({
      id: d.id,
      source: d.source,
      target: d.target,
      proof: 'derived' as const,
      /* THE COUNT IS THE WHOLE CLAIM: '84 imports' and '3 imports' must not
         read the same. The word stays 'imports' — a fact about files. */
      label: d.label,
      imports: true,
    }));
  }, [showDerived, graph, projection.nodes, projection.edges, composite.parentOf]);

  /* ONE LINE PER PAIR, PROOF FROM THE SCAN (edgeLines.ts). */
  const readPairs = useMemo(
    () => sourceReadPairs(graph, projection.nodes.map((n) => n.id)),
    [graph, projection.nodes],
  );

  /* ══ THE ARRANGEMENT SEES THE DERIVED EDGES TOO ═════════════════════════

     THE DEFECT: the layout was fed `projection.edges` while the RENDERER was
     fed `projection.edges + derived`, so the two disagreed about what the graph
     was. `elkGraphFor` chooses its algorithm on `drawn.length > 0` — with the
     scan's edges alone this repository has one, so ten of eleven cards were
     islands and ELK packed them as rectangles. Rectpacking has no direction,
     which is why the Vertical/Horizontal control flipped `aria-pressed` and
     changed nothing on screen: the control was live, the algorithm underneath
     it was one that does not take a direction. (Measured: bbox 160x677 before
     and after, byte-identical.)

     Feeding the same edge list to both ends closes it. When the inference is
     showing, the twelve service->service dependencies are what the graph IS, so
     they lay it out — layered, in the direction the toggle names — and the
     board becomes a dependency diagram instead of ten boxes beside one pair.
     When it is off, nothing changed: the same `projection.edges` as before.

     THIS DOES NOT PROMOTE THE CLAIM. An edge used for layout is still drawn
     dotted, hairline, in the weakest ink, carrying a count and the word
     'imports'. Where a card sits is not an assertion about the code. */
  const layoutEdges = useMemo(
    () => mergeSamePair(proofFromScan(derived.length > 0 ? [...projection.edges, ...derived] : projection.edges, readPairs)),
    [projection.edges, derived, readPairs],
  );

  /* Derived edges come AFTER the real ones, so a traced connector between the
     same two nodes paints over an inference rather than under it. */
  /* Counted whether or not the toggle is on: the label has to say what
     pressing it would draw, and asking the reader to press it to find out is
     the thing the count exists to avoid. */
  const derivedAvailable = useMemo(() => {
    if (!graph) return 0;
    /* BY ID, NOT LABEL. A saved board carries display labels ("Acp service") where the
       graph carries ids ("svc:acp"), so the label join matched nothing and this toggle
       was permanently disabled on every board written by that path. */
    /* The toggle governs file-level imports only: count those. */
    return importEdges(graph, projection.nodes.map((n) => n.id), composite.parentOf).filter(
      (d) => composite.parentOf[d.source] !== undefined || composite.parentOf[d.target] !== undefined,
    ).length;
  }, [graph, projection.nodes, composite.parentOf]);

  /* Nodes that contain others — expand icon on the card header. */
  const openableNodeIds = useMemo(() => {
    if (!graph) return new Set<string>();
    return openableIdsOf(graph) as Set<string>;
  }, [graph]);

  /* IMPORTS ARE HIDDEN BY DEFAULT (overhaul stream 3, composite board). On a
     real repository nearly every scanned edge is an import (codeforge: 1,718
     of 1,725), so the first screen shows the groups and the scan's own
     connectors; the Imports control draws the counted, lifted imports on
     request. This replaces the earlier rule that switched them on whenever a
     card was joined to nothing. */

  const boardEdges = useMemo(() => {
    const edges = layoutEdges;
    if (!runOverlay?.activeEdgeId) return edges;
    const [fromRaw, toRaw] = runOverlay.activeEdgeId.split('->');
    if (!fromRaw || !toRaw) return edges;
    const from = fromRaw.startsWith('wf:') ? fromRaw.slice(3) : fromRaw;
    const to = toRaw.startsWith('wf:') ? toRaw.slice(3) : toRaw;
    return edges.map((e) =>
      e.source === from && e.target === to ? { ...e, runActive: true } : e,
    );
  }, [layoutEdges, runOverlay?.activeEdgeId]);

  /* ══ ITEM playback — THE FLOW, RESOLVED ONTO THIS DOCUMENT ═══════════════

     `parentOf` reads the scan's own `parentId` and derives no containment of
     its own. It is memoised on the graph object, so a rescan gets a new lookup
     and the old one is collected with it — the same discipline `railModel.ts`
     applies to its index, and for the same reason: this is called once per
     playback change, not once per render, and a map rebuilt per render is the
     defect class this board already had once with its per-edge box map. */
  const parentOf = useMemo(
    () => parentLookup(graph?.nodes ?? []),
    [graph],
  );

  const flow = useMemo(() => {
    if (canvas.view.state !== 'S3') return null;
    return resolveFlow(
      canvas.view.playback,
      {
        nodeIds: new Set(projection.nodes.map((node) => node.id)),
        edges: projection.edges,
      },
      parentOf,
    );
  }, [canvas.view, projection, parentOf]);

  /* THE ONE DISPATCH THAT MOVES THE BOARD. `canvas/flow-focus` returns the
     slice unchanged when the answer has not moved, which is what stops this
     effect from feeding itself: the reducer's identity check is load-bearing
     and is documented on the case. */
  useEffect(() => {
    if (flow === null) return;
    dispatch({ type: 'canvas/flow-focus', dim: flow.dim, focus: flow.focus });
  }, [flow, dispatch]);

  /* ══ DECISION 6 — A CLICK DIMS WHAT THE SELECTION DOES NOT CONCERN ══════

     Sheet 06.6, as amended: "Selecting a node asks a question about THAT
     node, and the board answers by receding everything not on its path,
     exactly as path-focus does; the dim extends today's flow-playback
     behaviour to the selected card rather than inventing a second mechanism."
     Same pipeline (`DimSpec` → `canvas.dim`), resolved HERE because only this
     component holds the edges a path needs, and dispatched through the same
     compute-then-dispatch shape the ELK and flow effects use.

     IT STAYS OUT OF S3. While a flow plays, `canvas/flow-focus` owns the dim;
     a click inside the flow is how a reader inspects a hop, and it must not
     rewrite the lit set underneath them. Escape and click-empty clear through
     `canvas/clear`, which drops a selection-sourced dim at the reducer. */
  useEffect(() => {
    if (canvas.view.state === 'S3') return;
    const next = selectionDim(canvas.selection.nodeIds, projection.edges);
    /*
     * AN EFFECT MAY ONLY CLEAR A DIM IT AUTHORED. This dispatched
     * unconditionally, and `selectionDim([])` is null — so simply MOUNTING the
     * board wiped whatever dim another author had put there. It cost the first
     * teach:step attempt its whole point (reverted, 604fa893): a lesson lit the
     * board, the learner clicked the work row, opening this pane cleared the
     * spotlight before it painted. The S3 guard above is the same rule already
     * written for playback; this is it stated generally.
     *
     * `canvas.dim` is read but deliberately NOT a dependency: this effect
     * writes that value, so depending on it would re-run the effect on its own
     * dispatch, forever. The render's value is the right one to consult here.
     */
    if (next === null && canvas.dim !== null && canvas.dim.reason !== 'selection') return;
    dispatch({ type: 'canvas/dim', dim: next });
    // The edges list is what a path IS here; the selection is the ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas.view.state, canvas.selection.nodeIds, projection.edges, dispatch]);

  /* ══ A LESSON LIGHTS THE BOARD — teach:step, docs/teach-mode.md §3 ══════

     RESOLVED HERE, for the same reason the selection dim is: only this
     component knows what the board actually DRAWS. The step's `litNodeIds` are
     grounded — the server checked every one against the scanned graph before
     the event existed — but grounded is not drawn. The graph carries file and
     module nodes; the board paints services, datastores and topics. Dimming
     from raw ids would recede every card and light none, which is worse than
     doing nothing, and it is what the first attempt did.

     So: intersect with the projection, and if NOTHING the step names is on this
     board, leave the board alone. A lesson about a file is still a lesson — its
     caption and its chart carry it — and a spotlight on nothing is a lie about
     where to look. */
  useEffect(() => {
    if (canvas.view.state === 'S3') return;
    const step = state.session.canvasDoc.teachStep;
    if (!step) return;
    const onBoard = new Set(projection.nodes.map((n) => n.id));
    const dim = teachDim(step.litNodeIds, onBoard);
    if (dim === null) return;
    dispatch({ type: 'canvas/dim', dim });
  }, [canvas.view.state, state.session.canvasDoc.teachStep, projection.nodes, dispatch]);

  /* ══ A LOOKUP LIGHTS THE PART THAT HOLDS IT — lookup:located ═══════════

     THE SAME RESOLUTION AS THE LESSON ABOVE, A DIFFERENT CLAIM. Identical
     mechanics on purpose — intersect with what this board draws, and leave the
     board alone when nothing it names is painted here — but through `lookupDim`
     rather than `teachDim`, so the reason reads `lookup`.

     That distinction is the point of the whole join. Asking where a symbol is
     declared answered 4 of 4 in the chat rail while the map sat still, and the
     only server-fed way to light the board was `teach:step` — whose caption
     ASSERTS A LESSON. Reusing it would have told the board a lesson happened
     when none did, which is the same fault as a verb claiming an outcome the
     engine never supplied. So the board learns a lookup happened, and never
     mistakes it for teaching. */
  useEffect(() => {
    if (canvas.view.state === 'S3') return;
    const located = state.session.lookupLocated;
    if (!located) return;
    const onBoard = new Set(projection.nodes.map((n) => n.id));
    const dim = lookupDim(located, onBoard);
    if (dim === null) return;
    dispatch({ type: 'canvas/dim', dim });
  }, [canvas.view.state, state.session.lookupLocated, projection.nodes, dispatch]);

  /* ══ DECISION 6 — /api/annotate, CALLED AT LAST ════════════════════════

      Once per scan, keyed on `scannedAt` — the same invalidation key the route's
      own cache uses — and memoised at the client (`annotationsForScan`), so a
      Board↔Whiteboard tab flip remounts this component without re-asking. The
      client resolves to `{}` on every non-answer (no provider bound, static
      origin, abort); `{}` IS DISPATCHED like any other answer, because the
      reducer's annotate case replaces wholesale (finding F1: refusing to
      dispatch it is how scan A's sentences survived onto scan B's cards). */
  const scannedAt = graph?.scannedAt ?? null;
  useEffect(() => {
    if (scannedAt === null) return undefined;
    const controller = new AbortController();
    let live = true;
    void (async () => {
      const answer = await annotationsForScan(globalThis.fetch, controller.signal, scannedAt);
      if (!live) return;
      dispatch({ type: 'canvas/annotate', annotations: answer });
    })();
    return () => {
      live = false;
      controller.abort();
    };
    // One ask per scan; nothing else may re-fire it.
  }, [scannedAt, dispatch]);

  /* WHAT THE BOARD CAN AND CANNOT SHOW OF THE CURRENT HOP, in the resolver's
     own four-member vocabulary, with the labels read off the cards that are
     actually drawn. Every number here is an index into a list the reader can
     see; nothing is counted that is not on screen. */
  const playbackNote = useMemo<BoardPlayback | null>(() => {
    if (flow === null || canvas.view.state !== 'S3') return null;
    const playback = canvas.view.playback;
    const cursor = playback.cursor;
    if (cursor < 0 || cursor >= flow.hops.length) return null;
    const hop = flow.hops[cursor];
    const labelOf = (id: string | null) =>
      id === null ? null : (projection.nodes.find((node) => node.id === id)?.label ?? id);
    return {
      functionId: playback.functionId,
      index: cursor,
      count: flow.hops.length,
      shown: flow.shown,
      how: hop.how,
      from: hop.from,
      to: hop.to,
      fromLabel: labelOf(hop.from),
      toLabel: labelOf(hop.to),
    };
  }, [flow, canvas.view, projection]);

  /* ══ THE LAYOUT — item canvas-fixes 2 ══════════════════════════════

     ELK RUNS HERE, NOT IN `project.ts`. `projectDocument` is pure and
     synchronous and turns a document into cards; a layout is neither, because
     it has to be told the shape of the pane and it has to run off the main
     thread. Keeping them apart is what lets the projection stay a pure function
     of the document — the board draws the moment a graph arrives, and the
     arrangement improves one frame later.

     WHAT `positions` MEANS AT EACH OF THE THREE LEVELS, since there are now
     three and they are easy to confuse:

       projection.positions   the seed. `project.ts`'s depth walk: correct on a
                              layered graph, and a column on an edgeless one.
                              What is on screen before ELK answers, and what
                              stays there where there is no Worker to answer.
       laid.positions         ELK's. Replaces the seed wholesale.
       canvas.positions       what the READER dragged. Overrides both, per node,
                              inside Board.tsx — a layout never moves a card the
                              reader has placed.

     THE KEY IS THE THING BEING LAID OUT, not a counter. A stale answer arriving
     after the document changed would place the previous graph's nodes; keying
     on the ids and the frame's shape means an answer can only ever be applied
     to the question it was asked about. */
  /* THE ANNOTATION REACHES THE CARD THROUGH THE NODE IT BELONGS TO — one
     bullet, the endpoint's own first line for that id, merged onto the
     projection rather than rendered from a side list so `cardHeight` can
     reserve its room and every edge endpoint stays on the card. Ids the
     endpoint named that no drawn node carries are dropped here by simply not
     matching; nothing is invented for a card the scan has no answer about. */
  const annotations: Annotations = canvas.annotations;
  /* THE SCAN'S OWN NODES BY ID, for the definition line a card falls back to
     when the graph has no summary for it (scanFacts.ts). */
  const scanNodeById = useMemo(
    () => new Map((graph?.nodes ?? []).map((n) => [n.id, n as { label: string; meta?: Record<string, unknown> | null }])),
    [graph],
  );
  const boardNodes = useMemo(() => {
    const withFacts = (node: BoardNode): BoardNode => {
      const raw = scanNodeById.get(node.id);
      const facts = raw ? scanFacts(raw, node.label) : null;
      return facts ? { ...node, facts } : node;
    };
    const factual = scanNodeById.size === 0 ? projection.nodes : projection.nodes.map(withFacts);
    const base =
      Object.keys(annotations).length === 0
        ? factual
        : factual.map((node) => {
            const bullets = annotations[node.id];
            const first = bullets?.[0];
            return first ? { ...node, annotation: first } : node;
          });
    const marks = diffMarks?.marks;
    const marked = marks ? base.map((node) => (marks[node.id] ? { ...node, change: marks[node.id] } : node)) : base;
    if (!runOverlay) return marked;
    return marked.map((node) => {
      const runStatus = programNodeStatusForBoardNode(node.id, runOverlay);
      return runStatus ? { ...node, runStatus } : node;
    });
  }, [projection.nodes, annotations, runOverlay, diffMarks, scanNodeById]);

  /* THE FAR BAND (S4 review, item 1). On the far rungs a card reserves its
     counter-scaled title (cardBox.ts farTitleScaleMax), so the layout asks
     for those boxes there: one relayout when the zoom crosses into or out of
     the band, never one per zoom step. A far box is never shorter than the
     near one, so fitting a far layout cannot pull the board back near. */
  const farBand = !visibilityAt(canvas.rung).title && visibilityAt(canvas.rung).shortTitle;
  /* THE FACE BEFORE THE FIRST LAYOUT. Boxes are sized by measuring the title
     in its face; measured in a fallback face they are the wrong size until
     the next layout. Archivo is a local file, so this waits a few ms; a face
     that never arrives does not hold the board past 1.5 s. */
  const [fontsReady, setFontsReady] = useState(() => {
    const fonts = typeof document === 'undefined' ? undefined : document.fonts;
    return !fonts || typeof fonts.check !== 'function' || fonts.check(titleFont());
  });
  /* A LIVE FONT SWITCH (Settings > Interface font). Card boxes were measured in the old face, so the measure memo is
     dropped, the new face is awaited like the first one, and the epoch is part of the layout key so the same board
     is laid out again even though nothing else about it changed. */
  const [fontEpoch, setFontEpoch] = useState(0);
  useEffect(() => {
    const onFont = () => {
      clearCardWidthMemo();
      setFontsReady(false);
      setFontEpoch((n) => n + 1);
    };
    window.addEventListener(FONT_EVENT, onFont);
    return () => window.removeEventListener(FONT_EVENT, onFont);
  }, []);
  useEffect(() => {
    if (fontsReady) return;
    let live = true;
    const done = () => {
      if (!live) return;
      clearCardWidthMemo();
      setFontsReady(true);
    };
    const t = setTimeout(done, 1500);
    if (!document.fonts || typeof document.fonts.load !== 'function') done();
    else void Promise.all([document.fonts.load(titleFont()), document.fonts.load(glanceFont())]).then(done, done);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [fontsReady]);
  const layoutKey = useMemo(
    () =>
      fontsReady && projection.nodes.length && layoutProfile
        ? layoutKeyFor({
            nodeIds: projection.nodes.map((node) => node.id),
            edgeCount: layoutEdges.length,
            aspect: frameAspect(canvas.frame.width, canvas.frame.height),
            engine: layoutProfile.engine,
            direction: autoDirection ? 'auto' : layoutProfile.direction,
            annotated: annotatedCountForLayout(boardNodes, canvas.rung),
            visual,
            anatomyNodeId: anatomyNodeId ?? null,
            farBand,
            fontEpoch,
          })
        : '',
    [
      projection,
      layoutEdges,
      layoutProfile,
      canvas.frame.width,
      canvas.frame.height,
      boardNodes,
      canvas.rung,
      visual,
      anatomyNodeId,
      farBand,
      fontsReady,
      fontEpoch,
    ],
  );

  const [laid, setLaid] = useState<{
    key: string;
    positions: Record<string, { x: number; y: number }>;
    sizes?: Record<string, { w: number; h: number }>;
    routes?: Record<string, ElkPoint[]>;
    /** Where the "Not connected" row's label sits, when there is one, and
     *  its cards (the label follows them, rowLabels.ts). */
    orphanRow?: { x: number; y: number; count: number; ids?: string[] };
    /** The direction drawn, when the board chose it (auto). */
    direction?: 'LR' | 'TD';
  } | null>(null);

  useEffect(() => {
    if (!layoutKey || !layoutProfile) return;
    let live = true;
    dispatch({ type: 'canvas/layout', layout: 'laying-out' });

    /* MEASURED AT RUNG 1, ALWAYS, and that is a decision rather than a default.
       `cardHeight` shrinks as the reader zooms out, so laying out at the live
       rung would re-pack the whole board on every zoom step — the cards would
       slide under a reader who only asked to see more of them. Rung 1 is the
       resting card (§08.2: "the only rung that reserves --arch-card-min-h"), so
       the arrangement is stable and the zoom is what changes. */
    const farScale = farBand ? boardFarScale(projection.nodes) : undefined;
    const boxes = projection.nodes.map((node) => {
      const box = cardBox(
        node,
        projection.positions[node.id] ?? { x: 0, y: 0 },
        1,
        visual,
        node.id === anatomyNodeId ? anatomy : null,
      );
      /* An open group with nothing drawn keeps room for its body row. */
      if (node.group && node.group.shown === 0) return { ...box, h: Math.max(box.h, EMPTY_GROUP_H) };
      /* The far band: the card as painted there, its counter-scaled row
         reserved. */
      if (farScale && !node.group) {
        const far = cardBox(
          node,
          projection.positions[node.id] ?? { x: 0, y: 0 },
          canvas.rung,
          visual,
          node.id === anatomyNodeId ? anatomy : null,
          undefined,
          farScale,
        );
        return { ...box, w: Math.max(box.w, far.w), h: Math.max(box.h, far.h) };
      }
      return box;
    });

    const applyPositions = (
      positions: Record<string, { x: number; y: number }>,
      sizes?: Record<string, { w: number; h: number }>,
      routes?: Record<string, ElkPoint[]>,
      orphanRow?: { x: number; y: number; count: number; ids?: string[] },
      direction?: 'LR' | 'TD',
    ) => {
      if (!live) return;
      if (!Object.keys(positions).length) {
        dispatch({ type: 'canvas/layout', layout: 'failed' });
        return;
      }
      setLaid({
        key: layoutKey,
        positions,
        ...(sizes ? { sizes } : {}),
        ...(routes ? { routes } : {}),
        ...(orphanRow ? { orphanRow } : {}),
        ...(direction ? { direction } : {}),
      });
      dispatch({ type: 'canvas/layout', layout: 'idle' });
    };

    if (layoutProfile.engine === 'circular-loop') {
      applyPositions(circularLayoutPositions(boxes, layoutEdges, canvas.frame));
      return () => {
        live = false;
      };
    }

    /* NOT CONNECTED (stream 3b): a top-level card no line touches is not part
       of the flow, so it is not laid out in it, where ELK leaves it floating.
       It goes in a tidy row under the connected board, labelled. */
    const split = splitOrphans(boxes, layoutEdges, composite.parentOf);
    const run = (direction: 'LR' | 'TD') =>
      layoutOffThread(
        elkGraphFor(split.connected, layoutEdges, canvas.frame, {
          direction,
          engine: layoutProfile.engine,
          visual,
          parentOf: composite.parentOf,
        }),
      ).then((result) => {
        const positions = positionsFrom(result);
        const sizes = sizesFrom(result);
        const row = placeOrphanRow(split.connected, split.orphans, positions, sizes, composite.parentOf);
        const all = { ...positions, ...row.positions };
        return {
          direction,
          positions: all,
          sizes,
          routes: routesFrom(result),
          row: row.label ?? undefined,
          zoom: fitZoomFor(boxes, all, sizes, composite.parentOf, canvas.frame),
        };
      });
    /* AUTO DIRECTION (stream 3b): the reader has not picked one, so both are
       laid out and the one that fits the pane larger is drawn; within 5% of
       each other, the one whose routes cross less. */
    const answer = autoDirection
      ? Promise.all([run('LR'), run('TD')]).then(([lr, td]) => pickLayout(lr, td))
      : run(layoutProfile.direction === 'TD' ? 'TD' : 'LR');
    answer
      .then((laidOut) => {
        if (!live) return;
        applyPositions(laidOut.positions, laidOut.sizes, laidOut.routes, laidOut.row, laidOut.direction);
      })
      .catch(() => {
        /* NO Worker, OR ELK GAVE UP. The board keeps the seed and SAYS SO
           through `CanvasSlice.layout`, which Board.tsx puts on the root as
           `data-layout`. Nothing is fabricated and nothing is hidden: the graph
           is all there and correctly grounded; only its arrangement is the
           fallback. */
        if (live) dispatch({ type: 'canvas/layout', layout: 'failed' });
      });

    return () => {
      live = false;
    };
    // `layoutKey` already carries everything the layout depends on — the ids,
    // the edge count and the frame's quantised shape — so it is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, dispatch]);

  const positions = laid?.key === layoutKey ? laid.positions : projection.positions;
  const sizes = laid?.key === layoutKey ? laid.sizes : undefined;
  const elkRoutes = laid?.key === layoutKey ? laid.routes : undefined;
  const orphanRow = laid?.key === layoutKey ? laid.orphanRow : undefined;
  /* THE FIT FOLLOWS A NEW ARRANGEMENT, NOT A ZOOM (UX audit, 2026-10-06). The
     far band is in the layout key because a far card reserves its
     counter-scaled row, so crossing it re-lays the cards; keyed on the whole
     layout key, the post-attach fit read that as a new arrangement and took
     the camera back to the fit within ~90 ms of every zoom in, and 100% was
     never reachable. The fit key leaves the band out: the graph, the frame's
     shape and the layout choices still re-fit; the reader's zoom does not. */
  const attachFitKey = attachFitKeyFor(attachFitBase, layoutKey);

  const onLayoutDirection = useCallback(
    (direction: 'LR' | 'TD') => {
      if (proposal && !grounded) {
        setProposalLayoutDirection(direction);
        return;
      }
      setDirectionChoice(direction);
      editDoc({ type: 'doc/set-layout-direction', direction });
    },
    [proposal, grounded, editDoc],
  );

  const ghostFitKey =
    proposal && ghostNodeIds.length > 0
      ? `${proposal.id}|${layoutKey}|${laid?.key ?? ''}`
      : null;

  /* ONE ACTION — the chip. `ref` is the real `ArchNode.id`, which is what makes
     the chip GROUNDED: the turn that follows carries an identifier the engine
     can resolve, not a name the model has to guess at. `id` is derived from it
     so clicking the same node twice does not stack two identical chips — the
     store's `composer/chip-add` is a set on id, and a chip list with the same
     node in it three times is a context the reader did not build. */
  const onGround = useCallback(
    (node: BoardNode) => {
      store.dispatch({
        type: 'composer/chip-add',
        chip: {
          id: `node:${node.id}`,
          kind: 'node',
          ref: node.id,
          /* Label stays short on the chip; title (Composer) should say this is
             grounded ask context — not a tool call. */
          label: node.label,
          nodeKind:
            node.present.kind === 'storage'
              ? 'datastore'
              : node.present.kind === 'agent'
                ? null
                : node.present.kind,
        },
      });

      /*
       * AND THE RAIL MOVES WITH IT.
       *
       * Clicking a card used to change nothing in the index: the matching row
       * might be four hundred rows down and unhighlighted, and the two panes
       * that are supposed to drive each other only talked one way. That
       * undercuts the one-canvas premise more directly than any missing
       * feature does.
       *
       * Only when the node HAS a path. A service or a topic is a container
       * rather than a file, and revealing nothing is better than revealing
       * something arbitrary that happens to be inside it.
       */
      /* THE PATH IS READ OFF THE SCANNED NODE. `BoardNode` carries no `path` (the card projection
         drops it), so reading it off `node` meant this dispatch never fired on a real click; the
         reader of `rail/reveal` is Files (owner ruling 2026-10-14), which needs it to move. */
      const path = graph?.nodes.find((n) => n.id === node.id)?.path;
      if (typeof path === 'string' && path !== '') {
        store.dispatch({ type: 'rail/reveal', path: path as never });
      }
    },
    [store, graph],
  );

  /* SHEET 08.5 — three parts, in the same order, and the icon is the KIND OF
     ABSENCE rather than a verdict. An empty state is not a failure.
     "No graph yet" and "the scan failed" are different sentences and are told
     apart here rather than collapsed into one paragraph the reader cannot act
     on. */
  const empty = useMemo<BoardEmpty | null>(() => {
    const NO_PROJECT: BoardEmpty = {
      icon: 'board',
      what: 'No graph yet',
      why: 'Nothing has been read. Point at a folder and the board draws what is actually there.',
      /* THE THIRD PART, AND IT WAS MISSING UNTIL SOMEBODY LOOKED AT THE PAGE.
         Sheet 08.5: every empty state carries what is not here, WHY it is not
         here, and one thing to do about it — "the second part is the one that
         gets dropped, and dropping it turns an empty board into a bug report
         the reader has to file themselves". The first draft of this state had
         the what and the why and no way out of it, which is the same failure
         one step along: a reader who agrees there is no graph still has
         nothing to press.

         It opens the shell's attach overlay through the shell's own action —
         the same one `bootSurfacePropsFrom` dispatches — so the board and the
         boot surface reach the same dialog rather than each inventing a route
         to it. This is the ONLY case that carries an action: a scan in flight
         needs no button, and a scan that failed already carries its own words
         from the failure itself. */
      action: {
        label: 'Open a project',
        onAct: () => store.dispatch({ type: 'shell/overlay', overlay: { kind: 'attach' } }),
      },
    };

    if (projection.nodes.length) return null;

    if (state.repo.phase === 'scanning') {
      return {
        icon: 'board',
        what: scanStatusLine ?? 'Scanning the project',
        why: 'The board draws what the scan finds, as it finds it.',
      };
    }
    if (state.repo.phase === 'failed') {
      return {
        icon: 'board',
        what: 'The scan did not finish',
        // The reason is the failure's own words, never a generic one. Silence
        // is the one outcome a user cannot act on.
        why: state.repo.failure?.message ?? 'The analyzer returned no reason.',
      };
    }
    if (doc) {
      /*
       * ── TWO ABSENCES WORE ONE SENTENCE ─────────────────────────────────
       *
       * "Nothing at this scope / The scan produced a document with no node in
       * this view" was told to a reader in both of these situations, and it is
       * only true in one of them:
       *
       *   a document WITH nodes, none of which survive the current scope — a
       *   filter is hiding them, and the way out is to widen it;
       *
       *   a document with NO NODES AT ALL — the scan found nothing to draw,
       *   the scope is irrelevant, and there is nothing to widen.
       *
       * The owner hit the second one (photo 29, t3code: a folder with no
       * manifests) and was told his scope was wrong. He then typed "draw the
       * arch board behind our project" and it worked — which is the whole
       * finding: the capability was there and the affordance was not.
       * See `each-exit-needs-a-case-that-produces-only-it`.
       */
      const drawn = doc.nodes?.length ?? 0;

      /*
       * THE WAY OUT IS THE SAME IN BOTH, AND IT IS A REAL ONE. The first draft
       * of this offered "Show everything", which would have been a control
       * with nothing behind it: `projection` is `projectDocument(doc)`, a pure
       * projection with no scope state anywhere in it, so there is no filter
       * to widen. A button that widens nothing is the pencil again.
       */
      const drawFromCode = {
        label: 'Draw it from the code',
        onAct: () => {
          store.dispatch({
            type: 'composer/draft',
            text: 'Draw the architecture board for this project from what is actually in the code.',
          });
        },
      };

      /*
       * P2-9: SAY WHAT WAS ACTUALLY READ. "The scan read this folder and found no services" was told with no
       * project open at all, where nothing was scanned: that is the no-project state, and it gets the
       * no-project words. With a project open, the line between the two empty boards is source code: a
       * manifest-less folder with code in it (t3code, above) still draws from that code, so it keeps
       * "Draw it from the code"; a folder whose scan read no source file has nothing to draw from, and says so.
       */
      if (drawn === 0 && state.repo.phase === 'unattached') return NO_PROJECT;
      const sourceFiles =
        state.repo.phase === 'attached' || state.repo.phase === 'stale'
          ? state.repo.repo.graph.nodes.filter((n) => n.kind === 'file' || n.kind === 'module').length
          : null;
      if (drawn === 0 && sourceFiles === 0) {
        return {
          icon: 'board',
          what: 'This folder has no code Sequence can read yet.',
          why: 'Open a folder with code in it, or sketch the system yourself.',
          action: {
            label: 'Open another',
            onAct: () => store.dispatch({ type: 'shell/overlay', overlay: { kind: 'attach' } }),
          },
          secondary: {
            label: 'Start from a sketch',
            onAct: () => requestHostCommand('canvas.whiteboard'),
          },
        };
      }

      if (drawn > 0) {
        return {
          icon: 'filter',
          what: 'Nothing this board can draw',
          why: `The scan recorded ${drawn} ${drawn === 1 ? 'part' : 'parts'}, and none of them are the kind this view places — no service, datastore or topic among them.`,
          action: drawFromCode,
        };
      }
      return {
        icon: 'board',
        what: 'Nothing to draw yet',
        /* The honest why: the scan ran and came back empty, which is a real
           answer about this folder rather than a fault. A repository with no
           manifest is the ordinary case for this, and saying so is what keeps
           a reader from hunting for a setting that would not have helped. */
        why: 'The scan read this folder and found no services or datastores it could place. That is common for a folder with no manifest — the architecture can still be drawn from what is in it.',
        /*
         * ── THE AFFORDANCE, AND IT DOES NOT PULL THE TRIGGER ───────────────
         *
         * Owner, 2026-09-21: "it shouldn't also auto implement ... there
         * should be like a button top right next to the art board or bottom
         * left, which basically says generate."
         *
         * It writes the request into the composer and leaves it there. That is
         * this canvas's standing rule (see `onGenerate` at the foot of this
         * file: "a canvas gesture never starts a run on its own, and they can
         * edit the question first — which is the difference between a tool
         * that proposes and one that acts"), and it is also what he asked for
         * in the same breath. The sentence is the one he found by hand and
         * watched work.
         */
        action: drawFromCode,
      };
    }
    return NO_PROJECT;
  }, [projection.nodes.length, state.repo, doc, store, scanStatusLine]);

  /* ══ ITEM canvas-fixes 3 — A BOARD WITH NO CONNECTORS SAYS WHY ════════════

     THE DECISION, MADE RATHER THAN DEFERRED: THE BOARD DOES NOT DRAW IMPORT
     EDGES, and the honest consequence is a board with no connectors on this
     repository, so it has to say so instead of looking broken.

     The scan of this monorepo is 996 edges and every one of them is an
     `import`. `packages/export/src/project.ts:124` — `if (e.kind === 'import')
     continue;` — drops them before the diagram is built, which is why
     `doc.edges` is empty and no ElbowEdge is ever mounted.

     THAT SKIP IS CORRECT AND SHOULD STAY. Three reasons, in the order they
     matter:

       1. IT IS A DIFFERENT CLAIM. An import says one FILE names another. The
          board's nodes are services, so drawing it as a service-to-service
          connector asserts at the system level something that was only ever
          measured at the file level. CANON's first non-negotiable is that a
          tool asserting a false edge with a citation is worse than no tool, and
          it names the incident: svc:gateway's only two inbound edges were nginx
          confs inside test fixtures, drawn as facts. An import lifted to a
          service edge is that same shape of error, at scale.
       2. IT IS THE HAIRBALL SHEET 08 OPENS WITH — "a list's overflow is a
          scrollbar, a graph's overflow is a hairball". Lifted to ten service
          nodes, 996 file imports collapse to very nearly every ordered pair. An
          edge that is present between almost every two nodes carries no
          information; it is ink that makes the nodes harder to read.
       3. IT WOULD READ AS TRACED. `proofOf` marks `import` traced, so the board
          would spend its strongest proof vocabulary on its least informative
          claim.

     WHAT THE READER GETS INSTEAD is sheet 08.5's third empty state — the one
     whose icon is `ic-flow` because "the connections are the thing missing" —
     with the WHY carrying the scan's real numbers.

     ── 2026-09-05: THE FOURTH CONSUMER COMES INTO LINE ─────────────────────

     This decision was held by three consumers and contradicted by a fourth.
     The board refused to lift imports, `serviceLevelRisksInput` skipped them,
     and impact and risks inherited that — while `indexDigestForAsk` rolled them
     up into **162 service-to-service edges for the PROMPT**, with zero overlap
     with the single edge the other three compute.

     So the model was told, as structure, exactly what this comment refuses to
     draw: something asserted at the system level that was only ever measured at
     the file level. A reader could follow that answer to this board and find
     nothing here, because the board was right and the prompt was not.

     The prompt now applies the same rule, through one shared predicate
     (`isServiceLevelEdgeKind`) that every consumer calls, so a fifth cannot
     quietly disagree. Measured: 162 rolled service edges → 0, and the indexed
     digest 25,460 → 4,018 characters.

     AND THE STANDING OFFER, recorded so nobody re-adds the 162 quietly: if a
     reader needs those connections for an honest answer, the fix is to make
     them DATA with this incident's rule applied — not to keep telling the model
     a thing this board will not show. */
  const edgeless = useMemo<BoardEdgeless | null>(() => {
    if (!projection.nodes.length || projection.edges.length) return null;

    const what = 'No connector between these nodes';
    if (!graph) {
      return {
        what,
        why: 'The document on the board carries no edge, and there is no scan behind it to say why.',
      };
    }

    const total = graph.edges.length;
    if (total === 0) {
      return { what, why: 'The scan found no edge anywhere in this project.' };
    }

    const imports = graph.edges.filter((edge) => edge.kind === 'import').length;
    if (imports === total) {
      return {
        what,
        // Every number here is counted off the scan on screen. Nothing is
        // rounded, nothing is illustrative.
        why:
          `All ${total} edges the scan found are imports. An import says one file names another, ` +
          'not that one service calls another, so the board does not draw it as a connector. ' +
          'That is a fact about this project, not about the board.',
      };
    }
    return {
      what,
      why:
        `The scan found ${total} edges, ${imports} of them imports, and none of the rest joins ` +
        'two nodes that are both on this board.',
    };
  }, [projection.nodes.length, projection.edges.length, graph]);

  /* ══ EDITING, FROM THE USER'S SEAT ══════════════════════════════════════

     The register row read "nothing on the board can be added, renamed or
     removed". `docEdit` and `docSession` made the edits correct and safe; this
     is the part that makes them REACHABLE, which is the half the row was
     actually about. A reducer no gesture can reach closes nothing.

     UNDO IS BOUND HERE AND NOT IN THE MENU. Delete is one click away and the
     document it removes may have taken an hour to arrange, so the escape has
     to be the one every reader already has in their fingers rather than a
     third item they have to find. `docSession` holds a bounded stack of the
     documents themselves — see its header for why a reference stack and not a
     replayed inverse. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const undo = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey;
      if (!undo) return;
      /* NEVER FROM A FIELD. This listener is on `document`, so without this
         line Ctrl+Z typed in the chat box undid a board edit instead of the
         reader's own words — once the board had any undo stack, for the rest
         of the session (owner walk 2026-09-17: "it's not letting me type").
         The whiteboard's own handler has had this guard from the start. */
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null
      ) {
        return;
      }
      /* Only when there is something to take back. Swallowing the platform's
         undo on a board with an empty stack would break undo in whatever the
         reader last typed. */
      if (!session.canUndo) return;
      e.preventDefault();
      editDoc({ type: 'doc/undo' });
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [session.canUndo, editDoc]);

  /* ══ THE CONTROLS PANEL (S2, Nx project-graph style) ══════════════════════
     Search lights the cards whose name holds the text (Enter fits them); Start
     and End trace the shortest path between two cards; a focus draws only a
     card's neighbourhood; direction and framed/flat; PNG export. A click on a
     connector lists the scanned edges it stands for, file:line. */
  const [query, setQuery] = useState('');
  const [pathEnds, setPathEnds] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  const [fitRequest, setFitRequest] = useState<{ ids: string[]; seq: number } | null>(null);
  const [exportSeq, setExportSeq] = useState(0);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [edgeInspect, setEdgeInspect] = useState<{ edgeId: string; x: number; y: number } | null>(null);
  const labelOf = useCallback(
    (id: string | null) => (id ? (projection.nodes.find((n) => n.id === id)?.label ?? id) : null),
    [projection.nodes],
  );
  /* The view the hash asks for, when that view is enabled (views/viewModel). */
  const viewShown: SwitchableView =
    boardView.view !== 'map' && VIEW_ENABLED[boardView.view] ? boardView.view : 'map';
  const viewBoxes = useMemo<ViewBox[]>(
    () => projection.nodes.map((n) => ({ id: n.id, label: n.label, ...(n.parentId ? { parentId: n.parentId } : {}) })),
    [projection.nodes],
  );
  /* A cell's number counts the code links under the line (every scanned edge
     lifted onto the pair), the same set its evidence list shows. Only built
     while a view is open. */
  const viewLines = useMemo(() => {
    if (viewShown === 'map') return [];
    const ids = viewBoxes.map((b) => b.id);
    return linesOf(viewBoxes, boardEdges).map((l) => {
      const total = evidenceFor(graph, ids, l.source, l.target, 'any', 0).total;
      return total > 0 ? { ...l, count: total } : l;
    });
  }, [viewShown, viewBoxes, boardEdges, graph]);
  /* The click-only parts load once the board's first layout is applied
     (data-layout leaves 'laying-out'), not on a timer: the perf instrument
     ends its boot window at first layout, and a fixed 1.2 s could land inside
     it on a slow machine. preload() is idempotent. */
  const firstLaid = !!laid || canvas.layout === 'failed';
  useEffect(() => {
    if (!firstLaid) return undefined;
    /* In the first idle period AFTER that frame, not in the commit that
       applies the layout: started in the commit, the five chunks were
       requested before the layout's frame was even painted. */
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => void preloadBoardExtras());
      return () => w.cancelIdleCallback?.(id);
    }
    const t = setTimeout(() => void preloadBoardExtras(), 0);
    return () => clearTimeout(t);
  }, [firstLaid]);
  /* ── ROUND 8: THE BOARDS (lab/specs/r8-boards.md) ─────────────────────
     The index and this board's marks load AFTER the first layout (the perf
     instrument's boot window ends there) or the moment Draw is pressed. The
     strip is drawn from the first frame with the Architecture pill alone, so
     nothing under it moves when the index arrives. */
  /* In the first idle period after the first layout, like the board's
     extras above: started in the layout's own commit, the requests landed
     inside the perf instrument's boot window. Draw starts it at once. */
  const [boardsIdle, setBoardsIdle] = useState(false);
  useEffect(() => {
    if (!firstLaid || boardsIdle) return undefined;
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setBoardsIdle(true));
      return () => w.cancelIdleCallback?.(id);
    }
    const t = setTimeout(() => setBoardsIdle(true), 0);
    return () => clearTimeout(t);
  }, [firstLaid, boardsIdle]);
  const boardsOn = boardsIdle || drawing;
  const boardsProject = groundedRepoRoot(state) ?? 'workspace';
  const { index: boardsIndex, refresh: refreshBoards } = useBoardsIndex(boardsOn);
  const archBoard = useBoardDoc(ARCH_BOARD_ID, boardsOn);
  const archItems = archBoard.doc?.items ?? [];
  const archHidden = useMemo(() => {
    const on = new Set(projection.nodes.map((n) => n.id));
    return archItems.filter((i) => i.anchor && !on.has(i.anchor)).length;
  }, [archItems, projection.nodes]);
  const openWhiteboard = useCallback(
    (id: string) => {
      setActiveWhiteboard(boardsProject, id);
      requestHostCommand('canvas.whiteboard');
    },
    [boardsProject],
  );
  /* Expand all: the ranked groups still closed; the run starts on the next
     finished arrangement (onArrangedFit), which is the one on screen now. */
  const rankedGroups = useMemo(
    () => rankGroups(viewBoxes, openableNodeIds, boardView.expanded, boardEdges),
    [viewBoxes, openableNodeIds, boardView.expanded, boardEdges],
  );
  const [autoKick, setAutoKick] = useState(0);
  const expandAll = useCallback(() => {
    setAuto(startAutoExpand(rankedGroups));
    setAutoKick((k) => k + 1);
  }, [rankedGroups]);
  const collapseAll = useCallback(() => {
    setAuto(null);
    updateView((v) => ({ ...v, expanded: [] }));
  }, [updateView]);
  /* What expand-all left closed: opened one at a time from the chip. */
  const moreGroups = auto?.done ? auto.queue.filter((id) => !boardView.expanded.includes(id)) : [];
  const setView = useCallback((v: SwitchableView) => updateView((s) => (s.view === v ? s : { ...s, view: v })), [updateView]);
  /* Ctrl/Cmd+1..N switches views, except while typing in a field. */
  useEffect(() => {
    if (SWITCHER_VIEWS.length < 2) return undefined;
    const onKey = (e: KeyboardEvent) => {
      const v = viewForShortcut(e);
      if (!v) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      setView(v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setView]);
  const matchIds = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return projection.nodes.filter((n) => n.label.toLowerCase().includes(q)).map((n) => n.id);
  }, [query, projection.nodes]);
  useEffect(() => {
    if (matchIds === null) {
      if (canvas.dim?.reason === 'lookup') dispatch({ type: 'canvas/dim', dim: null });
      return;
    }
    dispatch({ type: 'canvas/dim', dim: { reason: 'lookup', litNodeIds: matchIds, litEdgeIds: [] } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchIds, dispatch]);
  const traced = useMemo(
    () => (pathEnds.start && pathEnds.end ? tracePath(pathEnds.start, pathEnds.end, boardEdges) : null),
    [pathEnds, boardEdges],
  );
  useEffect(() => {
    if (!pathEnds.start || !pathEnds.end) return;
    dispatch({
      type: 'canvas/dim',
      dim: traced
        ? { reason: 'path-focus', litNodeIds: traced.nodeIds, litEdgeIds: traced.edgeIds }
        : { reason: 'path-focus', litNodeIds: [pathEnds.start, pathEnds.end], litEdgeIds: [] },
    });
  }, [traced, pathEnds, dispatch]);
  const pathNote =
    pathEnds.start && pathEnds.end
      ? traced
        ? `${labelOf(pathEnds.start)} to ${labelOf(pathEnds.end)}: ${traced.edgeIds.length} ${traced.edgeIds.length === 1 ? 'hop' : 'hops'}${traced.directed ? '' : ', ignoring direction'}.`
        : `No path between ${labelOf(pathEnds.start)} and ${labelOf(pathEnds.end)} on this board.`
      : null;
  const selectedOne = canvas.selection.nodeIds.length === 1 ? canvas.selection.nodeIds[0]! : null;
  const inspected = useMemo(() => {
    if (!edgeInspect) return null;
    const edge = boardEdges.find((e) => e.id === edgeInspect.edgeId);
    if (!edge) return null;
    const ids = projection.nodes.map((n) => n.id);
    /* One line stands for every edge between the pair (edgeLines.ts), so its
       evidence is all of theirs, imports included. */
    const ev = evidenceFor(graph, ids, edge.source, edge.target, 'any');
    return {
      title: `${labelOf(edge.source)} to ${labelOf(edge.target)}`,
      total: ev.total,
      lineTotal: ev.lines,
      lines: ev.evidence.map((e) => ({ file: e.file, line: e.line })),
    };
  }, [edgeInspect, boardEdges, projection.nodes, graph, labelOf]);
  /* S2a: "Send the board to the agent" asks for this same export; its PNG is
     handed to the chat (chat/boardPngBus.ts) instead of downloaded. */
  const forAgent = useRef<{ resolve: (p: BoardPng) => void; reject: (e: Error) => void } | null>(null);
  useEffect(() => {
    registerBoardExporter(
      () =>
        new Promise<BoardPng>((resolve, reject) => {
          forAgent.current = { resolve, reject };
          setExportSeq((n) => n + 1);
        }),
    );
    return () => registerBoardExporter(null);
  }, []);
  const onExported = useCallback(
    (png: { dataUrl: string; width: number; height: number } | { error: string }) => {
      const asked = forAgent.current;
      if (asked) {
        forAgent.current = null;
        if ('error' in png) asked.reject(new Error(png.error));
        else asked.resolve(png);
        return;
      }
      if ('error' in png) {
        setExportNote(`Not saved: ${png.error}`);
        return;
      }
      const a = document.createElement('a');
      a.href = png.dataUrl;
      a.download = `${(graph?.repoName || 'board').replace(/[^\w.-]+/g, '-')}-board.png`;
      a.click();
      setExportNote(`Saved, ${png.width} x ${png.height}.`);
    },
    [graph],
  );

  const menuTarget = useMemo<BoardMenuTarget | null>(() => {
    if (!menu) return null;
    /* Re-read the label off the CURRENT projection rather than trusting the one
       captured at right-click. An undo or a rescan between opening the menu and
       using it would otherwise rename a node back to a name it no longer has. */
    const live = projection.nodes.find((n) => n.id === menu.nodeId);
    if (!live) return null;
    /* Generatable is read off the DOCUMENT, not the projection: `evidenceRef`
       is what says whether anybody proved this node, and the projection carries
       a rendering of it rather than the field. */
    const docNode = doc?.nodes.find((n) => n.id === menu.nodeId);
    return {
      ...menu,
      label: live.label,
      ...(graph?.nodes.find((n) => n.id === menu.nodeId)?.path ? { path: graph.nodes.find((n) => n.id === menu.nodeId)!.path } : {}),
      generatable: docNode ? isGeneratable(docNode as SeqDiagramNode) : false,
      /* Openable when the SCAN says something is inside. Read off the graph,
         not the projection: containment is `parentId`, which the projection
         does not carry. Inside a service too — a module card opens to its
         files, the third zoom (owner, 2026-09-22). */
      openable: !!graph && graph.nodes.some((n) => n.parentId === menu.nodeId),
    };
  }, [menu, projection.nodes, doc, graph]);

  /* ══ ASK IN PLACE (askInPlace/) ══════════════════════════════════════════
     Point at a node, an edge or several nodes, type beside them, and the words
     go to the main chat with the selection referenced by id, name, kind and
     file path, plus a crop of the board around it. A right-click on a NODE is
     the card's own menu (BoardMenu, which carries the "Ask about this" row); a
     right-click on an EDGE is the hook's menu. */
  const stackRef = useRef<HTMLDivElement | null>(null);
  const [edgeSel, setEdgeSel] = useState<string[]>([]);
  const nodeSelKey = canvas.selection.nodeIds.join('|');
  useEffect(() => {
    /* Picking nodes drops a picked edge. */
    setEdgeSel((was) => (was.length === 0 ? was : []));
  }, [nodeSelKey]);
  const askEdgeIds = useMemo(() => new Set(boardEdges.map((e) => e.id)), [boardEdges]);
  const askSelection = [...canvas.selection.nodeIds, ...edgeSel];
  const askNodes = (): ArchRefNode[] => {
    const byId = new Map((graph?.nodes ?? []).map((n) => [n.id, n]));
    return boardNodes.map((n) => {
      const scanned = byId.get(n.id);
      const own = scanned?.path;
      const inside = (graph?.nodes ?? []).filter((c) => c.parentId === n.id && c.path).map((c) => c.path!);
      const paths = own ? [own] : inside.slice(0, 3);
      return { id: n.id, label: n.label, kind: n.schemaKind, ...(paths.length > 0 ? { paths } : {}) };
    });
  };
  const askElementsOf = (ids: readonly string[]): Element[] => {
    const root = stackRef.current;
    if (!root) return [];
    const out: Element[] = [];
    for (const id of ids) {
      const found = askEdgeIds.has(id)
        ? Array.from(root.querySelectorAll('.react-flow__edge')).find((el) => el.getAttribute('data-id') === id)
        : Array.from(root.querySelectorAll('[data-node-id]')).find((el) => el.getAttribute('data-node-id') === id);
      if (found) out.push(found);
    }
    return out;
  };
  const askRectOf = (ids: readonly string[]) => {
    const rects = askElementsOf(ids).map((el) => el.getBoundingClientRect());
    const union = unionBox(rects.map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height })));
    return union ? { left: union.x, top: union.y, width: union.w, height: union.h } : null;
  };
  const ask = useAskInPlace({
    containerRef: stackRef,
    surface: 'architecture',
    selection: askSelection,
    idAt: (el) => {
      const node = el.closest('[data-node-id]');
      if (node) return node.getAttribute('data-node-id');
      return el.closest('.react-flow__edge')?.getAttribute('data-id') ?? null;
    },
    /* Nodes keep the card's own menu; the hook's menu is for edges. */
    ownsContextMenu: (el) => el.closest('[data-node-id]') === null && el.closest('.react-flow__edge') !== null,
    resolve: (ids) =>
      architectureReference(
        askNodes(),
        boardEdges,
        ids.filter((id) => !askEdgeIds.has(id)),
        ids.filter((id) => askEdgeIds.has(id)),
      ),
    rectOf: askRectOf,
    elementsOf: askElementsOf,
    snapshot: async (ids) => {
      const root = stackRef.current;
      const host = root?.querySelector<HTMLElement>('.react-flow__viewport');
      const box = askRectOf(ids);
      if (!root || !host || !box) return null;
      /* The selection in FLOW coordinates: undo the camera. */
      const rootBox = root.getBoundingClientRect();
      const z = canvas.viewport.zoom || 1;
      const selection = {
        x: (box.left - rootBox.left - canvas.viewport.x) / z,
        y: (box.top - rootBox.top - canvas.viewport.y) / z,
        w: box.width / z,
        h: box.height / z,
      };
      const visible = {
        x: -canvas.viewport.x / z,
        y: -canvas.viewport.y / z,
        w: rootBox.width / z,
        h: rootBox.height / z,
      };
      const background = getComputedStyle(root).getPropertyValue('--bg-base').trim() || undefined;
      /* The renderer and the sender load when a question is asked, not at boot (perf ratchet). */
      const { snapshotHtmlRegion } = await import('../askInPlace/snapshot');
      return snapshotHtmlRegion(host, regionAround(selection, visible, 48 / z, 240 / z), background);
    },
    select: (ids) => {
      const nodeIds = ids.filter((id) => !askEdgeIds.has(id));
      const edgeIds = ids.filter((id) => askEdgeIds.has(id));
      if (nodeIds.length > 0) {
        nodeIds.forEach((id, i) => dispatch({ type: 'canvas/select', nodeId: id, additive: i > 0 }));
        setEdgeSel([]);
      } else {
        dispatch({ type: 'canvas/clear' });
        setEdgeSel(edgeIds);
      }
    },
    onSend: (payload) => void import('../askInPlace/sendBoardAsk').then((m) => m.sendBoardAsk(store, payload)),
  });

  /* ══ THE NODE SUB-SURFACE (nodeSurface.ts) ═══════════════════════════════
     A single picked service or module opens a side card with what the scan
     knows about it and a Generate workflow button, which asks the chat (the
     same sender the ask-in-place popover uses) to draw its page-to-page flow. */
  const [surfaceClosed, setSurfaceClosed] = useState<string | null>(null);
  const surfaceId = canvas.selection.nodeIds.length === 1 && edgeSel.length === 0 ? canvas.selection.nodeIds[0]! : null;
  /* Closing is for the node it was closed on: picking anything else forgets it, so coming back reopens. */
  useEffect(() => {
    setSurfaceClosed((was) => (was !== null && was !== surfaceId ? null : was));
  }, [surfaceId]);
  const surfaceModel = useMemo(() => {
    if (!graph || surfaceId === null || surfaceClosed === surfaceId || viewShown !== 'map' || proposal || canvas.view.state === 'S3') return null;
    const model = nodeSurface(graph, surfaceId);
    return model && SURFACE_KINDS.has(model.kind) ? model : null;
  }, [graph, surfaceId, surfaceClosed, viewShown, proposal, canvas.view.state]);
  /* The engine draws the flow onto a Space when it can (POST /api/services/:id/flows) and
     the Space opens; an engine without the route gets the same ask as a chat message. */
  const generateWorkflow = async (audience: WorkflowAudience): Promise<GenerateOutcome> => {
    if (!surfaceModel) return { kind: 'failed', message: 'Nothing is selected.' };
    const drawn = await generateFlow(surfaceModel.id, audience);
    if (drawn.outcome === 'ok') {
      refreshBoards();
      openWhiteboard(drawn.boardId);
      return { kind: 'space', name: drawn.name };
    }
    if (drawn.outcome === 'failed') return { kind: 'failed', message: drawn.message };
    const reference = architectureReference(askNodes(), boardEdges, [surfaceModel.id], []);
    if (!reference) return { kind: 'failed', message: 'This node is not on the board, so there is nothing to ask about.' };
    const { sendBoardAsk } = await import('../askInPlace/sendBoardAsk');
    await sendBoardAsk(store, { text: workflowAsk(surfaceModel.label, audience), reference, image: null });
    return { kind: 'chat' };
  };
  /* The branch moved under the board (a switch here, in a terminal, by an agent): read the graph again. Only with a
     project open: with none there is no branch to follow, and the stream was opened against an origin with no
     /api/git/events (a static host answers it with index.html; the e2e console check caught it at boot). */
  const gitFollowRoot = groundedRepoRoot(state);
  useEffect(() => {
    if (gitFollowRoot === null) return undefined;
    /* The stream is the ENGINE's: a graph read off a static host (no engine) has nothing to follow. */
    let stop: (() => void) | null = null;
    let gone = false;
    void engineHasProject().then((ok) => {
      if (ok && !gone) stop = followGitEvents(store);
    });
    return () => {
      gone = true;
      stop?.();
    };
  }, [store, gitFollowRoot]);

  const boardTabs = (
    <BoardTabs
      index={boardsIndex}
      current={ARCH_BOARD_ID}
      onOpen={(b) => {
        if (b.kind === 'whiteboard') openWhiteboard(b.id);
      }}
      onCreate={() => {
        void boardsApi.create(nextBoardName(boardsIndex)).then((meta) => {
          refreshBoards();
          openWhiteboard(meta.id);
        }, () => undefined);
      }}
      onRename={(id, name) => void boardsApi.rename(id, name).then(refreshBoards, refreshBoards)}
      onDelete={(id) => void boardsApi.remove(id).then(refreshBoards, refreshBoards)}
    />
  );

  return (
    <div
      ref={stackRef}
      className="board-scope board-stack"
      data-testid="board-stack"
      data-board-tabs="true"
      data-view={viewShown}
      data-auto-expand={auto && !auto.done ? 'running' : undefined}
    >
      <AgentOverlay />
      {projection.nodes.length > 0 ? null : boardTabs}
      {drawing ? (
        <ArchPalette
          tool={archTool}
          onTool={setArchTool}
          hidden={archHidden}
          onDone={() => {
            setDrawing(false);
            setInkNote(null);
          }}
        />
      ) : null}
      {/* BOARD VIEWS (stream 3b, Slice B): Grid and Flow cover the Map with
          the same boxes and lines, reached by the hash's view token. Each is
          loaded only when opened. */}
      {viewShown !== 'map' ? (
        <Suspense fallback={null}>
          {viewShown === 'grid' ? (
            <GridView
              boxes={viewBoxes}
              lines={viewLines}
              onCell={(source, target, at) => {
                const edge = boardEdges.find((e) => e.source === source && e.target === target);
                if (edge) setEdgeInspect({ edgeId: edge.id, ...at });
              }}
            />
          ) : viewShown === 'diff' ? (
            <DiffView boxes={viewBoxes} lines={viewLines} graph={graph} onMarks={setDiffMarks} />
          ) : viewShown === 'hotspots' ? (
            <HotspotsView boxes={viewBoxes} graph={graph} />
          ) : (
            <FlowView boxes={viewBoxes} lines={viewLines} />
          )}
        </Suspense>
      ) : null}
      <Board
        onFurnitureBand={setFurnitureBand}
        canvas={canvas}
        nodes={boardNodes}
        edges={boardEdges}
        derivedOn={showDerived}
        onToggleDerived={() => setShowDerived((on) => !on)}
        derivedCount={derivedAvailable}
        positions={positions}
        dispatch={boardDispatch}
        focusRequest={focusRequest}
        onBack={() => {
          if (anatomyNodeId) {
            setAnatomyNodeId(null);
            return true;
          }
          if (openedPath.length > 0) {
            setOpenedPath((path) => path.slice(0, -1));
            return true;
          }
          return false;
        }}
        onGround={onGround}
        /* THE BOARD ASKS THE RAIL WHY. `NodeDetailPanel` answers exactly the
           question a person clicks a card to ask, and was reachable only by
           clicking the same node again over in the rail. */
        /* `store.dispatch`, not the canvas `dispatch` beside it: that one is
           narrowed to canvas actions on purpose, and this crosses into the
           rail's slice. */
        onExplain={(nodeId) => store.dispatch({ type: 'rail/explain', nodeId })}
        onMenu={(nodeId, at) => setMenu({ nodeId, label: '', x: at.x, y: at.y })}
        /*
         * DOUBLE-CLICK GOES INSIDE. Owner walk 2026-08-22 (A4): Open was the
         * product's own drill-in and was reachable by exactly one gesture that
         * nothing on screen suggested.
         *
         * The refusal lives HERE rather than on the card, because whether a
         * node has an interior is the scan's answer and the card does not hold
         * the graph. Same rule as the disabled menu item: an empty room does
         * not get opened by either door.
         */
        onOpenNode={(nodeId) => {
          if (!graph?.nodes.some((n) => n.parentId === nodeId)) return;
          /* A hand-opened group is checked against the camera's floor when
             its arrangement lands (onArrangedFit). */
          if (!boardView.expanded.includes(nodeId)) handTried.current = nodeId;
          /* COMPOSITE BOARD: the card's own control and double-click now
             EXPAND the group in place. Focus (the frame's header, the menu)
             still draws it alone. A proposal is never expanded. */
          if (proposal) {
            openNode(nodeId);
            return;
          }
          if (!boardView.expanded.includes(nodeId)) askFocus(nodeId);
          toggleExpand(nodeId);
        }}
        openableNodeIds={openableNodeIds}
        sizes={sizes}
        elkRoutes={elkRoutes}
        onArrangedFit={onArrangedFit}
        fitReportSeq={autoKick}
        arranged={laid?.key === layoutKey || canvas.layout === 'failed'}
        rowLabels={
          orphanRow
            ? [{ x: orphanRow.x, y: orphanRow.y, text: 'Not connected', count: orphanRow.count, ids: orphanRow.ids }]
            : undefined
        }
        onCollapseNode={toggleExpand}
        onFocusNode={openNode}
        onEdgeClick={(edgeId, at) => setEdgeInspect({ edgeId, ...at })}
        fitRequest={fitRequest}
        exportRequest={exportSeq}
        onExported={onExported}
        ghostNodeIds={ghostNodeIds}
        ghostFitKey={ghostFitKey}
        layoutDirection={
          layoutProfile?.engine === 'layered-flow'
            ? ((laid?.key === layoutKey ? laid.direction : undefined) ?? layoutProfile.direction)
            : null
        }
        /* ══ AND ONLY WHEN THERE IS A DIRECTION TO SET ═══════════════════

           MEASURED: pressing "Vertical" flipped `aria-pressed` correctly and
           the rendered layout was byte-identical — same bounding box, same
           coordinates, before and after. The control was live; the algorithm
           under it was not one that takes a direction.

           `elkGraphFor` chooses `rectpacking` when NO edge is drawn, because
           layered's component packer answers the frame's own ratio with a
           160px column (its header documents the measurement). Rectpacking has
           no direction — 'where do N boxes go in a rectangle of this shape' is
           a question with no left-to-right in it — so `elk.direction` is not
           even passed on that branch.

           Feeding the derived connectors into the layout (see `layoutEdges`)
           is what usually puts this board back on the layered path, and there
           the toggle does what it says. When there is genuinely nothing to
           layer, the control is not offered at all — the board's own rule, two
           controls to the left of this one: "a control that appears to do
           nothing when pressed is indistinguishable from a broken one". */
        onLayoutDirection={
          layoutProfile?.engine === 'layered-flow' &&
          projection.nodes.length > 0 &&
          layoutEdges.length > 0
            ? onLayoutDirection
            : undefined
        }
        visual={visual}
        onToggleVisual={onToggleVisual}
        /* ANATOMY — a THIRD affordance, drawn inside one node's own footprint.
           `onOpenNode` above is untouched and still replaces the view. */
        /* THE DOOR. Offered only when the scan actually produced a repository
           node — a control that opens an empty view is worse than no control. */
        onOpenRepoAnatomy={repoNode ? () => setRepoAnatomy(true) : undefined}
        anatomy={anatomy}
        anatomyKind={anatomyKind}
        onCloseAnatomy={() => setAnatomyNodeId(null)}
        attachFitKey={attachFitKey}
        drawing={drawing}
        renderOverlay={
          archItems.length > 0 && viewShown === 'map'
            ? ({ boxOf, paths, cards }) => (
                <ArchMarks items={archItems} boxOf={boxOf} paths={paths} cards={cards} hittable={drawing && archTool !== 'sketch' && archTool !== 'pen'} />
              )
            : undefined
        }
        renderDrawCapture={
          archTool === 'sketch'
            ? undefined
            : (passive, boxes) => (
                <ArchCapture
                  tool={archTool}
                  passive={passive}
                  toFlow={(p) => flowConvert.current(p)}
                  boxes={boxes}
                  items={archItems}
                  onPut={(item) => archBoard.write([{ op: 'put', item }])}
                  onRemove={(id) => void archBoard.write([{ op: 'remove', id }])}
                />
              )
        }
        onToggleDrawing={() => {
          setDrawing((on) => !on);
          setInkNote(null);
        }}
        onFlowReady={(api) => {
          flowConvert.current = api.screenToFlow;
        }}
        onStroke={(points, timing) => {
          if (!doc) {
            /* Unattached / unscanned: bootstrap the session scratch pad so Draw
               can place boxes instead of dead-ending on the empty lid
               (owner walk 2026-09-16). */
            if (!repoAttached) {
              const storage = scratchStorage();
              if (!storage) {
                setInkNote('Drawing needs local storage for a scratch board.');
                return;
              }
              const scratch = loadScratchDoc(storage, scratchSessionId);
              editDoc({ type: 'doc/base', doc: scratch, forSessionId: scratchSessionId });
              setInkNote('Scratch board ready — draw a closed box for a service.');
              return;
            }
            setInkNote(
              'Drawing needs a board document. Attach a project, or wait for the scan to finish.',
            );
            return;
          }
          /*
           * `packages/ink` had stroke recognition with passing tests and
           * NOTHING IMPORTED IT. This is the half-inch that was missing.
           *
           * The stroke edits the DOCUMENT — "free drawing is real editing of a
           * real artifact" — and fires no ask and no proposal. Generate is the
           * separate, deliberate step, and it is the user's to take.
           */
          /* Sketch reads strokes with the trained, grouped shape model, the
             whiteboard's own (`SnapSession`): a box drawn in four strokes is one
             box, a lone closed stroke decides at once, and handwriting is left
             alone. The session loads with the first stroke, not at boot (perf
             ratchet, bootJsBytes).

             'off' in Settings means no shape reading anywhere; 'auto' and
             'suggest' both apply here, because choosing the Sketch tool is
             itself the consent a suggestion would ask for. */
          if (readSnapMode() === 'off') {
            setInkNote('Shape reading is off in Settings, so Sketch adds nothing. Turn it on there, or add a service from the palette.');
            return;
          }
          const hitTest = (at: { x: number; y: number }): string | null => {
              /* The board's own DOM answers "what is under this point": the
                 cards are laid out by ELK and transformed by the camera, and
                 re-deriving either here would be a second answer that drifts
                 the first time a layout option changes. */
              /*
               * OPTIONAL CALL, and not defensive noise. `elementFromPoint` is
               * absent in jsdom, so the first test to draw a LINE - the only
               * gesture that needs a hit test, since a closed box makes a node
               * without one - threw an unhandled TypeError out of a React event
               * handler. A missing API must mean "no card is under this point",
               * which is the honest answer, not a crash mid-stroke.
               *
               * SKIP THE STROKE LAYER. While Draw is on, `.strokelayer` sits
               * above every card at z-index 20. Asking elementFromPoint at the
               * stroke's endpoints always hit the overlay — never a card — so
               * every connect refused with "needs a service at both ends".
               * Temporarily punch through, then restore.
               */
              const layer = document.querySelector(
                '[data-testid="board-stroke-layer"]',
              ) as HTMLElement | null;
              const prev = layer?.style.pointerEvents;
              if (layer) layer.style.pointerEvents = 'none';
              try {
                const el = document.elementFromPoint?.(at.x, at.y) ?? null;
                const card = el?.closest('[data-node-id]');
                return card?.getAttribute('data-node-id') ?? null;
              } finally {
                if (layer) layer.style.pointerEvents = prev ?? '';
              }
            };
          /* The session outlives this render; what it calls must not. */
          sketchApply.current = (results) => {
            void import('./inkToEdit.js').then(({ inkToEdit }) => {
              /* Switched off while the pen was resting: nothing is added. */
              if (readSnapMode() === 'off') {
                setInkNote('Shape reading is off in Settings, so Sketch adds nothing. Turn it on there, or add a service from the palette.');
                return;
              }
              for (const result of results) {
                const outcome = inkToEdit(result, {
                  hitTest,
                  /* The counter restarts with the page, the drawn edges do not: an id
                     already in the document is skipped, or the edit is refused as a
                     duplicate and the stroke seems to have done nothing. */
                  nextEdgeId: () => {
                    const taken = new Set(doc.edges.map((e) => e.id));
                    let id = `draw:e${++drawnEdgeSeq.current}`;
                    while (taken.has(id)) id = `draw:e${++drawnEdgeSeq.current}`;
                    return id;
                  },
                });
            if (outcome.kind === 'edit' && outcome.edit.type === 'doc/add-edge') {
              /* The old-rules fallback and a model connector can both read one line. */
              const key = `${outcome.edit.from}\u0000${outcome.edit.to}`;
              const seen = sketchPairs.current.get(key);
              if (seen !== undefined && Date.now() - seen < 3000) continue;
              sketchPairs.current.set(key, Date.now());
            }
            setInkNote(outcome.note);
            if (outcome.kind === 'edit') {
              logBoardEdit('architecture', 'add', { kind: outcome.edit.type });
              editDoc(outcome.edit);
              /* PIN THE DRAWN BOX where the stroke was — otherwise ELK packs the
                 new id into the clump and "draw a box" feels like it vanished. */
              if (outcome.edit.type === 'doc/add-node' && outcome.place) {
                const flow = flowConvert.current(outcome.place);
                dispatch({ type: 'canvas/position', nodeId: outcome.edit.id, x: flow.x, y: flow.y });
              }
            }
              }
            });
          };
          const t1 = timing?.t1 ?? performance.now();
          const strokeId = `sk${++sketchSeq.current}`;
          sketchRecent.current = [...sketchRecent.current.slice(-19), { id: strokeId, points }];
          sketchUndecided.current.push({ id: strokeId, points });
          setInkNote('Reading the drawing…');
          if (sketchGiveUp.current) clearTimeout(sketchGiveUp.current);
          /* The session says nothing for handwriting, and silence after a stroke
             reads as a dropped event; so the reader is told once the pen has rested.
             One timer for the strokes no offer has covered yet: an offer for a box
             takes ITS strokes off the list and leaves a later line on it. */
          const giveUp = () => {
            sketchGiveUp.current = null;
            const left = sketchUndecided.current;
            sketchUndecided.current = [];
            if (left.length === 0) return;
            /* The model snaps arrows and closed shapes. A bare straight line
               between two cards was an edge before the model, and still is: the
               old rules read it, and inkToEdit refuses it unless both ends land
               on a card. */
            void import('@sequence/ink').then(({ recognizeStroke }) => {
              const lines = left.map((u) => recognizeStroke(u.points)).filter((r) => r.kind === 'line');
              if (lines.length > 0) {
                sketchApply.current?.(lines);
                return;
              }
              setInkNote('That was not a box or a line, so nothing was added. Draw a closed shape for a service, or a line between two of them.');
            });
          };
          /* The countdown starts only once the model is ready: under load its first
             offer can land after a countdown that began at the stroke, and the old
             rules would call a box "not a box". The ceiling keeps nothing dropped. */
          const armGen = ++sketchArmGen.current;
          sketchGiveUp.current = setTimeout(giveUp, SKETCH_MODEL_WAIT_MS);
          const session = (sketchSession.current ??= import('../whiteboard/snapSession').then(
            ({ SnapSession }) =>
              new SnapSession({
                onOffer: (offers) => {
                  const covered = new Set(offers.flatMap((o) => o.strokeIds));
                  sketchUndecided.current = sketchUndecided.current.filter((u) => !covered.has(u.id));
                  if (sketchUndecided.current.length === 0 && sketchGiveUp.current) {
                    clearTimeout(sketchGiveUp.current);
                    sketchGiveUp.current = null;
                  }
                  sketchApply.current?.(offers.map(offerToInk));
                },
                context: (pending) =>
                  sketchRecent.current.flatMap((r) => (pending.has(r.id) ? [] : [r.points])),
                present: () => true,
                zoom: () => 1,
                recognizer: () =>
                  import('@sequence/ink/shape-model').then((m) => (pts, o) => m.recognizeShape(pts, o)),
              }),
          ));
          void session
            .then((snap) => snap.ready())
            .then(() => {
              if (sketchArmGen.current !== armGen || sketchGiveUp.current === null) return;
              clearTimeout(sketchGiveUp.current);
              sketchGiveUp.current = setTimeout(giveUp, SKETCH_IDLE_MS + 150);
            })
            .catch(() => undefined);
          void session
            .then((snap) => {
              snap.strokeBegan();
              return snap.strokeEnded({ id: strokeId, points, t0: timing?.t0 ?? t1, t1 });
            })
            .catch(() => {
              /* A chunk that failed to load is tried again on the next stroke. */
              sketchSession.current = null;
              setInkNote('Could not load shape reading. Try the stroke again.');
            });
        }}
        empty={empty}
        edgeless={openedService ? null : edgeless}
        playback={openedService ? null : playbackNote}
      />
      {repoPanel === null ? null : (
        /* ══ THE WHOLE REPOSITORY, DRAWN ═══════════════════════════════════
           The view Max's first loop asks for: hand it a repo, see the whole
           thing broken down. Every package a rectangle whose AREA IS ITS LINES,
           so two packages holding 86.5% of 275,837 lines read in one glance
           without a legend or a sentence.

           IT REPLACES THE VIEW AND RETURNS IN ONE STEP, which is the board's
           standing ruling (§33) rather than a new interaction: no board node,
           no board edge, no crumb trail, no container. Escape closes it too.

           THE SCOPE CLASS IS ON THIS ROOT, and that is not decoration. Every
           rule for the interior bar was written `.board-scope .interiorbar` —
           a DESCENDANT selector — while the bar was a SIBLING of the element
           carrying the class, so none of them ever matched and it rendered
           unstyled across the chat pane. That was "a messed-up design on top of
           the file". This panel is a sibling in the same fragment, so it
           carries the class itself. */
        <div
          className="board-scope repoanatomy"
          data-testid="board-repo-anatomy-view"
          role="group"
          aria-label={`${repoPanel.label} — the whole project, drawn by size`}
        >
          <div className="repoanatomy-hd">
            <button
              type="button"
              className="pb-btn"
              data-testid="board-repo-anatomy-close"
              onClick={() => setRepoAnatomy(false)}
            >
              Back to the system
            </button>
            <span className="pb-title">{repoPanel.label}</span>
            {/* ONE SET COUNTED TWO WAYS, and it is checked: the drawn cells sum
                to the container exactly on both axes — `anatomyPartitions`. */}
            <span className="pb-count">
              {repoPanel.cells.length} parts, {repoPanel.size.files} files,{' '}
              {repoPanel.size.loc.toLocaleString()} lines
            </span>
          </div>
          {/* `.node` IS LOad-BEARING, NOT DECORATION. Every rule the panel needs
              is written `.board-scope .node .ana-*` — a descendant chain — so a
              host without a `.node` ancestor paints the treemap COMPLETELY
              UNSTYLED. That is the same fault as the four pieces of board
              furniture whose rules never matched, one layer in. Verified by
              rendering the panel this way against a real scan before wiring it. */}
          <div className="node repoanatomy-body">
            <MetaStripBoundary what="the project anatomy">
              <Suspense fallback={null}>
                <AnatomyPanel panel={repoPanel} kind="repo" onClose={() => setRepoAnatomy(false)} />
              </Suspense>
            </MetaStripBoundary>
          </div>
          {/* ══ EVERY PART NAMED, WITHOUT TRUNCATING AND WITHOUT A HUE ═══════
              THE PICTURE'S PURPOSE AT ROOT IS TO NAME THE PARTS, and seven of
              ten cells are too small to carry their own name — `ink` is 0.2% of
              this repository, so its rectangle is six units across. Inside a
              card that is the right trade: the names are one hover away and a
              treemap of a service is read for shape. At ROOT the reader is
              being told what the repository is MADE OF, and a nameless
              rectangle does not tell them.

              TWO OBVIOUS FIXES ARE BOTH ALREADY REFUSED HERE, so neither is
              used. An ellipsis is refused by `anatomyLabelFits`' own reason —
              a label clipped to "…" is ink that says nothing while claiming
              the room of something, and a name that overflows lands on its
              neighbour and reads as the neighbour's. A legend keyed by COLOUR
              is refused by the substrate: `tokens/graphite.css` carries a
              DELETED five-step ramp with the deletion recorded as the point —
              "the exact hole through which kind-by-hue comes back" — and
              `anatomy.ts` spends three paragraphs declining a shade for this
              very view. Cells are neutral and area carries the reading.

              SO THE PARTS ARE LISTED. A list needs no hue, truncates nothing,
              and is keyed by the one thing the treemap already encodes and the
              reader can see: SIZE ORDER. The largest rectangle is the first
              row. Nothing about the cards changes — this is the root host, and
              `AnatomyPanel` is untouched. */}
          <ol className="repoanatomy-parts" data-testid="board-repo-anatomy-parts">
            {[...repoPanel.cells]
              .sort((a, b) => b.loc - a.loc || (a.label < b.label ? -1 : 1))
              .map((cell) => (
                <li key={cell.id} data-part-id={cell.id}>
                  <span className="rp-name">{cell.label}</span>
                  <span className="rp-loc mono">{cell.loc.toLocaleString()}</span>
                  <span className="rp-share mono">
                    {repoPanel.size.loc > 0
                      ? `${((cell.loc / repoPanel.size.loc) * 100).toFixed(1)}%`
                      : '—'}
                  </span>
                  {/* ── WHAT THE PART IS, NOT ONLY HOW BIG IT IS ──────────
                      Owner, 2026-09-21: "anatomy should have a little bit
                      more detail ... core infrastructure, carries most
                      features; web is pure website stuff; desktop, actual
                      client."

                      A name, a line count and a percentage describe the
                      SHAPE of a repository and say nothing about what any of
                      it is for, which is the question he is asking of a page
                      called anatomy.

                      AND IT IS NOT WRITTEN HERE. `detail.whatItDoes` is
                      already on the node, derived by the scanner from what
                      is actually in the package — "scripts · server control"
                      for desktop, "client · executor · index · 4 more" for
                      acp. The sentence was being computed and thrown away at
                      this one surface. Grounded, not guessed: a part whose
                      scan produced nothing to say shows nothing, rather than
                      a description invented to fill the column. */}
                  {partRole(cell.id) ? (
                    <span className="rp-role" data-testid="board-repo-anatomy-role">
                      {partRole(cell.id)}
                    </span>
                  ) : null}
                </li>
              ))}
          </ol>

        </div>
      )}

      {interior === null ? null : (
        /* THE WAY BACK, and it is always present. A view you can enter and not
           leave is a trap, and the reader's only other option would be a
           rescan. */
        /*
         * THE SCOPE CLASS IS ON THIS ROOT, and on every sibling below it.
         *
         * ConnectedBoard returns a FRAGMENT: <Board/> and this bar are
         * siblings, and `.board-scope` is on the Board element. Every rule for
         * this bar is written `.board-scope .interiorbar` - a descendant
         * selector - so none of them ever matched. It rendered with no absolute
         * positioning, no centring and no z-index: a plain block spanning the
         * full width, across the chat pane at narrow sizes.
         *
         * That is what "a messed-up design on top of the file" was, and
         * e2e/board-furniture.mjs measured it: `interiorbar [0..720]` on a 720
         * window whose board is much narrower.
         *
         * PermissionControl already carries this lesson in its own words: "the
         * scope class is on this root as well as on the composer's, because a
         * component whose styling only arrives when some ancestor happens to
         * carry a class is a component that renders unstyled the first time it
         * is reused." Four pieces of furniture here were that component.
         */
        <div
          className="board-scope interiorbar"
          data-testid="board-interior"
          role="group"
          aria-label="Opened service"
          /* Anchored above the MEASURED furniture band — a CSS constant here
             went stale every time the tools wrapped one more row (720px:
             three rows, bar drawn through the zoom cluster). */
          style={{ bottom: `calc(var(--sp-16) + ${Math.max(96, furnitureBand)}px)` }}
        >
          <button
            type="button"
            className="pb-btn"
            data-testid="board-interior-close"
            /* ONE LEVEL UP, not all the way out: a module's files go back to
               the service's modules, and those go back to the system. */
            onClick={() => setOpenedPath((path) => path.slice(0, -1))}
          >
            {backTo === null ? 'Back to the system' : `Back to ${backTo}`}
          </button>
          <span className="pb-title">{interior.doc.title}</span>
          <span className="pb-count" data-testid="board-interior-count">
            {interior.level === 'modules'
              ? `${interior.total} ${interior.total === 1 ? 'module' : 'modules'}`
              : `${interior.total} inside`}
            {/* WHAT WAS LEFT OUT IS SAID. Showing 60 of 900 without a word
                would tell the reader this service has 60 files. */}
            {interior.omitted > 0 ? `, showing ${interior.total - interior.omitted}` : ''}
            {/* The files no module holds are COUNTED, never placed — a card
                gathering them would be a node the scan did not produce. */}
            {interior.looseFiles > 0
              ? `, ${interior.looseFiles} ${interior.looseFiles === 1 ? 'file' : 'files'} outside any module`
              : ''}
          </span>
        </div>
      )}

      {inkNote === null ? null : (
        /* One line, and it is dismissible by drawing again. A stroke that
           vanishes is indistinguishable from a dropped event. */
        <div className="board-scope inknote" data-testid="board-ink-note" role="status">
          {inkNote}
        </div>
      )}

      {scanning && scanning.previous ? (
        <div
          className="board-scope proposalbar"
          data-testid="board-scanning"
          role="status"
          aria-live="polite"
        >
          <span className="pb-title">{scanStatusLine}</span>
          <span className="pb-why">The board keeps the last scan until the new one lands.</span>
        </div>
      ) : null}

      {/* ── THE RESCAN THAT IS BEING HELD ─────────────────────────────────
          `docSession` HOLDS a rescan that arrives while there are unsaved
          edits rather than silently applying it — which is right, and which
          left the reader in a state with no way out: `baseChanged` was
          rendered by NOTHING, and `doc/rebase`, the arm that takes the new
          scan, was dispatched by nothing either. The board simply stopped
          being current and never said so.

          It says so now, and it says what taking it costs. */}
      {session.baseChanged && proposal === null ? (
        <div
          className="board-scope proposalbar"
          data-testid="board-stale"
          role="group"
          aria-label="The project changed"
        >
          <span className="pb-title">
            The repository changed while you were drawing. This board is showing the older scan.
          </span>
          <span className="pb-why">
            {(() => {
              const drawn = session.doc?.edges.filter((e) => e.id.startsWith('draw:')).length ?? 0;
              if (drawn === 0) {
                return session.edits === 1
                  ? 'Taking the new one replaces 1 unsaved edit.'
                  : `Taking the new one replaces ${session.edits} unsaved edits.`;
              }
              return `Taking the new one keeps your ${drawn} drawn connection${drawn === 1 ? '' : 's'}: the ones the scan now finds become solid, the rest stay as claims. Other unsaved edits are replaced.`;
            })()}
          </span>
          <button
            type="button"
            className="pb-btn"
            data-testid="board-stale-rebase"
            onClick={() => editDoc({ type: 'doc/rebase' })}
          >
            Take the new scan
          </button>
        </div>
      ) : null}

      {workflowDoc?.kind === 'agent-workflow' && proposal === null ? (
        <WorkflowLaunchBar
          phase={workflow.phase}
          error={workflow.error}
          previewProgramId={workflow.previewProgramId}
          activeRunId={workflow.activeRunId}
          canLaunch={workflow.canLaunch}
          tier={workflow.tier}
          suggestFullTier={suggestFullTier}
          onTierChange={workflow.setTier}
          onPreview={workflow.preview}
          onLaunch={workflow.launch}
          onReset={workflow.reset}
          onPause={workflow.phase === 'running' ? pauseWorkflowRun : undefined}
          onResume={workflow.phase === 'running' ? resumeWorkflowRun : undefined}
        />
      ) : null}

      {selectedAgentId && workflowDoc ? (
        <AgentInspector
          doc={workflowDoc}
          nodeId={selectedAgentId}
          readOnly={workflow.phase === 'running'}
          onChange={(id, patch) => editDoc({ type: 'doc/patch-node', id, patch })}
        />
      ) : null}

      {proposal === null ? null : (
        /* ONE bar, and it names what it is judging. An Accept/Deny with no
           subject is a dialog asking the reader to agree to something they have
           to go and find. */
        <div className="board-scope proposalbar" data-testid="board-proposal" role="group" aria-label="Proposed change">
          <span className="pb-title">{proposal.title ?? 'Proposed change'}</span>
          <span className="pb-count">
            {proposal.nodes.length} node{proposal.nodes.length === 1 ? '' : 's'},{' '}
            {proposal.edges.length} edge{proposal.edges.length === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            className="pb-btn"
            data-testid="board-proposal-accept"
            onClick={() => {
              /* THROUGH `docEdit`, the same funnel a human rename uses. A
                 proposal that wrote to the document directly would be a second
                 way to change a diagram with its own idea of what is legal, and
                 the first thing it would skip is referential integrity.
                 Do NOT clear the ghost when zero edits land — that is the
                 "Accept and it disappeared" seat bug (colliding ids / empty doc). */
              let working = session.doc;
              const scratchMode = !repoAttached;
              if (!working && scratchMode) {
                const storage = scratchStorage();
                if (!storage) {
                  setInkNote('Accept needs a board document — attach a repo first.');
                  return;
                }
                working = loadScratchDoc(storage, scratchSessionId);
                editDoc({ type: 'doc/base', doc: working, forSessionId: scratchSessionId });
              }
              if (!working) {
                setInkNote('Accept needs a board document — attach a repo first.');
                return;
              }
              let applied = 0;
              let note: string | null = null;
              for (const n of proposal.nodes) {
                const preview = docEdit(working, {
                  type: 'doc/add-node',
                  id: n.id,
                  label: n.label,
                  kind: n.kind,
                });
                if (preview.changed) {
                  working = preview.doc;
                  editDoc({ type: 'doc/add-node', id: n.id, label: n.label, kind: n.kind });
                  applied += 1;
                } else {
                  note = preview.note ?? null;
                }
              }
              for (const e of proposal.edges) {
                const preview = docEdit(working, {
                  type: 'doc/add-edge',
                  id: e.id,
                  from: e.from,
                  to: e.to,
                  family: e.family,
                  ...(e.label ? { label: e.label } : {}),
                });
                if (preview.changed) {
                  working = preview.doc;
                  editDoc({
                    type: 'doc/add-edge',
                    id: e.id,
                    from: e.from,
                    to: e.to,
                    family: e.family,
                    ...(e.label ? { label: e.label } : {}),
                  });
                  applied += 1;
                } else {
                  note = preview.note ?? null;
                }
              }
              if (applied === 0) {
                setInkNote(note ?? 'Could not accept — nothing new to add to the board.');
                return;
              }
              if (scratchMode) {
                const storage = scratchStorage();
                if (storage) writeScratch(storage, scratchSessionId, working);
                setInkNote('Saved to local workspace');
              }
              dispatch({ type: 'canvas/proposal-clear' });
              store.dispatch({ type: 'topology/clear' });
            }}
          >
            Accept
          </button>
          <button
            type="button"
            className="pb-btn"
            data-testid="board-proposal-deny"
            onClick={() => {
              dispatch({ type: 'canvas/proposal-clear' });
              store.dispatch({ type: 'topology/clear' });
            }}
          >
            Deny
          </button>
        </div>
      )}

      {projection.nodes.length > 0 ? (
        <BoardControls
          query={query}
          onQuery={setQuery}
          matches={matchIds ? matchIds.length : null}
          onFitMatches={() =>
            matchIds && matchIds.length > 0
              ? setFitRequest((r) => ({ ids: matchIds, seq: (r?.seq ?? 0) + 1 }))
              : undefined
          }
          selectedLabel={labelOf(selectedOne)}
          pathStart={labelOf(pathEnds.start)}
          pathEnd={labelOf(pathEnds.end)}
          pathNote={pathNote}
          onPathStart={() => selectedOne && setPathEnds({ start: selectedOne, end: null })}
          onPathEnd={() => selectedOne && setPathEnds((p) => ({ ...p, end: selectedOne }))}
          onPathClear={() => {
            setPathEnds({ start: null, end: null });
            if (canvas.dim?.reason === 'path-focus') dispatch({ type: 'canvas/dim', dim: null });
          }}
          focusLabel={boardView.focus ? labelOf(boardView.focus) : null}
          proximity={boardView.proximity}
          onFocusSelected={() => selectedOne && updateView((v) => ({ ...v, focus: selectedOne }))}
          onFocusClear={() => updateView((v) => ({ ...v, focus: undefined }))}
          onProximity={(p) => updateView((v) => ({ ...v, proximity: p }))}
          direction={directionChoice === 'TD' ? 'TB' : (directionChoice ?? 'auto')}
          onDirection={(d) => setDirectionChoice(d === 'auto' ? null : d === 'TB' ? 'TD' : 'LR')}
          flat={flat}
          onFlat={setFlat}
          onExpandAll={rankedGroups.length > 0 ? expandAll : undefined}
          onCollapseAll={boardView.expanded.length > 0 ? collapseAll : undefined}
          moved={Object.keys(canvas.positions).length}
          onResetLayout={resetLayout}
          leading={boardTabs}
          viewMenu={SWITCHER_VIEWS.length > 1 ? <ViewMenu views={SWITCHER_VIEWS} value={viewShown} onChange={setView} /> : undefined}
          onExport={() => {
            setExportNote(null);
            setExportSeq((n) => n + 1);
          }}
          exportNote={exportNote}
          extra={
            moreGroups.length > 0 && viewShown === 'map' ? (
              <button
                type="button"
                className="board-more-groups"
                data-testid="board-more-groups"
                title={`Open the next group: ${graph?.nodes.find((n) => n.id === moreGroups[0])?.label ?? moreGroups[0]}`}
                onClick={() => {
                  const next = moreGroups[0]!;
                  handTried.current = next;
                  askFocus(next);
                  toggleExpand(next);
                }}
              >
                +{moreGroups.length} {moreGroups.length === 1 ? 'group' : 'groups'}
              </button>
            ) : undefined
          }
        />
      ) : null}
      {ask.layer}
      {surfaceModel ? (
        <Suspense fallback={null}>
          <NodeSurfacePanel surface={surfaceModel} onClose={() => setSurfaceClosed(surfaceModel.id)} onGenerate={generateWorkflow} />
        </Suspense>
      ) : null}
      {edgeInspect && inspected ? (
        <EdgeEvidence {...inspected} at={{ x: edgeInspect.x, y: edgeInspect.y }} onClose={() => setEdgeInspect(null)} />
      ) : null}

      {menuTarget && (
        <BoardMenu
          target={menuTarget}
          onRename={(nodeId, label) => {
            logBoardEdit('architecture', 'rename', { length: label.length });
            editDoc({ type: 'doc/rename-node', id: nodeId, label });
          }}
          onAskResult={(r) => setInkNote(askNote(r))}
          onAskHere={(nodeId) => {
            /* The whole selection when the node is one of several, else just the node. */
            const picked = canvas.selection.nodeIds.includes(nodeId) && canvas.selection.nodeIds.length > 1 ? [...canvas.selection.nodeIds] : [nodeId];
            ask.open(picked);
          }}
          access={state.composer.permission.access}
          onDelete={(nodeId) => editDoc({ type: 'doc/delete-node', id: nodeId })}
          onOpen={
            /*
             * ALWAYS SUPPLIED; the MENU decides whether it is pressable.
             *
             * This used to be withheld unless `openable`, which made the item
             * vanish — and owner walk 2026-08-22 (A4) is what that looks like
             * from the reader's seat: "Open scope doesn't open up", from
             * someone who could not tell a missing control from a missing
             * feature.
             *
             * "A control that opens an empty room is worse than no control"
             * is still enforced, one layer down: BoardMenu renders it disabled
             * with the reason, and its handler refuses. Withholding the
             * callback here would take the whole row away again and put the
             * reader back where the walk found them.
             */
            openNode
          }
          /*
           * ANATOMY — OFFERED WHENEVER THE SCAN KNOWS THE NODE, and never
           * disabled.
           *
           * It is a different answer from Open's, so it gets a different rule.
           * Open is withheld-but-shown on a node with nothing inside because it
           * would land the reader in an empty room. Anatomy on a node with
           * nothing inside does not open a room at all — it says what a
           * datastore IS, in place, which is information rather than a dead
           * end. `anatomyIsEmpty` is "no children AT ALL", and exactly one node
           * of forty-two qualifies here.
           *
           * Withheld only when the SCAN has never heard of the node — a box the
           * reader drew has no children to roll up and no evidence to read, and
           * an item that could only ever answer "nothing" is the vanishing
           * control the walk already caught once.
           */
          onAnatomy={
            anatomyIndex?.node(menuTarget.nodeId)
              ? (nodeId) => {
                  /* Show inside frames the node at a readable zoom at once (0.1.8.1 C8): `now`, not the next fit. */
                  if (anatomyNodeId !== nodeId) setFocusRequest((r) => ({ id: nodeId, seq: (r?.seq ?? 0) + 1, now: true }));
                  setAnatomyNodeId((open) => (open === nodeId ? null : nodeId));
                }
              : undefined
          }
          anatomyOpen={anatomyNodeId === menuTarget.nodeId}
          /*
           * GENERATE IS AN ASK, and it is the user's second deliberate act —
           * the menu item opens the confirm arm and only the choice inside it
           * reaches here. The owner's rule: "Drawing a box must NOT fire a code
           * proposal. Generate is an explicit act with a confirmation step."
           *
           * It puts the request in the COMPOSER rather than sending it. The
           * same rule one step further out: the person presses send, so a
           * canvas gesture never starts a run on its own, and they can edit the
           * question first — which is the difference between a tool that
           * proposes and one that acts.
           */
          onGenerate={(nodeId, intent, note) => {
            if (!doc) return;
            const request = buildGenerateRequest(doc, nodeId, intent, note);
            if (!request) return;
            store.dispatch({ type: 'composer/draft', text: request.prompt });
            store.dispatch({
              type: 'composer/chip-add',
              chip: {
                id: `node:${nodeId}`,
                kind: 'node',
                ref: nodeId,
                label: request.label,
                nodeKind: null,
              },
            });
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

/** Exported for the chip test, which needs to name the same silhouette the card
 *  drew without re-deriving it. */
export { silhouetteOf };
