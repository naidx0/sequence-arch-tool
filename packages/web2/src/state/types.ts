/**
 * ITEM 2.1 — THE STATE CONTRACT. Types only, no implementation.
 *
 * This file is the whole product's state modelled as types, and it is frozen
 * before 2.2 starts. Every other Wave 2 lane codes against it; a type changed
 * mid-wave is how four agents end up disagreeing, which is risk R13 in the
 * plan: the store is the serialization point, it was 1,627 + 2,387 lines and 92
 * action members in v1, and every parallel builder edits it in week one.
 *
 * THREE RULES THIS FILE OBEYS, AND WHY.
 *
 * 1. A WIRE SHAPE IS IMPORTED, NEVER RESTATED. `@sequence/api-types` is the
 *    single definition of what the server sends (engine gap G12: about sixty
 *    request/response shapes were re-derived by hand at each end and nothing
 *    tied the two together). Where the state holds a server response verbatim
 *    it holds the wire type. Where the state holds something the server does
 *    not have a word for — a pane width, a playback cursor, a chip the user can
 *    remove — it declares its own, and `types.test.ts` proves the two sets do
 *    not overlap by name or by shape.
 *
 * 2. STATE IS DATA, NOT CALLS. The one legibility defect the plan names by
 *    line number is the assistant setting the board's surface mode from three
 *    separate places, so the canvas changes out from under the user without a
 *    click. The fix is structural: a turn resolves into exactly one
 *    {@link TurnEffect}, a typed union the store applies. Nothing in chat
 *    reaches the canvas by any other route.
 *
 * 3. WHAT IS NOT KNOWN IS TYPED AS NOT KNOWN. The first of the three
 *    invariants is that the canvas is grounded or it is blank. So an absent
 *    hop's evidence is `null` and not an empty object, coverage is absent
 *    rather than zeroed when there is no graph to count against, and a stale
 *    graph carries the reason it went stale. A field that cannot express "I do
 *    not know" will be filled with a plausible value by the first lane that
 *    needs one.
 *
 * SCOPE. Slices are the six the plan names in §4.2 — session, repo, canvas,
 * rail, composer, net — plus `shell`, because item 2.1 asks for shell layout
 * explicitly and 2.3 owns the frame that reads it, and `attachDialog`, which is
 * the one surface whose data outlives the overlay that shows it. Actions, selectors,
 * reducers and middleware are 2.2's and are deliberately absent: an action
 * surface authored here would be a second design of the store by someone who
 * is not building it.
 *
 * SHEETS THIS FILE IMPLEMENTS. It renders nothing, so it cites the frozen book
 * only where a sheet fixes a STATE distinction a lane would otherwise invent:
 * docs/brand/graphite/pages/06-selection-focus-and-dimming.html (selection
 * is multi and additive; dimming is not a selection effect),
 * docs/brand/graphite/pages/08-board-density-and-overflow.html (seven detail
 * rungs; the budget is the frame, never a node count),
 * docs/brand/graphite/pages/11-the-functions-rail.html (three rungs and no
 * fourth; the rail width is the user's, inside clamps) and
 * docs/brand/graphite/pages/12-the-agentic-surfaces.html (the tool row's
 * four slots and four groups; the send button's four states; the composer's
 * mode strip). Everything else this file models is unsheeted by §5.6 and is
 * called out where it happens.
 */

import type {
  AdvisorNote,
  AskCoverage,
  AskDiagram,
  AskHistoryTurn,
  AskIntentInvocation,
  AskStreamEvent,
  AskSurfaceContext,
  AskMetrics,
  AskUsage,
  AskContextBreakdown,
  BrowseEntry,
  GetArchGraphResponse,
  GetFunctionsResponse,
  GitStatusFile,
  GraphSummary,
  RecentRepo,
  SessionIndexEntry,
  TreeNode,
  VerifyResult,
} from '@sequence/api-types';
/**
 * THE HANDBACK IS TAKEN. This was a deep relative import into
 * `../../../schema/src/seqdiagram.js`, with a comment promising it would
 * become a bare specifier "with nothing else in the file moving" the moment
 * `@sequence/schema` was a real dependency of this package. Wave 3's closing
 * lane lifted `seqdFromGraph` out of v1, which needs the schema AT RUNTIME —
 * `validateSeqDiagram` is a call, not a type — so the dependency landed in
 * `package.json` and this is the promised one-line change.
 *
 * The reason it mattered is not tidiness. Two paths to one set of declarations
 * is two sets as far as anything that reads the module graph is concerned, and
 * the first thing to drift is whichever one no test happens to touch.
 */
import type { SeqChart, SeqDiagramEdge, SeqDiagramNode, SeqDiagramV1 } from '@sequence/schema';

/*
 * The graph family, taken from the response that already carries it rather than
 * from a second import of the same declarations. `GetArchGraphResponse` IS
 * `ArchGraph` plus the MADR detail map, so these aliases are the wire type
 * read at a depth — never a restatement of it. They are deliberately NOT
 * exported: a lane that needs `ArchNode` should import it from the schema
 * package, not from the state contract.
 */
type ScannedGraph = GetArchGraphResponse;
type ArchNode = ScannedGraph['nodes'][number];
type ArchEdge = ScannedGraph['edges'][number];
type Evidence = ArchEdge['evidence'][number];
type NodeKind = ArchNode['kind'];
type NodeDetail = ScannedGraph['nodeDetail'][string];
type FunctionGraph = GetFunctionsResponse['functionGraph'];
type FunctionNode = FunctionGraph['nodes'][number];

/* ========================================================================== *
 * 0. IDENTIFIERS AND THE SHAPE OF NOT-YET
 * ========================================================================== */

/**
 * Ids are aliases, not branded types. A brand would be caught at compile time
 * exactly once — the first time a lane assigns one — and paid for with a cast
 * at every boundary where an id arrives from JSON. The names carry the meaning;
 * the compiler is not the thing keeping these apart.
 */
export type NodeId = string;
export type EdgeId = string;
/** `fn:${file}#${name}@${startLine}` — deterministic, from `functionNodeId`. */
export type FunctionId = string;
/** Repo-relative, forward slashes. Native separators never reach the store. */
export type RepoPath = string;
export type SessionId = string;
export type TurnId = string;
export type ProposalId = string;
/** The ask stream's own run id, from the `trajectory:start` event. */
export type RunId = string;

/**
 * A failed request as the UI has to render it. `status` is the HTTP code
 * because the routes discriminate on it — 403 jail escape, 409 no repo, 422
 * no-manifests, 413 too large — and a UI that only kept the message cannot tell
 * a refusal from an outage.
 */
export interface RemoteFailure {
  status: number | null;
  message: string;
  /** The route that failed, e.g. `POST /api/attach`. For the error surface. */
  route: string;
  at: number;
}

/* ========================================================================== *
 * 1. THE REPO SLICE — attachment and scan status
 * ========================================================================== */

/**
 * The five statuses item 2.1 names, as a discriminated union rather than a set
 * of booleans. `attached` and `stale` are separate members carrying the SAME
 * {@link ScannedRepo} payload, which is the point: a stale graph is still a
 * graph and the canvas keeps painting it, but every surface that reads it can
 * see, in the type, that it is no longer true. An `isStale: boolean` beside an
 * optional graph would let a lane paint a stale graph without noticing.
 */
export type RepoPhase = 'unattached' | 'scanning' | 'attached' | 'stale' | 'failed';

