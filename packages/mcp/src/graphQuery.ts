import type { ArchGraph, ArchEdge, ArchNode, FunctionGraph, FunctionNode } from '@sequence/schema';

/**
 * Targeted graph queries — the moat, in an answer-shaped package.
 *
 * P6 asked whether Sequence can replace a main coding agent. It cannot, and the
 * honest strategy is the inverse: be the thing those agents READ. The grounded graph
 * is the one asset Claude Code and Cursor cannot produce — ask them "what calls the
 * orders service?" and they grep and infer; Sequence knows, from a static scan, with
 * every edge traced to a file and line.
 *
 * But `scan_repo` hands back the WHOLE graph — megabytes of JSON on a monorepo this
 * size. (No count is pinned here on purpose. Three separate figures were quoted across
 * this package and all three went stale; `graphQueryRepo.test.ts` measures the corpus
 * instead, and caught this very line the day a scanner change moved the node count.)
 * An agent asking a
 * one-line question has to swallow the entire codebase's topology and re-derive the
 * answer, which is precisely the context-dump problem Sequence exists to avoid.
 *
 * (The figure this docblock carried until 2026-08-19 — "0.47 MB / 1326 nodes" — was
 * measured on `test/fixtures/shopfront` and written up as though it described the
 * monorepo. `docs/research/v32-scale-and-gaps.md` §7 retracts it. A tool that sells
 * groundedness cannot be wrong about its own repository.)
 *
 * So these answer the question instead, and carry the EVIDENCE with the answer — the
 * file and line that justify each edge — because an unciteable answer from a tool
 * that sells groundedness is worth nothing.
 *
 * ## Why this module was rebuilt (2026-08-19)
 *
 * Measured against `rg` on the twelve most-imported files in this repo, `who_calls`
 * recalled **68.8% of the true importers at 4.5x ripgrep's token cost**. A grounding
 * tool beaten by grep on recall AND on price has no reason to exist. Three causes,
 * all fixed below:
 *
 *   1. **Ambiguous names resolved silently and wrongly.** Dozens of filenames in this
 *      repo are borne by more than one file — `index.ts` by fifteen of them.
 *      Asking about `store.ts` answered about `packages/analyzer/src/server/store.ts`
 *      (25 importers) when the name's busiest bearer is `packages/web/src/state/store.ts`
 *      (78) — 0% recall, delivered as a complete answer with citations. Now ambiguity
 *      is ranked by degree and the losers are NAMED ({@link GraphQueryAnswer.alsoNamed}),
 *      and a path or path-suffix is accepted as the query so the agent can be exact.
 *   2. **The cap cut real answers.** `MAX_HITS_PER_DIRECTION = 40` against a real
 *      distribution topping out at 78.
 *   3. **Every function name returned `null`.** The FunctionGraph — thousands of call
 *      edges on this repo — had no agent-facing surface at all. Pass one in
 *      via {@link QueryOptions.functions} and symbol questions answer.
 *
 * Re-measured on the same twelve questions after the rebuild: full recall of the true
 * importers. (The precision figure this docblock once carried was CIRCULAR — who_calls'
 * callers ARE the graph's in-edges, so precision measured against that same graph can
 * only be 100%. The token ratio depended on an rg invocation whose harness no longer
 * exists. Both retracted rather than restated.) — and on six symbol questions, five answered
 * (the sixth is a const, which the function index does not hold) at **0.15x**, because
 * a call graph is smaller than every textual occurrence of an identifier.
 */

export interface CallerHit {
  /** The node id on the other end of the edge. */
  id: string;
  /** Human label, when the graph has one. */
  label?: string;
  kind: string;
  /** Repo-relative path, forward-slashed. The thing an agent actually opens. */
  path?: string;
  /** http | queue_publish | queue_consume | import | call */
  via: string;
  /** Owning service/topic, when the endpoint is a file inside one. */
  service?: string;
  /**
   * How many hops from the target this hit is: 1 is a direct neighbour, 2 reaches it
   * through one intermediary, and so on. Present only when a depth above 1 was asked
   * for, so a default answer is byte-identical to what it always was.
   *
   * It is reported because "calls the target" and "reaches the target through two
   * files" are different claims, and an agent that cannot tell them apart will edit
   * the wrong file. Each node appears once, at its SHORTEST distance.
   */
  depth?: number;
  confidence?: number;
  /** Where the claim comes from. Never empty for a deterministic edge. */
  evidence: { file: string; line?: number; snippet?: string }[];
}

/** A node that carries the SAME name as the one that won resolution. */
export interface Alternative {
  id: string;
  path?: string;
  /** Edges touching it — why it lost, stated rather than hidden. */
  degree: number;
}

