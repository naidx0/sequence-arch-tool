/* ══════════════════════════════════════════════════════════════════════════
   THE BOARD HOST — items 3.4, 3.5, 3.6
   packages/web2/src/canvas/Board.tsx

   docs/brand/graphite/pages/05-the-canvas.html (field, camera, gesture,
   cluster, pointer), pages/06-selection-focus-and-dimming.html (selection is
   additive; dimming is not a selection effect), pages/08-board-density-and-
   overflow.html (the frame is the budget).

   ── WHAT MAKES THIS A HOST AND NOT A COMPONENT ────────────────────────────

   IT IS CONTROLLED, END TO END. The camera, the selection, the frame and the
   rung all live in `CanvasSlice`; every change is a `CanvasAction` dispatched
   through one funnel; nothing here calls a setter, reads a getter, or asks the
   renderer what it thinks the state is. Item 3.4's rule — "no imperative
   getState/setState pokes" — is met by construction: there is no second place
   for the camera to live, because `<ReactFlow>` takes `viewport` as a PROP.

   THE DEAD SUBSCRIPTION IS NOT REPRODUCED. v1's board subscribes to
   `activeNameDraftId`, so every keystroke of a rename re-renders the whole
   board. This host reads five fields and each one is a fact about what is on
   screen.

   THE EDGE BOX MAP IS HOISTED. v1 computes it INSIDE EVERY EDGE — `useNodes()`
   + `useEdges()` + `nodes.map()` per connector, about 960 box allocations per
   drag frame at 24 cards. Here the board builds ONE map per layout change and
   hands each edge the polyline already routed; `ElbowEdge` draws and never
   computes. `board.perf.test.ts` counts the allocations.

   ── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────

   NO DRAW TOOL, AND NO CROSSHAIR AND NO `D` KEY. Draw is Wave 8+ (§ "Draw is
   the wave-2-after-cutover headline"). Sheet 05.7 specifies four cursors and a
   `V D Esc 0 1 2 + −` keymap; two of those bind a mode this build cannot enter.
   An affordance for something the product cannot do is the same lie sheet 02.6
   refuses on the connection handle, so `D` is unbound and the pointer never
   says crosshair. `V` is unbound for the same reason in reverse: select is the
   only tool, so a key that switches to it switches to nothing.

   NO SECOND FIELD. React Flow's own <Background> is not mounted — see board.css.
   ══════════════════════════════════════════════════════════════════════════ */

import { fieldDots } from './fieldDots.js';
import {
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type OnSelectionChangeParams,
  type Viewport as RfViewport,
  type NodeHandle,
} from '@xyflow/react';
import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ErrorInfo, KeyboardEvent, ReactNode } from 'react';

import type { NodeKind } from '@sequence/schema';

import type { AnatomyPanel as AnatomyPanelModel } from './anatomy.js';
import { BoardIcon, type BoardIconName } from './BoardIcon.js';
import { ElbowEdge, type EdgeProof } from './ElbowEdge.js';
import { HANDLE_SIDES, NodeCard, type BoardNode, type DotState } from './NodeCard.js';
import { ZoomCluster } from './ZoomCluster.js';
import { CARD_W, CHIP_INSET, boardFarScale, farTitleScaleMax, type CardBox } from './cardBox.js';
import { measureWithCanvas, titleFont } from './textFit.js';
import { GroupFrame } from './GroupFrame.js';
import { depthOf, nestedBoxes } from './nestedBoxes.js';
import { useInterpolatedPositions } from './useInterpolatedPositions.js';
import { displayLabel } from './displayLabel.js';
import { boardTitleFit, twoLineText } from './titleFit.js';
import { farLodClass } from './farLod.js';
import { routeEdges } from './routes.js';
import { FIT_INSET, FOCUS_MIN_ZOOM, SHOW_INSIDE_MIN_ZOOM, ZOOM_MAX, ZOOM_MIN, unionBounds, type Bounds } from './camera.js';
import { NODE_DRAG_THRESHOLD, dragCatchUp, isArrow, isTypingTarget, nextInDirection, nudge } from './boardKeys.js';
import { followRowLabel, type RowLabelInput } from './rowLabels.js';
/* Static, not lazy: the board is empty while the first scan runs, so a lazy
   ramp was a boot request of its own (measured: bootRequests 25 -> 26). */
import type { CanvasAction } from './canvasReduce.js';
import { promoteOnFlow, type HopResolution } from './flowFocus.js';
import { visibilityAt } from './lod.js';
import { farLabelsToYield } from './farLabels.js';
import type { CanvasSlice } from '../state/types';

export interface BoardEdge {
  id: string;
  source: string;
  target: string;
  proof: EdgeProof;
  /** Program-run overlay: pulse this connector while the run is on it. */
  runActive?: boolean;
  /**
   * WHAT THE CONNECTOR SAYS — sheet 04's `.edgetag`, carried from the document
   * rather than composed here.
   *
   * It is optional and it stays optional: an edge the scan gave no verb to gets
   * no tag, because a board that captions every arrow has to invent captions.
   * The two writers today are `project.ts` (the document's own
   * `SeqDiagramEdge.label`, which is where an AI-proposed 'publishes
   * order.placed' lives) and `ConnectedBoard`'s derived connectors, whose label
   * is an arithmetic fact — '84 imports' — and never a verb.
   */
  label?: string;
  /** The whole label when `label` had to be shortened to fit the connector —
   *  absent when it did not. The tag hands this to the reader on hover, so a
   *  count of what was cut is never the end of the story. */
  labelFull?: string;
  /** What the line stands for, on hover ("2 http · 14 imports"). */
  title?: string;
  /** Lifted imports between two boxes (one line per pair, counted). */
  imports?: boolean;
  /** How many edges this one line merges, when more than one. */
  merged?: number;
}

/** Sheet 08.5: what is not here, WHY it is not here, and one thing to do about
 *  it. The second part is the one that gets dropped, and dropping it turns an
 *  empty board into a bug report the reader has to file themselves. */
export interface BoardEmpty {
  icon: BoardIconName;
  what: string;
  why: string;
  action?: { label: string; onAct: () => void };
  /** A second way out, beside the first (P2-9: Open another / Start from a sketch). */
  secondary?: { label: string; onAct: () => void };
}

/**
 * SHEET 08.5's THIRD EMPTY STATE, which is about EDGES rather than nodes.
 *
 * The sheet draws it as "No traced edge at this level ... That is a fact about
 * the level, not about the repository", with `ic-flow` as its icon because
 * "the connections are the thing missing".
 *
 * IT IS A SEPARATE PROP FROM `empty` BECAUSE IT IS A DIFFERENT CLAIM. `empty`
 * says there is nothing on the board; this says the board is full and none of
 * it is joined up. Collapsing them would make an empty board and an unconnected
 * one the same sentence, which is precisely the confusion 08.5 exists to
 * remove — and it would put a lid over eleven cards the reader can see.
 */
export interface BoardEdgeless {
  what: string;
  why: string;
}

/**
 * ITEM playback — WHAT THE BOARD IS SHOWING OF THE CURRENT HOP.
 *
 * The resolver (`flowFocus.ts`) has already decided which of a flow's hops this
 * board can put on screen; this is that decision for the hop the reader is on,
 * with the labels of the cards that are actually drawn. It is a PROP and not
 * something the board derives, for the reason the whole lane is arranged
 * around: the board has the document, `ConnectedBoard` has the graph the
 * document was projected from, and only the second can resolve a hop that names
 * a node one level below the board's.
 *
 * IT EXISTS SO THE BOARD CAN SAY WHAT IT CANNOT SHOW. Measured on this
 * monorepo, every traced flow's hops are file→file and every one of them
 * resolves to `inside` a single service — the board focuses that service and
 * has no crossing to draw. A board that dimmed and moved and said nothing would
 * leave the reader to work out why the picture stopped changing at hop 2.
 */
export interface BoardPlayback {
  functionId: string;
  /** Zero-based index into the flow's hops — the cursor, already clamped. */
  index: number;
  count: number;
  /** How many of the flow's hops resolve to something on this board. */
  shown: number;
  how: HopResolution;
  from: string | null;
  to: string | null;
  fromLabel: string | null;
  toLabel: string | null;
}