/** S0. Nothing attached. The canvas holds one invitation and nothing else. */
export interface RepoUnattached {
  phase: 'unattached';
}

/**
 * A scan in flight. `progress` is absent until the first event arrives and
 * stays absent on a server that does not emit them: `/api/scan` is a single
 * blocking call today (gap G4) and item 1.5 adds `scan:progress{done,total,
 * path}`. A determinate bar drawn from an absent number is the dishonesty this
 * optionality prevents.
 */
export interface RepoScanning {
  phase: 'scanning';
  root: string;
  repoName: string;
  startedAt: number;
  progress: ScanProgress | null;
  /** A rescan of an already-attached repo keeps the old graph on screen. */
  previous: ScannedRepo | null;
}

/** Item 1.5's `scan:progress` event, held as state. */
export interface ScanProgress {
  done: number;
  total: number;
  /** Route phase id when the server emits one (`enumerate`, `analyze`, …). */
  phase?: string;
  /** The file being scanned. Absent between phases of the crawl. */
  path?: RepoPath;
}

/**
 * Everything one scan produced. Held together because it is invalidated
 * together: a rescan replaces all of it, and a partial refresh is how the tree
 * and the graph come to disagree about what exists.
 */
export interface ScannedRepo {
  root: string;
  repoName: string;
  /**
   * The `/archgraph.json` payload WHOLE — the graph and the MADR detail map
   * that came with it, kept as the one object the route returned. Splitting
   * `nodeDetail` into a sibling field would make it possible to refresh one
   * without the other, and a detail map keyed by node ids that no longer exist
   * is a breakout panel describing a node the board is not drawing.
   */
  graph: ScannedGraph;
  /** The projection the canvas actually paints, from `seqdFromGraph`. */
  doc: SeqDiagramV1;
  summary: GraphSummary;
  /** `ArchGraph.scannedAt`, which is also the natural ETag item 1.8 adds. */
  scannedAt: string;
  /** Absent until `/api/functions` is asked for — the rail fetches it lazily. */
  functions: FunctionIndex | null;
  /** The file tree, from `/api/tree`. Absent until the rail mounts. */
  tree: TreeNode | null;
}

/**
 * The function graph plus the two lookups every rail row and every S3 playback
 * needs. Derived once on load: 5,990 nodes and 7,759 edges on this repo, and
 * rebuilding either map per render is the class of defect the board already has
 * with its per-edge box map.
 */
export interface FunctionIndex {
  graph: FunctionGraph;
  byFile: Record<RepoPath, FunctionId[]>;
  byId: Record<FunctionId, FunctionNode>;
  /** Read-and-clear attribution warnings from the build, replayed on a cache hit. */
  warnings: string[];
}

/**
 * Attached and current. The invariant: nothing wrote to the repo since
 * `scannedAt`, so every node, edge and `file:line` on screen is still true.
 */
export interface RepoAttached {
  phase: 'attached';
  repo: ScannedRepo;
}

/**
 * Attached, and something changed underneath. `PUT /api/file` clears the graph
 * cache without rescanning, so the graph is knowingly stale the moment the user
 * acts on it and nothing on the wire says so today (gap G5; item 1.5 adds a
 * `stale` marker to the write response). This phase is what the canvas's
 * staleness bar reads, and `reason` is what it says out loud — "graph is stale"
 * with no cause is a shrug.
 */
export interface RepoStale {
  phase: 'stale';
  repo: ScannedRepo;
  since: number;
  reason: StaleReason;
  /** The paths known to have changed, when the cause named them. */
  changedPaths: RepoPath[];
}

/**
 * There is filesystem watching in the engine (P5 / gap G5): external edits
 * mark the graph stale and the client polls `/api/status` to enter this
 * reason. `file-written` / `proposal-applied` stay the client-side write path.
 */
export type StaleReason = 'file-written' | 'proposal-applied' | 'commit' | 'external';

/** Attach failed, or a scan threw. The dialog stays open on top of this. */
export interface RepoFailed {
  phase: 'failed';
  /** The path that was attempted, for the retry affordance. */
  attempted: string | null;
  failure: AttachFailure;
}

export type RepoSlice =
  | RepoUnattached
  | RepoScanning
  | RepoAttached
  | RepoStale
  | RepoFailed;

/**
 * The five attach errors the dialog must render honestly, classified. The wire
 * gives a bare `{ error }` for four of them and a discriminated
 * `{ error, code:'no-manifests', repoName }` for the fifth, so the HTTP status
 * is the only thing separating "you picked your home directory" from "that
 * directory is not there". Classification happens once, at the client boundary
 * (2.4 owns it), and every surface downstream reads this union instead of
 * re-deciding from a status code.
 *
 * `no-manifests` is a NOTE, not an error wall — the repo is real, the scanner
 * found nothing it recognises.
 */
export type AttachFailure =
  | { kind: 'no-manifests'; repoName: string; message: string }
  | { kind: 'outside-browse-root'; message: string }
  | { kind: 'home-directory-itself'; message: string }
  | { kind: 'not-found'; message: string }
  | { kind: 'not-a-directory'; message: string }
  | { kind: 'scan-threw'; message: string }
  | { kind: 'transport'; message: string; status: number | null };

/**
 * The attach dialog. Unsheeted (§5.6) and designed by 2.4.
 *
 * `cursor` is where the browser currently is; `root` is the jail it cannot
 * ascend past; `parent` being null IS the top and is why the up control
 * disables. `entries` are directories only — this route never returns files —
 * and each carries `isRepo`, which drives the scannable tag that 2.4 is told to
 * keep verbatim.
 */
export interface AttachDialogState {
  open: boolean;
  root: string | null;
  cursor: string | null;
  parent: string | null;
  entries: BrowseEntry[];
  recents: RecentRepo[];
  /** Which pane of the dialog is live — recents, or the folder browser. */
  browsing: boolean;
  loading: boolean;
  failure: AttachFailure | null;
}

/* ========================================================================== *
 * 2. THE CANVAS SLICE — the graph, the scope, the selection
 * ========================================================================== */

/**
 * The five canvas states, and only five. Each is what the user can see, so each
 * carries exactly what that view needs and nothing it does not. S4's payload is
 * a ghost overlay and NOT a mutation of the document: the third invariant is
 * that understanding and editing are one document, and a proposal that merged
 * itself into that document before a click would break it.
 */
export type CanvasView =
  | { state: 'S0' }
  | { state: 'S1' }
  | { state: 'S2'; focus: FocusSpec }
  | { state: 'S3'; playback: FlowPlayback }
  | { state: 'S4'; proposal: TopologyProposal };

/**
 * S2. `nodeId` is the node that was clicked or mentioned; `edgeIds` are its
 * edges, resolved once so the renderer does not re-derive them per frame.
 * `origin` is kept because the breadcrumb chip in chat says which it was, and
 * because a focus the user performed must not be undone by a turn effect.
 */
export interface FocusSpec {
  nodeId: NodeId;
  edgeIds: EdgeId[];
  origin: 'click' | 'mention' | 'turn-effect' | 'rail';
}

/**
 * S3. One hop per step, in order, each carrying its own proof.
 *
 * `evidence: null` is the honest empty case the rail is told to keep verbatim —
 * "shape unknown, no evidence on this hop". It is `null` and not an omitted
 * field so that a hop without proof is impossible to skip past silently: every
 * consumer must handle it.
 */
