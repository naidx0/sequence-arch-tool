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
import { useCanvas } from './canvasChannel.js';
import { useDoc } from './docChannel.js';
import { BoardMenu, type BoardMenuTarget } from './BoardMenu.js';
import { buildGenerateRequest, isGeneratable } from './generateGate.js';
import { docEdit } from './docEdit.js';
import { inkToEdit } from './inkToEdit.js';
import { deriveImportEdges, serviceInterior } from '@sequence/export';
import type { SeqDiagramNode } from '@sequence/schema';
import {
  classifySeqDiagramLayout,
  inferSeqDiagramKind,
  seqDiagramLayoutForKind,
} from '@sequence/schema';
import { recognizeStroke } from '@sequence/ink';
import { cardBox, annotatedCountForLayout } from './cardBox.js';
import { anatomyPanel, indexAnatomy } from './anatomy.js';
import { annotationsForScan, type Annotations } from './annotateClient.js';
import { lookupDim, parentLookup, resolveFlow, selectionDim, teachDim } from './flowFocus.js';
import {
  circularLayoutPositions,
  elkGraphFor,
  frameAspect,
  layoutOffThread,
  positionsFrom,
} from './layout.js';
import { projectDocument, type Projection } from './project.js';
import { boardVisualKey, readBoardVisual, writeBoardVisual } from './visualMode.js';
import { useAppState, useStore } from '../state';
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
import { AgentInspector } from './AgentInspector.js';
import { WorkflowLaunchBar } from './WorkflowLaunchBar.js';
import { useWorkflowLaunch } from './useWorkflowLaunch.js';
import { suggestFullWorkflowTier } from './workflowTierHint.js';
import {
  programNodeStatusForBoardNode,
  subscribeBoardRunOverlay,
  type BoardRunOverlay,
} from './workflowRunOverlay.js';

/** The empty projection. One object, so `useMemo` below has something stable to
 *  return and the board does not remount on every render of an empty board. */
