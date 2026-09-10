/**
 * The archgraph.json contract between the analyzer and the viewer.
 *
 * Invariants (spec §4.3):
 *  - Nodes form a containment tree via parentId (roots have no parentId).
 *  - Interaction edges are LEAF-LEVEL ONLY; the UI aggregates them to the
 *    deepest visible ancestor. Topics and datastores are nodes, not labels.
 *  - Every edge carries at least one evidence record (file:line) — edges
 *    without evidence are a schema violation, not a style choice. The lone
 *    exception is authored design specs (origin 'design'): see `mode` below.
 *
 * Two graph modes share this one contract (see `ArchGraph.mode`):
 *  - 'scan' (default, absent ⇒ scan): the scanner's output — every existing
 *    archgraph.json. All evidence rules apply unchanged.
 *  - 'design': a hand-authored spec of *intended* architecture. Edges express
 *    intent, not inference: origin 'design', confidence 1, evidence [] (there
 *    is nothing to cite — the code does not exist yet). scannedAt / repoRoot
 *    are empty strings (an authored spec has neither).
 */

export type NodeKind =
  | 'repo'
  | 'service'
  | 'datastore'
  | 'topic'
  | 'module'
  | 'file';

export type EdgeKind =
  | 'http'
  | 'grpc'
  | 'queue_publish'
  | 'queue_consume'
  | 'db_read'
  | 'db_write'
  | 'db_access' // read/write direction unknown
  | 'import';

export type EdgeOrigin = 'deterministic' | 'llm' | 'design';

/** The class of artifact an edge's evidence was read from. */
export type EdgeInstrument = 'source' | 'config' | 'manifest' | 'test' | 'mixed';

export interface ArchNode {
  id: string;
  kind: NodeKind;
  label: string;
  parentId?: string;
  /** repo-relative path for file/module/service nodes when applicable */
  path?: string;
  meta?: {
    language?: string;
    framework?: string;
    loc?: number;
    pageRank?: number;
    description?: string;
    /** set when the label/description came from the LLM */
    llmLabeled?: boolean;
    /**
     * Design-mode hint keys (types only — no runtime behavior beyond a
     * validator warning). A scaffolding agent consumes these to generate code
     * that the scanner will recognize; meta is open, so no new fields:
     *  - service node:   language: 'ts' | 'py', framework: 'express' | 'fastapi'
     *  - datastore node: tech: 'postgres' | 'redis'
     * validateGraph warns (into graph.warnings) when a design-mode service
     * node omits `language`.
     */
    tech?: string;
    [k: string]: unknown;
  };
}

export interface Evidence {
  file: string;
  line: number;
  snippet: string;
  note?: string;
}

export interface ArchEdge {
  id: string;
  srcId: string;
  dstId: string;
  kind: EdgeKind;
  /** 0..1, calibrated: resolved-host > proto > literal-topic > path-skeleton > llm */
  confidence: number;
  origin: EdgeOrigin;
  /**
   * WHICH DETECTOR PRODUCED THIS, where `origin` says only how confidently it
   * was derived.
   *
   * CANON records the incident this exists for: `svc:gateway`'s only two
   * inbound edges were nginx confs inside TEST FIXTURES, and both carried
   * `origin: 'deterministic'` — honestly produced, and wrong about the world.
   * "Deterministic" was true and useless, because a fixture file and a
   * production config are the same word to it.
   *
   * Optional: a hand-authored design graph has no detector, and an older
   * persisted graph predates the field. Absent means "not recorded", never
   * "produced by nobody".
   */
  actor?: string;
  /**
   * WHAT CLASS OF ARTIFACT the evidence lives in — `source`, `config`,
   * `manifest`, or `test`.
   *
   * `test` is the one that matters and the reason this is not just `actor`: an
   * edge whose every citation sits in a fixture is a claim about a test suite
   * wearing the costume of a claim about the system.
   */
  instrument?: EdgeInstrument;
  evidence: Evidence[];
  detail?: {
    method?: string;
    pathPattern?: string;
    topic?: string;
    table?: string;
    url?: string;
    envVar?: string;
    [k: string]: unknown;
  };
}