export interface FlowPlayback {
  functionId: FunctionId;
  hops: FlowHop[];
  /** Index into `hops`. -1 before the first hop plays. */
  cursor: number;
  playing: boolean;
}

export interface FlowHop {
  from: NodeId;
  to: NodeId;
  /** The arch edge this hop rides, when one exists. */
  via: EdgeId | null;
  label: string | null;
  evidence: Evidence | null;
}

/**
 * S4. The topology ghost: nodes and edges the agent proposes, drawn dashed over
 * the grounded document with one Accept/Deny bar. The rail never shows any of
 * it — unaccepted topology is not part of the index.
 *
 * Unsheeted: sheet 12's gate is drawn for a RUN, not for a ghost overlay
 * (§5.6). The verify result is carried here because the harness's accept path
 * answers 409 with a `VerifyResult`, and a proposal rejected by the gate must
 * show what the gate said rather than a generic failure.
 */
export interface TopologyProposal {
  id: ProposalId;
  turnId: TurnId;
  title: string | null;
  rationale: string | null;
  nodes: SeqDiagramNode[];
  edges: SeqDiagramEdge[];
  status: 'pending' | 'accepted' | 'denied';
  verify: VerifyResult | null;
}

/**
 * Selection is what the reader chose. It is a LIST because sheet 06 draws a
 * multi state with a bounding rect, and a single `selectedId` would have to be
 * widened later by every lane that touched it.
 *
 * Selecting a container makes no claim about its members: sheet 06 is explicit
 * that the members inside a selected module wall are neither selected nor
 * dimmed, so nothing here expands a group id into its children.
 */
export interface Selection {
  nodeIds: NodeId[];
  edgeIds: EdgeId[];
  /** The last item added — the anchor for shift-extend and for the toolbar. */
  anchor: NodeId | null;
}

/**
 * DIMMING IS NOT A SELECTION EFFECT … EXCEPT WHEN IT IS, BY DECISION.
 * Sheet 06 originally rationed dimming to playback and explicit path-focus;
 * Decision 6 (docs/OWNER-PLAN-2026-08-24c.md §1) adds explicit selection:
 * "selecting a node recedes everything not on its path". The reason is carried
 * here rather than in a boolean so every consumer can see which ask produced
 * the recede, and a lane that wants to change the rule has to change this type.
 *
 * `null` means nothing is dimmed. Otherwise everything NOT lit recedes.
 */
export interface DimSpec {
  /**
   * WHO AUTHORED THIS DIM. Not decoration: an effect may only CLEAR a dim it
   * authored. ConnectedBoard's selection effect used to dispatch
   * `selectionDim(selection)` unconditionally on mount, and that is `null` for
   * an empty selection — so mounting the board wiped any dim another author had
   * put there. With `teach` in this union the guard can be written as the rule
   * it is, rather than as a special case.
   */
  /*
   * `lookup` IS THE FOURTH AND IT IS NOT `teach`. An engineer asking where
   * `buildDigest` is defined gets a file back; the part that holds it should
   * light. Riding the teach reason would have been one line less code and a
   * lie: `teach:step` carries a caption asserting a lesson, and stamping a
   * lookup as a lesson step is the same fault as a verb claiming an outcome
   * the engine never supplied. The teach lane measured that and refused to
   * emit it, which is why this reason exists.
   */
  reason: 'playback' | 'path-focus' | 'selection' | 'teach' | 'lookup';
  litNodeIds: NodeId[];
  litEdgeIds: EdgeId[];
}

/**
 * What subset of the graph is on the board. `roots` empty means the whole
 * system (S1). Drilling into a service pushes a new scope; Back pops one.
 *
 * `/archgraph.json` is all-or-nothing today (gap G7) and item 1.8 adds
 * `?scope=&depth=`, so this is currently applied client-side and becomes a
 * request parameter without changing shape.
 */
export interface GraphScope {
  roots: NodeId[];
  depth: number;
  /** How the reader got here, for the crumb trail. Oldest first. */
  trail: ScopeCrumb[];
}

export interface ScopeCrumb {
  nodeId: NodeId | null;
  label: string;
}

/** `{x, y, zoom}` — the transform, persisted per session with the document. */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/**
 * The seven detail rungs of sheet 08, as a number so they can be compared.
 * Rung 1 is full; detail leaves in a fixed order — expand row, subtitle, port,
 * title, silhouette, icon — and each rung leaves whole. Rung 7 is a dot.
 *
 * This is state and not a render-local because the census beside the field, the
 * legend and the LOD tests all have to agree about which rung is live.
 */
export type LodRung = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * The frame, and what the frame affords. Sheet 08: "the budget is the frame,
 * not a node count", and risk R9 is that v1's `DEFAULT_MAX_CARDS = 24` was
 * derived for a 1400x900 canvas while a three-pane shell at 1280 gives the
 * canvas about 614. So the budget is DERIVED from `size` at runtime and stored
 * beside it — never a constant.
 *
 * `budget` is a detail budget, not a node cap. The board never draws fewer
 * nodes than the graph has; it drops a rung.
 */
export interface CanvasFrame {
  width: number;
  height: number;
  /** Cards that fit at the current rung. Derived from `width`/`height`. */
  budget: number;
}

export interface CanvasSlice {
  view: CanvasView;
  scope: GraphScope;
  selection: Selection;
  dim: DimSpec | null;
  viewport: Viewport;
  frame: CanvasFrame;
  rung: LodRung;
  /** User-dragged positions, keyed by node id. Absent means ELK decides. */
  positions: Record<NodeId, { x: number; y: number }>;
  /** ELK runs off-thread; the board paints the previous layout meanwhile. */
  layout: 'idle' | 'laying-out' | 'failed';
  /** Per-node bullets from `/api/annotate`. `{}` when no provider is bound. */
  annotations: Record<NodeId, string[]>;
  /** The node whose MADR breakout is open, or null. */
  breakout: NodeId | null;
}

/* ========================================================================== *
 * 3. THE CHAT THREAD — turns, the in-flight turn, tool activity, coverage
 * ========================================================================== */

/**
 * WHAT AN ANSWER COULD AND COULD NOT SEE. This is the product's single
 * differentiating chip and the one claim a terminal agent structurally cannot
 * make: Sequence knows the digest cut at N of the graph's edges and which
 * components contributed nothing.
 *
 * IT LANDED, AND THE GUARD FIRED EXACTLY AS THIS COMMENT PREDICTED. The note
 * here used to say the shape was declared locally on purpose because
 * `AskCoverage` lived only in the analyzer and there was nothing to import, and
 * that when it reached `@sequence/api-types`, `types.test.ts` would fail on the
 * property set and the fix would be to import the wire type. On 2026-08-21 the
 * shape moved into the shared contract so the `result` event could declare the
 * field the server had always been sending; the drift guard went red on the same
 * run; the local interface is now an alias. Left in place as a worked example of
 * a comment that made its own obsolescence detectable.
 *
 * ABSENT, NEVER ZEROED, when there is no scanned graph to count against. A zero
 * denominator reads as "saw nothing" instead of "nothing to measure".
 */
/**
 * What the answer did NOT read — the wire shape, not a copy of it.
 *
 * This was a local interface with the same four fields, which was correct while
 * `AskCoverage` lived only inside the analyzer. Putting the shape into
 * `@sequence/api-types` (so the `result` event could finally declare the field
 * the server had always been sending) turned this into a redeclaration, and
 * `types.test.ts` caught it immediately: *"these state types are wire types
 * wearing a new name"*. Aliased rather than deleted because `Coverage` is the
 * name the rest of this package reads well with.
 */