export interface GraphQueryAnswer {
  /** The node the question resolved to, or null when nothing matched. */
  target: { id: string; label?: string; kind: string; path?: string; line?: number } | null;
  /** Nodes that reach the target. */
  callers: CallerHit[];
  /** Nodes the target reaches. */
  callees: CallerHit[];
  /**
   * Other nodes carrying the query's name, best-first, when the query was ambiguous.
   *
   * NEVER silent, for the same reason `omitted` is never silent: a resolution the
   * agent cannot see is a resolution it cannot correct, and "who calls store.ts"
   * answered about the wrong `store.ts` reads exactly like the right answer.
   */
  alsoNamed: Alternative[];
  /** Named alternatives when the query was ambiguous or missed. */
  didYouMean: string[];
  /**
   * A stated limit of the answer, when one applies. Set on a symbol miss: the
   * function graph indexes function DEFINITIONS, so `MAX_ASK_TOOL_ROUNDS` (a const)
   * and `propose_files` (a string in a tool table) genuinely are not in it. Saying
   * which index was searched turns "no" from a claim about the repo into a claim
   * about this tool, which is the only one it is entitled to make.
   */
  note?: string;
  /**
   * Edges dropped by the cap, if any. NEVER silent: a truncated answer that looks
   * complete is how an agent concludes "nothing else calls this" and deletes
   * something. Zero when the answer is whole.
   */
  omitted: { callers: number; callees: number };
}

export interface QueryOptions {
  /** Include file-level `import` edges. Default TRUE — see {@link queryNeighbours}. */
  includeImports?: boolean;
  /**
   * The function-level graph, when the caller has one. Without it, symbol questions
   * (`scanRepo`, `buildDigest`) resolve to nothing; with it they resolve to the
   * function and answer from real call edges.
   */
  functions?: FunctionGraph;
  /** Max hits per direction. Default {@link DEFAULT_MAX_HITS_PER_DIRECTION}. */
  limit?: number;
  /**
   * How many hops out from the target to walk. Default 1 (direct neighbours only),
   * clamped to {@link MAX_QUERY_DEPTH}.
   *
   * This is the question a graph answers that grep structurally cannot. Measured in
   * `docs/research/v2-architecture-and-gaps.md` §5.3 B4: the closure of
   * `web/src/state/store.ts` is 146 files at depth 4 — 2,360 tokens in ONE call,
   * against 6,786 tokens across 78 grep round trips to reach depth 2 alone.
   *
   * The currency is round trips, not tokens. The same research measured direct
   * one-hop lookups as 1.15x-2.9x WORSE than a well-formed grep, so depth is where
   * the graph earns its keep and the shallow case is not worth claiming.
   */
  depth?: number;
}

/** Hard ceiling on {@link QueryOptions.depth}. Beyond this a closure is the whole repo. */
export const MAX_QUERY_DEPTH = 5;

const label = (n: ArchNode): string => (n as { label?: string }).label ?? n.id;
const nodePath = (n: ArchNode): string | undefined => {
  const p = (n as { path?: string }).path;
  return p ? p.replace(/\\/g, '/') : undefined;
};

/* --------------------------------------------------------------- indexing -- */

interface GraphIndex {
  byId: Map<string, ArchNode>;
  degree: Map<string, number>;
}

/**
 * Node lookups were `graph.nodes.find(...)` inside a filter over every edge — 1,318
 * nodes x edges, walked several times per query. Memoised per graph object so
 * repeated queries in one process pay for it once, and so `degree` (which decides
 * ambiguous resolutions) is computed exactly once rather than per candidate.
 */
const INDEX = new WeakMap<object, GraphIndex>();
function indexOf(graph: ArchGraph): GraphIndex {
  const cached = INDEX.get(graph as object);
  if (cached) return cached;
  const byId = new Map<string, ArchNode>();
  for (const n of graph.nodes) byId.set(n.id, n);
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    degree.set(e.srcId, (degree.get(e.srcId) ?? 0) + 1);
    degree.set(e.dstId, (degree.get(e.dstId) ?? 0) + 1);
  }
  const built = { byId, degree };
  INDEX.set(graph as object, built);
  return built;
}

/* ------------------------------------------------------------- resolution -- */

/** A service beats a topic beats a module beats a file. */
function rankKind(n: ArchNode): number {
  return n.kind === 'service' ? 0 : n.kind === 'topic' ? 1 : n.kind === 'module' ? 2 : 3;
}

/**
 * Choose between same-named candidates: kind first, then how connected the node is.
 *
 * Degree is the disambiguator because it is the closest available proxy for "the one
 * they meant". `pageRank` is already on every file node and was the obvious candidate,
 * but it does not survive inspection here: `packages/gateway/src/store.ts` scores
 * 0.1921 on 4 edges while `packages/web/src/state/store.ts` scores 0.0174 on 78 — the
 * rank is computed per connected component, so it compares nothing across packages.
 * Raw degree answers the question that was asked: which one does this repo import.
 */