export interface ArchGraph {
  version: 1;
  /**
   * 'scan' (default when absent) = scanner output; 'design' = a hand-authored
   * intent spec (see the module header). Mode changes validateGraph's evidence
   * rules; everything else about the contract is identical.
   */
  mode?: 'scan' | 'design';
  /** ISO timestamp of the scan; the empty string for an authored design spec. */
  scannedAt: string;
  /** Absolute path scanned; the empty string for an authored design spec. */
  repoRoot: string;
  repoName: string;
  nodes: ArchNode[];
  edges: ArchEdge[];
  warnings: string[];
  /**
   * Every route the scan found REGISTERED, whether or not anything calls it.
   *
   * The joiner has always built this inventory and always thrown it away: it
   * indexed routes by service to match callers, returned the matched edges, and
   * dropped the rest. So the graph could say "this call reaches that handler"
   * and could not say "this handler exists" — and a route nothing calls
   * produces no edge at all, which made the most useful question about a route
   * (is anything still using it?) the one question the graph could not be
   * asked.
   *
   * Optional because a design-mode graph has no scan behind it and an older
   * persisted graph predates the field. Absent and empty mean different things:
   * absent is "not recorded", empty is "recorded, and there were none".
   */
  routes?: ArchRoute[];
  /**
   * Source this scan could not read, by language.
   *
   * The scanner parses TypeScript, JavaScript, Python, Go and Java; every other
   * source file is skipped during the walk. A repository whose payment service
   * is C# produced a graph with no payment service in it and nothing anywhere
   * saying why — the graph did not look wrong, it looked like a system with no
   * payment service.
   *
   * Optional and absent-means-not-recorded, like `routes`. An EMPTY array is a
   * real and different answer: the scan looked and everything was readable.
   */
  unfollowed?: UnfollowedSource[];
  /**
   * Directories holding source the walk NEVER REACHED.
   *
   * Different from `unfollowed`, and the difference is the whole point.
   * `unfollowed` says "we opened this and cannot parse the language".
   * This says "we never went there at all".
   *
   * Measured on this repository 2026-08-22: 59 tracked source files were absent
   * from the graph, none of them a parse failure — all of them outside every
   * discovered service, because the scan walks service directories and nothing
   * else. Throughout, `unfollowed` reported `[]`, which its own contract
   * defines as "looked, and everything was readable". So the graph asserted
   * full coverage over files it had never opened.
   *
   * Optional and absent-means-not-recorded, like `routes` and `unfollowed`. An
   * EMPTY array is the real and different answer: every source file in the
   * repository sits inside something that was scanned.
   */
  unscanned?: UnscannedRegion[];
}

/** One directory holding source files no scanned service covers. */
export interface UnscannedRegion {
  /** Top-level directory, repo-relative POSIX. `(root)` for the root itself. */
  dir: string;
  /** How many source files it holds that nothing scanned. */
  files: number;
  /** Which extensions, sorted. */
  extensions: string[];
}

/** One language the scanner cannot parse, and how much of a repo is in it. */
export interface UnfollowedSource {
  /** Human name — `C#`, `Ruby`. What a reader recognises. */
  language: string;
  extensions: string[];
  files: number;
  /** The services those files sit in, when the walk knew one. */
  services: string[];
}

/**
 * A route registration, as found. Deliberately NOT the analyzer's `RouteFact`:
 * that carries detector bookkeeping (`handlerName`, mount resolution) which is
 * how the route was found rather than what it is, and schema cannot import from
 * analyzer in any case.
 */
export interface ArchRoute {
  /** The service the registration sits in. */
  service: string;
  /** GET / POST / … or `*` when the framework registers every method. */
  method: string;
  /** The path as written — `/orders/{order_id}`, `/:id`, `/shipments/`. */
  path: string;
  file: string;
  line: number;
  /** True when the framework treats the path as a PREFIX (a Go subtree). */
  prefix?: boolean;
}