export type Coverage = AskCoverage;

/**
 * The four groups of sheet 12.3, in the sheet's own order — cheapest first.
 * The group answers "how much should I care", which is why it is state and not
 * a lookup on the verb string.
 */
export type WorkGroup = 'read' | 'reason' | 'change' | 'run';

/**
 * One tool row. Sheet 12.2 fixes four slots left to right: the glyph for the
 * kind of work, what it did IN THE PAST TENSE, the identifier it did it to, and
 * a right cluster carrying the outcome. Only the first two are compulsory,
 * which is why `identifier` and `outcome` are nullable and `verb` is not.
 *
 * The verb is past tense because by the time a row is legible the call has been
 * made: a row that says "Searching the repo..." has to be rewritten a second
 * later, and a transcript that rewrites itself is not a record of anything. So
 * `status: 'running'` exists for the spinner-free pulse and NOT for a present-
 * tense verb — the verb is written once, in the past, when the row is created.
 *
 * `opens` is the right-hand affordance: anything wider than the row opens the
 * canvas or the index rail, never an expanded block inside the transcript.
 */
export interface WorkRow {
  id: string;
  group: WorkGroup;
  /** Past tense, one short clause. "Explored 12 files", "Read the graph". */
  verb: string;
  identifier: string | null;
  outcome: WorkOutcome | null;
  /**
   * Sheet 12.3: reading the attached graph carries a Measured tag, because the
   * cheapest demonstration of the product is saying where a number came from.
   * `null` where the row makes no provenance claim.
   */
  provenance: 'measured' | 'declared' | null;
  status: 'running' | 'done' | 'error';
  /** The stream event that produced this row, so a row is never invented. */
  from: AskStreamEvent['type'];
  opens: 'canvas' | 'ai-canvas' | 'rail' | 'review' | 'browser' | 'terminal' | null;
  /**
   * THE ROW IS THE TURN TELLING THE USER SOMETHING THEY DID NOT CHOOSE.
   *
   * Set only where a row announces a decision the ENGINE made about the turn —
   * today, the teach mode a question engaged without the Teach control being
   * touched. Such a row may never be folded: it landed as a settled
   * `group: 'reason'` row, `WorkProofStack` routed every settled reason row
   * into a disclosure that starts CLOSED and is headed "Reasoning", and the
   * mode switch the pipeline's own comment calls "MUST SAY SO ON SCREEN" was
   * one click away behind a label that does not mention it. Absent on every
   * ordinary row, because ordinary work is exactly what the folds are for.
   */
  announce?: true;
}

/**
 * The right cluster. A union rather than a formatted string because the diff
 * pair and the exit code are the two places sheet 12.7 permits a hue, and a
 * pre-formatted string cannot be coloured by claim.
 */
export type WorkOutcome =
  | { kind: 'count'; n: number; unit: string }
  | { kind: 'diff'; added: number; removed: number }
  | {
      kind: 'exit';
      code: number | null;
      /** Measured stdout+stderr from `command:log` — omit when absent, never invent. */
      output?: string;
    }
  | { kind: 'elapsed'; ms: number }
  | { kind: 'note'; text: string };

/**
 * THE EVIDENCE A TURN CARRIES. Item 2.6 / P3. Chat memory v2 persists work,
 * tool evidence and coverage across reload; v1 prose files still restore as
 * empty work (honest absence). A reload test asserts grounded fields come back.
 */
export interface TurnEvidence {
  tools: ToolResultRecord[];
  /** Repo-relative paths the pipeline actually read this turn. */
  filesRead: RepoPath[];
  /** Proposals this turn produced, by id. Contents live in the session slice. */
  proposals: ProposalId[];
}

export interface ToolResultRecord {
  id: string;
  name: string;
  /** The result text as the tool returned it. Never a summary of it. */
  text: string;
  /** `file:line` the tool cited, when it cited one. */
  evidence: string | null;
  at: number;
}

/**
 * THE ONE CANVAS EFFECT A TURN RESOLVES INTO. Exactly one, applied by the
 * store. `answer` is a real member and not the absence of one, because §2.5
 * requires the turn to SAY the canvas did not move; an optional effect would
 * make "no effect" and "we forgot to set an effect" the same value.
 *
 * Coverage is not a member of this union. §2.5 lists it as carried on every one
 * of the four outcomes, so it lives on the turn — putting it inside the union
 * would be four copies of one field.
 */
export type TurnEffect =
  | { kind: 'focus'; nodeIds: NodeId[]; edgeIds: EdgeId[]; play: FunctionId | null }
  | { kind: 'propose'; proposalId: ProposalId }
  | { kind: 'answer' }
  | { kind: 'act'; proposalId: ProposalId };

/**
 * The user's half of a turn. Sheet 12.1: a request is short, so it can afford a
 * bubble; it never holds a diff, a graph or a file list.
 *
 * `intents` and `context` are stored as sent, because the server composes the
 * prompt from the three parts separately and a replayed turn must replay the
 * same three parts, not a concatenation of them.
 */
export interface UserTurn {
  id: TurnId;
  role: 'user';
  text: string;
  intents: AskIntentInvocation[];
  /** The chips that were attached when this was sent. */
  chips: ContextChip[];
  /** The compiled grounded scope, as sent. */
  contextLines: string[];
  surface: AskSurfaceContext | null;
  /**
   * B3.2 — set when this send omitted earlier turns under HISTORY_CAP.
   * Shown once as a muted honesty line; not required on restore.
   */
  memoryTrim?: { droppedTurns: number } | null;
  at: number;
}

/**
 * The assistant's half. Sheet 12.1: plain full-width prose, no bubble, no
 * avatar, no role marker — which is a render fact, but it is why nothing here
 * carries a display name or an author.
 */
export interface AssistantTurn {
  id: TurnId;
  role: 'assistant';
  /** The user turn this answers. */
  replyTo: TurnId;
  text: string;
  work: WorkRow[];
  effect: TurnEffect;
  coverage: Coverage | null;
  evidence: TurnEvidence;
  usage: AskUsage | null;
  metrics: AskMetrics | null;
  /**
   * What filled the last prompt window (B3.4). Absent until a metered result
   * carries `contextBreakdown` — never invent sections client-side.
   */
  contextBreakdown: AskContextBreakdown | null;
  advisor: AdvisorNote | null;
  diagram: AskDiagram | null;
  /** `'surface'` means the text came off the on-screen program, unmetered. */
  source: 'surface' | 'provider' | null;
  runId: RunId | null;
  /** Set when the stream ended in `error` or was stopped by the user. */
  failure: TurnFailure | null;
  /** Wall-clock duration of the turn (assistant commit − user send), when measured. */
  durationMs?: number;
  at: number;
}

/**
 * A turn that did not finish. `stopped` is separate from `error` because a
 * cancelled turn is not a failure and must not be rendered as one — and because
 * cancellation is currently cosmetic on five of six AI paths (gap G3), so the
 * distinction is also the thing item 1.3's test is proving.
 */
export type TurnFailure =
  | { kind: 'stopped'; at: number }
  | {
      kind: 'error';
      message: string;
      providerResponse: string | null;
      status: number | null;
      /**
       * WHAT WOULD FIX THIS, carried from the server as data.
       *
       * `'provider'` means the turn failed because no usable model is
       * configured. It exists so a surface can offer the route the message
       * names WITHOUT matching the sentence - prose is what gets edited.
       *
       * Null is the common case and must stay so: an outage or a rate limit is
       * not fixed by opening Settings, and offering that route for them sends
       * the reader somewhere useless.
       */
      fix: 'provider' | null;
    };

