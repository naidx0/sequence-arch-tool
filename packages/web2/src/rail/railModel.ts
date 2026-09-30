/* ══════════════════════════════════════════════════════════════════════════
   THE INDEX RAIL'S PURE MODEL — items 4.1, 4.2, 4.3, 4.4
   packages/web2/src/rail/railModel.ts

   No React, no DOM, no fetch. Everything the rail decides is decided here, so
   that the three claims the wave is locked on — a function click produces a
   flow list, an uncovered subtree carries its badge, and a hop with no proof
   says so in the product's own words — are properties of a function and not of
   a render.

   ── WHAT THE SHEET FIXES, AND WHAT THIS FILE THEREFORE MAY NOT INVENT ─────
   docs/brand/graphite/pages/11-the-functions-rail.html:

     11.2  "Three rungs, and no fourth." Board card, file, function. The union
           in `state/types.ts` already has exactly three members; this module
           may never widen it, and a module node is deliberately NOT a card
           (see {@link buildRailRows}).
     11.5  The filter "counts hits, not scaffolding. A directory revealed only
           to expose a match below it is not itself a match. Counting the
           rendered rows instead of the matched ones reported '6 matches' for
           two files, and a count a reader can disprove by looking is worse
           than no count at all."
     11.6  "A function row that the scan could not resolve to a node on the
           board does not play. It selects its card instead, and says so — it
           never plays a flow assembled from a guess."

   ── THE HOP RULE, AND THE MEASUREMENT THAT FORCED IT ──────────────────────
   Measured on THIS repository, 2026-08-20, against the real engine
   (`/archgraph.json` and `/api/functions` off `sequence serve --repo .`):

       arch:      524 nodes · 997 edges · every one of them kind `import`
       functions: thousands of nodes and edges · every one of them kind `call`
       arch edges that cross a component:            0
       function call edges that cross a component:   0

   So on this repository there is no service-to-service call anywhere, and a
   flow rule that only ever emitted service→service hops would report an empty
   flow for every function while the scan holds only the proven calls. That
   is not honesty, it is a rule mis-fitted to its evidence.

   THE RULE: a hop is drawn between the two board nodes the two ends of a call
   resolve to, AT THE COARSEST LEVEL WHERE THEY DIFFER.

     - the callee is in another component  → the hop is service → service
     - the callee is in another file       → the hop is file → file
     - the callee is in the same file      → there is no hop; an internal call
                                             moves nothing on the board

   On a repository whose scan produces http/grpc/queue/db edges this degrades
   to exactly the service-to-service flow sheet 11.6 describes. On this one it
   produces 861 hops across 528 functions, every hop riding a real arch edge
   and carrying that edge's real `file:line`. Nothing is assembled from a guess
   at either scale.

   ── SEPARATORS ────────────────────────────────────────────────────────────
   The engine sends native separators — `packages\web2\src\rail` on this
   machine — and `state/types.ts` declares `RepoPath` as forward-slashed:
   "Native separators never reach the store." The normalisation happens here,
   once, in {@link toRepoPath}, for the same reason `explain.ts` does it in
   `normalizeComponentPath`: "Native separators are an artifact of the scanning
   machine, never of the repo." Coverage arrives from the engine ALREADY
   normalised, so the two sides can only agree if this side normalises too.
   ══════════════════════════════════════════════════════════════════════════ */

import type { GetArchGraphResponse, GetFunctionsResponse } from '@sequence/api-types';

import type {
  Coverage,
  FlowHop,
  FunctionId,
  FunctionIndex,
  NodeDetailView,
  NodeId,
  PathCoverage,
  RailRow,
  RepoPath,
} from '../state/types';

/* The graph family read at a depth off the wire response, exactly as
   `state/types.ts` does it — never a second import of the same declarations. */
type ScannedGraph = GetArchGraphResponse;
type ArchNode = ScannedGraph['nodes'][number];
type ArchEdge = ScannedGraph['edges'][number];
type Evidence = ArchEdge['evidence'][number];
type FunctionNode = GetFunctionsResponse['functionGraph']['nodes'][number];