/**
 * Kind-constrained interaction edges (V5 Phase B).
 *
 * Per-edge-kind whitelist of the node kinds a *target* may legally have, so a
 * hand-authored or externally-generated spec — and, as a genuine invariant,
 * any scanner output — cannot wire an interaction edge to a nonsensical target.
 * brief.ts enforced a service-level version of this ad-hoc at scaffold-render
 * time; this moves it into the schema layer so it fires for every graph.
 *
 * The allowed sets are the UNION that is correct in both graph modes, because
 * node kinds differ between them:
 *   - http  → a callable code location: `service` (design specs, and the
 *     scanner's unmatched-route fallback) or `file` (scan mode lands the edge on
 *     the leaf route-handler file inside a service — see join.ts).
 *   - grpc  → a callable code location `service`/`file` (as http), OR a
 *     `datastore`: when no server implementation is found in-repo for the proto
 *     service, the grpc joiner's deterministic fallbacks resolve the channel
 *     address / service-name to a discovered node, and an infra host (role !=
 *     'app') lands on a datastore node (join.ts, `dsId(...)` at the channel-
 *     address and name-convention fallbacks). This is the exact same "channel
 *     resolves to an infra host" shape as the queue broker fallback below.
 *   - queue_publish / queue_consume → a `topic`, or a `datastore`: this system
 *     models a message broker (Redis/Kafka) as a datastore node, and the
 *     joiner's dynamic-topic fallback draws the edge to that broker instead of a
 *     named topic (join.ts, `dsId(broker)`). Both are legitimate queue targets.
 *   - db_read / db_write / db_access → a `datastore`.
 *   - import → structural (module/file wiring), exempt from this rule entirely
 *     (deliberately absent from the table below; see projectToServiceLevel,
 *     which likewise skips import edges).
 *
 * These reject exactly the nonsensical targets: http→topic|datastore,
 * grpc→topic, queue→service|file, db→anything-but-datastore, etc.
 */
export const INTERACTION_DST_KINDS: Partial<Record<EdgeKind, readonly NodeKind[]>> = {
  http: ['service', 'file'],
  grpc: ['service', 'file', 'datastore'],
  queue_publish: ['topic', 'datastore'],
  queue_consume: ['topic', 'datastore'],
  db_read: ['datastore'],
  db_write: ['datastore'],
  db_access: ['datastore'],
};

/**
 * Legal *source* kinds for any interaction edge. An interaction always
 * originates from a code location — a `service` (design/service-level) or a
 * `file` (scan-mode leaf). Datastores, topics, repos and modules never
 * originate one, so a `datastore -> service` edge (etc.) is caught here.
 */
export const INTERACTION_SRC_KINDS: readonly NodeKind[] = ['service', 'file'];

/**
 * Validate structural invariants. Returns a list of problems (empty = valid).
 *
 * Scan mode (default): every edge must carry evidence — unchanged from v1.
 * Design mode (`g.mode === 'design'`): edges express intent, so empty evidence
 * is legal *only* for origin 'design'; additionally every edge must have
 * origin 'design' and confidence exactly 1 (a spec must not smuggle in fake
 * findings). As a side effect, a design-mode service node lacking a
 * `meta.language` hint pushes a warning into `g.warnings` (not a problem).
 *
 * Kind-constrained edges (both modes): an interaction edge's src/dst node kinds
 * must satisfy INTERACTION_SRC_KINDS / INTERACTION_DST_KINDS above.
 */