export type Turn = UserTurn | AssistantTurn;

/**
 * The in-flight turn, held OUTSIDE the committed list. A partially streamed
 * answer is not a turn yet: appending it and then mutating it in place is how a
 * cancelled stream leaves half a sentence in the transcript that reloads as
 * fact.
 *
 * `firstTokenAt` exists to measure what item 1.2 is for. Time-to-first-token
 * equals full generation time today, because the `result` event carries the
 * entire answer at once and there is no delta variant on the wire.
 */
export interface InFlightTurn {
  turnId: TurnId;
  replyTo: TurnId;
  runId: RunId | null;
  phase: StreamPhase;
  startedAt: number;
  firstTokenAt: number | null;
  /** Accumulated text. Grows by deltas once item 1.2 lands; set once until then. */
  text: string;
  /**
   * Raw stream buffer used only while stripping tool JSON. Deltas append here
   * first; `text` is the stripped view. Without this, an incomplete tool dump
   * gets stripped mid-stream and the next delta (continuation of the dump)
   * paints as raw SVG/JSON pollution in chat.
   */
  streamRaw?: string;
  work: WorkRow[];
  evidence: TurnEvidence;
  usage: AskUsage | null;
  /** Live `Round k/n` — incremented on each `provider:start` frame. */
  providerRound: number;
  /** Resolved cap for this turn's `Round k/n` denominator. */
  roundCap: number;
  /** Last provider/tool/file progress event — drives the stall notice. */
  lastActivityAt: number;
  /**
   * Whether Stop can actually abort. TRUE on ask routes where client Stop
   * aborts the fetch and the server tears down the provider call and tool loop
   * (G3). FALSE elsewhere so the control stays honest.
   */
  abortable: boolean;
}

/**
 * `queued` covers the gap between send and the first server event, which is
 * where the composer must already look busy. `finalizing` is after `result` and
 * before the effect is applied — the one moment the canvas is about to move.
 */
export type StreamPhase =
  | 'queued'
  | 'streaming'
  | 'finalizing'
  | 'stopping'
  | 'done'
  | 'error';

/**
 * The stream as the reducer sees it: the sixteen wire variants plus the token
 * delta item 1.2 adds. Declared here and NOT in the wire package because the
 * wire does not have it yet — `grep "stream: *true"` over the analyzer returns
 * zero hits. When 1.2 lands, `AskStreamDelta` is deleted and `AskEvent`
 * collapses to `AskStreamEvent`; nothing else in this file moves.
 */
export interface AskStreamDelta {
  type: 'delta';
  text: string;
}

export type AskEvent = AskStreamEvent | AskStreamDelta;

/* ========================================================================== *
 * 4. THE COMPOSER SLICE
 * ========================================================================== */

/**
 * One context chip. Sheet 12.4 fixes what `@` may resolve to — an architecture
 * node, a file, or a function, each with the glyph its kind owns on the board —
 * and states that where nothing matches it SAYS SO and offers no free-text
 * fallback. So a chip always carries a `ref` that exists in the attached repo;
 * there is no `kind: 'text'` member, and adding one would be the product
 * lying about grounding in the one place it promises not to.
 *
 * The composer sheet draws no chip row. Item 2.7 requires chips with remove, so
 * their placement is unsheeted work — flagged, not invented here.
 */
export interface ContextChip {
  id: string;
  kind: ContextChipKind;
  /** A real `ArchNode.id`, a repo-relative path, or a `FunctionId`. */
  ref: string;
  label: string;
  /** For a node chip, the kind that picks its glyph. */
  nodeKind: NodeKind | null;
}

export type ContextChipKind = 'node' | 'file' | 'function' | 'canvas-block';

/**
 * One attachment, as the composer holds it.
 *
 * Deliberately NOT a `ContextChip` - see `attachments` on {@link ComposerSlice}
 * and the ruling on {@link ContextChip}. This carries no `ref`, because there
 * is nothing in the repository for it to refer to; that is what makes it an
 * attachment rather than a mention.
 */
export interface ComposerAttachment {
  /** sha256 of the stored content; the id the server files it under. */
  id: string;
  name: string;
  bytes: number;
  /** True when the store's cap bit and the text is not the whole thing. */
  truncated?: boolean;
}

/**
 * The `@` picker while it is open. `status: 'no-matches'` is a rendered state,
 * not an empty list — sheet 12.4 draws "No grounded matches" as its own row.
 */
export interface MentionQuery {
  query: string;
  /** Character offsets of the `@…` token inside the draft. */
  from: number;
  to: number;
  status: 'searching' | 'resolved' | 'no-matches';
  results: MentionResult[];
  activeIndex: number;
}

export interface MentionResult {
  kind: ContextChipKind;
  ref: string;
  label: string;
  /** The path or `:line` shown to the right of the name. */
  detail: string | null;
  nodeKind: NodeKind | null;
}

/**
 * The permission control under the composer. P3: Auto-edit and Full are typed
 * and gated by `enabled` until the user turns them on in Settings. Plan and
 * Propose are always available. Auto-edit writes proposed files without
 * Accept; Full also allows `run_command` under `.sequence/permissions.json`.
 */
/**
 * What the agent is allowed to do, weakest first.
 *
 * `plan` is the owner walk's item — "there should be a plan mode, planning mode
 * is really important" — and it is the one non-default mode this product can
 * honestly enable today, because it is STRICTLY WEAKER than what the tool
 * boundary already enforces. `autoEdit` and `full` opt in from Settings (P3).
 */
export type PermissionMode = 'plan' | 'propose' | 'autoEdit' | 'full';

export interface PermissionControl {
  mode: PermissionMode;
  /** Modes the user has turned on in Settings. `propose` is always present. */
  enabled: PermissionMode[];
}

/**
 * The model the composer names. There is NO route that lists available models —
 * `/api/ai-config` returns the one configured model as a string — so a models
 * submenu has no wire source and 2.7 must either ship a free-text field or the
 * engine must grow a list route. Recorded here rather than papered over with a
 * hardcoded array.
 */
export interface ModelSelection {
  model: string;
  origin: 'default' | 'api-key' | 'local' | 'unconfigured';
}

/**
 * The send button's four states, sheet 12.4. `disabled` is a DIFFERENT OBJECT,
 * not a faded one, and `running` becomes stop, so the control that started the
 * work is the control that ends it. Modelled as a union because the fourth
 * state — focus — is a ring on any of the other three and is not a member.
 */
export type SendState = 'disabled' | 'ready' | 'running';