function preferConnected(graph: ArchGraph, candidates: ArchNode[]): ArchNode[] {
  const { degree } = indexOf(graph);
  return [...candidates].sort((a, b) => {
    const byKind = rankKind(a) - rankKind(b);
    if (byKind !== 0) return byKind;
    const byDegree = (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0);
    if (byDegree !== 0) return byDegree;
    // Total order, so the answer cannot depend on scan order.
    return a.id.localeCompare(b.id);
  });
}

/**
 * Does `path` end with `suffix` on a path-segment boundary?
 *
 * `state/store.ts` must match `packages/web/src/state/store.ts` and must NOT match
 * `packages/web/src/otherstate/store.ts`. A plain `endsWith` gets the second one
 * wrong, which is the whole reason a path query exists.
 */
function endsAtSegment(path: string, suffix: string): boolean {
  if (path === suffix) return true;
  if (!path.endsWith(suffix)) return false;
  return path[path.length - suffix.length - 1] === '/';
}

/**
 * Resolve a free-text name to a node.
 *
 * Deliberately forgiving, because the caller is an agent relaying a human's words:
 * exact id, then PATH (or path suffix), then exact label, then case-insensitive
 * label, then filename stem, then substring. Ties inside any tier are broken by
 * {@link preferConnected}, so "the busiest bearer of this name" wins rather than
 * "whichever the scanner happened to emit first".
 */
export function resolveNode(graph: ArchGraph, query: string): ArchNode | null {
  return resolveCandidates(graph, query)[0] ?? null;
}

/**
 * Every node that matches, best first. The tail is what {@link GraphQueryAnswer.alsoNamed}
 * reports: the alternatives an ambiguous query silently discarded before.
 */
function resolveCandidates(graph: ArchGraph, query: string): ArchNode[] {
  const q = query.trim();
  if (!q) return [];
  const nodes = graph.nodes;
  const { byId } = indexOf(graph);

  const byExactId = byId.get(q);
  if (byExactId) return [byExactId];

  // A path (or path suffix) is the ONLY way to disambiguate `index.ts`, borne by 14
  // files in this repo. It resolved to nothing before: ids carry a `file:` prefix and
  // OS-native separators, and no tier matched `path` at all.
  const asPath = q.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  if (asPath.includes('/')) {
    const byPath = nodes.filter((n) => {
      const p = nodePath(n)?.toLowerCase();
      return p !== undefined && endsAtSegment(p, asPath);
    });
    if (byPath.length > 0) return preferConnected(graph, byPath);
  }

  const exact = nodes.filter((n) => label(n) === q);
  if (exact.length > 0) return preferConnected(graph, exact);

  const lower = q.toLowerCase();
  const ci = nodes.filter((n) => label(n).toLowerCase() === lower);
  if (ci.length > 0) return preferConnected(graph, ci);

  // Stem match: a file label carries its extension, so "Icon" should find "Icon.tsx"
  // before anything merely CONTAINING those letters.
  const stem = (n: ArchNode) => label(n).toLowerCase().replace(/\.[a-z0-9]+$/, '');
  const byStem = nodes.filter((n) => stem(n) === lower);
  if (byStem.length > 0) return preferConnected(graph, byStem);

  // Substring is the last resort and must be RANKED, not first-past-the-post.
  // Unranked, asking for "Icon" returned AiConnectCta.tsx — lowercased
  // "aiconnectcta" contains "icon" at index 1. An incidental letter run inside an
  // unrelated word was beating an exact filename, and the answer looked authoritative.
  const partial = nodes.filter((n) => label(n).toLowerCase().includes(lower));
  if (partial.length > 0) {
    const { degree } = indexOf(graph);
    return [...partial].sort((a, b) => {
      const sa = stem(a);
      const sb = stem(b);
      const byBoundary = atWordBoundary(sa, lower) - atWordBoundary(sb, lower);
      if (byBoundary !== 0) return byBoundary;
      // Then the closest fit: the least unrelated text around the match.
      const byLength = sa.length - sb.length;
      if (byLength !== 0) return byLength;
      const byKind = rankKind(a) - rankKind(b);
      if (byKind !== 0) return byKind;
      return (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0);
    });
  }
  return [];
}

/**
 * Does `needle` start at a word boundary inside `haystack`? 0 = yes, 1 = no.
 *
 * Deliberately not a RegExp: the query is arbitrary user text, so a pattern built
 * from it would need escaping, and an escape bug here silently changes which node an
 * agent is told about. A character check cannot be injected into.
 */
function atWordBoundary(haystack: string, needle: string): number {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return 1;
    const before = at === 0 ? '' : haystack[at - 1];
    if (at === 0 || !/[a-z0-9]/.test(before)) return 0;
    from = at + 1;
  }
}