export function validateGraph(g: ArchGraph): string[] {
  // TOTAL (vision §5 totality invariant): validateGraph must NEVER throw on a
  // null/undefined/non-object ROOT either — symmetric with validateDomain's
  // `m?.entities` guard. A hand-edited spec loaded via Design → "Load spec" can
  // be any JSON value; a bad root returns a normal errors string[], not a crash
  // (dereferencing g.mode / g.nodes on a null g would throw otherwise).
  if (g === null || typeof g !== 'object') {
    return ['graph is not an object'];
  }
  const problems: string[] = [];
  const design = g.mode === 'design';
  // TOTAL (vision §3): validateGraph must NEVER throw on partial/malformed
  // input — including a null/non-object element inside nodes/edges (e.g. a
  // hand-edited {"nodes":[null]} spec loaded via Design → "Load spec"). Coerce
  // the top-level arrays, then report each malformed element as invalid input
  // and skip it, rather than dereferencing .id/.evidence and crashing. An ARRAY
  // element (e.g. {"nodes":[[]]}) is also rejected: `typeof [] === 'object'`, so
  // it would otherwise slip through as a node with `id: undefined`.
  const nodes: ArchNode[] = [];
  (Array.isArray(g.nodes) ? g.nodes : []).forEach((n, i) => {
    if (n === null || typeof n !== 'object' || Array.isArray(n)) problems.push(`node[${i}] is not an object`);
    else nodes.push(n);
  });
  const edges: ArchEdge[] = [];
  (Array.isArray(g.edges) ? g.edges : []).forEach((e, i) => {
    if (e === null || typeof e !== 'object' || Array.isArray(e)) problems.push(`edge[${i}] is not an object`);
    else edges.push(e);
  });
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const ids = new Set<string>();
  for (const n of nodes) {
    if (ids.has(n.id)) problems.push(`duplicate node id: ${n.id}`);
    ids.add(n.id);
  }
  for (const n of nodes) {
    if (n.parentId !== undefined && !ids.has(n.parentId)) {
      problems.push(`node ${n.id} has unknown parentId ${n.parentId}`);
    }
  }
  // containment must be acyclic
  const parent = new Map(nodes.map((n) => [n.id, n.parentId]));
  for (const n of nodes) {
    const seen = new Set<string>();
    let cur: string | undefined = n.id;
    while (cur !== undefined) {
      if (seen.has(cur)) {
        problems.push(`containment cycle involving ${cur}`);
        break;
      }
      seen.add(cur);
      cur = parent.get(cur);
    }
  }
  const edgeIds = new Set<string>();
  for (const e of edges) {
    if (edgeIds.has(e.id)) problems.push(`duplicate edge id: ${e.id}`);
    edgeIds.add(e.id);
    if (!ids.has(e.srcId)) problems.push(`edge ${e.id} unknown srcId ${e.srcId}`);
    if (!ids.has(e.dstId)) problems.push(`edge ${e.id} unknown dstId ${e.dstId}`);
    // Empty (or missing/malformed) evidence is a violation unless this is an
    // authored design edge. Coerce so a bad `evidence` field never throws.
    const evidence = Array.isArray(e.evidence) ? e.evidence : [];
    if (evidence.length === 0 && e.origin !== 'design') {
      problems.push(`edge ${e.id} has no evidence`);
    }
    if (e.confidence < 0 || e.confidence > 1) {
      problems.push(`edge ${e.id} confidence out of range: ${e.confidence}`);
    }
    // Kind-constrained interaction edges. `import` is absent from the table and
    // therefore exempt. Unknown-id edges are already flagged above; skip the
    // kind check when the endpoint node is missing to avoid noise.
    const allowedDst = INTERACTION_DST_KINDS[e.kind];
    if (allowedDst) {
      const dst = nodeById.get(e.dstId);
      if (dst && !allowedDst.includes(dst.kind)) {
        problems.push(
          `edge ${e.id} (${e.kind}) has an invalid target: ${dst.kind} node ${dst.id} (expected ${allowedDst.join(' or ')})`
        );
      }
      const src = nodeById.get(e.srcId);
      if (src && !INTERACTION_SRC_KINDS.includes(src.kind)) {
        problems.push(
          `edge ${e.id} (${e.kind}) has an invalid source: ${src.kind} node ${src.id} (expected ${INTERACTION_SRC_KINDS.join(' or ')})`
        );
      }
    }
    if (design) {
      if (e.origin !== 'design') {
        problems.push(`edge ${e.id} in a design-mode graph must have origin 'design'`);
      }
      if (e.confidence !== 1) {
        problems.push(`edge ${e.id} in a design-mode graph must have confidence 1`);
      }
    }
  }

  // Design-mode service nodes should carry a language hint for the scaffolder.
  // This is advisory only — a warning on the graph, never a validation problem.
  if (design && Array.isArray(g.warnings)) {
    for (const n of nodes) {
      if (n.kind === 'service' && !n.meta?.language) {
        const w = `design-mode service ${n.id} has no meta.language hint`;
        if (!g.warnings.includes(w)) g.warnings.push(w);
      }
    }
  }

  return problems;
}

// Scaffoldability check (V5 Phase B3): the authoritative, browser-safe predicate
// for "can this spec be turned into a running scaffold?" — distinct from the
// structural validity `validateGraph` above. renderBrief delegates to it.
export { checkScaffoldability } from './scaffoldability.js';