/**
 * THE PRODUCT'S FIRST NON-NEGOTIABLE IN ONE LINE, AND IT IS VERBATIM.
 *
 * Item 4.2 and the plan's §6 both write this sentence in quotation marks and
 * both say to keep it. It is the whole of "grounded, not guessed" said where a
 * user can act on it: this hop happened, and we cannot show you the line that
 * proves it. Do not soften it to "no evidence", do not append a count, and do
 * not turn it into a tooltip.
 *
 * (`state/types.ts` renders the same sentence with a comma inside a prose
 * comment. The two build items that specify the STRING both use the em dash,
 * so the em dash is the string.)
 */
export const NO_EVIDENCE_ON_HOP = 'shape unknown — no evidence on this hop';

/**
 * Sheet 11.6: "A claim the source could not confirm is --unknown, and on this
 * rail it is a word, not a dead row… The only badge this rail is allowed to
 * draw, and it is grey."
 */
export const NOT_TRACED = 'Not traced';

/** The three board kinds a rail card may show — the set the board itself draws. */
const CARD_KINDS: ReadonlySet<string> = new Set(['service', 'datastore', 'topic']);

const BACKSLASH = String.fromCharCode(92);

/**
 * Native separator → repo separator. Total: an absent path is the empty path.
 *
 * Returning `''` rather than `undefined` is deliberate — every caller here
 * either compares or renders, and a `String(undefined)` reaching a row would
 * print the word "undefined" beside a real filename, which is the exact class
 * of defect CANON calls "a plausible-looking value".
 */
export function toRepoPath(path: string | null | undefined): RepoPath {
  if (typeof path !== 'string') return '';
  return path.split(BACKSLASH).join('/');
}

/* ========================================================================== *
 * THE FUNCTION INDEX
 * ========================================================================== */

/**
 * `/api/functions` → the two lookups every rail row and every playback needs.
 *
 * `state/types.ts` says why this is derived ONCE rather than per render:
 * "5,990 nodes and 7,759 edges on this repo, and rebuilding either map per
 * render is the class of defect the board already has with its per-edge box
 * map." Measured on a real repo, and the figure moves with every commit, so it is not pinned here.
 *
 * `byFile` is keyed by the NORMALISED path, because that is the key every
 * caller has — the rail's file rows come from `ArchNode.path`, which this
 * module normalises on the way in.
 */
export function buildFunctionIndex(response: GetFunctionsResponse): FunctionIndex {
  const graph = response.functionGraph;
  const byFile: Record<RepoPath, FunctionId[]> = {};
  const byId: Record<FunctionId, FunctionNode> = {};

  for (const node of graph.nodes) {
    byId[node.id] = node;
    const file = toRepoPath(node.file);
    (byFile[file] ??= []).push(node.id);
  }
  for (const file of Object.keys(byFile)) {
    byFile[file].sort((a, b) => (byId[a]?.startLine ?? 0) - (byId[b]?.startLine ?? 0));
  }

  return { graph, byFile, byId, warnings: response.warnings ?? [] };
}

/* ========================================================================== *
 * OWNERSHIP — which board card holds a node
 * ========================================================================== */

interface GraphIndex {
  byId: Map<NodeId, ArchNode>;
  /** Nearest board-card ancestor of any node id, memoised over the chain. */
  cardOf: (nodeId: NodeId) => NodeId | null;
  /** Repo-relative file path → the arch file node's id. */
  fileIdByPath: Map<RepoPath, NodeId>;
  /** `${srcId}>${dstId}` → the edge, for hop resolution in O(1). */
  edgeBetween: Map<string, ArchEdge>;
}