export interface ComposerSlice {
  draft: string;
  /**
   * The configured model's context window, or null when nobody would say.
   *
   * Only Ollama reports a real one (`/api/show` carries the architecture's own
   * `context_length`); no OpenAI-compatible route exposes it. Null is therefore
   * an ordinary outcome, not a failure, and the surface draws nothing for it.
   */
  contextWindow: number | null;
  /**
   * Bumped when something asks for the composer to take focus.
   *
   * A NONCE RATHER THAN A BOOLEAN, because focus is an event and not a state:
   * a `focused: true` flag would have to be cleared by whoever consumed it,
   * and a second request arriving before that clear would be swallowed. The
   * number only ever goes up, so every request is distinguishable from the
   * one before it.
   *
   * Focusing a textarea is a DOM act no reducer can perform — this is the
   * store carrying the REQUEST, and the component performing it.
   */
  focusNonce: number;
  chips: ContextChip[];
  /**
   * WHAT THE USER BROUGHT that is not in the repository - a pasted log, a
   * dropped text file.
   *
   * A SEPARATE ARRAY FROM `chips`, and that is the whole point. The comment on
   * `ContextChip` rules that a chip always carries a `ref` that exists in the
   * attached repo, and that a text member "would be the product lying about
   * grounding in the one place it promises not to". That ruling stands. An
   * attachment is a different KIND of thing - a chip is a claim about the
   * repository, an attachment is evidence the user supplied - and holding them
   * in one array would erase exactly the distinction the ruling protects.
   *
   * Ids and metadata only. The CONTENT lives on disk under
   * `.sequence/attachments`, so a thread carrying a 128KB log does not carry
   * it again in every reducer state.
   */
  attachments: ComposerAttachment[];
  mention: MentionQuery | null;
  model: ModelSelection;
  permission: PermissionControl;
  /**
   * Sheet 12.4 draws a Work/Code mode strip below the composer and calls it
   * real session state. §2.1 of the plan defers Work mode entirely — one
   * persona, Code — because a Work session has no repo, therefore no evidence,
   * therefore nothing the board may draw. The field exists because the wire has
   * it (`jobMode` on the ask request) and sessions on disk carry it; the strip
   * is a 2.7 decision the book and the plan disagree about.
   */
  jobMode: 'work' | 'code';
  send: SendState;
  /** The `+` toolbelt. One menu, mode-specific, per sheet 12.4. */
  toolbeltOpen: boolean;
  /** Rows the composer replays into the ask body. Bounded by the store. */
  history: AskHistoryTurn[];
  /**
   * What the workspace chrome says the user is looking at (Architecture /
   * Whiteboard). Copied onto the user turn and the ask wire. Null on chat-alone.
   */
  askSurface: AskSurfaceContext | null;
  /**
   * Teach Mode (docs/teach-mode.md): the turn teaches — one concept, one
   * visual, one check-in — and every mutating tool refuses. A mode, not a
   * permission: it composes with any permission level by narrowing it.
   */
  teach: boolean;
  /**
   * What the learner already knows about this subject — ONE CLICK.
   *
   * Three values and no fourth. The one somebody will reach for is "not sure,
   * ask me some questions", and that is the interrogation bug arriving through
   * the UI: a lesson that opens by quizzing the learner about themselves has
   * taught nothing, exactly like one that opens by asking which chart kind they
   * want. The union is closed so a fourth cannot be added without deleting this.
   *
   * `null` is "not stated", which is NOT the same as `new` — it adds no skip to
   * the belt rather than asserting the learner is a beginner.
   */
  teachKnown: 'new' | 'used-it' | 'ship-it' | null;
}

/* ========================================================================== *
 * 5. THE RAIL SLICE
 * ========================================================================== */

/**
 * Sheet 11.2: three rungs and no fourth — board card, file, function. Modelled
 * as a union of rows rather than a recursive tree, because the sheet is
 * explicit that the indent never compounds: one step, applied once, even where
 * the file projection nests deeper.
 */
export type RailRow =
  | { rung: 'card'; id: string; label: string; count: number }
  | { rung: 'file'; id: string; path: RepoPath; label: string; functionCount: number }
  | { rung: 'function'; id: FunctionId; label: string; file: RepoPath; line: number };

/**
 * Coverage per path, for the rail badges of item 4.4: a package that
 * contributed nothing to the last answer is marked, with its edge count, rather
 * than looking identical to one that did.
 */
export interface PathCoverage {
  edges: number;
  inLastAnswer: boolean;
}

/**
 * The MADR breakout's data, from `nodeDetail`. One layout — what it is, its
 * parts, its files, its edges — replacing v1's four render branches selected by
 * three booleans.
 */
export interface NodeDetailView {
  nodeId: NodeId;
  node: ArchNode;
  detail: NodeDetail | null;
  /** The node's own edges, resolved, so the panel does not scan the graph. */
  edges: ArchEdge[];
  files: RepoPath[];
}

export interface RailSlice {
  rows: RailRow[];
  /** File paths whose functions are shown. The rail is closed by default per row. */
  expanded: RepoPath[];
  /** Sheet 11.2: density is solved by the filter and the grouping, never a shorter row. */
  filter: string;
  selectedFunctionId: FunctionId | null;
  selectedPath: RepoPath | null;
  /**
   * The node the reader asked to understand, or null.
   *
   * REPLACES a `detail: NodeDetailView | null` member that was declared,
   * seeded null and written by no reducer arm. A whole derived view does not
   * belong in the store anyway: `nodeDetailViewFor(graph, id)` builds it from
   * the graph the store already holds, so the ID is the state and the view is
   * a projection of it.
   *
   * This is the board's channel into the rail's explanation. Clicking a card
   * selected it and grounded the composer on it, and never opened the panel
   * that says WHY the node is there and where its edges were traced from -
   * which is the question a person clicks a node to ask.
   */
  selectedNodeId: NodeId | null;
  coverageByPath: Record<string, PathCoverage>;
  loading: boolean;
}

/* ========================================================================== *
 * 6. THE SESSION SLICE — sessions, the thread, proposals, memory
 * ========================================================================== */

/**
 * A file-edit proposal, per file, with its comments. v1 rendered a list of bare
 * filenames with one whole-set Accept and one Deny; Wave 5 needs per-file
 * accept/reject and line-anchored comments, and both need a place to live from
 * day 0 or the retrofit reaches every turn record.
 */
export interface FileEditProposal {
  id: ProposalId;
  turnId: TurnId;
  title: string | null;
  /**
   * WHY the assistant believes this is the right change, or null.
   *
   * `TopologyProposal` has carried one from the start and the board renders
   * it, so a proposed change to the ARCHITECTURE explained itself while a
   * proposed change to the CODE did not. Null is ordinary - a model may have
   * nothing to add beyond the title - and it draws nothing rather than an
   * empty row.
   */
  rationale: string | null;
  files: ProposedFile[];
  status: 'pending' | 'applying' | 'applied' | 'denied' | 'partial';
  /** Set when an accept came back 409 with the verify gate's own result. */
  verify: VerifyResult | null;
}

export interface ProposedFile {
  path: RepoPath;
  /** The full new content — this is a whole-file replace, not a patch. */
  content: string;
  decision: 'pending' | 'accepted' | 'rejected';
  /** The unified diff against what is on disk, once fetched. */
  diff: string | null;
  comments: LineComment[];
}

/**
 * A line-anchored comment. §5.2 item 3: the cheapest high-value item on the gap
 * list, because it turns review from a verdict into a steering instrument.
 *
 * `sentWith` records that the comment has reached the agent, so the same one is
 * not replayed twice — and so the reader can see which of their comments it
 * already has.
 *
 * `HANDED` RATHER THAN A TURN ID, and the distinction is not pedantry. A
 * comment is steered into the COMPOSER, where it sits until the reader presses
 * send; at the moment it is handed over there is no turn and therefore no id.
 * Recording a turn id then would mean inventing one, and this type is read by a
 * surface whose entire job is not inventing things.
 *
 * Nothing reads the value — DiffView asks only whether it is null — so the
 * honest marker costs nothing and the field stops implying a fact nobody has.
 *
 * The marker itself lives in `review/reviewModel.ts`: this file declares TYPES
 * ONLY, and a test enforces that no runtime value escapes the contract.
 */