// The pure board view-model (v8 Phase B1): PlainNode + the deterministic
// buildBoardModel / evictForBudget the whiteboard renders. Lives here so both the
// analyzer's explain layer and the web renderer import it with zero new deps, and
// so it is covered by this package's node:test suite.
export * from './board.js';

// B1 — Sequence-native Task Board document (`.sequence/board.json`).
export * from './sequenceBoard.js';

// The from-scratch DESIGN tree (v8 Phase B2): pure, tested mutation ops
// (newDesign / addDesignChild / rename / remove / move) and the deterministic
// autoSortDesign, all over the same PlainNode the board renders. Designed nodes
// live in the `d:` id namespace with empty sourceRefs (design intent, not a scan).
export * from './design.js';

// The Domain-model (ontology) layer (v17 Phase 1): pure, tested types + validator
// (DomainModel / DomainEntity / DomainProperty / DomainRelationship /
// validateDomain) and immutable mutation helpers (emptyDomain / addEntity /
// renameEntity / removeEntity / addProperty / updateProperty / removeProperty /
// addRelationship / removeRelationship), modeled on the program.ts pattern. An
// OWL-honest ontology (entities≈classes, properties≈datatype properties,
// relationships≈object properties with cardinality). Browser-safe, no fs/network.
export * from './domain.js';

// The placement checker (v8 Phase C): inferPlacement / checkPlacement — the pure,
// deterministic structural advice behind "draw = design = code". Given a parent
// and a label it infers what a new file should BE (kind/language/path) and warns
// when it probably doesn't belong there, building on the interaction/containment
// rules above. Browser-safe (the board imports it) and under this package's tests.
export * from './placement.js';

// The deterministic product-type classifier (v9 Phase 3b): classifyProject reads
// framework/category signals + graph shape and returns one of a fixed set of
// product types via a first-match precedence cascade. Pure (no fs/LLM), tested,
// and browser-safe — both the analyzer/MCP and the explain layer import it here.
export * from './classify.js';

// The Programs model + graph-walking scheduler (v14 Phase 1): the pure,
// headless engine behind "agent workflows as executable graphs". `program.ts`
// is the typed model + validator (Program / ProgramNode / ProgramEdge /
// Predicate / evalPredicate / validateProgram), modeled on the ArchGraph
// pattern; `scheduler.ts` is the deterministic runtime (runProgram) that walks
// it, fanning out `parallel` via Promise.all, gating branch/loop on a typed
// predicate over shared state, and streaming honest node status. The only
// non-determinism is the INJECTED executors — the web wires real AI/terminal
// later. Pure, browser-safe, and covered by this package's node:test suite.
export * from './program.js';
export * from './scheduler.js';
// Grounded checker primitive (harness W1): agents propose, pure code verifies
// against the real ArchGraph. Also powers the Program `checker` node kind.
export * from './graphChecker.js';

// G-E: per-org harness policies — `policy.ts` (the repo-committed rule shape +
// `validatePolicy`, hand-written like `validateProgram`) and `policyChecker.ts`
// (`checkPolicy` — the pure verdict over a proposal's ADDED edges, consuming
// impact.ts' adjacency rather than re-deriving one). No policies ⇒ an honest
// no-op; a policy may block or flag a proposal, never silently rewrite it.
export * from './policy.js';
export * from './policyChecker.js';
export * from './policyCompose.js';

// v16 Phase 4 (additive, pure): ProgramGraph ⇄ Mermaid flowchart — the
// spec-first authoring loop (programToMermaid / mermaidToProgram), lossless over
// our own dialect (node id/kind/title, agent runtime, edge src/dst/kind).
export * from './programMermaid.js';

// v16 Phase 4 (additive): the honest PR-triage flagship template
// (buildPrTriageProgram) — a validateProgram-clean parallel-probe → judge →
// branch ACP program, also shipped serialized at .sequence/programs/pr-triage.json.
export * from './programs/prTriage.js';
export * from './programs/reviewLoop.js';
export * from './programs/councilAgainstRisks.js';
export * from './programs/routeByBlastRadius.js';
export * from './programs/dogfoodLoop.js';
export * from './programs/buildArchitecture.js';
export * from './programs/buildArchitectureFull.js';
export * from './programs/catalogue.js';
export * from './compileSeqDiagram.js';
export * from './langGraphExport.js';
// Customer autoresearch seam: `.sequence/program.md` strategy + runs/results.tsv log.
export * from './programRunLog.js';
export * from './programStrategy.js';