/**
 * ONE INDEX PER GRAPH OBJECT, FOR THE LIFE OF THAT OBJECT.
 *
 * Keyed weakly on the graph itself, so a rescan's new graph gets a new index
 * and the old one is collected with it — there is no invalidation to get wrong
 * and no cache to go stale against a graph that no longer exists.
 *
 * It is not a micro-optimisation. Every exported function here indexes the
 * graph, and `flowForFunction` is called once per function row: the grounded
 * tier walks every one of them, and rebuilding the parent map and a
 * 997-edge lookup on each walk turned a 40 ms pass into a 1.2 second one.
 * In the product the same shape is one click, but the state contract already
 * names this defect class on the board — "rebuilding either map per render is
 * the class of defect the board already has with its per-edge box map" — and
 * it is cheaper to not introduce it than to find it later.
 */
const INDEX_CACHE = new WeakMap<object, GraphIndex>();

function indexGraph(graph: ScannedGraph): GraphIndex {
  const cached = INDEX_CACHE.get(graph);
  if (cached) return cached;
  const built = buildGraphIndex(graph);
  INDEX_CACHE.set(graph, built);
  return built;
}

/**
 * The containment walk is the same one `explain.ts:componentOwnerLookup`
 * performs — walk `parentId` to the first ancestor that is a component — so
 * the rail's idea of "inside packages/web" and the engine's coverage figures
 * cannot disagree. Every node on a walk resolves to the same owner, so the
 * whole chain is memoised at once: O(nodes), not O(nodes × depth).
 */