/**
 * Walk `parentId` up to the owning service/topic.
 *
 * This is what makes the tool answer the question that was actually asked. The
 * scanner records edges between FILES — `gateway/src/routes/orders.ts` calls
 * `orders/app/routes.py` — but a human (and an agent relaying one) asks "what calls
 * the orders service". Without rolling up, `who_calls orders` resolved the service
 * node, found no edge touching it directly, and answered "nothing in this scan":
 * technically true, completely useless, and worse than no tool because it reads as
 * an authoritative negative.
 */
function ownerOf(graph: ArchGraph, nodeId: string, depth = 0): ArchNode | null {
  if (depth > 12) return null; // parentId cycles are not expected; do not hang on one
  const node = indexOf(graph).byId.get(nodeId);
  if (!node) return null;
  if (node.kind === 'service' || node.kind === 'topic') return node;
  const parentId = (node as { parentId?: string }).parentId;
  if (!parentId || parentId === node.id) return null;
  return ownerOf(graph, parentId, depth + 1);
}

function hit(graph: ArchGraph, otherId: string, edge: ArchEdge): CallerHit {
  const node = indexOf(graph).byId.get(otherId);
  const owner = ownerOf(graph, otherId);
  const p = node ? nodePath(node) : undefined;
  return {
    id: otherId,
    ...(node ? { label: label(node) } : {}),
    kind: node?.kind ?? 'unknown',
    ...(p ? { path: p } : {}),
    // Which service the other end belongs to — the level the question was asked at.
    ...(owner && owner.id !== otherId ? { service: label(owner) } : {}),
    via: edge.kind,
    ...(typeof edge.confidence === 'number' ? { confidence: edge.confidence } : {}),
    evidence: (edge.evidence ?? []).map((ev) => ({
      file: ev.file.replace(/\\/g, '/'),
      ...(ev.line !== undefined ? { line: ev.line } : {}),
      ...(ev.snippet ? { snippet: ev.snippet } : {}),
    })),
  };
}

/**
 * Past this many per direction, the answer is capped and says so.
 *
 * Was 40, chosen before the import graph was real. Measured against this repo's
 * actual in-degree distribution the busiest file once had 78 importers; by
 * 2026-08-27 the hottest target sits at 202. Across the twelve hottest targets
 * the old tool returned 353 of 513 true callers; of the 160 it missed, **54 were
 * this cap** and the other 106 were the two wrong-node resolutions above. 250
 * cleared that distribution with headroom, and the compact rendering keeps even
 * a full answer around a few k tokens.
 *
 * ── RE-MEASURED 2026-09-05, BECAUSE A SCAN CHANGE MOVED THE DISTRIBUTION ──
 *
 * `ecceb7a4` made `export { x } from './y'` produce an edge — a re-export is a
 * dependency — which restored 251 previously-missing dependency links and lifted
 * every barrel index's in-degree. `packages/schema/src/index.ts` went to **251 importers: exactly one
 * over the cap**, so the busiest real target in this repository was being
 * answered with one caller silently omitted.
 *
 * Found by `tools/ci/counting-gate.mjs`, which runs every package's tests rather
 * than the three the usual gate names. Nothing else caught it, because nothing
 * else ran `@sequence/mcp`.
 *
 * The cap is raised, not the test relaxed: `graphQueryRepo.test.ts` encodes the
 * policy that **no real target is silently capped**, and that policy is the
 * reason this constant is measured instead of guessed. 320 restores roughly the
 * same headroom over 251 that 250 had over 202.
 */
export const DEFAULT_MAX_HITS_PER_DIRECTION = 320;

/** @deprecated Kept as the historical name; use {@link DEFAULT_MAX_HITS_PER_DIRECTION}. */
export const MAX_HITS_PER_DIRECTION = DEFAULT_MAX_HITS_PER_DIRECTION;

/* --------------------------------------------------- function-level lookup -- */

const fnPath = (n: FunctionNode): string => n.file.replace(/\\/g, '/');

interface FunctionIndex {
  byName: Map<string, FunctionNode[]>;
  byId: Map<string, FunctionNode>;
  inDeg: Map<string, number>;
  outDeg: Map<string, number>;
}
const FN_INDEX = new WeakMap<object, FunctionIndex>();
function functionIndex(fg: FunctionGraph): FunctionIndex {
  const cached = FN_INDEX.get(fg as object);
  if (cached) return cached;
  const byName = new Map<string, FunctionNode[]>();
  const byId = new Map<string, FunctionNode>();
  for (const n of fg.nodes) {
    byId.set(n.id, n);
    if (n.kind && n.kind !== 'function') continue; // boundary nodes reuse arch ids
    const key = n.name.toLowerCase();
    const list = byName.get(key);
    if (list) list.push(n);
    else byName.set(key, [n]);
  }
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  for (const e of fg.edges) {
    inDeg.set(e.dstId, (inDeg.get(e.dstId) ?? 0) + 1);
    outDeg.set(e.srcId, (outDeg.get(e.srcId) ?? 0) + 1);
  }
  const built = { byName, byId, inDeg, outDeg };
  FN_INDEX.set(fg as object, built);
  return built;
}

