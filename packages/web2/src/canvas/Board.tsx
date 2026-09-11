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

import {
  ReactFlow,
  ReactFlowProvider,
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
import { KindLegend } from './KindLegend.js';
import { HANDLE_SIDES, NodeCard, type BoardNode, type DotState } from './NodeCard.js';
import { ZoomCluster } from './ZoomCluster.js';
import { CARD_W, cardBox, type CardBox } from './cardBox.js';
import { distinctiveShortLabels } from './displayLabel.js';
import { routeEdges } from './routes.js';
import { ZOOM_MAX, ZOOM_MIN, unionBounds, type Bounds } from './camera.js';
import type { CanvasAction } from './canvasReduce.js';
import { promoteOnFlow, type HopResolution } from './flowFocus.js';
import { silhouetteOf, type Silhouette } from './kinds.js';
import { visibilityAt } from './lod.js';
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
}

/** Sheet 08.5: what is not here, WHY it is not here, and one thing to do about
 *  it. The second part is the one that gets dropped, and dropping it turns an
 *  empty board into a bug report the reader has to file themselves. */
export interface BoardEmpty {
  icon: BoardIconName;
  what: string;
  why: string;
  action?: { label: string; onAct: () => void };
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
  onStroke?: (points: { x: number; y: number }[]) => void;
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

const NODE_TYPES = { arch: ArchNode };
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
  onStroke,
  onFurnitureBand,
  onFlowReady,
  empty = null,
  edgeless = null,
  onDismissEdgeless,
  onOpenNode,
  openableNodeIds,
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
}: BoardProps) {
  const root = useRef<HTMLDivElement | null>(null);
  const { screenToFlowPosition } = useReactFlow();
  /* Live drag position — controlled nodes only move when this updates. */
  const [dragPos, setDragPos] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  useEffect(() => {
    onFlowReady?.({
      screenToFlow: (point) => screenToFlowPosition(point),
    });
  }, [onFlowReady, screenToFlowPosition]);
  /* Latch for post-attach fit — see the effect below `ghostKey`. */
  const fittedAttachKey = useRef<string | null>(null);
  const sawLayingOut = useRef(false);

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
  const boxes = useMemo<CardBox[]>(
    () =>
      nodes.map((node) => {
        const laid = positions[node.id] ?? { x: 0, y: 0 };
        const pos = boardNodePosition(node.id, dragPos, canvas.positions, laid);
        /* VISUAL IS AN INPUT TO THE GEOMETRY, not just to the paint. The strip
           and the parts line are real rows, so the router, the fit bounds and
           the declared @xyflow box all have to be told — a card measured
           without them is `cardBox.ts`'s own 160x96 defect with a new cause. */
        /* ANATOMY IS GEOMETRY TOO, and for the same reason: the wall is a real
           129px object inside the card, so the router, the fit bounds and the
           declared @xyflow box all have to be told. */
        return cardBox(node, pos, canvas.rung, visual, anatomy?.nodeId === node.id ? anatomy : null);
      }),
    [nodes, positions, canvas.positions, canvas.rung, dragPos, visual, anatomy?.nodeId],
  );

  /* Sibling-aware far-zoom titles — one map per board, so twelve
     "Hoppscotch …" services read "Backend" / "App" / "Old Backend" instead of
     nine identical first words. See displayLabel.distinctiveShortLabels. */
  const shortLabels = useMemo(
    () => distinctiveShortLabels(nodes.map((n) => n.label)),
    [nodes],
  );

  const rfNodes = useMemo<Node[]>(
    () =>
      nodes.map((node, index) => {
        const box = boxes[index]!;
        return {
          id: node.id,
          type: 'arch',
          position: { x: box.x, y: box.y },
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
            node: { ...node, shortLabel: shortLabels.get(node.label) },
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
          } satisfies ArchNodeData,
        };
      }),
    [
      nodes,
      boxes,
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
      routeEdges(promoted, boxes, showEdgeTags).map((routed) => ({
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
    [promoted, boxes, showEdgeTags],
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
      return unionBounds(chosen.map((box) => ({ x: box.x, y: box.y, width: box.w, height: box.h })));
    },
    [boxes],
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
  const chromeBands = useCallback((): { bottom?: number } | null => {
    /* THE CONTAINER IS THE WHOLE PANE (`inset: 0`) — the band is its CONTENT.
       Measuring the container handed fitViewport a band taller than the frame,
       every banded fit returned null, and the hop camera silently stopped
       moving (caught by flow-plays' "the camera moved" check). The band is
       from the top of the highest visible furniture row to the pane's bottom
       edge. */
    const el = root.current?.querySelector('.boardfurniture');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const tops = [...el.children]
      .map((child) => child.getBoundingClientRect())
      .filter((r) => r.height > 0 && r.width > 0)
      .map((r) => r.top);
    if (tops.length === 0) return null;
    const band = rect.bottom - Math.min(...tops);
    return band > 0 && band < rect.height ? { bottom: band } : null;
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
  useEffect(() => {
    if (hopTarget === null) return;
    const host = root.current;
    /* C4.1 — sheet 11.6 / 06.7: camera moves over --seq-dur-cam, not a jump.
       Flag only for the hop fit so freehand pan stays immediate. */
    host?.setAttribute('data-cam-animating', 'true');
    dispatch({
      type: 'canvas/fit',
      bounds: fitBounds([hopTarget]),
      reserve: noteBox(),
      bands: chromeBands(),
    });
    let ms = 240;
    if (host) {
      const raw = getComputedStyle(host).getPropertyValue('--seq-dur-cam').trim();
      const parsed = Number.parseFloat(raw);
      if (Number.isFinite(parsed) && parsed > 0) ms = parsed;
    }
    const clear = window.setTimeout(() => {
      host?.removeAttribute('data-cam-animating');
    }, ms);
    return () => {
      window.clearTimeout(clear);
      host?.removeAttribute('data-cam-animating');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hopTarget, hopIndex, dispatch]);

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
      return;
    }
    if (canvas.layout === 'laying-out') {
      sawLayingOut.current = true;
      return;
    }
    if (nodes.length === 0) return;
    if (canvas.frame.width <= 0 || canvas.frame.height <= 0) return;
    if (fittedAttachKey.current === attachFitKey) return;
    if (!sawLayingOut.current && canvas.layout === 'idle') return;

    fittedAttachKey.current = attachFitKey;
    dispatch({ type: 'canvas/fit', bounds: fitBounds([]), reserve: noteBox() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachFitKey, canvas.layout, canvas.frame.width, canvas.frame.height, nodes.length, dispatch]);

  /* ── THE KEYMAP (sheet 05.7) ─────────────────────────────────────────────
     CAMERA KEYS MOVE THE CAMERA AND NOTHING ELSE. No keystroke here changes the
     graph, so a reader who is lost can always press 1 and get the whole board
     back without having edited anything. */
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case 'Escape':
          /* Exit draw first — Escape while drawing must not leave the capture
             overlay trapping every click with no obvious door out. */
          if (drawing && onToggleDrawing) {
            onToggleDrawing();
            break;
          }
          dispatch({ type: 'canvas/clear' });
          break;
        case '0':
          dispatch({ type: 'canvas/zoom-reset' });
          break;
        case '1':
          fitAll();
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
    [dispatch, drawing, fitAll, fitSelection, onToggleDrawing],
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

  const present = useMemo<Silhouette[]>(() => {
    const seen = new Set<Silhouette>();
    for (const node of nodes) seen.add(silhouetteOf(node.present));
    return [...seen];
  }, [nodes]);

  const counts = useMemo(() => {
    const tally: Partial<Record<Silhouette, number>> = {};
    for (const node of nodes) {
      const silhouette = silhouetteOf(node.present);
      tally[silhouette] = (tally[silhouette] ?? 0) + 1;
    }
    return tally;
  }, [nodes]);

  return (
    <div
      ref={root}
      className="board-scope board"
      data-testid="board"
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-rung={canvas.rung}
      data-zoom={canvas.viewport.zoom.toFixed(4)}
      data-node-count={nodes.length}
      data-edge-count={edges.length}
      data-canvas-budget={canvas.frame.budget}
      /* STATE, NOT IDENTITY. `CanvasSlice.layout` is 'idle' | 'laying-out' |
         'failed', and it is on the root so a suite can wait for the ELK answer
         instead of waiting a fixed number of frames and hoping. A layout that
         failed leaves the seed arrangement on screen and says so here rather
         than pretending it ran. */
      data-layout={canvas.layout}
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
        onSelectionChange={onSelectionChange}
        nodesDraggable={!drawing}
        onNodeDragStart={(_event, node) =>
          setDragPos({ nodeId: node.id, x: node.position.x, y: node.position.y })
        }
        onNodeDrag={(_event, node) =>
          setDragPos({ nodeId: node.id, x: node.position.x, y: node.position.y })
        }
        onNodeDragStop={(_event, node) => {
          setDragPos(null);
          dispatch({
            type: 'canvas/position',
            nodeId: node.id,
            x: node.position.x,
            y: node.position.y,
          });
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
        panOnDrag={!drawing}
        panActivationKeyCode={drawing ? 'Space' : null}
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
      />

      {/* SHEET 08.5 — an empty state is a box sitting ON the board, at the size
          of what it is talking about, never a lid over it. */}
      {empty && (
        <div className="empty" data-testid="board-empty">
          <BoardIcon name={empty.icon} size={16} className="gl" />
          <span className="t">{empty.what}</span>
          <p className="s">{empty.why}</p>
          {empty.action && (
            <button type="button" className="btn" onClick={empty.action.onAct}>
              {empty.action.label}
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
            {playback.how === 'inside' && playback.toLabel ? ` · inside ${playback.toLabel}` : ''}
            {playback.how === 'containing' && playback.fromLabel && playback.toLabel
              ? ` · ${playback.fromLabel} → ${playback.toLabel}`
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

      {/* TWO CORNERS, TWO JOBS, AND THEY DO NOT COLLIDE: the legend is a key to
          what is on the board, the cluster is a control over how you are
          looking at it. v1 puts React Flow's own untokened controls bottom-left,
          overlapping the legend. */}
      <div className="boardfurniture">
        {nodes.length > 0 ? <KindLegend present={present} counts={counts} /> : <span />}
        <div className="boardtools">
          {onToggleDrawing ? (
            /* Decision 9 — icon-first Draw (`ic-pen`). The word stays as the
               accessible name; `aria-pressed` carries on/off for readers who
               cannot see the fill. */
            <button
              type="button"
              className="drawtoggle"
              data-testid="board-draw-toggle"
              aria-label={drawing ? 'Exit draw mode' : 'Draw on the architecture'}
              title={drawing ? 'Exit draw mode' : 'Draw on the architecture'}
              aria-pressed={drawing ? 'true' : 'false'}
              data-on={drawing ? 'true' : 'false'}
              onClick={onToggleDrawing}
            >
              <BoardIcon name="pen" size={14} />
            </button>
          ) : null}
          {onOpenRepoAnatomy ? (
            /* Decision 9 — icon-first, the word kept as the accessible name.
               `folder` is the book's glyph for a tree of things, which is what
               this opens: the repository drawn as its parts, area = lines. */
            <button
              type="button"
              className="drawtoggle"
              data-testid="board-repo-anatomy"
              aria-label="Show the whole repository, drawn by size"
              title="Show the whole repository — every package drawn at its true share of the lines"
              onClick={onOpenRepoAnatomy}
            >
              <BoardIcon name="folder" size={14} />
            </button>
          ) : null}
          {onToggleDerived ? (
            /* A WORD, for the same sheet 09 ruling that makes Draw and Fit
               words: the vocabulary has no glyph for "show me the inference"
               and does not borrow one.

               The COUNT is in the label because this control can reveal
               nothing — on a repository whose packages do not import each
               other there is no derived edge to draw, and a toggle that
               appears to do nothing when pressed is indistinguishable from a
               broken one. */
            <button
              type="button"
              className="drawtoggle"
              data-testid="board-derived-toggle"
              aria-pressed={derivedOn ? 'true' : 'false'}
              data-on={derivedOn ? 'true' : 'false'}
              disabled={derivedCount === 0}
              title={
                derivedCount === 0
                  ? 'No service in this repository imports another, so there is nothing to infer.'
                  : `Show ${derivedCount} connector${derivedCount === 1 ? '' : 's'} inferred from imports. An import is not a call.`
              }
              onClick={onToggleDerived}
            >
              {derivedCount === 0 ? 'Imports' : `Imports (${derivedCount})`}
            </button>
          ) : null}
          {onLayoutDirection && layoutDirection ? (
            <>
              <button
                type="button"
                className="drawtoggle"
                data-testid="board-layout-vertical"
                aria-pressed={layoutDirection === 'TD' ? 'true' : 'false'}
                data-on={layoutDirection === 'TD' ? 'true' : 'false'}
                title="Top-down tree layout"
                onClick={() => onLayoutDirection('TD')}
              >
                Vertical
              </button>
              <button
                type="button"
                className="drawtoggle"
                data-testid="board-layout-horizontal"
                aria-pressed={layoutDirection === 'LR' ? 'true' : 'false'}
                data-on={layoutDirection === 'LR' ? 'true' : 'false'}
                title="Left-to-right tree layout"
                onClick={() => onLayoutDirection('LR')}
              >
                Horizontal
              </button>
            </>
          ) : null}
          {onToggleVisual ? (
            /* BESIDE THE DIRECTION CONTROL, which is the MADR's decision 1:
               "The board's own furniture already hosts exactly this kind of
               per-board, appearance-scoped switch (the direction toggle).
               Visual belongs there, next to it."

               A WORD, for the same sheet 09 ruling that makes Draw, Imports and
               Fit words — the icon vocabulary has no glyph for "draw this board
               in more detail" and does not borrow one.

               THE LABEL DOES NOT FLIP. A control captioned "Plain" when Visual
               is on is a control whose word describes what pressing it would
               do, and the reader has to work out which reading is meant.
               `aria-pressed` and `data-on` carry the state; the word names the
               thing being switched, exactly as Draw and Imports do.

               THE TOOLTIP NAMES THE ZOOM, AND IT DOES NOT PROMISE THE PARTS.
               Its first draft read "Cards show kind, provenance and the parts
               the scan found inside", and both halves were false where the
               reader stands. `cardHeight` and `NodeCard` gate the strip on
               `show.footer`, which `lod.ts` puts at rung 1 — zoom >= 1.00 — and
               the post-attach fit on this monorepo lands at 74%, rung 4. So a
               reader who opens the Architecture tab sees a highlighted "Visual"
               control over a board with zero strips on it, being told the cards
               ARE showing three things none of which is on screen; the honest
               reading of that is that the mode is broken. And the parts NAMES
               are `selected ? meta.parts : null` in `VisualMetaStrip` — they
               are never on a resting card at any zoom, by the 2026-08-25
               ruling. A control that describes what it does not do is worse
               than one that says nothing, so the sentence states the zoom it
               becomes true at and where the parts actually live. */
            <button
              type="button"
              className="drawtoggle"
              data-testid="board-visual-toggle"
              aria-pressed={visual ? 'true' : 'false'}
              data-on={visual ? 'true' : 'false'}
              title={
                visual
                  ? 'Visual mode is on. From 100% zoom each card names its kind and whether the scan traced it; select a card for the parts inside. Press to draw the plain board.'
                  : 'Draw this board in more detail — from 100% zoom each card names its kind and whether the scan traced it.'
              }
              onClick={onToggleVisual}
            >
              Visual
            </button>
          ) : null}
          <ZoomCluster
            zoom={canvas.viewport.zoom}
            onStep={(direction) => dispatch({ type: 'canvas/zoom-step', direction })}
            onFit={fitAll}
          />
        </div>
      </div>
      {drawing && onStroke ? <StrokeLayer onStroke={onStroke} /> : null}
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
function StrokeLayer({ onStroke }: { onStroke: (points: { x: number; y: number }[]) => void }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const clientPoints = useRef<{ x: number; y: number }[]>([]);
  const drawingRef = useRef(false);
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
      className="strokelayer"
      data-testid="board-stroke-layer"
      onPointerDown={(e) => {
        drawingRef.current = true;
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
        if (stroke.length > 1) onStroke(stroke);
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