const NOTHING: Projection = { nodes: [], edges: [], positions: {} };

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
  const [openedService, setOpenedService] = useState<string | null>(null);
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
  const [proposalLayoutDirection, setProposalLayoutDirection] = useState<'LR' | 'TD' | null>(null);
  /* What the last stroke did, said out loud. See `inkToEdit`: silence after a
     stroke is indistinguishable from a dropped event. */
  const [inkNote, setInkNote] = useState<string | null>(null);
  const drawnEdgeSeq = useRef(0);
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
  const attachFitKey = attachIdentity
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

  /* No repo: hydrate the session-scoped scratch pad from localStorage when the
     server left no boardSeqd for this session. */
  useEffect(() => {
    if (repoAttached || session.doc !== null) return;
    const storage = scratchStorage();
    if (!storage) return;
    editDoc({ type: 'doc/base', doc: loadScratchDoc(storage, scratchSessionId) });
  }, [repoAttached, scratchSessionId, session.doc, editDoc]);

  /* Persist Architecture overlay to the active session's boardSeqd. */
  useEffect(() => {
    const activeId = state.session.activeId;
    if (!activeId || !worthPersistingBoard(session.doc, session.edits)) return;
    rememberBoardForFlush(activeId, session.doc, session.edits);
    void fetch(`/api/sessions/${encodeURIComponent(activeId)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ boardSeqd: toBoardSeqd(session.doc!) }),
    }).catch(() => {
      /* Best effort — same contract as chat-memory. */
    });
  }, [state.session.activeId, session.doc, session.edits]);

  /* Autosave scratch after each accepted edit when not on a scanned repo. */
  useEffect(() => {
    if (repoAttached || session.doc === null || !isScratchDoc(session.doc)) return;
    const storage = scratchStorage();
    if (!storage) return;
    writeScratch(storage, scratchSessionId, session.doc);
  }, [repoAttached, scratchSessionId, session.doc]);

  /* The scanned graph the document was projected from. It is read for exactly
     one purpose — to be able to say WHY the board has no connectors in the
     scan's own numbers rather than in a guess. */
  const graph =
    state.repo.phase === 'attached' || state.repo.phase === 'stale'
      ? state.repo.repo.graph
      : state.repo.phase === 'scanning' && state.repo.previous
        ? state.repo.previous.graph
        : null;

  const suggestFullTier = useMemo(() => suggestFullWorkflowTier(graph), [graph]);

  /* The interior, when one is open. Computed from the SCANNED graph rather than
     the edited document: what is inside a service is a fact about the
     repository, and a drawn node has no interior to show. */
  const interior = useMemo(
    () => (openedService && graph ? serviceInterior(graph, openedService) : null),
    [openedService, graph],
  );

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
      if (event.key === 'Escape') setAnatomyNodeId(null);
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

  const layoutProfile = useMemo(
    () => (layoutDoc ? classifySeqDiagramLayout(layoutDoc) : null),
    [layoutDoc],
  );
  const projection = useMemo(() => (doc ? projectDocument(doc) : NOTHING), [doc]);
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
  const [showDerived, setShowDerived] = useState(false);

  const derived = useMemo(() => {
    if (!showDerived || !graph) return [];
    const onBoard = new Set(projection.nodes.map((n) => n.id));
    return deriveImportEdges(graph)
      /* Only between two cards this board is actually drawing. An edge to a
         node that is not on screen terminates nowhere, and the renderer would
         drop it silently anyway. */
      .filter((d) => onBoard.has(d.srcId) && onBoard.has(d.dstId))
      .map((d) => {
        const src = projection.nodes.find((n) => n.id === d.srcId)!;
        const dst = projection.nodes.find((n) => n.id === d.dstId)!;
        return {
          id: `derived:${src.id}->${dst.id}`,
          source: src.id,
          target: dst.id,
          proof: 'derived' as const,
          /* THE COUNT IS THE WHOLE CLAIM, AND IT REACHES THE SCREEN.

             The comment nine lines up has promised since this toggle was
             written that the derived connector's "label counts imports and
             never says calls". `derivedEdges.ts` computes that label —
             '84 imports', '3 imports' — and this map used to drop it, so the
             twelve inferred connectors on this repository painted as twelve
             identical dotted lines. analyzer->schema (84) and mcp->analyzer (3)
             read the same, which destroys the one piece of information the
             inference actually carries: how strong the coupling is.

             The word stays 'imports'. It is a fact about files, and every
             stronger verb here would be a fact about behaviour that nothing
             measured. */
          label: d.label,
        };
      });
  }, [showDerived, graph, projection.nodes]);

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
    () => (derived.length > 0 ? [...projection.edges, ...derived] : projection.edges),
    [projection.edges, derived],
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
    const onBoard = new Set(projection.nodes.map((n) => n.id));
    return deriveImportEdges(graph).filter((d) => onBoard.has(d.srcId) && onBoard.has(d.dstId)).length;
  }, [graph, projection.nodes]);

  /* Nodes that contain others — expand icon on the card header. */
  const openableNodeIds = useMemo(() => {
    if (!graph) return new Set<string>();
    const ids = new Set<string>();
    for (const n of graph.nodes) {
      if (graph.nodes.some((c) => c.parentId === n.id)) ids.add(n.id);
    }
    return ids;
  }, [graph]);

  /* Cards the scan's own connectors leave joined to nothing at all. */
  const unjoinedNodeCount = useMemo(() => {
    if (projection.nodes.length === 0) return 0;
    const joined = new Set<string>();
    for (const edge of projection.edges) {
      joined.add(edge.source);
      joined.add(edge.target);
    }
    return projection.nodes.filter((n) => !joined.has(n.id)).length;
  }, [projection.nodes, projection.edges]);

  /* ══ WHEN THE INFERENCE IS OFFERED WITHOUT BEING ASKED FOR ══════════════

     The default board stays the honest one and this does not change that: what
     is drawn is still counted, still labelled 'N imports', still dotted, still
     in the weakest ink, and the reader can switch it off.

     WHAT CHANGED IS THE CONDITION. It used to be `projection.edges.length > 0`
     — offer the inference only on a board with NO connector whatsoever. On this
     monorepo the scan finds exactly one (`svc:analyzer -> ds:analyzer-db`, a
     real db_access), so the test failed by one edge and the board opened as ten
     cards floating beside a single connected pair, with 12 real service->service
     dependencies sitting behind a toggle nobody had a reason to press.

     THE CONDITION IS NOW THE ACTUAL QUESTION: are there cards this board has
     nothing to say about? A node with no connector at all is a box the reader
     cannot place, and offering a counted, labelled, opt-out-able inference is a
     better answer than silence. It is not a threshold somebody picked — it is
     'one or more nodes joined to nothing', which is the condition itself. */
  const derivedAutoKey = useRef<string | null>(null);
  useEffect(() => {
    if (!attachIdentity || derivedAvailable === 0 || unjoinedNodeCount === 0) return;
    if (derivedAutoKey.current === attachIdentity) return;
    derivedAutoKey.current = attachIdentity;
    setShowDerived(true);
  }, [attachIdentity, derivedAvailable, unjoinedNodeCount]);

  const boardEdges = useMemo(() => {
    const edges = derived.length > 0 ? [...projection.edges, ...derived] : projection.edges;
    if (!runOverlay?.activeEdgeId) return edges;
    const [fromRaw, toRaw] = runOverlay.activeEdgeId.split('->');
    if (!fromRaw || !toRaw) return edges;
    const from = fromRaw.startsWith('wf:') ? fromRaw.slice(3) : fromRaw;
    const to = toRaw.startsWith('wf:') ? toRaw.slice(3) : toRaw;
    return edges.map((e) =>
      e.source === from && e.target === to ? { ...e, runActive: true } : e,
    );
  }, [projection.edges, derived, runOverlay?.activeEdgeId]);

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
  const boardNodes = useMemo(() => {
    const base =
      Object.keys(annotations).length === 0
        ? projection.nodes
        : projection.nodes.map((node) => {
            const bullets = annotations[node.id];
            const first = bullets?.[0];
            return first ? { ...node, annotation: first } : node;
          });
    if (!runOverlay) return base;
    return base.map((node) => {
      const runStatus = programNodeStatusForBoardNode(node.id, runOverlay);
      return runStatus ? { ...node, runStatus } : node;
    });
  }, [projection.nodes, annotations, runOverlay]);

  const layoutKey = useMemo(
    () =>
      projection.nodes.length && layoutProfile
        ? `${projection.nodes.map((node) => node.id).join(',')}|${layoutEdges.length}|` +
          `${frameAspect(canvas.frame.width, canvas.frame.height)}|` +
          `${layoutProfile.engine}:${layoutProfile.direction}|` +
          // An annotation makes its card one line taller — but only at the
          // rungs the subtitle shows, which is exactly where `cardHeight`
          // reserves its room. Counting annotated cards below that rung spent
          // an ELK relayout on boxes that had not changed (finding F6), so the
          // count obeys the same ladder rule as the room.
          `a${annotatedCountForLayout(boardNodes, canvas.rung)}|` +
          /* VISUAL IS PART OF THE QUESTION. It changes every card's height
             (`cardBox`) and both ELK spacings (`elkGraphFor`), so an answer
             computed with it off must not be applied with it on — that is the
             stale-answer defect this key's own comment describes, arriving by a
             second road. */
          `v${visual ? 1 : 0}|` +
          /* SO IS THE OPEN WALL, and for exactly the reason above. Anatomy adds
             129px plus its frame to ONE card; an arrangement packed without
             that room applied with it on is the stale-answer defect again, and
             here it lands as a treemap overlapping the card below it. */
          `an${anatomyNodeId ?? ''}`
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
    ],
  );

  const [laid, setLaid] = useState<{
    key: string;
    positions: Record<string, { x: number; y: number }>;
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
    const boxes = projection.nodes.map((node) =>
      cardBox(
        node,
        projection.positions[node.id] ?? { x: 0, y: 0 },
        1,
        visual,
        node.id === anatomyNodeId ? anatomy : null,
      ),
    );

    const applyPositions = (positions: Record<string, { x: number; y: number }>) => {
      if (!live) return;
      if (!Object.keys(positions).length) {
        dispatch({ type: 'canvas/layout', layout: 'failed' });
        return;
      }
      setLaid({ key: layoutKey, positions });
      dispatch({ type: 'canvas/layout', layout: 'idle' });
    };

    if (layoutProfile.engine === 'circular-loop') {
      applyPositions(circularLayoutPositions(boxes, layoutEdges, canvas.frame));
      return () => {
        live = false;
      };
    }

    layoutOffThread(
      elkGraphFor(boxes, layoutEdges, canvas.frame, {
        direction: layoutProfile.direction,
        engine: layoutProfile.engine,
        visual,
      }),
    )
      .then((result) => {
        if (!live) return;
        applyPositions(positionsFrom(result));
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

  const onLayoutDirection = useCallback(
    (direction: 'LR' | 'TD') => {
      if (proposal && !grounded) {
        setProposalLayoutDirection(direction);
        return;
      }
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
      const path = (node as { path?: string }).path;
      if (typeof path === 'string' && path !== '') {
        store.dispatch({ type: 'rail/reveal', path: path as never });
      }
    },
    [store],
  );

  /* SHEET 08.5 — three parts, in the same order, and the icon is the KIND OF
     ABSENCE rather than a verdict. An empty state is not a failure.
     "No graph yet" and "the scan failed" are different sentences and are told
     apart here rather than collapsed into one paragraph the reader cannot act
     on. */
  const empty = useMemo<BoardEmpty | null>(() => {
    if (projection.nodes.length) return null;

    if (state.repo.phase === 'scanning') {
      return {
        icon: 'board',
        what: scanStatusLine ?? 'Scanning the repository',
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
      return {
        icon: 'filter',
        what: 'Nothing at this scope',
        why: 'The scan produced a document with no node in this view.',
      };
    }
    return {
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
        label: 'Open a repository',
        onAct: () => store.dispatch({ type: 'shell/overlay', overlay: { kind: 'attach' } }),
      },
    };
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
      return { what, why: 'The scan found no edge anywhere in this repository.' };
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
          'That is a fact about this repository, not about the board.',
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
      generatable: docNode ? isGeneratable(docNode as SeqDiagramNode) : false,
      /* Openable when the SCAN says something is inside. Read off the graph,
         not the projection: containment is `parentId`, which the projection
         does not carry. */
      openable:
        interior === null &&
        !!graph &&
        graph.nodes.some((n) => n.parentId === menu.nodeId),
    };
  }, [menu, projection.nodes, doc, graph, interior]);

  return (
    <div className="board-scope board-stack" data-testid="board-stack">
      <Board
        onFurnitureBand={setFurnitureBand}
        canvas={canvas}
        nodes={boardNodes}
        edges={boardEdges}
        derivedOn={showDerived}
        onToggleDerived={() => setShowDerived((on) => !on)}
        derivedCount={derivedAvailable}
        positions={positions}
        dispatch={dispatch}
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
          setOpenedService(nodeId);
        }}
        openableNodeIds={openableNodeIds}
        ghostNodeIds={ghostNodeIds}
        ghostFitKey={ghostFitKey}
        layoutDirection={
          layoutProfile?.engine === 'layered-flow' ? layoutProfile.direction : null
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
        onToggleDrawing={() => {
          setDrawing((on) => !on);
          setInkNote(null);
        }}
        onFlowReady={(api) => {
          flowConvert.current = api.screenToFlow;
        }}
        onStroke={(points) => {
          if (!doc) {
            setInkNote(
              'Drawing needs a scanned board. Attach a repository first, or wait for the scan to finish.',
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
          const outcome = inkToEdit(recognizeStroke(points), {
            hitTest: (at) => {
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
            },
            nextEdgeId: () => `draw:e${++drawnEdgeSeq.current}`,
          });
          setInkNote(outcome.kind === 'edit' ? outcome.note : outcome.note);
          if (outcome.kind === 'edit') {
            editDoc(outcome.edit);
            /* PIN THE DRAWN BOX where the stroke was — otherwise ELK packs the
               new id into the clump and "draw a box" feels like it vanished. */
            if (outcome.edit.type === 'doc/add-node' && outcome.place) {
              const flow = flowConvert.current(outcome.place);
              dispatch({ type: 'canvas/position', nodeId: outcome.edit.id, x: flow.x, y: flow.y });
            }
          }
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
          aria-label={`${repoPanel.label} — the whole repository, drawn by size`}
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
              {repoPanel.cells.length} parts · {repoPanel.size.files} files ·{' '}
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
            <MetaStripBoundary what="the repository anatomy">
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
            onClick={() => setOpenedService(null)}
          >
            Back to the system
          </button>
          <span className="pb-title">{interior.doc.title}</span>
          <span className="pb-count">
            {interior.total} inside
            {/* WHAT WAS LEFT OUT IS SAID. Showing 60 of 900 without a word
                would tell the reader this service has 60 files. */}
            {interior.omitted > 0 ? ` · showing ${interior.total - interior.omitted}` : ''}
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
          aria-label="The repository changed"
        >
          <span className="pb-title">
            The repository changed while you were drawing. This board is showing the older scan.
          </span>
          <span className="pb-why">
            {session.edits === 1
              ? 'Taking the new one replaces 1 unsaved edit.'
              : `Taking the new one replaces ${session.edits} unsaved edits.`}
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
                editDoc({ type: 'doc/base', doc: working });
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

      {menuTarget && (
        <BoardMenu
          target={menuTarget}
          onRename={(nodeId, label) => editDoc({ type: 'doc/rename-node', id: nodeId, label })}
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
            (nodeId) => setOpenedService(nodeId)
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
              ? (nodeId) => setAnatomyNodeId((open) => (open === nodeId ? null : nodeId))
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