function buildGraphIndex(graph: ScannedGraph): GraphIndex {
  const byId = new Map<NodeId, ArchNode>(graph.nodes.map((n) => [n.id, n]));
  const memo = new Map<NodeId, NodeId | null>();
  const fileIdByPath = new Map<RepoPath, NodeId>();
  const edgeBetween = new Map<string, ArchEdge>();

  for (const node of graph.nodes) {
    if (node.kind === 'file') fileIdByPath.set(toRepoPath(node.path), node.id);
  }
  for (const edge of graph.edges) {
    const key = `${edge.srcId}>${edge.dstId}`;
    if (!edgeBetween.has(key)) edgeBetween.set(key, edge);
  }

  const cardOf = (nodeId: NodeId): NodeId | null => {
    const hit = memo.get(nodeId);
    if (hit !== undefined) return hit;
    const chain: NodeId[] = [];
    const seen = new Set<NodeId>();
    let owner: NodeId | null = null;
    let cur: ArchNode | undefined = byId.get(nodeId);
    while (cur) {
      if (CARD_KINDS.has(cur.kind)) {
        owner = cur.id;
        break;
      }
      if (seen.has(cur.id)) break; // malformed parent cycle — never spin
      seen.add(cur.id);
      chain.push(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    for (const id of chain) memo.set(id, owner);
    memo.set(nodeId, owner);
    return owner;
  };

  return { byId, cardOf, fileIdByPath, edgeBetween };
}

/* ========================================================================== *
 * ITEM 4.1 — THE ROWS
 * ========================================================================== */

/**
 * The whole index, in repo order, as a flat list of three rungs.
 *
 * FLAT AND NOT A TREE, following the state contract: "Modelled as a union of
 * rows rather than a recursive tree, because the sheet is explicit that the
 * indent never compounds: one step, applied once." A row's ancestor is
 * therefore positional — the nearest preceding row of a coarser rung — which
 * is what {@link filterRailRows} uses and what the renderer uses to indent.
 *
 * A MODULE IS NOT A CARD. `mod:analyzer/0` is a real node with real files
 * under it, and drawing it as a fourth kind of card would either add a rung
 * (forbidden by 11.2) or list its files twice — once under the module and once
 * under the service. The board does not draw modules either; `CARD_KINDS` is
 * the same set `e2e/board-grounded.mjs` calls `drawable`, so the rail and the
 * canvas name the same things.
 *
 * A file with no board card above it is not in the index. Measured on this
 * repository: 0 of 486 file nodes. It is an omission and never a silent
 * substitution — nothing invents a card to hold it.
 */
export function buildRailRows(graph: ScannedGraph, functions: FunctionIndex | null): RailRow[] {
  const index = indexGraph(graph);

  const filesByCard = new Map<NodeId, ArchNode[]>();
  for (const node of graph.nodes) {
    if (node.kind !== 'file') continue;
    const card = index.cardOf(node.id);
    if (card === null) continue;
    (filesByCard.get(card) ?? filesByCard.set(card, []).get(card)!).push(node);
  }
  for (const files of filesByCard.values()) {
    files.sort((a, b) => toRepoPath(a.path).localeCompare(toRepoPath(b.path)));
  }

  const rows: RailRow[] = [];
  for (const node of graph.nodes) {
    if (!CARD_KINDS.has(node.kind)) continue;
    const files = filesByCard.get(node.id) ?? [];

    let cardCount = 0;
    const fileRows: RailRow[] = [];
    for (const file of files) {
      const path = toRepoPath(file.path);
      const ids = functions?.byFile[path] ?? [];
      cardCount += ids.length;
      fileRows.push({
        rung: 'file',
        id: file.id,
        path,
        label: file.label,
        functionCount: ids.length,
      });
      for (const id of ids) {
        const fn = functions?.byId[id];
        if (!fn) continue;
        fileRows.push({
          rung: 'function',
          id,
          label: fn.name,
          file: path,
          line: fn.startLine,
        });
      }
    }

    rows.push({ rung: 'card', id: node.id, label: node.label, count: cardCount });
    rows.push(...fileRows);
  }
  return rows;
}

/* ========================================================================== *
 * SHEET 11.5 — THE FILTER
 * ========================================================================== */

export interface FilteredRows {
  rows: RailRow[];
  /**
   * Hits, not rendered rows. `null` when there is no query at all, which is a
   * different fact from "zero hits" and reads differently in the header.
   */
  matches: number | null;
  /**
   * Matching rows the cap withheld. 0 when everything matching is on screen.
   *
   * SAID, NEVER SILENT. A list that quietly stops at 300 tells a reader their
   * repository contains 300 matches, and the number they are being shown is
   * the one thing they cannot check from the screen.
   */
  omitted: number;
}

/**
 * The most rows the rail will mount for one query.
 *
 * MEASURED PROBLEM, not a precaution. Typing one or two characters into the
 * filter — the exact gesture the filter exists for — matched thousands of rows
 * on this repository and mounted a DOM button for every one, stalling the whole
 * shell. The rail's own index carries 647 files and over three thousand
 * functions.
 *
 * 300 is chosen against the reader rather than the renderer: past a few
 * hundred rows nobody is scanning a list, they are refining the query, and the
 * honest response is to say how many more there are and let them type another
 * character.
 */
export const RAIL_ROW_CAP = 300;

/**
 * A row matches on its name or its repo-relative path; every match is shown
 * with its ancestors revealed; order still follows the repo.
 *
 * A FUNCTION MATCHES ON ITS NAME ONLY. Its "repo-relative path" is its file,
 * and letting the file's path match the function would make one hit on a
 * filename report itself once per function in that file — the "6 matches for
 * two files" defect sheet 11.5 records by name. The file row still matches on
 * its path, and revealing a matched file does not reveal its contents.
 */
export function filterRailRows(rows: RailRow[], query: string): FilteredRows {
  const q = query.trim().toLowerCase();
  /* No query means no cap: this is the tree the reader opened, already bounded
     by what they expanded, and truncating it would hide their own repository
     from them. The cap exists for the FILTER, which is where the unbounded
     match count comes from. */
  if (q === '') return { rows, matches: null, omitted: 0 };

  const hit = (row: RailRow): boolean => {
    if (row.label.toLowerCase().includes(q)) return true;
    return row.rung === 'file' && row.path.toLowerCase().includes(q);
  };

  const out: RailRow[] = [];
  let matches = 0;
  /* The nearest preceding row of each coarser rung, not yet emitted. */
  let pendingCard: RailRow | null = null;
  let pendingFile: RailRow | null = null;

  for (const row of rows) {
    if (row.rung === 'card') {
      pendingCard = row;
      pendingFile = null;
      if (hit(row)) {
        matches += 1;
        out.push(row);
        pendingCard = null;
      }
      continue;
    }
    if (row.rung === 'file') {
      pendingFile = row;
      if (hit(row)) {
        matches += 1;
        if (pendingCard) out.push(pendingCard);
        pendingCard = null;
        out.push(row);
        pendingFile = null;
      }
      continue;
    }
    if (hit(row)) {
      matches += 1;
      if (pendingCard) out.push(pendingCard);
      pendingCard = null;
      if (pendingFile) out.push(pendingFile);
      pendingFile = null;
      out.push(row);
    }
  }

  /* Capped AFTER the walk, so `matches` still counts every hit — the number
     the reader needs is how many exist, not how many survived the cap. */
  if (out.length > RAIL_ROW_CAP) {
    return { rows: out.slice(0, RAIL_ROW_CAP), matches, omitted: out.length - RAIL_ROW_CAP };
  }
  return { rows: out, matches, omitted: 0 };
}

/* ========================================================================== *
 * ITEM 4.4 — COVERAGE. THE STRONGEST THING SEQUENCE HAS.
 * ========================================================================== */

/**
 * Edges touching each component, deduped, keyed by the component's repo path.
 *
 * The denominator discipline is risk R4's, verbatim: "coverage on the wire,
 * denominator = graph.edges.length". An edge is counted once for the component
 * at each end, and once in total when both ends are the same component — the
 * same set arithmetic `computeAskCoverage` performs when it builds
 * `withEdgesInGraph`, so the number beside a badge and the number the engine
 * counted describe the same edges.
 */
export function componentEdgeCounts(graph: ScannedGraph): Record<RepoPath, number> {
  const index = indexGraph(graph);
  const pathOf = (nodeId: NodeId): RepoPath | null => {
    const card = index.cardOf(nodeId);
    if (card === null) return null;
    const node = index.byId.get(card);
    if (!node) return null;
    return toRepoPath(node.path ?? node.label);
  };

  const counts: Record<RepoPath, number> = {};
  for (const edge of graph.edges) {
    const src = pathOf(edge.srcId);
    const dst = pathOf(edge.dstId);
    for (const path of src === dst ? [src] : [src, dst]) {
      if (path === null) continue;
      counts[path] = (counts[path] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Per-component coverage for the rail's badges.
 *
 * ABSENT, NEVER ZEROED. With no answer yet there is nothing to be covered BY,
 * so every component is unmarked rather than marked as missed — the same rule
 * `state/types.ts` states for `Coverage` itself ("a zero denominator reads as
 * 'saw nothing' instead of 'nothing to measure'").
 *
 * A component the engine named in NEITHER list has no entry. Coverage makes no
 * claim about a package with no edges at all, and a rail that badged it would
 * be making one on the engine's behalf.
 */
export function coverageByPath(
  graph: ScannedGraph,
  coverage: Coverage | null,
): Record<string, PathCoverage> {
  if (coverage === null) return {};
  const counts = componentEdgeCounts(graph);
  const out: Record<string, PathCoverage> = {};
  for (const path of coverage.packagesSeen) {
    out[path] = { edges: counts[path] ?? 0, inLastAnswer: true };
  }
  for (const path of coverage.packagesMissed) {
    out[path] = { edges: counts[path] ?? 0, inLastAnswer: false };
  }
  return out;
}

/**
 * The badge line item 4.4 writes: `packages/web · 1,545 edges · not in the
 * last answer`. `null` for a component that WAS read — the absence of a badge
 * is the positive state, because four hundred rows each carrying "read" is a
 * rail that says nothing.
 *
 * The warning mark is NOT in this string. Sheet 11.7: "Every coloured state on
 * this sheet also carries a word", and the glyph is a glyph — it is drawn from
 * the icon vocabulary beside this text, never typed into it. Sheet 11.3
 * forbids a typed character standing in for a mark outright: "a typed
 * character carries no stroke weight, no grid and no colour inheritance, so it
 * cannot be part of a vocabulary."
 */
export function coverageBadgeText(path: RepoPath, coverage: PathCoverage): string | null {
  if (coverage.inLastAnswer) return null;
  const n = coverage.edges;
  /* "1 edges" is the shape of a sentence nobody read before shipping it, and a
     reader who notices it stops trusting the number beside it. */
  const edges = `${n.toLocaleString('en-US')} ${n === 1 ? 'edge' : 'edges'}`;
  return `${path} · ${edges} · not in the last answer`;
}

/* ========================================================================== *
 * ITEM 4.2 — THE FLOW
 * ========================================================================== */

export interface FlowTrace {
  functionId: FunctionId;
  /** The board node the function's own file sits in. `null` = unplaceable. */
  originNodeId: NodeId | null;
  hops: FlowHop[];
  /** Sheet 11.6: false ⇒ do not play; select the card and say "Not traced". */
  traced: boolean;
}

/**
 * One function → the flow the scan can prove, in call order.
 *
 * See the header for the hop rule and the measurement behind it. Three things
 * this function will not do:
 *
 *   - it never emits a hop whose ends are the same node, because a node
 *     lighting itself is not a flow;
 *   - it never invents `via` or `evidence`. A hop with no arch edge behind it
 *     carries `null` for both and the renderer says {@link NO_EVIDENCE_ON_HOP};
 *   - it never dedupes across DIFFERENT pairs, only across repeats of the same
 *     pair — twenty calls into one file are one hop, and the board would
 *     otherwise flash the same edge twenty times.
 */
export function flowForFunction(
  functionId: FunctionId,
  functions: FunctionIndex | null,
  graph: ScannedGraph,
): FlowTrace {
  const empty: FlowTrace = { functionId, originNodeId: null, hops: [], traced: false };
  if (!functions) return empty;

  const source = functions.byId[functionId];
  if (!source) return empty;

  const index = indexGraph(graph);
  const sourceFileId = index.fileIdByPath.get(toRepoPath(source.file)) ?? null;
  const sourceCardId = sourceFileId ? index.cardOf(sourceFileId) : null;
  const originNodeId = sourceCardId ?? sourceFileId;
  if (originNodeId === null) return empty;

  const hops: FlowHop[] = [];
  const seen = new Set<string>();

  for (const edge of functions.graph.edges) {
    if (edge.srcId !== functionId) continue;

    /* The callee may be a function span, or a boundary node that reuses an
       arch id outright (`FunctionNodeKind` is 'function' | 'service' |
       'datastore' | 'topic'). Both are resolved; neither is guessed. */
    let targetFileId: NodeId | null = null;
    let targetCardId: NodeId | null = null;
    const callee = functions.byId[edge.dstId];
    if (callee && (callee.kind === undefined || callee.kind === 'function')) {
      targetFileId = index.fileIdByPath.get(toRepoPath(callee.file)) ?? null;
      targetCardId = targetFileId ? index.cardOf(targetFileId) : null;
    } else if (index.byId.has(edge.dstId)) {
      targetFileId = edge.dstId;
      targetCardId = index.cardOf(edge.dstId);
    }

    let from: NodeId | null = null;
    let to: NodeId | null = null;
    if (sourceCardId && targetCardId && sourceCardId !== targetCardId) {
      from = sourceCardId;
      to = targetCardId;
    } else if (sourceFileId && targetFileId && sourceFileId !== targetFileId) {
      from = sourceFileId;
      to = targetFileId;
    }
    if (from === null || to === null) continue;

    const key = `${from}>${to}`;
    if (seen.has(key)) continue;
    seen.add(key);

    /*
     * `via` AND `evidence` ARE LOOKED UP AT DIFFERENT LEVELS, ON PURPOSE.
     *
     * `via` is "the arch edge this hop rides, when one exists" — a BOARD edge,
     * the thing the canvas lights — so it is looked up between the hop's own
     * endpoints and is null when the scan drew no edge there.
     *
     * `evidence` is the PROOF that the hop happened, and the proof of a
     * service-to-service hop is normally an edge one level down: this
     * repository's scan joins `file:…/one.ts` to `file:…/gate.ts` with a real
     * `import` at a real line, and nothing at all joins `svc:alpha` to
     * `svc:beta`. Reading the proof only at the coarse level would throw away
     * the `file:line` the scan actually holds and report the strongest state
     * this rail can reach — a hop with evidence — as the weakest one.
     *
     * Neither is ever synthesised. When the finer lookup misses too, both stay
     * null and the row says {@link NO_EVIDENCE_ON_HOP}.
     */
    const arch = index.edgeBetween.get(key) ?? null;
    const proof =
      (sourceFileId && targetFileId
        ? index.edgeBetween.get(`${sourceFileId}>${targetFileId}`)
        : undefined) ?? arch;
    hops.push({
      from,
      to,
      via: arch?.id ?? null,
      label: edge.label ?? callee?.name ?? null,
      evidence: proof?.evidence?.[0] ?? null,
    });
  }

  return { functionId, originNodeId, hops, traced: hops.length > 0 };
}

/**
 * `file:line`, or the honest empty case verbatim.
 *
 * ONE FUNCTION, SO THERE IS ONE SENTENCE. Every surface that shows a hop — the
 * flow list, the trace strip, the playback line — goes through here, which is
 * what stops the third call site from writing "no evidence" and the fourth
 * from writing nothing at all.
 */
export function evidenceRef(evidence: Evidence | null): string {
  if (!evidence) return NO_EVIDENCE_ON_HOP;
  return `${toRepoPath(evidence.file)}:${evidence.line}`;
}

/* ========================================================================== *
 * ITEM 4.3 — NODE DETAIL
 * ========================================================================== */

/**
 * The MADR breakout's data for one node: what it is, what it does, its parts,
 * the files it is made of, and its own edges.
 *
 * `detail` is `null` rather than an empty shape when `nodeDetail` has no slot
 * for this node. `seqdNodeDetailFromStructuralTree` derives the map per graph
 * and it does not cover every id; a `{whatItIs: ''}` invented here would put an
 * empty heading on screen where the honest answer is that the scanner produced
 * no description.
 *
 * `edges` is the node's OWN edges, per the state contract's wording, "resolved,
 * so the panel does not scan the graph". On this repository a service card has
 * zero of them — all 997 edges join file nodes — and the panel says so rather
 * than borrowing its subtree's edges to look busier.
 */
export function nodeDetailViewFor(graph: ScannedGraph, nodeId: NodeId): NodeDetailView | null {
  const index = indexGraph(graph);
  const node = index.byId.get(nodeId);
  if (!node) return null;

  const files: RepoPath[] = [];
  for (const candidate of graph.nodes) {
    if (candidate.kind !== 'file') continue;
    if (candidate.id === nodeId || index.cardOf(candidate.id) === nodeId) {
      files.push(toRepoPath(candidate.path));
    }
  }
  files.sort((a, b) => a.localeCompare(b));

  const detail = graph.nodeDetail?.[nodeId] ?? null;
  return {
    nodeId,
    node,
    detail: detail ? normaliseDetail(detail) : null,
    edges: graph.edges.filter((e) => e.srcId === nodeId || e.dstId === nodeId),
    files,
  };
}

/** `parts` are repo paths from the scanner, so they arrive natively separated. */
function normaliseDetail(detail: NodeDetailView['detail']): NodeDetailView['detail'] {
  if (!detail) return detail;
  return { ...detail, parts: (detail.parts ?? []).map(toRepoPath) };
}