/**
 * Resolve a symbol name to its definitions, busiest first.
 *
 * Accepts a bare name (`scanRepo`), a qualified one (`scan.ts#scanRepo`,
 * `graphCache.ts::scanRepoCached`) and a function-node id. Ambiguity is handled the
 * same way as for files: rank, then NAME the losers.
 */
function resolveFunctions(fg: FunctionGraph, query: string): FunctionNode[] {
  const q = query.trim();
  if (!q) return [];
  const idx = functionIndex(fg);
  const direct = idx.byId.get(q);
  if (direct) return [direct];

  const m = /^(.*?)(?:#|::)([^#:]+)$/.exec(q);
  const name = (m ? m[2] : q).trim().replace(/\(\)$/, '');
  const file = m ? m[1].trim().replace(/\\/g, '/').toLowerCase() : '';
  let hits = idx.byName.get(name.toLowerCase()) ?? [];
  if (file) hits = hits.filter((n) => endsAtSegment(fnPath(n).toLowerCase(), file));
  if (hits.length === 0) return [];
  return [...hits].sort((a, b) => {
    const byIn = (idx.inDeg.get(b.id) ?? 0) - (idx.inDeg.get(a.id) ?? 0);
    if (byIn !== 0) return byIn;
    const byOut = (idx.outDeg.get(b.id) ?? 0) - (idx.outDeg.get(a.id) ?? 0);
    if (byOut !== 0) return byOut;
    return a.id.localeCompare(b.id);
  });
}

function fnHit(fg: FunctionGraph, otherId: string, kind: string, edgeLabel?: string): CallerHit {
  const node = functionIndex(fg).byId.get(otherId);
  if (!node) return { id: otherId, kind: 'unknown', via: kind, evidence: [] };
  const p = fnPath(node);
  return {
    id: otherId,
    label: node.name,
    kind: node.kind ?? 'function',
    path: p,
    via: kind,
    ...(edgeLabel ? { service: edgeLabel } : {}),
    // The call GRAPH does not record the call site's own line, only the enclosing
    // function's span. Cite the definition rather than invent a line: a fabricated
    // citation from a tool that sells groundedness is worse than a coarser true one.
    evidence: [{ file: p, line: node.startLine }],
  };
}

function answerFunctions(
  fg: FunctionGraph,
  matches: FunctionNode[],
  limit: number,
): GraphQueryAnswer {
  const idx = functionIndex(fg);
  const target = matches[0];
  const callers: CallerHit[] = [];
  const callees: CallerHit[] = [];
  for (const e of fg.edges) {
    if (e.dstId === target.id && e.srcId !== target.id) callers.push(fnHit(fg, e.srcId, e.kind, e.label));
    if (e.srcId === target.id && e.dstId !== target.id) callees.push(fnHit(fg, e.dstId, e.kind, e.label));
  }
  const seen = new Set<string>();
  const dedupe = (h: CallerHit): boolean => {
    const k = `${h.id}|${h.via}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  };
  const uniqueCallers = callers.filter(dedupe);
  seen.clear();
  const uniqueCallees = callees.filter(dedupe);
  return {
    target: {
      id: target.id,
      label: target.name,
      kind: 'function',
      path: fnPath(target),
      line: target.startLine,
    },
    callers: uniqueCallers.slice(0, limit),
    callees: uniqueCallees.slice(0, limit),
    alsoNamed: matches.slice(1, 8).map((n) => ({
      id: n.id,
      path: `${fnPath(n)}:${n.startLine}`,
      degree: (idx.inDeg.get(n.id) ?? 0) + (idx.outDeg.get(n.id) ?? 0),
    })),
    didYouMean: [],
    omitted: {
      callers: Math.max(0, uniqueCallers.length - limit),
      callees: Math.max(0, uniqueCallees.length - limit),
    },
  };
}

/* ------------------------------------------------------------------ query -- */

/**
 * Who calls this, and what does it call?
 *
 * `includeImports` defaults to TRUE, reversing the original choice. That default was
 * reasoned when the graph held 79 import edges against 8 of every other kind, and
 * excluding them looked like protecting the signal. It was measured wrong twice over:
 *
 *   1. The import graph was 2% real — `resolveImport` could not resolve TypeScript
 *      ESM `.js` specifiers, so 100% of packages/web's 1545 relative imports produced
 *      no edge. Fixed; the graph went from 87 edges to "2307 edges" as measured on
 *      2026-08-19. That figure is QUOTED because it is history — what the fix
 *      achieved on the day — not a live claim about the repo. The honesty guard in
 *      graphQueryRepo.test.ts exempts quoted figures for exactly this reason, and it
 *      caught this line once the corpus grew past its 5% tolerance.
 *   2. With a real graph, the old default made the COMMON question return nothing.
 *      `who_calls ProductComposer` gave 0 edges and 66 tokens of silence; with
 *      imports it gives 9 edges and 852 tokens of answer.
 *
 * The feared noise never materialised: the worst realistic target measures ~796
 * tokens. A default that returns an empty answer to the most-asked question is not a
 * conservative default, it is a broken one.
 *
 * Pass `includeImports: false` to see only cross-service traffic (http, queue) — the
 * right lens for "what talks to this service", and now an explicit choice rather than
 * a silent one.
 *
 * Resolution order is FILE-GRAPH FIRST, function graph second. A name that is both a
 * filename and a symbol (`buildFunctionGraph`) answers about the file, because the
 * file answer is the superset — and the function is offered in `didYouMean` so the
 * narrower question is one call away.
 */
export function queryNeighbours(
  graph: ArchGraph,
  query: string,
  opts: QueryOptions = {},
): GraphQueryAnswer {
  const limit = Math.max(1, opts.limit ?? DEFAULT_MAX_HITS_PER_DIRECTION);
  const candidates = resolveCandidates(graph, query);
  const target = candidates[0];

  if (!target) {
    // Before giving up on an ArchGraph miss, try the symbol graph. This is the whole
    // of finding #7 in the research doc: `scanRepo`, `MAX_ASK_TOOL_ROUNDS`,
    // `propose_files`, `acceptFileEditProposal` and `VERIFY_COMMAND_ALLOWLIST` all
    // returned `target: null` while the call edges that answer them sat unexposed.
    if (opts.functions) {
      const fnMatches = resolveFunctions(opts.functions, query);
      if (fnMatches.length > 0) return answerFunctions(opts.functions, fnMatches, limit);
    }
    const isIdentifier = /^[A-Za-z_$][\w$]*$/.test(query.trim());
    return {
      target: null,
      callers: [],
      callees: [],
      alsoNamed: [],
      // No service list behind a symbol question: "did you mean acp, analyzer,
      // desktop…" is ten tokens of noise in answer to "who calls scanRepo", and the
      // note below states the real reason the lookup failed.
      didYouMean: missSuggestions(graph, opts.functions, query, !(isIdentifier && !!opts.functions)),
      ...(opts.functions && isIdentifier
        ? {
            note:
              'The symbol index covers function definitions only — a constant, type, ' +
              'string literal or property name will not be found here even though it ' +
              'exists in the source.',
          }
        : {}),
      omitted: { callers: 0, callees: 0 },
    };
  }

  const keep = (e: ArchEdge): boolean => opts.includeImports !== false || e.kind !== 'import';

  // An edge counts if either endpoint IS the target, or belongs to it. Asking about a
  // service therefore surfaces the file-level calls its files make and receive, which
  // is the only reading of the question that is useful.
  const touches = (id: string): boolean => id === target.id || ownerOf(graph, id)?.id === target.id;

  const maxDepth = Math.min(MAX_QUERY_DEPTH, Math.max(1, Math.floor(opts.depth ?? 1)));

  /**
   * Breadth-first walk outward from the target, one hop per round.
   *
   * At `maxDepth === 1` this emits exactly what the previous straight filter emitted,
   * in the same order — it iterates `graph.edges` in order and the first round's
   * frontier test IS `touches`. That equivalence is deliberate: the default answer had
   * to stay byte-identical, and `graphQueryDepth.test.ts` asserts it.
   *
   * The two directions walk independently. A shared visited set would let a node
   * reached as a callee silently disappear from the callers answer, which is a wrong
   * answer that looks like a complete one.
   */
  const walk = (dir: 'callers' | 'callees'): CallerHit[] => {
    const out: CallerHit[] = [];
    // The scanner can emit the same call twice (two routes, one target). Collapse by
    // the fact being asserted, not by edge id, or the answer repeats itself.
    const seenFact = new Set<string>();
    // Node ids already attributed to a hop. This is what terminates a cycle, and it is
    // why every node is reported at its SHORTEST distance: a later, longer path to a
    // node already answered adds nothing an agent can act on.
    const reached = new Set<string>();
    let atFrontier: (id: string) => boolean = touches;

    for (let d = 1; d <= maxDepth; d++) {
      const layer: { far: string; e: ArchEdge }[] = [];
      for (const e of graph.edges) {
        if (!keep(e)) continue;
        const near = dir === 'callers' ? e.dstId : e.srcId;
        const far = dir === 'callers' ? e.srcId : e.dstId;
        if (!atFrontier(near)) continue;
        if (touches(far)) continue; // the target is never its own neighbour
        if (reached.has(far)) continue;
        layer.push({ far, e });
      }
      if (layer.length === 0) break;

      const next = new Set<string>();
      for (const { far, e } of layer) {
        const h = hit(graph, far, e);
        const k = `${h.id}|${h.via}|${h.evidence[0]?.file ?? ''}|${h.evidence[0]?.line ?? ''}`;
        if (seenFact.has(k)) continue;
        seenFact.add(k);
        // Only label the hop when one was asked for, so a depth-1 answer keeps the
        // exact shape every existing caller already parses.
        out.push(maxDepth > 1 ? { ...h, depth: d } : h);
        next.add(far);
      }
      // Marked after the round, so two edges into the same node within one hop both
      // report — they are two distinct pieces of evidence for the same relationship.
      for (const id of next) reached.add(id);
      atFrontier = (id) => next.has(id);
    }
    return out;
  };

  const callers = walk('callers');
  const callees = walk('callees');
  // Cap, and report what the cap removed. A silently truncated answer is worse than
  // a big one: the agent cannot tell "these are all the callers" from "these are the
  // first forty", and acts on the difference.
  const omitted = {
    callers: Math.max(0, callers.length - limit),
    callees: Math.max(0, callees.length - limit),
  };
  const { degree } = indexOf(graph);
  const targetPath = nodePath(target);
  return {
    target: {
      id: target.id,
      label: label(target),
      kind: target.kind,
      ...(targetPath ? { path: targetPath } : {}),
    },
    callers: callers.slice(0, limit),
    callees: callees.slice(0, limit),
    alsoNamed: candidates.slice(1, 8).map((n) => ({
      id: n.id,
      ...(nodePath(n) ? { path: nodePath(n) as string } : {}),
      degree: degree.get(n.id) ?? 0,
    })),
    didYouMean: sameNamedFunctions(opts.functions, target),
    omitted,
  };
}

/**
 * A file answered, but a function shares the name — say so.
 *
 * `who_calls buildFunctionGraph` resolves to `buildFunctionGraph.ts` (10 importers).
 * The caller may well have meant the function inside it (2 callers). Offering the
 * narrower question costs one line and saves a wrong conclusion.
 */
function sameNamedFunctions(fg: FunctionGraph | undefined, target: ArchNode): string[] {
  if (!fg) return [];
  const stem = label(target).toLowerCase().replace(/\.[a-z0-9]+$/, '');
  const hits = functionIndex(fg).byName.get(stem) ?? [];
  return hits.slice(0, 3).map((n) => `${fnPath(n)}#${n.name} (function)`);
}

/**
 * A miss must be USEFUL.
 *
 * It used to list the repo's services and topics, full stop — 9 names on this repo,
 * none of them related to a question about a symbol. Now the nearest real names come
 * first (files and functions that contain, or are contained by, the query), with the
 * service list as the fallback it always was.
 */
function missSuggestions(
  graph: ArchGraph,
  fg: FunctionGraph | undefined,
  query: string,
  serviceFallback: boolean,
): string[] {
  const q = query.trim().toLowerCase();
  const out: string[] = [];
  if (q.length >= 3) {
    // The containment test runs BOTH ways so `scanRepoo` finds `scanRepo` — but the
    // reverse direction has to be SUBSTANTIAL or it degenerates into noise that reads
    // as authority. Measured: `q.includes(name)` with a 3-character floor answered
    // "MAX_ASK_TOOL_ROUNDS" with `#ask` and `#round`, and "propose_files" with
    // `#file`. Requiring the match to be most of the query kills all three and still
    // finds `scanRepo` for `scanRepoo`.
    const floor = Math.max(4, Math.ceil(q.length * 0.6));
    for (const n of graph.nodes) {
      if (out.length >= 8) break;
      const l = label(n).toLowerCase();
      const stem = l.replace(/\.[a-z0-9]+$/, '');
      if (l.includes(q) || (stem.length >= floor && q.includes(stem))) out.push(nodePath(n) ?? label(n));
    }
    if (fg) {
      for (const [name, defs] of functionIndex(fg).byName) {
        if (out.length >= 12) break;
        if (name.includes(q) || (name.length >= floor && q.includes(name))) {
          out.push(`${fnPath(defs[0])}#${defs[0].name}`);
        }
      }
    }
  }
  if (out.length > 0 || !serviceFallback) return out;
  return graph.nodes
    .filter((n) => n.kind === 'service' || n.kind === 'topic')
    .map((n) => label(n))
    .sort()
    .slice(0, 20);
}

/* ------------------------------------------------------------- rendering -- */

/**
 * One-line-per-fact rendering, for an agent that wants prose over JSON.
 *
 * Rewritten to be CHEAP. The old form printed `service → label [via] — path:line` for
 * every hit, which repeats the filename twice (label and evidence path) and stamps
 * `[import]` on the ~99.6% of this repo's edges that are imports: 90 bytes per fact,
 * and the tool handed back this text AND the full JSON of the same facts, so the
 * agent paid for both. Measured on `who_calls repoServer.ts`: 42,272 bytes for 82
 * facts. The same 82 facts render here in about a fifth of that, and `path:line` is
 * the form an agent can act on directly.
 */
export function renderAnswer(a: GraphQueryAnswer, query: string): string {
  if (!a.target) {
    const alt = a.didYouMean.length ? ` Nearest names: ${a.didYouMean.join(', ')}.` : '';
    const note = a.note ? ` ${a.note}` : '';
    return `No node matches "${query}" in this scan.${alt}${note}`;
  }
  const where = a.target.path
    ? ` — ${a.target.path}${a.target.line !== undefined ? `:${a.target.line}` : ''}`
    : '';
  const lines = [`${a.target.label} (${a.target.kind})${where}`];

  // Ambiguity, stated before the answer rather than after it. An agent that reads
  // only the first two lines must still learn that its question had three answers.
  if (a.alsoNamed.length > 0) {
    const alts = a.alsoNamed.map((n) => `${n.path ?? n.id} (${n.degree} edges)`).join(', ');
    lines.push(`also named "${query}": ${alts} — ask by path to pick one`);
  }

  // `import` is the overwhelming majority of this repo's edges. Printing it on every line is 9 bytes
  // x every fact to say "normal"; the exceptions are what carry information.
  const majority = majorityVia([...a.callers, ...a.callees]);

  /**
   * Each row names the file at the OTHER end of the edge, then cites the line.
   *
   * Which file that line is IN differs by direction, and conflating the two was a
   * real defect in the first cut of this renderer: it printed the evidence path
   * verbatim, so `calls` listed `explain.ts:33` — the target's own path — for a
   * callee that is a different file entirely. It read as "explain.ts calls
   * explain.ts:33". Three cases, told apart rather than merged:
   *
   *   `path:line`        the citation is in this row's own file (every caller)
   *   `path @line`       the citation is in the TARGET; the header says which file
   *   `path ← file:line` neither — a service-level row whose evidence is in some
   *                      third file inside it. Cross-service edges only (8 of this
   *                      repo), and without it two different fixtures both
   *                      rendered as an identical `packages/gateway @5`.
   */
  const fmt = (h: CallerHit): string => {
    const ev = h.evidence[0];
    const own = h.path ?? h.label ?? h.id;
    const line = ev?.line !== undefined ? `:${ev.line}` : '';
    const at =
      !ev || ev.file === h.path
        ? `${own}${line}`
        : ev.file === a.target?.path
          ? `${own}${ev.line !== undefined ? ` @${ev.line}` : ''}`
          : `${own} ← ${ev.file}${line}`;
    const via = h.via === majority ? '' : ` [${h.via}]`;
    const named = h.kind === 'function' ? ` ${h.label}()` : '';
    // Service attribution, restored. `h.service` is populated at the two sites above
    // for CROSS-SERVICE rows only, and the compact rewrite stopped reading it — the
    // field went dead in the renderer while still being computed. "which service is
    // this caller in" is the question an architecture tool exists to answer, and on
    // this repo it fires on a handful of edges, so it is not what made the old format
    // expensive. What was expensive was the filename twice and an `[import]` stamp on
    // every one of the other 2301 rows; both of those stay gone.
    const owner = h.service ? `${h.service} → ` : '';
    return `  ${owner}${at}${named}${via}`;
  };
  /** True when any row in this direction cites a line in the TARGET rather than itself. */
  const citesTarget = (hits: CallerHit[]): boolean =>
    hits.some((h) => h.evidence[0]?.line !== undefined && h.evidence[0]?.file === a.target?.path);
  const head = (hits: CallerHit[], omitted: number, verb: string): string => {
    if (hits.length === 0) return `${verb}: (nothing in this scan)`;
    const kind = majority ? ` [${majority}]` : '';
    const at =
      citesTarget(hits) && a.target?.path ? ` — @N is a line in ${a.target.path}` : '';
    return `${verb} ${hits.length + omitted}${kind}${at}:`;
  };

  lines.push(head(a.callers, a.omitted.callers, 'called by'));
  for (const c of a.callers) lines.push(fmt(c));
  // A truncated answer that looks complete is how an agent concludes "nothing else
  // calls this" and deletes something. The cap is always stated.
  if (a.omitted.callers > 0) lines.push(`  … and ${a.omitted.callers} more callers not shown`);
  lines.push(head(a.callees, a.omitted.callees, 'calls'));
  for (const c of a.callees) lines.push(fmt(c));
  if (a.omitted.callees > 0) lines.push(`  … and ${a.omitted.callees} more callees not shown`);
  if (a.didYouMean.length > 0) lines.push(`same name, narrower: ${a.didYouMean.join(', ')}`);
  return lines.join('\n');
}

/** The edge kind carried by more than half the hits, if any — printed once, not per line. */
function majorityVia(hits: CallerHit[]): string | null {
  if (hits.length === 0) return null;
  const counts = new Map<string, number>();
  for (const h of hits) counts.set(h.via, (counts.get(h.via) ?? 0) + 1);
  const [kind, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return n * 2 > hits.length ? kind : null;
}