export interface BoardProps {
  canvas: CanvasSlice;
  nodes: readonly BoardNode[];
  edges: readonly BoardEdge[];
  /** Where the layout put each node. `canvas.positions` overrides per node. */
  positions: Readonly<Record<string, { x: number; y: number }>>;
  dispatch: (action: CanvasAction) => void;
  /**
   * ITEM 3.5 — P5, and a Wave-3 ACCEPTANCE GATE.
   *
   * ONE ACTION: clicking a grounded node makes it a context chip in the
   * composer. It is the pattern every visual competitor converged on, and in v1
   * the button existed but rendered only on hand-drawn `design:draw-*` nodes —
   * so the grounded graph could not talk to the agent AT ALL, on any scanned
   * node. That is not an engine defect and not a stylesheet defect; it is a
   * shell defect, and it is this callback.
   */
  onGround: (node: BoardNode) => void;
  /**
   * Ask the rail to explain a node — what it is, and where each of its edges
   * was traced from. A PROP rather than a dispatch because this board's
   * dispatch is narrowed to canvas actions and the rail owns its own slice.
   */
  onExplain?: (nodeId: string) => void;
  /**
   * Right-click on a node. Optional: a board with no editing host still reads
   * and still plays, and the card leaves the platform menu alone when nothing
   * is listening — see `NodeCard`'s handler.
   */
  onMenu?: (nodeId: string, at: { x: number; y: number }) => void;
  /** Go inside a node. See `NodeCard.onOpen` — the owner refuses when the scan
   *  recorded nothing inside, so this fires on every double-click. */
  onOpenNode?: (nodeId: string) => void;
  /** Node ids the scan says have children — expand icon on the card. */
  openableNodeIds?: ReadonlySet<string>;
  /** COMPOSITE BOARD: each expanded group's frame size, from the layout. A
   *  member's entry in `positions` is relative to its group. */
  sizes?: Readonly<Record<string, { w: number; h: number }>>;
  /** ELK's orthogonal routes by edge id, absolute (layout.ts `routesFrom`).
   *  Drawn when a route still meets both cards; otherwise the board routes. */
  elkRoutes?: Readonly<Record<string, ReadonlyArray<{ x: number; y: number }>>>;
  /** False while the positions are the seed for an arrangement ELK has not
   *  answered yet; the auto refit waits for true. Default true. */
  arranged?: boolean;
  /** Called with the zoom a fit of each finished arrangement needs (before
   *  the camera's floor clamps it), so the board's owner can tell when an
   *  expansion left the board unreadable or past the floor (autoExpand.ts). */
  onArrangedFit?: (fitZoom: number) => void;
  /** Bump to have the current arrangement's fit reported again (a run that
   *  starts on the board as it stands). */
  fitReportSeq?: number;
  /** Row labels drawn on the board in flow coordinates ("Not connected").
   *  With `ids`, the label follows its cards when they are dragged
   *  (rowLabels.ts, round 7 C.3). */
  rowLabels?: ReadonlyArray<RowLabelInput>;
  /**
   * FRAME THIS, READABLY, WHEN ITS ARRANGEMENT LANDS (round 7, C.4). Bumped
   * by the host when the reader expands a group, opens an anatomy wall
   * (`id` = that node) or drills into a level (`id` = null, the whole new
   * level). The next fit frames it at no less than `FOCUS_MIN_ZOOM`, eased,
   * instead of fitting the whole board.
   */
  focusRequest?: { id: string | null; seq: number; now?: boolean } | null;
  /**
   * Esc after Draw and the selection are already clear: the host steps back
   * one level (the open anatomy wall, then the drilled-in level). Returns
   * whether it did anything, so an Esc with nothing left to undo is not eaten.
   */
  onBack?: () => boolean;
  /** Collapse an expanded group back to one card. */
  onCollapseNode?: (nodeId: string) => void;
  /** Draw one group alone (replaces the view one level down). */
  onFocusNode?: (nodeId: string) => void;
  /** A click on a connector: its id and where, in client pixels. */
  onEdgeClick?: (edgeId: string, at: { x: number; y: number }) => void;
  /** Fit these cards (or all, when empty) each time `seq` changes. */
  fitRequest?: { ids: readonly string[]; seq: number } | null;
  /** Render the board to a PNG each time this number changes. */
  exportRequest?: number;
  onExported?: (png: { dataUrl: string; width: number; height: number } | { error: string }) => void;
  /**
   * DERIVED CONNECTORS — the inference, offered rather than assumed.
   *
   * Absent means the board does not offer them at all. Present means it offers
   * a toggle, and `derivedCount` says what turning it on would draw, because a
   * control that might reveal nothing should say so before it is pressed.
   */
  derivedOn?: boolean;
  onToggleDerived?: () => void;
  derivedCount?: number;
  /** When set, the board can switch layered-flow between LR and TD. */
  layoutDirection?: 'LR' | 'TD' | null;
  onLayoutDirection?: (direction: 'LR' | 'TD') => void;
  /**
   * VISUAL MODE — MADR §0 amendment A1, Max 2026-09-02: "I want it to be
   * toggleable so people don't have to choose. They just load it, and it's
   * always going to be doing this."
   *
   * ON is the default, and the control turns it OFF. The board takes it as a
   * prop and decides nothing: which board this is, and what that board was left
   * on, are `ConnectedBoard`'s to know (`visualMode.ts`).
   *
   * IT LIVES ON THE BOARD'S OWN FURNITURE, beside the direction toggle, and NOT
   * in the composer's mode menu. The MADR's decision 1 argues that at length
   * and the distinction is the whole point of that other control: the mode menu
   * answers "what will this turn be allowed to do to my repository" — every row
   * is a claim about consequences — and Visual answers "how does this board
   * look", scoped to one board, true whether or not a turn is running.
   */
  visual?: boolean;
  /** Absent ⇒ the board offers no toggle at all (a specimen, a test harness). */
  onToggleVisual?: () => void;
  /**
   * THE DOOR TO THE WHOLE REPOSITORY, and it is not a card.
   *
   * `anatomyPanel` computes a correct panel for the repo node — 10 cells,
   * 275,837 lines, the cells partitioning the container exactly — and until
   * this prop existed NOTHING COULD OPEN IT. Anatomy paints into a card's own
   * slot (`anatomy?.nodeId === node.id`), and the board draws services,
   * datastores and topics; it never draws the repository. So the one view that
   * answers "hand it a repo and see the whole thing broken down" was built,
   * correct and unreachable.
   *
   * A ROOT DOOR, DELIBERATELY, NOT A REPO CARD. Containment was cut — opening
   * REPLACES the view, one level at a time — and a crumb trail was built and
   * REVERTED for violating it (docs/COMPETITIVE-GAPS-2026-08-22.md §33). A repo
   * card would be a container every other node sits inside, which is the shape
   * that was cut. A door in the furniture contains nothing, adds no board node
   * and no board edge, and replaces the view for exactly one step back.
   */
  onOpenRepoAnatomy?: () => void;
  /**
   * ANATOMY — the node whose children are drawn inside its own footprint, and
   * the packing for them, already computed.
   *
   * A MODEL AND NOT A GRAPH. The board holds the DOCUMENT; `ConnectedBoard`
   * holds the scanned graph the document was projected from — the same split
   * `playback` is arranged around, for the same reason: only the host can
   * resolve something one level below the board's. So the host walks the graph
   * and hands the packed result down.
   *
   * IT IS A THIRD GESTURE. `onOpenNode` above is navigation and still replaces
   * the view one level at a time (the board's standing ruling, locked by
   * `boardMenuRendered.test.tsx`); a plain click is selection. This adds no
   * board node, no board edge, no second structural level and no crumb trail.
   */
  anatomy?: AnatomyPanelModel | null;
  /** The opened node's schema kind — the empty copy says what a datastore IS. */
  anatomyKind?: NodeKind;
  /** Close the wall. §07.3 puts the control on the wall's own header. */
  onCloseAnatomy?: () => void;
  /** Extra key so proposal fit re-runs after ELK settles. */
  ghostFitKey?: string | null;
  /** S4 — node ids the agent PROPOSED. Drawn dashed over the grounded doc. */
  ghostNodeIds?: readonly string[];
  /**
   * POST-ATTACH ONE-SHOT FIT. Host passes a stable key for the attached repo
   * (root + scan time). When the key is set and layout is no longer in flight,
   * the board fits the camera once so attach does not leave the default
   * `{0,0,zoom:1}` viewport. Null means nothing attached — reset the latch.
   */
  attachFitKey?: string | null;
  /**
   * DRAW MODE. When present, the board offers a Draw toggle and, while it is
   * on, hands every completed stroke to `onStroke` instead of panning.
   *
   * IT IS A WORD, NOT A GLYPH — sheet 09 ruling 3, the same reason Fit is a
   * word: the icon vocabulary has no `ic-pen` and "does not borrow one". The
   * five-tool toolbar that sheet specifies needs glyphs that do not exist yet,
   * which is a brand decision; a worded toggle is what the book's own ruling
   * says to do in the meantime, and it is the difference between being able to
   * draw and not.
   */
  drawing?: boolean;
  onToggleDrawing?: () => void;
  onStroke?: (points: { x: number; y: number }[], timing?: StrokeTiming) => void;
  /**
   * ROUND 8 — THE DRAWING LAYER (canvas/boards/ArchDraw.tsx). Rendered in
   * flow space (inside the camera), handed the box every card is drawn at
   * this frame so a mark anchored to a node moves with it.
   */
  renderOverlay?: (view: {
    boxOf: (id: string) => CardBox | undefined;
    /** Every connector's path ("M x y L …") as drawn, so a text mark can keep off them. */
    paths: readonly string[];
    /** The cards (group frames excluded) as drawn this frame. */
    cards: readonly CardBox[];
  }) => ReactNode;
  /**
   * While Draw is on with an annotation tool, this replaces the Sketch
   * gesture's stroke layer. `passive` is Space held (the layer lets the pan
   * through); `boxes` are the cards in flow space, for anchoring.
   */
  renderDrawCapture?: (passive: boolean, boxes: readonly CardBox[]) => ReactNode;
  /** Called once React Flow is mounted — screen → flow coordinate conversion. */
  /**
   * The measured furniture band (px from the pane's bottom edge that the
   * legend + tools rows occupy), reported whenever it changes — so a sibling
   * surface (the interior bar) can anchor ABOVE it instead of trusting a CSS
   * constant that goes stale the moment the tools wrap one more row.
   */
  onFurnitureBand?: (band: number) => void;
  onFlowReady?: (api: {
    screenToFlow: (point: { x: number; y: number }) => { x: number; y: number };
  }) => void;
  empty?: BoardEmpty | null;
  /** Drawn only when there ARE nodes and there are NO edges. Null otherwise —
   *  a board with connectors has nothing to explain. */
  edgeless?: BoardEdgeless | null;
  /**
   * Put the edgeless note down. Optional, and its ABSENCE is meaningful: with
   * no handler the note is not dismissible and must not grow a control saying
   * it is — the same rule BoardMenu applies to Open.
   *
   * The board reports the press and decides nothing. WHETHER the note returns
   * on the next scan is the owner's call one level up, because only that level
   * knows whether a new scan is the same finding.
   */
  onDismissEdgeless?: () => void;
  /** The current hop, resolved onto this board. Null when nothing is playing. */
  playback?: BoardPlayback | null;
}

/* ── the renderer's node, which is a thin wrapper and nothing else ────────── */

/**
 * VISUAL MODE'S ONLY RENDERING CODE, AND IT IS A SEPARATE CHUNK.
 *
 * MADR cost clause: "everything Visual-only is lazy-loaded, so a reader who
 * never flips the switch pays nothing", measured the way `ReactCanvasMount.tsx`
 * measured Babel. `lazy()` at module scope declares the split; the `import()`
 * inside it does not run until something actually renders the component, so a
 * board with Visual OFF never requests the chunk.
 *
 * `fallback={null}` and not a spinner: the card is already on screen with its
 * title, its glance line and its silhouette — the strip is one more row, and a
 * spinner in its place would be a louder absence than the absence.
 */
const VisualMetaStrip = lazy(() =>
  import('./visual/VisualMetaStrip.js').then((module) => ({ default: module.VisualMetaStrip })),
);

/**
 * ANATOMY'S WALL, ON THE SAME TERMS AS THE STRIP ABOVE.
 *
 * Lazy for the same reason and with the same boundary: a reader who never opens
 * an anatomy never downloads the renderer. The MODEL is not in the chunk — it
 * is `anatomy.ts` on the main path — because `cardBox` has to know how tall the
 * wall is BEFORE it renders, or the edge router terminates on a box the card
 * does not paint.
 */
const AnatomyPanel = lazy(() =>
  import('./visual/AnatomyPanel.js').then((module) => ({ default: module.AnatomyPanel })),
);

/**
 * A CHUNK THAT DOES NOT ARRIVE MUST COST ONE ROW, NOT THE WHOLE APP.
 *
 * `Suspense` catches suspension; it does NOT catch rejection. `lazy` re-throws
 * a failed `import()` during render, and with no boundary between here and
 * `createRoot` React unmounts the entire tree — the reader loses the
 * transcript, the rail and the composer, and gets a blank page instead of a
 * card missing a row. `lazy` also caches the rejected promise, so nothing short
 * of a reload recovers.
 *
 * THIS IS REACHABLE, NOT THEORETICAL. Vite content-hashes the chunk, so a
 * reader holding an open tab while `dist` is rebuilt requests a
 * `VisualMetaStrip-<oldhash>.js` that no longer exists — the same stale-dist
 * race this repo has already recorded once. An offline or flaky static server
 * does it too. And A1 put every reader on this path: before this wave no card
 * render depended on a fetch at all.
 *
 * IT RENDERS NOTHING, and the tradeoff is stated rather than hidden. Nothing on
 * the card is wrong without the strip — title, glance line, icon and silhouette
 * are all still there and still grounded; only the extra row Visual adds is
 * missing, and `cardHeight` has already reserved its room, so no other card
 * moves. What is lost is that the toggle reads "on" while one card shows less
 * than it promises, which is why the reason goes to the console rather than
 * being swallowed. A visible refusal in a 25px strip on every card would be a
 * louder failure than the failure.
 */
/* `what` NAMES THE CHUNK IN THE CONSOLE LINE, and defaults to the strip this
   boundary was written for. Anatomy's wall is a second lazy chunk on the same
   card with the same failure mode, and a second copy of this class would be a
   second place to fix the next thing found wrong with it. */
/* Exported so `ConnectedBoard`'s whole-repository view can use the SAME
   boundary rather than a second one. A lazy chunk that throws should degrade
   the panel, not the board around it, wherever it is mounted. */
export class MetaStripBoundary extends Component<
  { children: ReactNode; what?: string },
  { failed: boolean }