export interface LineComment {
  id: string;
  line: number;
  text: string;
  sentWith: TurnId | 'handed-to-composer' | null;
  at: number;
}

/** The five review scopes stolen verbatim from Codex (§5.2 item 2). */
export type ReviewScope = 'unstaged' | 'staged' | 'commit' | 'branch' | 'last-turn';

/**
 * Git, relocated out of the rail into its own home (item 4.6). Held on the
 * session because "last turn" is a session concept, not a git one.
 */
export interface GitState {
  branch: string | null;
  changed: GitStatusFile[];
  scope: ReviewScope;
  /** Unified diffs by path, fetched on demand. */
  diffs: Record<string, string>;
}

/** `pending` = agent tool running; `live` = block streamed, turn open; `landed` = committed. */
export type CanvasBlockStatus = 'pending' | 'live' | 'landed';

export interface CanvasStoryStep {
  blockId: string;
  caption: string;
}

/** Guided story route — Archify-style click-through narrative over blocks. */
export interface CanvasStoryRoute {
  title: string;
  steps: CanvasStoryStep[];
}

/** One typed block on AI Canvas — grounded in a real `canvas.write_*` tool call. */
export interface CanvasDocBlock {
  id: string;
  type: 'markdown' | 'mermaid' | 'html' | 'react' | 'svg';
  title?: string;
  payload: string;
  status: CanvasBlockStatus;
}

export interface CanvasDoc {
  blocks: CanvasDocBlock[];
  storyRoute?: CanvasStoryRoute;
  /**
   * Validated SeqChart specs the model asked Sequence to draw (`propose_chart`
   * → `chart:proposal`). Data, never render code — `packages/web2/src/charts`
   * owns the pixels. Newest last; a lesson grows this list one concept per turn.
   *
   * TYPED, BECAUSE `unknown[]` MADE IT UNREADABLE. This was `unknown[]` while
   * `SeqChartView` and its eight family renderers sat with zero callers: the
   * specs landed here from the stream and nothing could read a `title` off one
   * without a cast. The array is the seam between a validated wire spec and the
   * renderer, and both sides already speak `SeqChart` — `@sequence/schema` is
   * where `SeqChartView` and `chartFixtures` get it too.
   */
  charts?: SeqChart[];
  /**
   * The current step of a lesson (`teach:step`, docs/teach-mode.md §3). One
   * field replaced wholesale, the way `storyRoute` is — a lesson advances one
   * concept at a time and the previous step is not history the board keeps.
   *
   * The board resolves `litNodeIds` against what it actually DRAWS before
   * dimming anything; see ConnectedBoard. Ids here are grounded (the server
   * validated them) but grounded is not the same as drawn — the graph has file
   * and module nodes the board does not paint.
   */
  teachStep?: { caption: string; litNodeIds?: string[] };
}

export interface SessionSlice {
  /** The index as the server keeps it. Ordering and titles are the server's. */
  sessions: SessionIndexEntry[];
  activeId: SessionId | null;
  /** Committed turns of the active session, oldest first. */
  turns: Turn[];
  /** The turn being streamed, or null. Never inside `turns`. */
  inFlight: InFlightTurn | null;
  proposals: Record<ProposalId, FileEditProposal>;
  /**
   * THE ARCHITECTURE AN AGENT PROPOSED, waiting for Accept or Deny.
   *
   * `TopologyProposal` and the board's entire S4 ghost layer — dashed nodes,
   * an Accept that runs back through `docEdit`, a Deny that drops the layer —
   * shipped complete, with fourteen tests, and `canvas/proposal` WAS
   * DISPATCHED BY NOTHING. The prompt asked the model for a fenced seqd block
   * and no code anywhere parsed one, so the feature could not be entered.
   *
   * ONE AT A TIME, and not a record keyed by id like `proposals` above. A file
   * proposal is a change to a set of files and two of them can coexist; a
   * topology proposal REPLACES what the board is showing, and the reducer says
   * so — "a second answer to the same question is still a second answer, and
   * merging them would show a topology no agent proposed".
   */
  topology: TopologyProposal | null;
  /** Typed artifact blocks streamed to AI Canvas during ask turns. */
  canvasDoc: CanvasDoc;
  /**
   * WHERE THE LAST SYMBOL LOOKUP FOUND ITS DECLARATION — `lookup:located`.
   *
   * HERE AND NOT IN `canvasDoc`, which is the whole reason this is a separate
   * field rather than a fifth key beside `teachStep`. `canvasDoc` is the
   * session's DOCUMENT: blocks, charts, a story route, a lesson step — things
   * that were authored during the session and are worth keeping. A lookup
   * result is not a document. It is a pointer that was true for one question,
   * and persisting it would restore a spotlight on a stale answer the next time
   * the session opened, with nothing on screen explaining why that part of the
   * board is lit.
   *
   * Replaced wholesale on each lookup for the same reason `teachStep` is: the
   * previous lookup is not history the board keeps.
   *
   * Ids are grounded — the server resolved every one against the scanned graph
   * — but grounded is not DRAWN. The board intersects with what it actually
   * paints before dimming anything; see `lookupDim` and ConnectedBoard.
   */
  lookupLocated?: string[];
  git: GitState;
  /**
   * A follow-up typed while a turn was still streaming, waiting its turn.
   *
   * `send` refuses while `inFlight` is unsettled, so a question typed
   * mid-stream used to be silently dropped — the reader pressed Enter, nothing
   * happened, and they had to notice and press it again.
   *
   * Held rather than auto-sent-later-silently: it is shown, and it can be
   * taken back. A question that fires itself two minutes after it was typed,
   * with no sign it was pending, is worse than one that was dropped.
   */
  queued: string | null;
  /** True while the active session's history is being hydrated from disk. */
  hydrating: boolean;
}

/* ========================================================================== *
 * 7. THE SHELL SLICE — panes, widths, breakpoints, theme
 * ========================================================================== */

/**
 * Three breakpoints, decided in the model layer before any CSS — R9's
 * mitigation, because deciding it in a media query is near-free early and an
 * expensive retrofit later. Boundaries: `wide` at 1100 and above, `medium`
 * from 820 to 1099, `narrow` below 820.
 */
export type Breakpoint = 'wide' | 'medium' | 'narrow';

/**
 * A pane. `column` is a real grid column; `overlay` is a floating panel over
 * the canvas; `hidden` is collapsed.
 *
 * The distinction is load-bearing and it is a locking test in 2.3: above 1100
 * the rail must render as a column and NOT as a dialog. v1's rail was a
 * `role="dialog"` collapsed by default, which is the defect being fixed.
 */
export type PaneMode = 'column' | 'overlay' | 'hidden';

export interface PaneState {
  mode: PaneMode;
  /** The user's dragged width, remembered. Clamped by the pane's own limits. */
  width: number;
  /** Whether the user has it open. Independent of `mode`. */
  open: boolean;
}

/**
 * Light is DEFERRED by owner ruling (Decision 1) and no light values are to be
 * tuned. The three-state preference is typed from day 0 anyway because the
 * token layer must support it or the retrofit is a rewrite: `system` means the
 * media query decides, and the two explicit values stamp the root.
 */
export type ThemePreference = 'dark' | 'light' | 'system';