// v17 Phase 3 (additive, pure): the per-industry starter catalogue — a STARTERS
// registry of honest, ready-made starting points. Each starter's buildArch() is a
// validateGraph-clean design ArchGraph and each buildDomain?() a validateDomain-ok
// DomainModel; the web catalogue picker loads them into Design mode. Browser-safe.
export * from './starters/index.js';

// The pure dependency + failure-impact + risk engines (moved here so BOTH the web
// canvas and the analyzer's server-side explain digest consume ONE grounded
// implementation): `impact.ts` (computeImpact / impactHighlight — the depends-on /
// blast-radius closures), `risks.ts` (computeRisks / rankableNodeCount — the
// single-points-of-failure advisor over the r11 blast radius), and `cycles.ts`
// (computeCycles — the Tarjan circular-dependency advisor). All three are PURE +
// TOTAL over a bare `{srcId,dstId}` edge list, import only schema types + each
// other, and are covered by this package's node:test suite.
export * from './impact.js';
export * from './risks.js';
export * from './chart.js';
export * from './cycles.js';
// `paths.ts` (pathsBetween) — the route, where the three above return SETS. Two
// services can each sit in the other's closure with the reader still unable to
// say what runs in between, and a grep for `pathsBetween|shortestPath|allPaths`
// across `packages/*` returned nothing before this. Same purity contract, same
// `{srcId,dstId}` input, and it inherits impact.ts's direction law rather than
// re-deciding it: `edge X -> Y` means X depends on Y, so a path is a dependency
// chain. Bounded three ways and honest when a bound bit — an unbounded simple-
// path enumeration on a dense graph is not slow, it is a hang.
export * from './paths.js';
// `policyScans.ts` — the same policies, run against a COMMIT instead of a
// drawing. `checkPolicy` takes an authoring-time mutation, so the rules could
// judge a proposal and could not judge a pull request. This adds the three
// things between those: the DIFF (added edges are what two scans differ by),
// the BASELINE ratchet (a rule is unadoptable in a repo that already breaks it),
// and the EXIT CODE. It invents no policy semantics — every hit still comes
// from `checkPolicy`.
export * from './policyScans.js';
// `territories.ts` — who claims what, and where two claims collide. The gap
// study: parallel-agent limitations "are dominated by OBSERVABILITY failures",
// and a view of claimed file ownership "eliminates the failure class rather than
// documenting it". Reuses `pathMatchesRepoGlob`, so a territory is the claim
// `program.md` already makes rather than a second answer to "may this agent
// touch this file".
export * from './territories.js';
// G-D: `riskDelta.ts` (diffRisks) — the change-vs-scaffolding read, diffing two
// `computeRisks` outputs (real graph vs a proposal merged into it) by
// nodeId+severity. Adds no risk semantics; set-equal inputs ⇒ an empty delta.
export * from './riskDelta.js';

// Function-level graph (understanding-v2 P3): separate from ArchGraph — grounded
// function nodes + intra-file calls edges for the Functions tab.
export * from './functions.js';

// v20 Phase 6 (ADR-009): grounded architecture decision records — pure builder +
// markdown renderer. Diagram mermaid text is attached by the caller (export projection).
export * from './decisionRecord.js';

// SeqDiagram v1 (exploration-diagram P0): JSON IR for grounded architecture diagrams.
export * from './seqdiagram.js';
export * from './diagramLayout.js';

// Harness skill frontmatter (Phase 3 distill) — progressive-disclosure summaries.
export * from './harnessSkill.js';

/** Ancestor path from root to the node itself (inclusive), by id. */
export function ancestorPath(g: ArchGraph, nodeId: string): string[] {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const path: string[] = [];
  let cur = byId.get(nodeId);
  while (cur) {
    path.unshift(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path;
}
export * from './scanCoverage.js';
export * from './gradePrediction.js';