> {
  constructor(props: { children: ReactNode; what?: string }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error(
      `[board] ${this.props.what ?? 'the visual meta strip'} failed to render`,
      error,
      info.componentStack,
    );
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

interface ArchNodeData extends Record<string, unknown> {
  node: BoardNode;
  selected: boolean;
  dimmed: boolean;
  dot: DotState | null;
  rung: CanvasSlice['rung'];
  /** MADR A1 — on by default, per board, persisted. See `visualMode.ts`. */
  visual: boolean;
  /** The node's own children, already packed — or null when the wall is shut.
   *  Built once per board in the host, never per card: `anatomyPanel` walks the
   *  graph, and a card is not the place to do that. */
  anatomy: AnatomyPanelModel | null;
  /** The opened node's schema kind, for the empty copy. */
  anatomyKind?: NodeKind;
  onCloseAnatomy?: () => void;
  onPick: (id: string, additive: boolean) => void;
  onMenu?: (id: string, at: { x: number; y: number }) => void;
  onOpen?: (id: string) => void;
  openable?: boolean;
  ghost?: boolean;
  labelYields?: boolean;
}

function ArchNode({ data }: NodeProps) {
  const payload = data as ArchNodeData;
  return (
    <NodeCard
      node={payload.node}
      selected={payload.selected}
      dimmed={payload.dimmed}
      dot={payload.dot}
      rung={payload.rung}
      onSelect={payload.onPick}
      onMenu={payload.onMenu}
      onOpen={payload.onOpen}
      openable={payload.openable}
      ghost={payload.ghost}
      labelYields={payload.labelYields}
      /* ONE CARD COMPONENT, ONE SLOT. A second card for Visual would be two
         answers to "what does a node look like" — two selection behaviours, two
         sets of handles, two chances for an edge to terminate on air. */
      meta={
        payload.visual ? (
          /* The boundary is OUTSIDE the Suspense because the thing that throws
             is `lazy` itself re-throwing a rejected import — see
             `MetaStripBoundary`. Inside, it would be remounted by the retry and
             never see the rejection. */
          <MetaStripBoundary>
            <Suspense fallback={null}>
              <VisualMetaStrip node={payload.node} selected={payload.selected} />
            </Suspense>
          </MetaStripBoundary>
        ) : undefined
      }
      /* THE WALL — a THIRD affordance, and it leaves the other two alone.
         `onOpen` above still REPLACES the view, one level at a time; a plain
         click is still selection. This draws one node's children inside that
         node and adds no board node, no board edge and no crumb trail. */
      anatomy={
        payload.anatomy ? (
          <MetaStripBoundary what="the anatomy wall">
            <Suspense fallback={null}>
              <AnatomyPanel
                panel={payload.anatomy}
                kind={payload.anatomyKind}
                onClose={() => payload.onCloseAnatomy?.()}
              />
            </Suspense>
          </MetaStripBoundary>
        ) : undefined
      }
    />
  );
}

interface GroupNodeData extends Record<string, unknown> {
  node: BoardNode;
  selected: boolean;
  dimmed: boolean;
  onPick: (id: string, additive: boolean) => void;
  onCollapse?: (id: string) => void;
  onFocus?: (id: string) => void;
  onMenu?: (id: string, at: { x: number; y: number }) => void;
}

function GroupNode({ data }: NodeProps) {
  const payload = data as GroupNodeData;
  return (
    <GroupFrame
      node={payload.node}
      selected={payload.selected}
      dimmed={payload.dimmed}
      onSelect={payload.onPick}
      onCollapse={payload.onCollapse}
      onFocus={payload.onFocus}
      onMenu={payload.onMenu}
    />
  );
}

const NODE_TYPES = { arch: ArchNode, archgroup: GroupNode };
const EDGE_TYPES = { elbow: ElbowEdge };

/**
 * THE RENDERER'S BADGE IS OFF, AND THE LICENCE IS HONOURED WHERE IT ASKS TO BE.
 *
 * `@xyflow/react` is **MIT** (`LICENSE`, "Copyright (c) 2019-2025 webkid GmbH",
 * read in `node_modules`, not assumed). MIT's one condition is that the
 * copyright notice and permission notice "be included in all copies or
 * substantial portions of the Software" — a condition on what SHIPS, not on
 * what is painted in the corner of the canvas. The package itself provides this
 * flag for the purpose. Hiding the badge is permitted; dropping the notice would
 * not be, so the notice is carried in `docs/THIRD-PARTY-NOTICES.md` and
 * `tools/ci/third-party-notices.test.mjs` fails the build if this flag is set
 * without it.
 *
 * This replaces a comment in `board.css` that called it "a licence question" and
 * moved the badge to an unused corner rather than answering it. The question has
 * an answer, and it is written above.
 *
 * Defined at module scope: a `proOptions` object rebuilt per render trips
 * @xyflow's own error 002, the same reason `NODE_TYPES` and `EDGE_TYPES` live
 * here.
 */
const PRO_OPTIONS = { hideAttribution: true } as const;

const NO_SIZES: Readonly<Record<string, { w: number; h: number }>> = {};

/**
 * THE HANDLES ARE DECLARED TOO, AND WITHOUT THIS THE BOARD DRAWS NO CONNECTORS.
 *
 * `rfNodes` already declares `width`/`height` so the first frame is the right
 * size. That is half a decision. @xyflow decides whether an edge can be drawn at
 * all with `isNodeInitialized`, read from the installed source
 * (@xyflow/system 0.0.79):
 *
 *     node && !!(node.internals.handleBounds || node.handles?.length)
 *          && !!(node.measured.width || node.width || node.initialWidth)
 *
 * The size clause passed. The handle clause did not: `internals.handleBounds` is
 * populated by the ResizeObserver measuring pass, and a node handed explicit
 * dimensions does not go through it. `getEdgePosition` then returns null and
 * `EdgeWrapper` renders nothing — SILENTLY. The 008 error it can raise is for a
 * missing handle ID, not for this, so React Flow's own `onError` stays quiet.
 *
 * Measured before the fix: 11 nodes drawn, `data-edge-count="1"`, the store
 * holding exactly 1 edge with the right id, `routeEdges` returning a real path,
 * and `.react-flow__edges` empty. A plain default-type edge between the same two
 * nodes did not render either.
 *
 * `node.handles` is the documented second half of that clause and
 * `toHandleBounds` consumes it, so declaring the eight is the same decision the
 * box already makes, applied to the thing the renderer actually gates on.
 * Measurement still wins when it lands — `internals.handleBounds ||` is checked
 * first — so this is a floor, never an override.
 *
 * Width and height are 0 so the anchor is the exact edge midpoint:
 * `getHandlePosition` adds `width`/`height` back for right and bottom, and
 * `toHandleBounds` only defaults them when they are null or undefined.
 */
function declaredHandles(w: number, h: number): NodeHandle[] {
  const at: Record<string, { x: number; y: number }> = {
    t: { x: w / 2, y: 0 },
    r: { x: w, y: h / 2 },
    b: { x: w / 2, y: h },
    l: { x: 0, y: h / 2 },
  };
  return HANDLE_SIDES.flatMap(([position, key]) => [
    { id: `s-${key}`, type: 'source' as const, position, ...at[key]!, width: 0, height: 0 },
    { id: `t-${key}`, type: 'target' as const, position, ...at[key]!, width: 0, height: 0 },
  ]);
}

/* ══════════════════════════════════════════════════════════════════════════ */

export function Board(props: BoardProps) {
  // The provider is the renderer's own context and has to wrap the flow it
  // serves. It is here rather than in App.tsx so that mounting the board is one
  // import, and so a render test can mount it without knowing the renderer
  // exists.
  return (
    <ReactFlowProvider>
      <BoardInner {...props} />
    </ReactFlowProvider>
  );
}

function BoardInner({
  canvas,
  nodes,
  edges,
  positions,
  dispatch,
  onGround,
  onExplain,
  onMenu,
  ghostNodeIds,
  attachFitKey = null,
  drawing,
  onToggleDrawing,
  renderOverlay,
  renderDrawCapture,
  onStroke,
  onFurnitureBand,
  onFlowReady,
  empty = null,
  edgeless = null,
  onDismissEdgeless,
  onOpenNode,
  openableNodeIds,
  sizes = NO_SIZES,
  elkRoutes,
  rowLabels,
  arranged = true,
  onArrangedFit,
  fitReportSeq = 0,
  onCollapseNode,
  onFocusNode,
  onEdgeClick,
  fitRequest = null,
  exportRequest = 0,
  onExported,
  derivedOn = false,
  onToggleDerived,
  derivedCount = 0,
  layoutDirection = null,
  onLayoutDirection,
  /* FALSE HERE IS NOT A1 REVERSED. A1 is a PRODUCT default and it is applied
     where the product knows which board this is — `ConnectedBoard` reads
     `readBoardVisual`, which answers ON for an absent, corrupt or unreadable
     record. A bare `<Board>` in a specimen or a chassis test has no board
     identity and no storage to consult, and defaulting it ON there would make
     every existing card assertion depend on a dynamic import resolving. */
  visual = false,
  onToggleVisual,
  onOpenRepoAnatomy,
  anatomy = null,
  anatomyKind,
  onCloseAnatomy,
  ghostFitKey = null,
  playback = null,
  focusRequest = null,
  onBack,
}: BoardProps) {
  const root = useRef<HTMLDivElement | null>(null);
  const { screenToFlowPosition } = useReactFlow();
  /* Live drag position — controlled nodes only move when this updates. */
  const [dragPos, setDragPos] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  /* Where the press that may become a drag landed, and the catch-up it owes (see dragCatchUp). */
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
  const catchUp = useRef({ x: 0, y: 0 });
  /* The dock's overflow menu (narrow boards: board.css hides the optional
     buttons and shows ⋯ instead, so the dock stays one row). */
  const [dockMenu, setDockMenu] = useState(false);
  /* ── HOLD SPACE TO PAN (round 7, C.5) ───────────────────────────────────
     In Select and in Draw: while Space is held, a drag anywhere on the board
     pans it (cards included), the pointer says grab, and Draw's capture layer
     lets go until Space is released. Only when the board has focus or the
     pointer is over it, and never while typing in a field. */
  const [spaceHeld, setSpaceHeld] = useState(false);
  const pointerOver = useRef(false);
  useEffect(() => {
    const isSpace = (e: globalThis.KeyboardEvent) => e.code === 'Space' || e.key === ' ';
    const down = (e: globalThis.KeyboardEvent) => {
      if (!isSpace(e) || isTypingTarget(e.target)) return;
      const el = root.current;
      if (!el) return;
      const target = e.target as EventTarget | null;
      const onBoard = target === el || (target === document.body && pointerOver.current);
      /* A focused control inside the board (a card's own select button, a
         dock button) keeps Space for itself. */
      if (!onBoard) return;
      e.preventDefault();
      if (!e.repeat) setSpaceHeld(true);
    };
    const up = (e: globalThis.KeyboardEvent) => {
      if (isSpace(e)) setSpaceHeld(false);
    };
    const blur = () => setSpaceHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);
  useEffect(() => {
    onFlowReady?.({
      screenToFlow: (point) => screenToFlowPosition(point),
    });
  }, [onFlowReady, screenToFlowPosition]);
  /* Latch for post-attach fit — see the effect below `ghostKey`. */
  const fittedAttachKey = useRef<string | null>(null);
  const sawLayingOut = useRef(false);
  const awaitedFitKey = useRef<string | null>(null);
  const nodesAtKeyChange = useRef<typeof nodes | null>(null);
  /* The camera the last automatic fit produced; see the resize re-fit. */
  const autoFitPending = useRef(false);
  const lastAutoView = useRef<{ x: number; y: number; zoom: number } | null>(null);

  /* ── THE FRAME (sheet 08.1) ──────────────────────────────────────────────
     "The budget is the frame, not a node count." The frame is measured, never
     assumed: v1's DEFAULT_MAX_CARDS = 24 was derived once, at authoring time,
     for a 1400 x 900 canvas — and a three-pane shell at 1280 gives this pane
     about 614. A ResizeObserver is used rather than a window `resize` listener
     because the pane changes width when the reader drags the chat's grip, and
     the window never hears about that. */
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    /* MEASURE NOW, SYNCHRONOUSLY — then observe for changes. The observer's
       "initial" delivery rides the rendering pipeline, and a pane that is not
       compositing frames (a background tab, a hidden panel, a headless run)
       never receives one: the board then computes every fit against a 0×0
       frame and the Fit control is dead until something resizes. Measured:
       an observer on this very element delivered zero callbacks in a
       non-compositing pane while getBoundingClientRect read 500×639. */
    const reportBand = (): void => {
      if (!onFurnitureBand) return;
      const furn = element.querySelector('.boardfurniture');
      if (!furn) return;
      const rect = furn.getBoundingClientRect();
      const tops = [...furn.children]
        .map((child) => child.getBoundingClientRect())
        .filter((r) => r.height > 0 && r.width > 0)
        .map((r) => r.top);
      if (tops.length === 0) return;
      const band = rect.bottom - Math.min(...tops);
      if (band > 0 && band < rect.height) onFurnitureBand(band);
    };
    const box = element.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) {
      dispatch({ type: 'canvas/frame', width: box.width, height: box.height });
    }
    reportBand();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const next = element.getBoundingClientRect();
      dispatch({ type: 'canvas/frame', width: next.width, height: next.height });
      reportBand();
    });
    observer.observe(element);
    const furnEl = element.querySelector('.boardfurniture');
    if (furnEl) observer.observe(furnEl);
    return () => observer.disconnect();
  }, [dispatch, onFurnitureBand]);

  /* ── THE BOXES, BUILT ONCE ───────────────────────────────────────────────
     One map, one pass, shared by the router, the fit policy and the hit
     regions — so an edge endpoint, a camera bounds and a card can never
     disagree about where anything is. `canvas.positions` (what the reader
     dragged) overrides the layout's own answer, per node. */
  /* VISUAL IS AN INPUT TO THE GEOMETRY, not just to the paint. The strip and
     the parts line are real rows, so the router, the fit bounds and the
     declared @xyflow box all have to be told — a card measured without them is
     `cardBox.ts`'s own 160x96 defect with a new cause. ANATOMY IS GEOMETRY TOO,
     for the same reason. A member of an expanded group is placed relative to
     its group (`nestedBoxes`); the boxes here are absolute. */
  /* On the far rungs each card reserves its condensed title at the board's
     largest far scale (cardBox.ts farTitleScaleMax), as the layout did. */
  const farScale = useMemo(
    () => (!visibilityAt(canvas.rung).title && visibilityAt(canvas.rung).shortTitle ? boardFarScale(nodes) : undefined),
    [canvas.rung, nodes],
  );
  const boxes = useMemo<CardBox[]>(
    () =>
      nestedBoxes(
        nodes,
        positions,
        sizes,
        (id, laid) => boardNodePosition(id, dragPos, canvas.positions, laid),
        canvas.rung,
        visual,
        anatomy ?? null,
        farScale,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, positions, sizes, canvas.positions, canvas.rung, dragPos, visual, anatomy?.nodeId, farScale],
  );
  /* THE GLIDE (useInterpolatedPositions): cards move to a new arrangement
     over 240ms. `boxes` above are where they are GOING — the router, the fit
     and the hit regions use those; `shownBoxes` are where they are drawn this
     frame. Connectors are hidden until the glide lands. */
  const glide = useInterpolatedPositions(positions);
  const shownBoxes = useMemo<CardBox[]>(
    () =>
      glide.animating
        ? nestedBoxes(
            nodes,
            glide.positions,
            sizes,
            (id, laid) => boardNodePosition(id, dragPos, canvas.positions, laid),
            canvas.rung,
            visual,
            anatomy ?? null,
            farScale,
          )
        : boxes,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [glide, boxes],
  );
  const boxIndex = useMemo(() => new Map(shownBoxes.map((box) => [box.id, box])), [shownBoxes]);

  /* ROUND 7, C.3 — A ROW LABEL FOLLOWS ITS CARDS. The label is placed from
     where its members are now (dragged, nudged or saved), measured against
     where the layout laid them; see rowLabels.ts. The laid boxes are built
     only when a row names its members. */
  const rowsFollow = Boolean(rowLabels?.some((row) => row.ids && row.ids.length > 0));
  const laidIndex = useMemo(
    () =>
      rowsFollow
        ? new Map(
            nestedBoxes(nodes, positions, sizes, (_id, laid) => laid, canvas.rung, visual, anatomy ?? null, farScale).map(
              (box) => [box.id, box],
            ),
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rowsFollow, nodes, positions, sizes, canvas.rung, visual, anatomy?.nodeId, farScale],
  );
  const shownRows = useMemo(
    () =>
      (rowLabels ?? []).flatMap((row) => {
        const at = laidIndex ? followRowLabel(row, boxIndex, laidIndex) : { x: row.x, y: row.y, count: row.count };
        return at ? [{ text: row.text, ...at }] : [];
      }),
    [rowLabels, laidIndex, boxIndex],
  );
  const depth = useMemo(() => depthOf(nodes), [nodes]);


  /* ONE TITLE SIZE ON THE WHOLE BOARD (coordinator ruling, round 3;
     titleFit.ts): every card's title is drawn at one size at a given zoom,
     whatever its kind. The full name wraps inside its card to at most two
     lines at word breaks, and only then is shortened in the middle. At the
     far rungs the shared scale is the smallest two-line fit on the board,
     held to 1/zoom and the 9 px floor; at the near rungs the size is the
     ramp's own and only the two-line text is computed. Recomputed on zoom
     steps of 5%. */
  const zoomStep = Math.round(canvas.viewport.zoom * 20) / 20;
  const farRung = !visibilityAt(canvas.rung).title && visibilityAt(canvas.rung).shortTitle;
  const nearRung = visibilityAt(canvas.rung).title;
  const farTitleText = useMemo(() => {
    const out = new Map<string, { text: string; fit: number | undefined; defRoom: number | undefined }>();
    if (!farRung && !nearRung) return out;
    const measure = (t: string) => measureWithCanvas(t, titleFont());
    /* The words' own room: the card less its pads and the icon chip, which
       keeps its size on the far rungs while the words are counter-scaled. */
    const cards = nodes.flatMap((node, i) =>
      node.group ? [] : [{ id: node.id, text: displayLabel(node.label), contentW: (boxes[i]?.w ?? CARD_W) - 22 - CHIP_INSET }],
    );
    const boardFit = farRung ? boardTitleFit(cards, measure) : 1;
    if (boardFit === undefined) return out;
    /* Capped where the card reserves room for it (cardBox.ts farTitleScaleMax). */
    const fit = farRung ? farTitleScaleMax(boardFit) : 1;
    const z = Math.max(zoomStep, 0.25);
    const scale = farRung ? Math.min(Math.max(Math.min(1 / z, fit), 9 / (14 * z)), fit) : 1;
    /* The definition's room at this scale too: the line is cut by nothing
       the reader can see, so the card picks a line that fits it whole. */
    const measurable = Number.isFinite(measure('x'));
    for (const c of cards) {
      out.set(c.id, { text: twoLineText(c.text, c.contentW / scale, measure), fit, defRoom: measurable ? c.contentW / scale : undefined });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farRung, nearRung, zoomStep, nodes, boxes]);

  /* FAR LABELS THAT COLLIDE YIELD — only on the far rungs, where the title is
     counter-scaled to screen size and the cards' spacing is not. See
     `farLabels.ts` for the measurement (photo 2, 2026-09-22). */
  const farTitles = !visibilityAt(canvas.rung).title && visibilityAt(canvas.rung).shortTitle;
  const zoomForLabels = canvas.viewport.zoom;
  const yieldingLabels = useMemo(() => {
    if (!farTitles) return new Set<string>();
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    return farLabelsToYield(
      /* A group frame paints no far title: its header is its label, drawn on
         the frame's top edge at about 14px on screen (board.css, far zoom).
         It never yields, and a title that would sit on it does. */
      nodes.flatMap((node, index) => {
        const box = boxes[index]!;
        if (node.group) {
          const z = Math.max(zoomForLabels, 0.25);
          const w = Math.min((node.label.length * 7.5 + 16) / z, box.w);
          return [{ id: node.id, cx: box.x + w / 2, cy: box.y - 8 / z, text: node.label, degree: 0, selected: true, maxW: w }];
        }
        return [{
          id: node.id,
          cx: box.x + box.w / 2,
          cy: box.y + box.h / 2,
          text: farTitleText.get(node.id)?.text ?? displayLabel(node.label),
          degree: degree.get(node.id) ?? 0,
          selected: canvas.selection.nodeIds.includes(node.id),
          maxW: box.w - 22,
        }];
      }),
      zoomForLabels,
    );
  }, [farTitles, zoomForLabels, nodes, boxes, edges, farTitleText, canvas.selection.nodeIds]);

  const rfNodes = useMemo<Node[]>(
    () =>
      nodes.map((node, index): Node => {
        const box = shownBoxes[index]!;
        /* A MEMBER IS PLACED RELATIVE TO ITS GROUP, which is what @xyflow
           expects of a node with a `parentId` — so dragging the group carries
           its members. */
        const parent = node.parentId ? boxIndex.get(node.parentId) : undefined;
        const position = parent ? { x: box.x - parent.x, y: box.y - parent.y } : { x: box.x, y: box.y };
        const nesting = parent ? { parentId: parent.id, extent: 'parent' as const } : {};
        const isSelected = canvas.selection.nodeIds.includes(node.id);
        if (node.group) {
          return {
            id: node.id,
            type: 'archgroup',
            position,
            ...nesting,
            width: box.w,
            height: box.h,
            handles: declaredHandles(box.w, box.h),
            selected: isSelected,
            zIndex: -1,
            data: {
              node,
              selected: isSelected,
              dimmed: canvas.dim ? !canvas.dim.litNodeIds.includes(node.id) : false,
              onPick: (id: string, additive: boolean) => {
                dispatch({ type: 'canvas/select', nodeId: id, additive });
                onExplain?.(id);
                onGround(node);
              },
              onCollapse: onCollapseNode,
              onFocus: onFocusNode,
              onMenu,
            } satisfies GroupNodeData,
          };
        }
        return {
          id: node.id,
          type: 'arch',
          position,
          ...nesting,
          /* THE BOX IS DECLARED, NOT DISCOVERED. @xyflow measures a node with a
             ResizeObserver and derives every edge endpoint from what it
             measured; until the first measurement lands, `measured` is
             undefined and EdgeWrapper drops the edge. Handing it the box we
             already computed means the first frame draws the same picture as
             the second — and it is not a guess: `cardHeight` is the card's own
             arithmetic off the type ramp, which is what the card then paints.
             v1's equivalent is a hardcoded 160 x 96, over-tall by up to 58px on
             a one-line card. */
          width: box.w,
          height: box.h,
          // The other half of @xyflow's `isNodeInitialized` — see declaredHandles.
          handles: declaredHandles(box.w, box.h),
          selected: canvas.selection.nodeIds.includes(node.id),
          data: {
            node: {
              ...node,
              shortLabel: farTitleText.get(node.id)?.text,
              titleText: nearRung ? farTitleText.get(node.id)?.text : undefined,
              cardW: box.w,
              farFit: farTitleText.get(node.id)?.fit,
              defRoom: farTitleText.get(node.id)?.defRoom,
            },
            selected: canvas.selection.nodeIds.includes(node.id),
            // DIMMING IS NOT A SELECTION EFFECT — except when it IS, by
            // Decision 6. `canvas.dim` is written by playback, by explicit
            // path-focus, and now by an explicit selection resolved through
            // `selectionDim` and dispatched as `canvas/dim`; the card reads it
            // the same way whichever ask produced it.
            dimmed: canvas.dim ? !canvas.dim.litNodeIds.includes(node.id) : false,
            // THE STATUS DOT — Decision 6, sheet 06.1. The loudest state wins:
            // the current hop's card is selected AND on-path, and sheet 06.1's
            // monotonic order puts selection above both. At rest there is no
            // path being read, so there is no dot.
            dot: canvas.selection.nodeIds.includes(node.id)
              ? ('selected' as DotState)
              : canvas.dim === null
                ? null
                : canvas.dim.litNodeIds.includes(node.id)
                  ? ('onpath' as DotState)
                  : ('offpath' as DotState),
            rung: canvas.rung,
            visual,
            anatomy: anatomy?.nodeId === node.id ? anatomy : null,
            anatomyKind,
            onCloseAnatomy,
            onPick: (id: string, additive: boolean) => {
              dispatch({ type: 'canvas/select', nodeId: id, additive });
              /*
               * AND ASK THE RAIL WHY THIS NODE IS THERE.
               *
               * `NodeDetailPanel` answers exactly the question a person clicks
               * a card to ask - what this is, and where each of its edges was
               * traced from, file and line. It was built, tested, and reachable
               * only by clicking the same node a SECOND time over in the rail.
               *
               * THROUGH A PROP, not `dispatch`: this board's dispatch is
               * narrowed to canvas actions on purpose, and reaching into
               * another lane's slice from here would be the board owning what
               * the rail shows. Same rule `onGround` follows.
               */
              onExplain?.(id);
              // THE ONE ACTION. Selecting a grounded node and grounding the
              // composer on it are the same gesture, so there is exactly one
              // chip per click and no second control to find.
              onGround(node);
            },
            onMenu,
            onOpen: onOpenNode,
            openable: openableNodeIds?.has(node.id) ?? false,
            ghost: ghostNodeIds?.includes(node.id) ?? false,
            labelYields: yieldingLabels.has(node.id),
          } satisfies ArchNodeData,
        };
      })
        /* @xyflow wants a group before its members. Stable, so a board with
           no group keeps its order exactly. */
        .map((rf, index) => ({ rf, index, d: depth.get(rf.id) ?? 0 }))
        .sort((a, b) => a.d - b.d || a.index - b.index)
        .map(({ rf }) => rf),
    [
      nodes,
      shownBoxes,
      boxIndex,
      depth,
      onExplain,
      onCollapseNode,
      onFocusNode,
      canvas.selection.nodeIds,
      canvas.dim,
      canvas.rung,
      dispatch,
      onGround,
      onMenu,
      onOpenNode,
      openableNodeIds,
      ghostNodeIds,
      visual,
      anatomy,
      anatomyKind,
      onCloseAnatomy,
      yieldingLabels,
      farTitleText,
    ],
  );

  /* ── THE ROUTES, ALSO BUILT ONCE ─────────────────────────────────────────
     `routeEdges` is pure and takes the box list as an argument, so a second
     box map cannot appear inside a connector without changing its signature.
     `routes.test.ts` asserts the identity of the array handed to each route. */
  /* SHEET 06.6 — THE PATH IS PROMOTED BEFORE ANYTHING IS DIMMED. "Contrast is
     won by making the answer louder, not by making the rest illegible", and the
     sheet is explicit about the order: the edges on the path take
     --flow-onflow at --w-flow FIRST, and only then does the off-path card
     recede to --board-dim-opacity.

     `onflow` is not a new vocabulary — `EdgeProof` has carried it since item
     3.3 and `.e-onflow` has been in board.css since, with nothing ever setting
     it. This is the line that sets it. It is derived at render off
     `canvas.dim.litEdgeIds` rather than stored on the edge, because a proof
     that was WRITTEN onto the document would still be there after the flow was
     cleared, and the reader would be looking at a promoted path with nothing
     playing. */
  const promoted = useMemo(() => promoteOnFlow(edges, canvas.dim), [edges, canvas.dim]);

  /* THE TAG OBEYS THE LADDER, AND ASKS IT RATHER THAN GUESSING. §05.8's first
     row is `.edgetag` at --t-10, threshold 1.00 — the first ink to leave. The
     rung is live camera state, so this recomputes with the zoom and the router
     never sees a number this board invented. */
  const showEdgeTags = visibilityAt(canvas.rung).edgeTag;

  const rfEdges = useMemo<Edge[]>(
    () =>
      routeEdges(promoted, boxes, showEdgeTags, elkRoutes).map((routed) => ({
        id: routed.id,
        type: 'elbow',
        source: routed.source,
        target: routed.target,
        // The eight handles are what @xyflow measures the endpoint off; the ids
        // have to name ones the card actually renders or EdgeWrapper bails
        // before ElbowEdge ever mounts.
        sourceHandle: 's-r',
        targetHandle: 't-l',
        data: routed.data,
      })),
    [promoted, boxes, showEdgeTags, elkRoutes],
  );

  /* ── THE CAMERA ──────────────────────────────────────────────────────────
     Controlled. `viewport` in, `onViewportChange` out, and the reducer clamps
     — which is what makes sheet 05.9's assertion 5 ("clamped on EVERY path —
     gesture, button, key and fit alike") true rather than aspirational. */
  const onViewportChange = useCallback(
    (viewport: RfViewport) => dispatch({ type: 'canvas/viewport', viewport }),
    [dispatch],
  );

  const fitBounds = useCallback(
    (ids: readonly string[]) => {
      const chosen = ids.length
        ? boxes.filter((box) => ids.includes(box.id))
        : boxes;
      const rects = chosen.map((box) => ({ x: box.x, y: box.y, width: box.w, height: box.h }));
      /* The whole board's fit holds its lines too: ELK routes a line around
         the cards, outside their union, and a fit on boxes alone put it on
         the pane's edge (codeforge's Mcp line, stream 3b review). */
      if (!ids.length && elkRoutes) {
        for (const pts of Object.values(elkRoutes)) for (const p of pts) rects.push({ x: p.x, y: p.y, width: 0.001, height: 0.001 });
      }
      return unionBounds(rects);
    },
    [boxes, elkRoutes],
  );

  /* FIT AND ZOOM-TO-SELECTION ARE ONE OPERATION WITH DIFFERENT BOUNDS, and
     therefore one action carrying different bounds — never two policies. v1's
     Fit BUTTON uses padding 0.10 / maxZoom 2.50 while its programmatic fit uses
     0.20 / 1.00, so a three-node graph auto-fits at 100% and jumps to 250% the
     moment the reader presses the control that is supposed to do the same
     thing. */
  /**
   * The edgeless note's box, measured, or null when it is not rendered.
   *
   * FINDING F2: the note is `position: absolute; left: 12px; top: 12px` with a
   * `--pane-w` max-width, so it sits exactly where the first cards land — 94% of
   * two cards covered on load in the shipped bundle, and 26% still covered after
   * Fit. The fit now moves content clear of it, which it can only do if it knows
   * where it is. Measured rather than derived from tokens because the note's
   * HEIGHT depends on how much text it carries.
   */
  const noteBox = useCallback((): Bounds | null => {
    /* EITHER NOTE, because only one is ever rendered and both sit in the same
       gutter. Naming only the edgeless one here would have let the flow note —
       added by item playback, same chassis, same corner — cover the very cards
       the camera was moving to put under it. */
    const el = root.current?.querySelector(
      '[data-testid="board-edgeless"], [data-testid="board-flow-note"]',
    );
    const el2 = root.current;
    if (!el || !el2) return null;
    const n = el.getBoundingClientRect();
    const r = el2.getBoundingClientRect();
    if (n.width <= 0 || n.height <= 0) return null;
    return { x: n.left - r.left, y: n.top - r.top, width: n.width, height: n.height };
  }, []);

  /**
   * The furniture row's measured band — legend + tools, one or two wrapped
   * lines along the bottom. Measured because its height depends on how many
   * lines the pane width forced; the P1 screenshot audit caught the KINDS
   * pill sitting on a card because the fit assumed a fixed inset.
   */
  const chromeBands = useCallback((): { top?: number; bottom?: number; left?: number } | null => {
    /* THE CONTROLS FLOAT OVER THE BOARD'S TOP-LEFT (Decision 49, board.css
       .board-controls), so their bottom edge is the fit's top band: no card
       is laid under the view pills, Find or More. */
    const frame = root.current?.getBoundingClientRect();
    const controls = root.current?.parentElement?.querySelector(':scope > .board-controls');
    const ctl = controls?.getBoundingClientRect();
    const top =
      frame && ctl && ctl.height > 0 && ctl.bottom > frame.top ? Math.ceil(ctl.bottom - frame.top) + 8 : undefined;
    /* THE CONTAINER IS THE WHOLE PANE (`inset: 0`) — the band is its CONTENT.
       Measuring the container handed fitViewport a band taller than the frame,
       every banded fit returned null, and the hop camera silently stopped
       moving (caught by flow-plays' "the camera moved" check). The band is
       from the top of the highest visible furniture row to the pane's bottom
       edge. */
    const el = root.current?.querySelector('.boardfurniture');
    /* THE DRAW PALETTE IS A COLUMN AT THE LEFT while Draw is on: content is fitted to the right of it, so no card is
       laid under a tool. */
    const pal = root.current?.parentElement?.querySelector('.annot-palette');
    const palRect = pal?.getBoundingClientRect();
    const left =
      frame && palRect && palRect.width > 0 ? Math.ceil(palRect.right - frame.left) + 8 : undefined;
    const withTop = (bands: { bottom?: number } | null) => {
      const out = { ...(bands ?? {}) } as { top?: number; bottom?: number; left?: number };
      if (top !== undefined) out.top = top;
      if (left !== undefined) out.left = left;
      return top === undefined && left === undefined ? bands : out;
    };
    if (!el) return withTop(null);
    const rect = el.getBoundingClientRect();
    const tops = [...el.children]
      .map((child) => child.getBoundingClientRect())
      .filter((r) => r.height > 0 && r.width > 0)
      .map((r) => r.top);
    if (tops.length === 0) return withTop(null);
    const band = rect.bottom - Math.min(...tops);
    return withTop(band > 0 && band < rect.height ? { bottom: band } : null);
  }, []);

  const fitAll = useCallback(
    () =>
      dispatch({
        type: 'canvas/fit',
        bounds: fitBounds([]),
        reserve: noteBox(),
        bands: chromeBands(),
      }),
    [dispatch, fitBounds, noteBox, chromeBands],
  );

  /* Entering Draw puts the palette column over the board's left edge. If it lands on a card, fit again with the column
     reserved (chromeBands), so Draw never opens with a tool covering content. */
  useEffect(() => {
    if (!drawing) return undefined;
    /* The palette is a lazy chunk: wait (bounded) for it to be in the document. */
    let id = 0;
    let tries = 0;
    const look = () => {
      const pal = root.current?.parentElement?.querySelector('.annot-palette');
      if (!pal) {
        if (++tries < 60) id = requestAnimationFrame(look);
        return;
      }
      const pr = pal.getBoundingClientRect();
      const hit = [...(root.current?.querySelectorAll('[data-testid="board-node"]') ?? [])].some((n) => {
        const r = n.getBoundingClientRect();
        return r.right > pr.left && r.left < pr.right && r.bottom > pr.top && r.top < pr.bottom;
      });
      if (hit) fitAll();
    };
    id = requestAnimationFrame(look);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing]);

  const fitSelection = useCallback(
    () =>
      dispatch({
        type: 'canvas/fit',
        // With nothing selected this is fit-all, never a no-op that leaves the
        // reader wondering whether the key registered.
        bounds: fitBounds(canvas.selection.nodeIds),
        reserve: noteBox(),
        bands: chromeBands(),
      }),
    [dispatch, fitBounds, canvas.selection.nodeIds, noteBox, chromeBands],
  );

  /* A FIT SOMEONE ASKED FOR (search: Enter fits the matches). Keyed on the
     request's own sequence number, so asking twice fits twice. */
  const fitSeq = fitRequest?.seq ?? 0;
  useEffect(() => {
    if (!fitRequest) return;
    dispatch({
      type: 'canvas/fit',
      bounds: fitBounds(fitRequest.ids),
      reserve: noteBox(),
      bands: chromeBands(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSeq]);

  /* ══ PNG EXPORT — the whole board, not the camera's crop ═════════════════
     The React Flow pattern (its free "download image" example): render the
     viewport element with html-to-image at a transform that fits every card
     into the image, at 2x for a sharp result. Loaded on demand, so the
     library costs the boot nothing. */
  useEffect(() => {
    if (!exportRequest) return;
    const host = root.current?.querySelector<HTMLElement>('.react-flow__viewport');
    const bounds = fitBounds([]);
    if (!host || !bounds) {
      onExported?.({ error: 'Nothing on the board to export.' });
      return;
    }
    const pad = 32;
    const width = Math.max(1, Math.ceil(bounds.width + pad * 2));
    const height = Math.max(1, Math.ceil(bounds.height + pad * 2));
    const background = getComputedStyle(root.current!).getPropertyValue('--bg-base').trim() || undefined;
    let live = true;
    void import('html-to-image')
      .then(({ toPng }) =>
        toPng(host, {
          width,
          height,
          pixelRatio: 2,
          backgroundColor: background,
          style: {
            width: `${width}px`,
            height: `${height}px`,
            transform: `translate(${pad - bounds.x}px, ${pad - bounds.y}px) scale(1)`,
          },
        }),
      )
      .then((dataUrl) => {
        if (live) onExported?.({ dataUrl, width, height });
      })
      .catch((e: unknown) => {
        if (live) onExported?.({ error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportRequest]);

  /* ══ ITEM playback — THE CAMERA GOES TO THE HOP ═════════════════════════

     THE MOVE IS THE OTHER HALF OF THE CLAIM. Dimming alone would leave a
     reader who is scrolled elsewhere watching a board that got quieter for no
     visible reason; sheet 06.7 budgets --seq-dur-cam for exactly this — "the
     camera moving to fit a selection".

     IT GOES THROUGH `canvas/fit`, THE SAME ACTION THE 1 AND 2 KEYS USE. v1
     shipped two fit policies — the button at padding 0.10 / maxZoom 2.50 and
     the programmatic one at 0.20 / 1.00 — so the same graph landed at two
     different zooms depending on which thing asked. There is one policy here
     and playback is not allowed a second.

     THE DEPENDENCY IS THE HOP, NOT THE SELECTION. Keying on
     `canvas.selection.nodeIds` would re-fit every time the reader clicked a
     card, which is a camera moving on its own. `playback.index` and
     `playback.to` change once per hop and only while a flow is playing, so the
     board is still under the reader's hand at every other moment.

     A HOP THE BOARD CANNOT PLACE MOVES NOTHING. `fitBounds` on an id no box
     carries returns null bounds, and `canvas/fit` already leaves the camera
     where it was rather than moving it "somewhere arithmetically defensible and
     visually wrong". The note below says what happened instead. */
  const hopTarget = playback?.to ?? playback?.from ?? null;
  const hopIndex = playback?.index ?? -1;
  /* C4.1 — sheet 11.6 / 06.7: a camera the board moves on its own glides over
     --seq-dur-cam (240ms) instead of jumping; freehand pan stays immediate.
     board.css drops the transition under prefers-reduced-motion. */
  const camTimer = useRef<number | null>(null);
  const easeCamera = useCallback(() => {
    const host = root.current;
    if (!host) return;
    host.setAttribute('data-cam-animating', 'true');
    let ms = 240;
    const raw = getComputedStyle(host).getPropertyValue('--seq-dur-cam').trim();
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed) && parsed > 0) ms = Math.min(parsed, 250);
    if (camTimer.current !== null) window.clearTimeout(camTimer.current);
    camTimer.current = window.setTimeout(() => {
      camTimer.current = null;
      host.removeAttribute('data-cam-animating');
    }, ms);
  }, []);
  useEffect(
    () => () => {
      if (camTimer.current !== null) window.clearTimeout(camTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (hopTarget === null) return;
    easeCamera();
    dispatch({
      type: 'canvas/fit',
      bounds: fitBounds([hopTarget]),
      reserve: noteBox(),
      bands: chromeBands(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hopTarget, hopIndex, dispatch]);

  /* ══ ROUND 7, C.4 — OPENING SOMETHING FRAMES IT, READABLY ════════════════
     Jaden: "Shouldn't zoom out that hard when you expand a certain object...
     the focused view of the actual microservice to be a little bit more
     direct." Expanding a group, opening an anatomy wall and drilling into a
     level each change the arrangement, and the board used to answer every
     new arrangement by fitting the WHOLE board — so expanding one service on
     a big repo zoomed out until its titles were specks.

     Now the host says what was opened (`focusRequest`) and the next automatic
     fit frames THAT, at no less than FOCUS_MIN_ZOOM (a 12px title), centred
     when it fits and pinned top-left below the toolbar when it does not,
     eased over --seq-dur-cam. The hold lasts until the reader moves the
     camera or another arrangement lands without a request, so a re-fit for
     the same arrangement (the resize refit) keeps the focus too. */
  const pendingFocus = useRef<{ id: string | null; seq: number } | null>(null);
  const heldFocus = useRef<{ id: string | null } | null>(null);
  const focusSeq = focusRequest?.seq ?? 0;
  useEffect(() => {
    if (focusRequest) pendingFocus.current = focusRequest;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSeq]);
  /*
   * "SHOW INSIDE" FRAMES WHAT IT OPENED, NOW (0.1.8.1 C8, audit P2-7: it opened at 49 %, unreadable). A request marked
   * `now` does not wait for the next automatic fit, which an open wall does not always cause: once the layout is not
   * running, the node is framed to its content at no less than SHOW_INSIDE_MIN_ZOOM. The reader zooms out from there.
   */
  const fitNow = useRef<string | null>(null);
  useEffect(() => {
    if (focusRequest?.now && focusRequest.id) fitNow.current = focusRequest.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSeq]);
  useEffect(() => {
    const id = fitNow.current;
    if (!id || canvas.layout === 'laying-out') return;
    if (!boxes.some((box) => box.id === id)) return;
    if (canvas.frame.width <= 0 || canvas.frame.height <= 0) return;
    fitNow.current = null;
    heldFocus.current = { id };
    easeCamera();
    dispatch({
      type: 'canvas/fit',
      bounds: fitBounds([id]),
      reserve: noteBox(),
      bands: chromeBands(),
      minZoom: Math.max(FOCUS_MIN_ZOOM, SHOW_INSIDE_MIN_ZOOM),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSeq, canvas.layout, boxes, canvas.frame.width, canvas.frame.height]);
  const autoFit = useCallback(() => {
    const held = heldFocus.current;
    if (held) {
      const target = held.id !== null && boxes.some((box) => box.id === held.id) ? [held.id] : [];
      easeCamera();
      dispatch({
        type: 'canvas/fit',
        bounds: fitBounds(target),
        reserve: noteBox(),
        bands: chromeBands(),
        minZoom: FOCUS_MIN_ZOOM,
      });
      return;
    }
    dispatch({ type: 'canvas/fit', bounds: fitBounds([]), reserve: noteBox(), bands: chromeBands() });
  }, [boxes, dispatch, easeCamera, fitBounds, noteBox, chromeBands]);

  /*
   * WHEN A TOPOLOGY PROPOSAL LANDS — fit the camera to the ghost nodes so the
   * reader sees what was drawn (owner seat-walk: old product pointed at the
   * board). Keyed on the ghost id set, not selection (S4 clears selection).
   */
  const ghostKey = ghostNodeIds?.join('\0') ?? '';
  const ghostFitLatch = ghostFitKey ?? ghostKey;
  useEffect(() => {
    if (!ghostNodeIds || ghostNodeIds.length === 0) return;
    dispatch({
      type: 'canvas/fit',
      bounds: fitBounds([...ghostNodeIds]),
      reserve: noteBox(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghostFitLatch, dispatch]);

  /*
   * POST-ATTACH — fit once after the first layout settles so attach does not
   * leave the default camera. Wait until we have seen `laying-out` (or until
   * layout failed) so we do not latch on the seed idle frame before ELK runs.
   * Frame must be measured — fit against a 0×0 pane is arithmetic nonsense.
   */
  useEffect(() => {
    if (!attachFitKey) {
      fittedAttachKey.current = null;
      sawLayingOut.current = false;
      awaitedFitKey.current = null;
      return;
    }
    /* A NEW KEY NAMES AN ARRANGEMENT THAT HAS NOT ARRIVED YET. `sawLayingOut`
       was reset only when the key went null, so when it CHANGED — a module
       opened inside an open service (builder's walk on ML Harness, 2026-09-22:
       Panes opened at 100% with cards off the right edge; Fit gave 61%) — the
       latch still held the previous arrangement's "yes, laid out", and this
       effect runs before the parent's layout effect has said `laying-out`. It
       fitted at once, against the boxes of the level being left, and the new
       level's layout landed under a camera that had already spent its one fit.
       So a changed key starts the wait again: the fit follows a layout this
       key has been seen to run, or boxes that have changed since the key did. */
    if (awaitedFitKey.current !== attachFitKey) {
      awaitedFitKey.current = attachFitKey;
      sawLayingOut.current = false;
      nodesAtKeyChange.current = nodes;
    }
    if (canvas.layout === 'laying-out') {
      sawLayingOut.current = true;
      return;
    }
    if (nodes.length === 0) return;
    if (canvas.frame.width <= 0 || canvas.frame.height <= 0) return;
    if (fittedAttachKey.current === attachFitKey) return;
    if (!sawLayingOut.current && canvas.layout === 'idle' && nodes === nodesAtKeyChange.current) return;

    fittedAttachKey.current = attachFitKey;
    autoFitPending.current = true;
    heldFocus.current = pendingFocus.current ? { id: pendingFocus.current.id } : null;
    pendingFocus.current = null;
    autoFit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachFitKey, canvas.layout, canvas.frame.width, canvas.frame.height, nodes, dispatch]);

  /* ══ THE PANE CHANGED SIZE AND THE READER HAD NOT MOVED THE CAMERA ════════
     The fit above follows a new ARRANGEMENT. A pane that only got narrower
     (a resizer drag, a window resize, a pane opening beside it) keeps the
     arrangement and used to keep a camera fitted to the old width: cards cut
     off at the right edge. So the board re-fits on resize — but only while
     the camera is still exactly where the last automatic fit put it. Once the
     reader pans or zooms, the camera is theirs. */
  useEffect(() => {
    if (!autoFitPending.current) return;
    autoFitPending.current = false;
    lastAutoView.current = canvas.viewport;
  }, [canvas.viewport]);
  /* AND WHEN A NEW ARRANGEMENT LANDS (an expand, or a resize that changed the
     pane's shape and so re-laid the board): a fit taken while the layout was
     still running measured the seed positions (stream 3b: opening the Agents
     panel left codeforge at 100%). So no refit while laying out, and one more
     when the positions arrive, still only while the camera is the board's. */
  useEffect(() => {
    if (boxes.length === 0) return;
    if (!shouldAutoRefit(lastAutoView.current, canvas.viewport, canvas.layout, arranged, canvas.frame)) return;
    autoFitPending.current = true;
    autoFit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas.frame.width, canvas.frame.height, arranged, canvas.layout]);

  /* THE FIT A FINISHED ARRANGEMENT NEEDS, reported once per arrangement and
     frame (not per zoom step: the boxes are the layout's, at rung 1 widths). */
  const lastReported = useRef('');
  useEffect(() => {
    if (!onArrangedFit || !arranged || canvas.layout === 'laying-out') return;
    if (canvas.frame.width <= 0 || canvas.frame.height <= 0 || boxes.length === 0) return;
    const b = fitBounds([]);
    if (!b) return;
    const bands = chromeBands();
    const key = `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)}|${canvas.frame.width}x${canvas.frame.height}|${fitReportSeq}`;
    if (key === lastReported.current) return;
    lastReported.current = key;
    onArrangedFit(rawFitZoom(b, canvas.frame, bands));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arranged, canvas.layout, positions, canvas.frame.width, canvas.frame.height, onArrangedFit, fitReportSeq]);

  /* ── THE KEYMAP (sheet 05.7) ─────────────────────────────────────────────
     CAMERA KEYS MOVE THE CAMERA AND NOTHING ELSE. No keystroke here changes the
     graph, so a reader who is lost can always press 1 and get the whole board
     back without having edited anything. */
  /* ROUND 7, C.5 — the keys follow the board's hint (boardKeys.ts BOARD_KEYS):
     0 fits, 1 is 100%, arrows walk the selection or move a focused card, and
     Esc steps back ONE level per press. A key typed into a field is never the
     board's. */
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isArrow(event.key)) {
        const target = event.target as HTMLElement;
        const focusedCard = target.closest?.('[data-testid="board-node-select"]')
          ? target.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null
          : null;
        if (focusedCard) {
          /* C.1 — the keyboard's drag: the focused card moves, its lines
             reroute, and the place is saved like a drop. */
          const laid = positions[focusedCard] ?? { x: 0, y: 0 };
          const at = boardNodePosition(focusedCard, null, canvas.positions, laid);
          const next = nudge(at, event.key, event.shiftKey);
          dispatch({ type: 'canvas/position', nodeId: focusedCard, x: next.x, y: next.y });
        } else {
          const cards = boxes.filter((box) => !box.container);
          const from = canvas.selection.nodeIds[canvas.selection.nodeIds.length - 1] ?? null;
          const to = nextInDirection(cards, from, event.key);
          if (to && to !== from) dispatch({ type: 'canvas/select', nodeId: to, additive: false });
        }
        event.preventDefault();
        return;
      }
      switch (event.key) {
        case 'Escape':
          /* ONE LEVEL PER PRESS. Draw first — Escape while drawing must not
             leave the capture overlay trapping every click with no obvious
             door out — then the selection, then whatever the host has open. */
          if (drawing && onToggleDrawing) {
            onToggleDrawing();
            break;
          }
          if (canvas.selection.nodeIds.length > 0 || canvas.selection.edgeIds.length > 0 || canvas.dim) {
            dispatch({ type: 'canvas/clear' });
            break;
          }
          if (onBack?.()) break;
          return;
        case '0':
          fitAll();
          break;
        case '1':
          dispatch({ type: 'canvas/zoom-reset' });
          break;
        case '2':
          fitSelection();
          break;
        case '+':
        case '=':
          dispatch({ type: 'canvas/zoom-step', direction: 1 });
          break;
        case '-':
        case '_':
          dispatch({ type: 'canvas/zoom-step', direction: -1 });
          break;
        default:
          return;
      }
      event.preventDefault();
    },
    [dispatch, drawing, fitAll, fitSelection, onToggleDrawing, onBack, boxes, positions, canvas.positions, canvas.selection, canvas.dim],
  );

  /* ══ MARQUEE SELECTION — the renderer's gesture, the slice's fact ═══════

     ONLY THE LAST REPORT IN A TICK IS A FACT, AND THAT IS THE FIX rather than
     a nicety. The guard that used to be here said: "<ReactFlow> reports an
     empty selection on mount, and without it the board would clear a selection
     the reader arrived with (from a turn effect, or the rail) before they had
     touched anything." The hole it left is the case it names.

     MEASURED, WITH THE HANDLER INSTRUMENTED. Setting `canvas.selection`
     programmatically — which item playback is the first thing in this product
     ever to do, when a hop focuses its card — makes @xyflow emit TWO reports in
     one tick:

         onSelectionChange []                 ← the previous selection
         onSelectionChange ['svc:alpha']      ← the one it actually holds now

     Acting on the first dispatched `canvas/clear`, which un-selected the hop,
     which re-rendered the board, which produced the pair again — an unbounded
     render loop that took the vitest worker out with no error message at all.
     `Board.test.tsx` could not see it, because nothing in this package set a
     selection except @xyflow itself.

     SO THE REPORTS ARE COALESCED AND THE LAST ONE WINS. A person cannot make
     two different selections in one tick, so nothing real is lost; a renderer
     narrating its way from the old value to the new one is not two gestures.
     A genuine deselect — a click on empty ground — reports `[]` once and is
     applied exactly as before.

     THE REFS ARE NOT A SHORTCUT AROUND STATE. The flush runs after this
     render's closure would be stale, and it has to compare against the
     selection as it is AT FLUSH TIME rather than as it was when the first
     report arrived. Both refs are written during render, from the props, so
     neither is a second source of truth — they are this render's values, read
     one tick later. */
  const selectionRef = useRef<readonly string[]>(canvas.selection.nodeIds);
  selectionRef.current = canvas.selection.nodeIds;
  const reportRef = useRef<string[] | null>(null);

  const onSelectionChange = useCallback(
    ({ nodes: picked }: OnSelectionChangeParams) => {
      const pending = reportRef.current !== null;
      reportRef.current = picked.map((node) => node.id);
      if (pending) return;

      queueMicrotask(() => {
        const ids = reportRef.current ?? [];
        reportRef.current = null;
        const current = selectionRef.current;
        if (ids.length === current.length && ids.every((id, i) => id === current[i])) return;
        if (!ids.length && !current.length) return;
        if (!ids.length) {
          dispatch({ type: 'canvas/clear' });
          return;
        }
        // Replayed through the same action a click uses, so there is one
        // selection rule and not a second one for the marquee.
        ids.forEach((id, index) =>
          dispatch({ type: 'canvas/select', nodeId: id, additive: index > 0 }),
        );
      });
    },
    [dispatch],
  );

  return (
    <div
      ref={root}
      /* Far-zoom box classes (farLod.ts): they change only when the zoom
         crosses 0.5 or 0.3, so the DOM is written once per crossing. */
      className={`board-scope board ${farLodClass(canvas.viewport.zoom)}`.trim()}
      data-testid="board"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDownCapture={(e) => {
        pressedAt.current = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
      }}
      data-rung={canvas.rung}
      data-zoom={canvas.viewport.zoom.toFixed(4)}
      /* Below 60% a group frame's header is counter-scaled to a readable
         size and keeps its name only (board.css). */
      data-group-far={canvas.viewport.zoom < 0.6 ? 'true' : undefined}
      data-node-count={nodes.length}
      data-edge-count={edges.length}
      data-canvas-budget={canvas.frame.budget}
      /* STATE, NOT IDENTITY. `CanvasSlice.layout` is 'idle' | 'laying-out' |
         'failed', and it is on the root so a suite can wait for the ELK answer
         instead of waiting a fixed number of frames and hoping. A layout that
         failed leaves the seed arrangement on screen and says so here rather
         than pretending it ran. */
      data-layout={canvas.layout}
      data-space-pan={spaceHeld ? 'true' : undefined}
      onPointerEnter={() => {
        pointerOver.current = true;
      }}
      onPointerLeave={() => {
        pointerOver.current = false;
      }}
      data-animating={glide.animating ? 'true' : undefined}
      /* STATE, NOT IDENTITY — the five canvas states of `CanvasView`, on the
         root. `S3` is the one this item added a writer for, and putting it here
         is what lets a suite ask "is a flow playing" without inferring it from
         a dim that path-focus will one day also set. */
      data-view={canvas.view.state}
      /* STATE, NOT IDENTITY — the same rule `data-layout` and `data-view` above
         follow. A suite (and a human with a devtools panel) can ask which way
         the switch is pointing without inferring it from a row that may or may
         not have been drawn. */
      data-visual={visual ? 'true' : 'false'}
      data-flow-hop={playback ? playback.index : undefined}
      data-flow-hops={playback ? playback.count : undefined}
      data-flow-how={playback ? playback.how : undefined}
      data-flow-shown={playback ? playback.shown : undefined}
      style={
        {
          // THE FIELD MOVES WITH THE CONTENT. These three are the whole of it:
          // the camera's own translate and scale, handed to the background as
          // position and size. Written in device pixels, which is what the
          // renderer's transform is in.
          '--board-cam-x': `${canvas.viewport.x}px`,
          '--board-cam-y': `${canvas.viewport.y}px`,
          '--board-cam-z': canvas.viewport.zoom,
          // Round 13 (A7): fewer, fainter dots when zoomed out (fieldDots.ts).
          '--board-field-step': fieldDots(canvas.viewport.zoom).step,
          '--board-field-fade': fieldDots(canvas.viewport.zoom).fade,
        } as React.CSSProperties
      }
    >
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        proOptions={PRO_OPTIONS}
        viewport={canvas.viewport}
        onViewportChange={onViewportChange}
        onEdgeClick={
          onEdgeClick
            ? (event, edge) => onEdgeClick(edge.id, { x: event.clientX, y: event.clientY })
            : undefined
        }
        onSelectionChange={onSelectionChange}
        nodesDraggable={!drawing && !spaceHeld}
        /* C.1: a press that moves under 4px is a click (it still selects);
           past that it is a drag. */
        nodeDragThreshold={NODE_DRAG_THRESHOLD}
        onNodeDragStart={(event, node) => {
          const began = 'clientX' in event ? { x: event.clientX, y: event.clientY } : null;
          catchUp.current = began ? dragCatchUp(pressedAt.current, began, canvas.viewport.zoom) : { x: 0, y: 0 };
          setDragPos({ nodeId: node.id, x: node.position.x + catchUp.current.x, y: node.position.y + catchUp.current.y });
        }}
        onNodeDrag={(_event, node) =>
          setDragPos({ nodeId: node.id, x: node.position.x + catchUp.current.x, y: node.position.y + catchUp.current.y })
        }
        onNodeDragStop={(_event, node) => {
          setDragPos(null);
          dispatch({
            type: 'canvas/position',
            nodeId: node.id,
            x: node.position.x + catchUp.current.x,
            y: node.position.y + catchUp.current.y,
          });
          catchUp.current = { x: 0, y: 0 };
        }}
        minZoom={ZOOM_MIN}
        maxZoom={ZOOM_MAX}
        /* 05.3 — THE REVERSAL. v1 maps a plain wheel straight into zoom with no
           modifier branch and never pans on scroll, so the most common gesture
           on a trackpad is bound to the most destructive camera operation. Miro
           and Figma both do the opposite. These two props are that sentence. */
        panOnScroll={!drawing}
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        selectionOnDrag={false}
        /* Select mode: left-drag pans the board without Space. Shift+drag still
           box-selects via selectionKeyCode. Draw mode locks the camera. */
        panOnDrag={!drawing || spaceHeld}
        /* Space is the board's own (spaceHeld above), in both modes, so the
           renderer's copy of the same key is off. */
        panActivationKeyCode={null}
        selectionKeyCode="Shift"
        /* The graph is not connectable, so nothing may offer a connection.
           This is the store-level half; the card's own eight handles carry the
           other half, because <Handle> does not read this. */
        nodesConnectable={false}
        /* The card is the control and carries its own focus ring. A second
           tabIndex on the renderer's wrapper would put two focusable elements
           on one card and read the same name twice. */
        nodesFocusable={false}
        edgesFocusable={false}
        /* THE BADGE IS OFF, AND THE ESCALATION THAT KEPT IT ON HAS BEEN ANSWERED.
           The previous version of this comment established the facts correctly
           and then, correctly, refused to decide:
             · @xyflow/react 12.11.2 is MIT (node_modules/@xyflow/react/LICENSE,
               "webkid GmbH"). MIT requires the copyright notice in copies of the
               SOFTWARE, not a badge in the UI — hiding it breaks no licence term.
             · The library embeds its own request in the markup it renders,
               verified verbatim in dist/esm/index.js: "Please only hide this
               attribution when you are subscribed to React Flow Pro".
           So it was never a legal question, it was a subscription question, and
           it was escalated as an owner decision rather than made here.
           MAX ASKED FOR IT REMOVED on 2026-08-21 ("i'm also seeing a react flow
           watermark ... please fix that"), which is that decision. The vendor's
           ask is not a term and is not silently discarded either: it is recorded
           in docs/THIRD-PARTY-NOTICES.md so a later reader meets it. The flag is
           set once, at PRO_OPTIONS above. */
      >
        {renderOverlay ? (
          <ViewportPortal>
            {renderOverlay({
              boxOf: (id) => boxIndex.get(id),
              paths: rfEdges.map((e) => (e.data as { d?: string } | undefined)?.d ?? ''),
              cards: shownBoxes.filter((b) => !b.container),
            })}
          </ViewportPortal>
        ) : null}
        {shownRows.length > 0 ? (
          <ViewportPortal>
            {shownRows.map((row) => (
              <div
                key={row.text}
                className="board-row-label"
                data-testid="board-row-label"
                /* Bottom-anchored just above its row, and counter-scaled to a
                   readable size at far zoom like the far titles. */
                style={{
                  transform: `translate(${row.x}px, ${row.y + 20}px) translateY(-100%) scale(calc(1 / max(var(--board-cam-z), 0.25)))`,
                }}
              >
                {row.text} <span className="brl-n">{row.count}</span>
              </div>
            ))}
          </ViewportPortal>
        ) : null}
      </ReactFlow>

      {/* SHEET 08.5 — an empty state is a box sitting ON the board, at the size
          of what it is talking about, never a lid over it. */}
      {empty && !drawing && (
        <div className="empty" data-testid="board-empty">
          <BoardIcon name={empty.icon} size={16} className="gl" />
          <span className="t">{empty.what}</span>
          <p className="s">{empty.why}</p>
          {empty.action && (
            <button type="button" className="bpill" data-testid="board-empty-action" onClick={empty.action.onAct}>
              {empty.action.label}
            </button>
          )}
          {empty.secondary && (
            <button type="button" className="bpill" data-testid="board-empty-secondary" onClick={empty.secondary.onAct}>
              {empty.secondary.label}
            </button>
          )}
        </div>
      )}

      {/* SHEET 08.5, THIRD STATE — "No traced edge at this level". A NOTE, not a
          lid: it sits in the board's own top-left gutter at the size of what it
          is talking about, and it is inert, so every card underneath and beside
          it stays clickable. It carries two of the sheet's three parts and not
          the third: the sheet's example offers "Step up a level", and this build
          has no level control, so a button for it would be an affordance for
          something the product cannot do — the same lie sheet 02.6 refuses on
          the connection handle. The WHY is the whole point and it is the honest
          one, naming where the edges went. */}
      {/* THE FLOW NOTE REPLACES IT WHILE A FLOW IS PLAYING, rather than sitting
          beside it. Both are `.boardnote` in the same top-left gutter, so two at
          once would overlap — and finding F2 already measured what one of them
          costs there (94% of two cards covered on load). The precedence is not
          arbitrary either: the edgeless note explains a standing property of the
          document, the flow note answers a question the reader just asked, and
          an answer outranks a standing explanation. */}
      {edgeless && playback === null && nodes.length > 0 && edges.length === 0 && (
        <div className="boardnote" data-testid="board-edgeless" aria-live="polite">
          <BoardIcon name="flow" size={14} className="gl" />
          <span className="t">{edgeless.what}</span>
          <p className="s">{edgeless.why}</p>
          {/* NAMED, because an unlabelled X on a note explaining an absence is
              ambiguous between "hide this note" and "do something to the
              board" — and the second reading is alarming on a surface whose
              whole claim is that it only draws what it measured. */}
          {onDismissEdgeless ? (
            <button
              type="button"
              className="boardnote-x"
              data-testid="board-edgeless-dismiss"
              aria-label="Dismiss this note"
              onClick={onDismissEdgeless}
            >
              <BoardIcon name="x" size={12} />
            </button>
          ) : null}
        </div>
      )}

      {/* ITEM playback — WHAT THE BOARD IS SHOWING OF THIS HOP, WHEN IT IS NOT
          SIMPLY SHOWING IT.

          A `direct` hop needs no words: both cards are lit, the connector
          between them is promoted, and the camera is on it. The other three
          resolutions are the board declining to assert something, and each gets
          the sentence that is true of it rather than a shared one.

          THIS IS THE HONEST-ABSENCE HALF OF "PLAYS ON BOARD". Measured on this
          monorepo: `.sequence/functions.json` holds thousands of call edges and none
          of them crosses a package, so every traced flow here resolves
          `inside` one service. The board focuses that service and moves to it —
          which is a real response and not nothing — but it has no crossing to
          draw, and saying so is the difference between a surface that is
          grounded and one that leaves the reader to guess why the picture
          stopped changing.

          IT IS THE SAME CHASSIS AS THE EDGELESS NOTE, deliberately: sheet 05
          wants "ONE kind of floating object rather than two that merely look
          alike", and a second class here would be an unstyled promise. The
          testid is what tells the two apart from outside. */}
      {playback && playback.how !== 'direct' && (
        <div className="boardnote" data-testid="board-flow-note" aria-live="polite">
          <BoardIcon name="flow" size={14} className="gl" />
          <span className="t">
            {`Hop ${playback.index + 1} of ${playback.count}`}
            {playback.how === 'inside' && playback.toLabel ? `, inside ${playback.toLabel}` : ''}
            {playback.how === 'containing' && playback.fromLabel && playback.toLabel
              ? `: ${playback.fromLabel} → ${playback.toLabel}`
              : ''}
          </span>
          <p className="s">
            {playback.how === 'inside'
              ? 'Both ends of this hop sit inside this node, so there is no crossing on this board to draw. The node it happened in is the one lit.'
              : playback.how === 'containing'
                ? 'The scan traced this hop below the level this board draws. The nodes lit are the ones that contain each end of it.'
                : 'Neither end of this hop is a node this board draws, so nothing is lit for it.'}
          </p>
        </div>
      )}

      {/* THE DOCK, CENTRED IN THE PANE AT EVERY WIDTH (Decision 49; the kind key and its spacers are gone, so nothing sits at the bottom-left). The dock is
          B's glass pill (BArc.dc.html `.dock`): Draw, the repository, Imports,
          the layered layout, card detail, then the zoom. Every button is a
          32px round target with a tooltip; the words stay as accessible names
          and `aria-pressed` carries every on/off. */}
      {/* data-toast-avoid: the zoom row is never under an agent toast. */}
      <div className="boardfurniture" data-toast-avoid="">
        <div className="bdock" role="toolbar" aria-label="Board tools" data-testid="board-dock">
          {onToggleDrawing ? (
            <button
              type="button"
              className="bbtn"
              data-testid="board-draw-toggle"
              aria-label={drawing ? 'Exit draw mode' : 'Draw on the architecture'}
              title={drawing ? 'Exit draw mode' : 'Draw on the architecture'}
              aria-pressed={drawing ? 'true' : 'false'}
              data-on={drawing ? 'true' : 'false'}
              onClick={onToggleDrawing}
            >
              <BoardIcon name="b-pen" size={16} />
            </button>
          ) : null}
          {onOpenRepoAnatomy ? (
            <button
              type="button"
              className="bbtn bdock-opt"
              data-testid="board-repo-anatomy"
              aria-label="Show the whole project, drawn by size"
              title="Show the whole project: every package drawn at its true share of the lines"
              onClick={onOpenRepoAnatomy}
            >
              <BoardIcon name="b-file" size={16} />
            </button>
          ) : null}
          {onToggleDerived ? (
            /* THE COUNT STAYS ON THE CONTROL. On a repository whose packages do
               not import each other there is nothing to infer, and a toggle
               that appears to do nothing when pressed reads as broken, so the
               number is drawn beside the glyph and the button is disabled at
               zero. */
            <button
              type="button"
              className="bbtn bdock-opt"
              data-testid="board-derived-toggle"
              aria-pressed={derivedOn ? 'true' : 'false'}
              data-on={derivedOn ? 'true' : 'false'}
              disabled={derivedCount === 0}
              aria-label={derivedCount === 0 ? 'Imports' : `Imports (${derivedCount})`}
              title={
                derivedCount === 0
                  ? 'No service in this project imports another, so there is nothing to infer.'
                  : `Show ${derivedCount} connector${derivedCount === 1 ? '' : 's'} inferred from imports. An import is not a call.`
              }
              onClick={onToggleDerived}
            >
              <BoardIcon name="b-import" size={16} />
              {derivedCount > 0 ? (
                <span className="bbtn-n mono" aria-hidden="true">
                  {derivedCount}
                </span>
              ) : null}
            </button>
          ) : null}
          {onLayoutDirection && layoutDirection ? (
            /* ONE CONTROL (owner, 2026-09-21: "should be one"): on is the
               layered top-down layout, off is left to right. */
            <button
              type="button"
              className="bbtn bdock-opt"
              data-testid="board-layout-toggle"
              aria-pressed={layoutDirection === 'TD' ? 'true' : 'false'}
              data-on={layoutDirection === 'TD' ? 'true' : 'false'}
              aria-label="Layered layout, top to bottom"
              title={layoutDirection === 'TD' ? 'Layered top to bottom (press for left to right)' : 'Left to right (press for layered top to bottom)'}
              onClick={() => onLayoutDirection(layoutDirection === 'TD' ? 'LR' : 'TD')}
            >
              <BoardIcon name="b-layers" size={16} />
            </button>
          ) : null}
          {onToggleVisual ? (
            /* THE TOOLTIP NAMES THE ZOOM, AND IT DOES NOT PROMISE THE PARTS:
               the strip draws from 100% zoom, and the parts' names live behind
               a selection, so the sentence says exactly that. */
            <button
              type="button"
              className="bbtn bdock-opt"
              data-testid="board-visual-toggle"
              aria-pressed={visual ? 'true' : 'false'}
              data-on={visual ? 'true' : 'false'}
              aria-label={
                visual
                  ? 'Card detail is on. From 100% zoom each card names its kind and whether the scan traced it; select a card for the parts inside. Press for the plain board.'
                  : 'Show more on each card: from 100% zoom each card names its kind and whether the scan traced it.'
              }
              title={visual ? 'Card detail is on (from 100% zoom)' : 'Card detail (from 100% zoom)'}
              onClick={onToggleVisual}
            >
              <BoardIcon name="b-eye" size={16} />
            </button>
          ) : null}
          {onOpenRepoAnatomy || onToggleDerived || onLayoutDirection || onToggleVisual ? (
            /* THE OVERFLOW (narrow boards only, board.css): the four optional
               buttons above, as B's menu rows, so the dock never wraps. Each
               row does exactly what its button does. */
            <span className="bdock-morewrap">
              <button
                type="button"
                className="bbtn bdock-more"
                data-testid="board-dock-more"
                aria-label="More board tools"
                title="More board tools"
                aria-haspopup="menu"
                aria-expanded={dockMenu}
                data-on={dockMenu ? 'true' : 'false'}
                onClick={() => setDockMenu((open) => !open)}
              >
                <BoardIcon name="b-more" size={16} />
              </button>
              {dockMenu ? (
                <span className="bmenu bdock-menu" role="menu" aria-label="More board tools" data-testid="board-dock-menu">
                  {onOpenRepoAnatomy ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="bmi"
                      data-testid="board-dock-menu-anatomy"
                      onClick={() => {
                        setDockMenu(false);
                        onOpenRepoAnatomy();
                      }}
                    >
                      <BoardIcon name="b-file" size={16} />
                      <span className="bmi-t">Whole project, by size</span>
                    </button>
                  ) : null}
                  {onToggleDerived ? (
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={derivedOn ? 'true' : 'false'}
                      className="bmi"
                      data-testid="board-dock-menu-imports"
                      disabled={derivedCount === 0}
                      onClick={() => {
                        setDockMenu(false);
                        onToggleDerived();
                      }}
                    >
                      <BoardIcon name="b-import" size={16} />
                      <span className="bmi-t">{derivedCount === 0 ? 'Imports' : `Imports (${derivedCount})`}</span>
                    </button>
                  ) : null}
                  {onLayoutDirection && layoutDirection ? (
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={layoutDirection === 'TD' ? 'true' : 'false'}
                      className="bmi"
                      data-testid="board-dock-menu-layout"
                      onClick={() => {
                        setDockMenu(false);
                        onLayoutDirection(layoutDirection === 'TD' ? 'LR' : 'TD');
                      }}
                    >
                      <BoardIcon name="b-layers" size={16} />
                      <span className="bmi-t">Layered, top to bottom</span>
                    </button>
                  ) : null}
                  {onToggleVisual ? (
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={visual ? 'true' : 'false'}
                      className="bmi"
                      data-testid="board-dock-menu-visual"
                      onClick={() => {
                        setDockMenu(false);
                        onToggleVisual();
                      }}
                    >
                      <BoardIcon name="b-eye" size={16} />
                      <span className="bmi-t">Card detail</span>
                    </button>
                  ) : null}
                </span>
              ) : null}
            </span>
          ) : null}
          {onToggleDrawing || onOpenRepoAnatomy || onToggleDerived || onLayoutDirection || onToggleVisual ? (
            <span className="bdock-sep" aria-hidden="true" />
          ) : null}
          <ZoomCluster
            zoom={canvas.viewport.zoom}
            onStep={(direction) => dispatch({ type: 'canvas/zoom-step', direction })}
            onFit={fitAll}
          />
        </div>
      </div>
      {drawing && renderDrawCapture ? (
        renderDrawCapture(spaceHeld, shownBoxes)
      ) : drawing && onStroke ? (
        <StrokeLayer onStroke={onStroke} passive={spaceHeld} />
      ) : null}
    </div>
  );
}

/**
 * THE CAPTURE SURFACE, and it exists only while Draw is on.
 *
 * Mounted rather than hidden: a transparent overlay left in the tree would eat
 * every click on the board for the rest of the session, and the bug would look
 * like the board having stopped responding rather than like a layer.
 *
 * It captures with POINTER events, so a pen, a finger and a mouse are one code
 * path — and `setPointerCapture` means a stroke that leaves the element still
 * finishes, instead of a box that fails to close because the reader's hand went
 * past the edge.
 */
/**
 * THE INK HAS TO BE VISIBLE WHILE IT IS BEING DRAWN.
 *
 * This layer recorded points and rendered NOTHING - the `<svg>` had no
 * children. On pointer-up the stroke was recognised and could become a real
 * edge, so the feature was never inert; it just left no mark under the cursor.
 * From the reader's seat that is indistinguishable from broken, and it is
 * exactly how it was reported: "drawing on the actual architecture board
 * doesn't work. On the whiteboard, it works fine."
 *
 * The whiteboard was right two files away - it paints a live draft path while
 * the pointer is down. Same idiom here, deliberately: two drawing surfaces that
 * behave differently make the reader learn the product twice.
 *
 * TWO COORDINATE SPACES, DELIBERATELY:
 *
 *   LOCAL  — for the live ink path. SVG `d` is in the element's own user
 *            space (origin = top-left of this SVG). Using clientX/Y painted
 *            the stroke hundreds of pixels away from the cursor whenever the
 *            board sat beside chat/sessions — overflow:hidden clipped it, so
 *            drawing looked dead. Whiteboard already converts; we match it.
 *
 *   CLIENT — handed to `onStroke` for hit-testing. `elementFromPoint` wants
 *            viewport coordinates; converting those to board/ELK space would
 *            break connect under zoom/pan.
 */
/** Pen-down and pen-up on one clock, so a multi-stroke box can be grouped by its rests. */
export interface StrokeTiming {
  t0: number;
  t1: number;
}

function StrokeLayer({
  onStroke,
  passive = false,
}: {
  onStroke: (points: { x: number; y: number }[], timing?: StrokeTiming) => void;
  /** Space is held: the layer lets the pointer through to pan (C.5). */
  passive?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const clientPoints = useRef<{ x: number; y: number }[]>([]);
  const drawingRef = useRef(false);
  const downAt = useRef(0);
  /* State, not a ref: React re-renders the LOCAL path as the pointer moves.
     The ref keeps CLIENT points for the recogniser / hit-test. */
  const [draft, setDraft] = useState<{ x: number; y: number }[]>([]);

  function localOf(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const box = svgRef.current?.getBoundingClientRect();
    return { x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) };
  }

  return (
    <svg
      ref={svgRef}
      className={passive ? 'strokelayer is-passive' : 'strokelayer'}
      data-testid="board-stroke-layer"
      data-passive={passive ? 'true' : undefined}
      onPointerDown={(e) => {
        drawingRef.current = true;
        downAt.current = e.timeStamp;
        clientPoints.current = [{ x: e.clientX, y: e.clientY }];
        setDraft([localOf(e)]);
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drawingRef.current) return;
        clientPoints.current.push({ x: e.clientX, y: e.clientY });
        setDraft((prev) => [...prev, localOf(e)]);
      }}
      onPointerUp={(e) => {
        if (!drawingRef.current) return;
        drawingRef.current = false;
        (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
        const stroke = clientPoints.current;
        clientPoints.current = [];
        setDraft([]);
        /* A stroke of one point is a click, not a gesture. Handing it to the
           recogniser would spend a round trip to be told it is a scribble. */
        if (stroke.length > 1) onStroke(stroke, { t0: downAt.current, t1: e.timeStamp });
      }}
      onPointerCancel={() => {
        /* A cancelled pointer must not leave ink on the board with no stroke
           behind it - the mark would claim an edit that never happened. */
        drawingRef.current = false;
        clientPoints.current = [];
        setDraft([]);
      }}
    >
      {draft.length > 1 ? (
        <path className="board-ink" data-testid="board-ink" d={strokePath(draft)} />
      ) : null}
    </svg>
  );
}

/** Points to an SVG path. Same shape as the whiteboard's, and for the same reason. */
function strokePath(points: readonly { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
}

/** Re-exported so a caller sizing a pane does not import two modules to learn
 *  one number. */
export { CARD_W };

/**
 * Where a node sits while the reader drags it or at rest. Controlled React Flow
 * nodes only paint a live preview when this answers with the in-flight position.
 */
export function boardNodePosition(
  nodeId: string,
  drag: { nodeId: string; x: number; y: number } | null,
  saved: Readonly<Record<string, { x: number; y: number }>>,
  laid: { x: number; y: number },
): { x: number; y: number } {
  if (drag?.nodeId === nodeId) return { x: drag.x, y: drag.y };
  return saved[nodeId] ?? laid;
}

/**
 * `text` shortened in the middle until it measures at most `maxInk` in the
 * title face ("graphQuery…pth.test.ts"); unchanged when it fits or cannot be
 * measured.
 */
export function middleEllipsis(text: string, maxInk: number, measure: (t: string) => number = (t) => measureWithCanvas(t, titleFont())): string {
  const full = measure(text);
  if (!Number.isFinite(full) || full <= maxInk || text.length <= 4) return text;
  let keep = text.length - 1;
  while (keep > 2) {
    const head = Math.ceil(keep / 2);
    const cand = `${text.slice(0, head)}\u2026${text.slice(text.length - (keep - head))}`;
    if (measure(cand) <= maxInk) return cand;
    keep -= 1;
  }
  return `${text.slice(0, 1)}\u2026${text.slice(-1)}`;
}

/**
 * Whether the board re-fits by itself: only while the camera is exactly where
 * the last automatic fit left it (the reader has not moved it), the frame is
 * measured, and the arrangement on screen is the one ELK answered for this
 * frame (never the seed while a layout runs).
 */
export function shouldAutoRefit(
  last: { x: number; y: number; zoom: number } | null,
  v: { x: number; y: number; zoom: number },
  layout: string,
  arranged: boolean,
  frame: { width: number; height: number },
): boolean {
  if (!last) return false;
  if (layout === 'laying-out' || !arranged) return false;
  if (frame.width <= 0 || frame.height <= 0) return false;
  return Math.abs(v.x - last.x) <= 0.5 && Math.abs(v.y - last.y) <= 0.5 && Math.abs(v.zoom - last.zoom) <= 1e-4;
}


/** The zoom `fitViewport` would fit `bounds` at, before any clamp: the
 *  usable frame (inset and bands taken off) over the bounds, per axis. */
export function rawFitZoom(
  bounds: { width: number; height: number },
  frame: { width: number; height: number },
  bands: { top?: number; bottom?: number; left?: number } | null,
): number {
  const usableW = frame.width - FIT_INSET * 2 - Math.max(0, bands?.left ?? 0);
  const usableH = frame.height - FIT_INSET * 2 - Math.max(0, bands?.top ?? 0) - Math.max(0, bands?.bottom ?? 0);
  if (!(usableW > 0) || !(usableH > 0) || !(bounds.width > 0) || !(bounds.height > 0)) return 0;
  return Math.min(usableW / bounds.width, usableH / bounds.height);
}