export interface ShellSlice {
  breakpoint: Breakpoint;
  /** The window, measured. Everything below is derived from it. */
  frame: { width: number; height: number };
  chat: PaneState;
  rail: PaneState;
  /**
   * The user's open/closed intent for COLUMN mode, which an overlay never sets.
   *
   * WHY IT IS A MEMBER AND NOT RECONSTRUCTED. It is not the same fact as
   * `chat.open`: at `wide` the two are equal, and below it they diverge —
   * opening the rail as an overlay at 900px says nothing about what should
   * happen the next time the window is wide. `store.ts` used to rebuild it as
   * `{chat: chat.open, rail: rail.open}` on the way into the shell's reducers,
   * and said so in its own comment: "this reconstruction is exact only for the
   * three actions the store currently accepts, none of which changes a pane."
   * The pane actions landed with the controlled shell, so the reconstruction
   * stopped being exact and the fact moved here, where it is kept rather than
   * guessed.
   */
  intent: { chat: boolean; rail: boolean };
  /**
   * The pane the user resized last; the other one gives way. Ties break toward
   * the chat, which is the driver (product invariant 2).
   *
   * Also unrecoverable from the rest of the slice — nothing about two widths
   * says which one the cursor was on — and load-bearing: `shellModel.ts`
   * records that sharing the overflow between both panes instead made a 50px
   * drag move the pane 4px the WRONG WAY.
   */
  priority: 'chat' | 'rail';
  /**
   * The canvas's resulting width in pixels. Derived, and the invariant 2.3
   * tests is that it never falls below half of `frame.width`: the canvas is the
   * workspace and it never defaults to the minority pane.
   */
  canvasWidth: number;
  /** Which resizer is being dragged, for the cursor and the pointer capture. */
  dragging: 'chat' | 'rail' | null;
  theme: ThemePreference;
  /** Settings, attach and the like. One at a time; the shell has no routes. */
  overlay: ShellOverlay | null;
}

/**
 * Everything that opens over the three panes. A single nullable member rather
 * than a boolean per surface, because two open at once is not a state the shell
 * has a layout for and a set of booleans can express it.
 *
 * Settings and the attach dialog are both unsheeted (§5.6).
 */
export type ShellOverlay =
  | { kind: 'attach' }
  /*
   * The pane union now names the four the panel DRAWS. It was
   * 'provider' | 'permissions' | 'appearance' - there is no permissions pane
   * and no appearance pane, and light is deferred by Graphite decision so
   * there may never be one. A contract naming surfaces that do not exist is a
   * contract nothing can honour, which is why nothing did.
   */
  | { kind: 'settings'; pane: 'provider' | 'notifications' | 'hooks' | 'workspace' }
  | { kind: 'sessions' }
  /*
   * SEARCH. Carries no member for the same reason activity and rewind do not:
   * the question is "what is in this repository", and an opener that had to
   * name the query up front would be asking for the answer as the price of
   * asking the question.
   */
  | { kind: 'search' }
  /*
   * HELP. The onboarding row was marked done and corrected to "OVERSTATED —
   * not built": the whole of it was one Ctrl-K hint in the app bar, and a
   * person who never guesses that chord cannot reach ANY of the surfaces
   * below, because every one of them lives behind the palette.
   */
  | { kind: 'help' }
  /*
   * REWIND. Like activity it carries NO member, and for the same reason:
   * the question is about every checkpoint this write session has, not one
   * named checkpoint. Which one to put back is the thing the panel exists
   * to help a reader decide, so an opener that had to name it up front
   * would be asking for the answer as the price of asking the question.
   */
  | { kind: 'rewind' }
  | { kind: 'review'; proposalId: ProposalId }
  /**
   * P9 — THE ACTIVITY VIEW. It carries NO member, and that is a statement
   * rather than an omission.
   *
   * The other four kinds each name a subject the opener already has: which
   * settings pane, which proposal. This one has none, because the question it
   * answers is about ALL the runs at once — §5.2 of
   * `docs/research/v2-architecture-and-gaps.md`: "multi-agent work is unusable
   * without 'which of my N threads needs me' answerable from outside the app."
   * A `runId` here would make the overlay a run VIEWER opened on one run, and
   * the list would then need a second way in. The run a reader opens is held
   * inside the surface, where it lives exactly as long as the surface does.
   */
  | { kind: 'activity' };

/* ========================================================================== *
 * 8. THE NET SLICE
 * ========================================================================== */

/**
 * One request in flight. `abortable` is not decoration: on ask routes it means
 * Stop aborts the browser fetch and the server tears down the provider call and
 * tool loop (G3). A control that claims otherwise is the thing the type
 * refuses to let a lane render.
 */
export interface InflightRequest {
  id: string;
  route: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  startedAt: number;
  abortable: boolean;
}

export interface NetSlice {
  inflight: InflightRequest[];
  lastFailure: RemoteFailure | null;
  /**
   * Whether the platform probe has answered. There is no push channel beyond
   * the terminal socket (gap G6), so this is the boot probe's result and not a
   * live connection state.
   */
  reachable: boolean | null;
}

/* ========================================================================== *
 * 8b. THE TRUST SLICE — is this repository allowed to give orders and to run
 * ========================================================================== */

/**
 * THE TRUST MOMENT.
 *
 * A repository's `AGENTS.md` used to become the assistant's standing orders the
 * moment you attached it, and `pnpm test` used to run whatever that repo's own
 * package.json said it was. Both are now gated on ONE explicit decision, stored
 * OUTSIDE every repository so a repo cannot mark itself trusted
 * (`analyzer/src/server/repoTrust.ts`).
 *
 * UNTRUSTED MUST BE VISIBLE. The whole point of a boundary the user cannot see
 * is lost: a turn that quietly behaved differently, with no explanation, is the
 * failure `docs/vision.md` §5 names. So the state carries what the repository
 * is ASKING FOR — as data, never as instruction — and the strip shows it.
 *
 * A SEPARATE SLICE, not a field on `RepoSlice`. `RepoSlice` is a five-state
 * union describing what the SCAN found; trust is a fact about the person's
 * decision and survives a rescan, a stale marker and a failed attach. Folding
 * it in would mean writing it into five variants and losing it in four of them.
 */
export interface TrustSlice {
  /**
   * The root this answer is about, or null before the probe answers. NOT the
   * same as "untrusted": a surface that renders the untrusted strip before the
   * probe returns accuses every repository for as long as the request takes —
   * the same third-state lesson as `NetSlice.reachable`.
   */
  root: string | null;
  trusted: boolean;
  /** The repo's own instruction file, verbatim, as DATA. Null when it has none. */
  instructions: { file: string; text: string; truncated: boolean } | null;
  /** The disclosure is open — the reader is looking at what the repo asked for. */
  reviewing: boolean;
}

/* ========================================================================== *
 * 9. THE ROOT
 * ========================================================================== */

/**
 * One store. Target under 600 lines, zero imperative reads or writes from a
 * component — v1's board alone read seventeen selectors plus two `getState` /
 * `setState` pokes, and that coupling is what inflated its dependency closure
 * from 64 files to 110.
 *
 * The attach dialog's data hangs off `repo` rather than `shell`, because
 * `shell.overlay` decides whether it is VISIBLE and this decides what it shows.
 */
export interface AppState {
  shell: ShellSlice;
  repo: RepoSlice;
  attachDialog: AttachDialogState;
  canvas: CanvasSlice;
  rail: RailSlice;
  session: SessionSlice;
  composer: ComposerSlice;
  net: NetSlice;
  trust: TrustSlice;
}
