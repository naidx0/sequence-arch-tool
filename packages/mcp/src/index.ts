/**
 * @sequence/mcp — a Model Context Protocol (stdio) server that exposes
 * Sequence's static-architecture engine as tools Claude can call.
 *
 * This module is a THIN wrapper over already-verified `@sequence/analyzer`
 * functions — it contains NO new engine logic. Each tool:
 *   - resolves to a real, deterministic engine call;
 *   - wraps that call in try/catch and returns a STRUCTURED tool error rather
 *     than throwing (a thrown handler would crash the MCP session);
 *   - keeps the honest line: the keyless tools (`scan_repo`, `explain_repo`,
 *     `plain_tree`) need no AI key and return real structure; `design_suggest`
 *     refuses to fabricate without a key, and NO key ever appears in any tool
 *     output or error message.
 *
 * `createServer()` builds an `McpServer` with every tool registered so both the
 * stdio entrypoint (`server.ts`) and the in-process tests can drive it.
 */

import path from 'node:path';
import { z } from 'zod';
import {
  impactFromGraph,
  resolveNodeName,
  risksFromGraph,
  writeWhiteboard,
} from './insightTools.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  pathsBetween,
  scanCoverage,
  canRefuteExtension,
  type ArchGraph,
} from '@sequence/schema';
import { queryNeighbours, renderAnswer, resolveNode } from './graphQuery.js';
import {
  scanRepo,
  scanRepoCached,
  buildRepoFunctionGraphCached,
  buildPlainTree,
  liftToTopLevel,
  findNegatives,
  rescanVerdict,
  buildDigest,
  computeAskCoverage,
  unfollowedSentence,
  buildTree,
  renderOutline,
  buildDesignSuggestPrompt,
  normalizeDesignSuggestion,
  generateText,
  classifyProject,
  type AiConfig,
} from '@sequence/analyzer';
import {
  exportDiagramTool,
  validateDiagramTool,
  type DiagramExportFormat,
} from './diagramTools.js';

/** The structured result every tool handler returns (a subset of MCP's CallToolResult). */
export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

/** A successful JSON payload → a single pretty-printed text block. */
function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/**
 * A successful JSON payload → a single COMPACT text block.
 *
 * Indentation is for a human reading a file; nothing reads a tool result but a
 * model, and it pays for every byte. Measured on this monorepo on 2026-08-20,
 * `scan_repo`'s payload was **31.5% leading spaces and newlines** — very nearly
 * a third of the bytes carrying no information, on the one payload whose own
 * description warns it can exhaust a context window.
 *
 * A ratio, not a char count, deliberately: the absolute size moves with the
 * corpus every week (see `graphQueryRepo.test.ts` on why a pinned figure rots),
 * while the share is a property of `JSON.stringify`'s indent and the shape of an
 * ArchGraph, and holds at any repo size.
 *
 * Reserved for the payloads that are large. The small keyless tools stay
 * pretty-printed because a human does read those at the terminal, and 200 bytes
 * of indentation costs nothing.
 */
function okCompact(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

/** A clean, structured tool error — never a throw. Text is caller-safe / key-free. */
function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Detect the analyzer's `NoManifestsError` WITHOUT importing the class — it
 * carries a stable `code: 'no-manifests'` discriminator (and name). Kept
 * structural so a friendly message is returned instead of a red-wall crash.
 */
function isNoManifests(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const o = e as { code?: unknown; name?: unknown };
  return o.code === 'no-manifests' || o.name === 'NoManifestsError';
}

const NO_MANIFEST_MESSAGE =
  'Nothing to scan here: no container manifests (docker-compose / Kubernetes / Helm) AND ' +
  'no recognizable package manifest or source were found in this path. Sequence scans ' +
  'container-manifest repos and (since v9) manifest-less code repos via their package ' +
  'manifests (package.json, pyproject, go.mod, Cargo.toml, …); this message means the ' +
  'directory is empty or unrecognized.';

const CONNECT_KEY_MESSAGE =
  'Connect an AI key to design from a description. Pass `apiKey` (and optionally `provider`, ' +
  '`model`, `baseUrl`) to design_suggest, or set SEQUENCE_AI_KEY in the server environment. ' +
  'Without a key, Sequence will not fabricate a design — the keyless scan/explain/plain_tree ' +
  'tools return real detected structure instead.';

/* ---------------------------------------------------------------- handlers -- */

export interface ScanRepoInput {
  repoPath: string;
  cluster?: boolean;
}

/**
 * `scan_repo` → the engine's {@link scanRepo}. Returns node/edge counts and the
 * full ArchGraph. Catches `NoManifestsError` and returns a friendly, calm
 * message rather than crashing.
 */
export async function scanRepoTool(input: ScanRepoInput): Promise<ToolResult> {
  try {
    const cluster = input.cluster !== false; // default on, matching the CLI
    // Reuse the persisted graph when the repo is unchanged. An agent calling this
    // repeatedly used to pay a full parse every time; the app server has always
    // cached, and the MCP path simply never asked for it.
    const graph: ArchGraph = await scanRepoCached(input.repoPath, { cluster });
    const services = graph.nodes.filter((n) => n.kind === 'service').length;
    const datastores = graph.nodes.filter((n) => n.kind === 'datastore').length;
    const files = graph.nodes.filter((n) => n.kind === 'file').length;
    const imports = graph.edges.filter((e) => e.kind === 'import').length;
    const interactions = graph.edges.length - imports;
    // Compact, not pretty: see {@link okCompact}. This is the payload the tool's
    // own description warns about, so it is the one that must not spend a third
    // of its bytes on indentation.
    return okCompact({
      repoName: graph.repoName,
      counts: {
        nodes: graph.nodes.length,
        edges: graph.edges.length,
        services,
        datastores,
        files,
        interactions,
        imports,
      },
      graph,
    });
  } catch (e) {
    if (isNoManifests(e)) return fail(NO_MANIFEST_MESSAGE);
    return fail(`scan failed: ${(e as Error).message}`);
  }
}

export interface RepoPathInput {
  repoPath: string;
}

/**
 * `explain_repo` → the CLI explain sequence (scan → structural PlainTree →
 * outline). Keyless: with no provider, {@link buildPlainTree} returns the
 * deterministic structural tree, so `mode` is `'structural'` and no key is
 * needed.
 */
export async function explainRepoTool(input: RepoPathInput): Promise<ToolResult> {
  try {
    const graph = await scanRepo(input.repoPath, { cluster: true });
    const { tree, mode } = await buildPlainTree(graph, {
      tree: buildTree(path.resolve(input.repoPath)),
    });
    const outline = renderOutline(tree, { color: false });
    return ok({ outline, mode });
  } catch (e) {
    if (isNoManifests(e)) return fail(NO_MANIFEST_MESSAGE);
    return fail(`explain failed: ${(e as Error).message}`);
  }
}

/**
 * `plain_tree` → the full {@link PlainTreeResult} JSON (structural / keyless).
 */
export async function plainTreeTool(input: RepoPathInput): Promise<ToolResult> {
  try {
    const graph = await scanRepo(input.repoPath, { cluster: true });
    const result = await buildPlainTree(graph, {
      tree: buildTree(path.resolve(input.repoPath)),
    });
    return ok(result);
  } catch (e) {
    if (isNoManifests(e)) return fail(NO_MANIFEST_MESSAGE);
    return fail(`plain_tree failed: ${(e as Error).message}`);
  }
}

/**
 * `classify_repo` → the deterministic product-type classifier. Scans the repo
 * into an ArchGraph, then {@link classifyProject} reads its framework/category
 * signals + graph shape and returns the product type plus the concrete signals
 * that drove the decision. Keyless (no AI). Catches `NoManifestsError` with the
 * same friendly message as the other scan-based tools.
 */
export async function classifyRepoTool(input: RepoPathInput): Promise<ToolResult> {
  try {
    const graph = await scanRepo(input.repoPath, { cluster: true });
    const { type, matchedSignals, confidence } = classifyProject(graph);
    return ok({ type, matchedSignals, confidence });
  } catch (e) {
    if (isNoManifests(e)) return fail(NO_MANIFEST_MESSAGE);
    return fail(`classify failed: ${(e as Error).message}`);
  }
}

export interface DesignSuggestInput {
  description: string;
  parentTitle?: string;
  repoName?: string;
  apiKey?: string;
  provider?: 'anthropic' | 'openai-compatible';
  model?: string;
  baseUrl?: string;
}

/**
 * Build an {@link AiConfig} from the passed fields (or the SEQUENCE_AI_KEY env
 * fallback). Returns undefined when no key is available — the caller then
 * returns the connect-a-key message instead of fabricating. The key is only
 * ever placed into the config that goes straight to the provider layer; it is
 * never returned or logged here.
 */
function buildAiConfig(input: DesignSuggestInput): AiConfig | undefined {
  const apiKey = (input.apiKey ?? process.env.SEQUENCE_AI_KEY ?? '').trim();
  if (apiKey === '') return undefined;
  const provider = input.provider === 'openai-compatible' ? 'openai-compatible' : 'anthropic';
  const model =
    input.model && input.model.trim() !== ''
      ? input.model.trim()
      : provider === 'anthropic'
        ? 'claude-3-5-sonnet-latest'
        : '';
  const cfg: AiConfig = { provider, model, apiKey };
  if (input.baseUrl && input.baseUrl.trim() !== '') cfg.baseUrl = input.baseUrl.trim();
  return cfg;
}

/**
 * `design_suggest` → PROPOSED plain-English building blocks from a natural
 * description. Requires a key (mirrors repoServer's design-suggest path). With
 * no key it returns the connect-a-key message and never fabricates. The key is
 * never echoed in output or errors.
 */
export async function designSuggestTool(input: DesignSuggestInput): Promise<ToolResult> {
  if (typeof input.description !== 'string' || input.description.trim() === '') {
    return fail('design_suggest needs a non-empty "description" of what to build.');
  }
  const cfg = buildAiConfig(input);
  if (!cfg) return fail(CONNECT_KEY_MESSAGE);
  try {
    const text = await generateText(
      cfg,
      buildDesignSuggestPrompt(input.description, input.parentTitle, input.repoName)
    );
    // Normalized/capped into safe proposed design nodes. Never throws.
    const nodes = normalizeDesignSuggestion(text);
    return ok({ nodes, proposed: true });
  } catch (e) {
    // A ProviderError's message/body describe the provider RESPONSE only, which
    // is key-free by construction. We surface just the message, never the config.
    return fail(`design suggestion failed: ${(e as Error).message}`);
  }
}

/**
 * `who_calls` → a targeted answer instead of the whole graph.
 *
 * `scan_repo` returns the full ArchGraph — megabytes of JSON on a monorepo this size.
 * No figure is pinned in a comment any more; graphQueryRepo.test.ts measures it. (The "0.47 MB / 1326 nodes" this comment quoted until
 * 2026-08-19 was the shopfront fixture's; see `docs/research/v32-scale-and-gaps.md`
 * §7 for the retraction.) An agent asking one
 * question should not have to ingest a codebase's entire topology and re-derive the
 * answer; that is the context dump this product exists to replace. This returns the
 * edges that answer the question, each carrying the file and line that justify it.
 *
 * Two deliberate choices in the payload:
 *
 *   - **The function graph is built LAZILY.** It costs ~3.1 s cold on this repo, and
 *     a question that resolves to a file (most of them) never needs it. It is built
 *     only when the arch graph has no answer, and it is cached on disk from then on.
 *   - **The facts are returned ONCE.** The old payload carried the full structured
 *     answer AND a rendered summary of the same facts: 42,272 bytes for the 82 facts
 *     of `who_calls repoServer.ts`, of which 7,216 were the readable half. An agent
 *     pays for every byte of a tool result, so it gets the readable half plus the
 *     header it cannot derive (counts, ambiguity, what the cap removed).
 */
export async function whoCallsTool(input: {
  repoPath: string;
  name: string;
  includeImports?: boolean;
  limit?: number;
  depth?: number;
}): Promise<ToolResult> {
  try {
    const graph: ArchGraph = await scanRepoCached(input.repoPath, { cluster: true });
    const common = {
      ...(input.includeImports !== undefined ? { includeImports: input.includeImports } : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
      ...(input.depth !== undefined ? { depth: input.depth } : {}),
    };
    let answer = queryNeighbours(graph, input.name, common);
    if (!answer.target) {
      // Only now is a symbol lookup worth 3.1 s (or a cache read). Finding #7 of the
      // research doc: every function name tried returned null while the call edges
      // that answer them sat behind `GET /api/functions` and nothing else.
      const { functionGraph } = await buildRepoFunctionGraphCached(input.repoPath, graph);
      answer = queryNeighbours(graph, input.name, { ...common, functions: functionGraph });
    }
    return ok({
      target: answer.target,
      counts: { callers: answer.callers.length, callees: answer.callees.length },
      omitted: answer.omitted,
      ...(answer.alsoNamed.length ? { alsoNamed: answer.alsoNamed } : {}),
      ...(answer.note ? { note: answer.note } : {}),
      answer: renderAnswer(answer, input.name),
    });
  } catch (e) {
    return fail(`who_calls failed: ${(e as Error).message}`);
  }
}

/**
 * The ROUTE between two nodes — what `who_calls` cannot answer.
 *
 * `who_calls` returns neighbours and `computeImpact` returns closures. Both are
 * sets, and two services can each appear in the other's set with the caller
 * still unable to say what runs in between. This walks it.
 *
 * BOTH ENDPOINTS GO THROUGH `resolveNode`, so the same things `who_calls`
 * accepts work here — a service, a file, a path suffix. An endpoint that does
 * not resolve is reported as unresolved rather than as "no route": those are
 * different answers, and returning the second for the first tells someone their
 * architecture is disconnected when they made a typo.
 */
export async function pathBetweenTool(input: {
  repoPath: string;
  from: string;
  to: string;
  includeImports?: boolean;
  maxPaths?: number;
  maxDepth?: number;
}): Promise<ToolResult> {
  try {
    const graph: ArchGraph = await scanRepoCached(input.repoPath, { cluster: true });
    const from = resolveNode(graph, input.from);
    const to = resolveNode(graph, input.to);
    if (!from || !to) {
      return ok({
        from: from ? { id: from.id, label: from.label } : null,
        to: to ? { id: to.id, label: to.label } : null,
        paths: [],
        unresolved: [...(from ? [] : [input.from]), ...(to ? [] : [input.to])],
        answer:
          `Could not find ${!from ? `"${input.from}"` : ''}${!from && !to ? ' or ' : ''}` +
          `${!to ? `"${input.to}"` : ''} in this repository. Nothing is being hidden — ` +
          `the name did not resolve, which is not the same as there being no route.`,
      });
    }

    /* Imports are IN by default, matching who_calls, and for its reason: they
       dominate this repo's edges, so excluding them answers most real questions
       with silence. Pass false for the cross-service lens. */
    const includeImports = input.includeImports !== false;

    /*
     * THE QUESTION IS ANSWERED AT THE LEVEL IT WAS ASKED, and getting this
     * wrong makes the tool answer "no route" to a route that plainly exists.
     *
     * CONTAINMENT IS NOT AN EDGE. A db edge is recorded FILE-level —
     * `gateway/src/db.ts -> ds:postgres` — while the gateway SERVICE reaches its
     * files through `parentId`. So "how does gateway reach postgres" walked from
     * a node with no outgoing edges at all and came back empty, which reads as
     * "these are not connected" when they are connected on the line below.
     *
     * When BOTH endpoints are systems-layer nodes the edges are lifted to their
     * owning service/datastore/topic; when either endpoint is a file the raw
     * edges are used, because a file-to-file question is asking about imports
     * and lifting would collapse the answer to one node. `liftToTopLevel` is
     * the analyzer's own, and it is cycle-safe — a persisted graph need not be
     * a tree.
     */
    const isSystems = (k: string) => k === 'service' || k === 'datastore' || k === 'topic';
    const systemsLevel = isSystems(from.kind) && isSystems(to.kind);
    const lift = systemsLevel ? liftToTopLevel(graph) : null;

    const links = graph.edges
      .filter((e) => includeImports || e.kind !== 'import')
      .map((e) =>
        lift
          ? { srcId: lift(e.srcId)?.id ?? e.srcId, dstId: lift(e.dstId)?.id ?? e.dstId }
          : { srcId: e.srcId, dstId: e.dstId },
      )
      /* Two files in one service produce a lifted self-edge, which is not a hop.
         `pathsBetween` drops self-loops anyway; dropping here keeps the link
         list honest about what it contains. */
      .filter((l) => l.srcId !== l.dstId);

    const result = pathsBetween(links, from.id, to.id, {
      ...(input.maxPaths !== undefined ? { maxPaths: input.maxPaths } : {}),
      ...(input.maxDepth !== undefined ? { maxDepth: input.maxDepth } : {}),
    });

    const labelOf = new Map(graph.nodes.map((n) => [n.id, n.label || n.id]));
    const named = result.paths.map((p) => p.map((id) => labelOf.get(id) ?? id));

    return ok({
      from: { id: from.id, label: from.label, kind: from.kind },
      to: { id: to.id, label: to.label, kind: to.kind },
      includeImports,
      level: systemsLevel ? 'systems' : 'file',
      count: result.paths.length,
      truncated: result.truncated,
      ...(result.note ? { note: result.note } : {}),
      paths: result.paths,
      answer:
        named.length === 0
          ? `No route from ${from.label} to ${to.label}${result.note ? ` — ${result.note}` : ''}.`
          : named.map((p, i) => `${i + 1}. ${p.join(' -> ')}`).join('\n') +
            (result.note ? `\n\n${result.note}` : ''),
    });
  } catch (e) {
    return fail(`path_between failed: ${(e as Error).message}`);
  }
}

/**
 * `find_negatives` → the four questions the scan could always answer.
 *
 * Every other tool here reports a POSITIVE: what calls this, what this reads.
 * These are the other shape — what is in here that nothing uses. The states
 * (`routeInventory`, `testCoverage`) are passed through deliberately: a graph
 * with no route inventory is not a repository with no dead routes, and the
 * caller must be able to tell those apart.
 */
export async function findNegativesTool(input: {
  repoPath: string;
  limit?: number;
}): Promise<ToolResult> {
  try {
    const graph: ArchGraph = await scanRepoCached(input.repoPath, { cluster: true });
    const n = findNegatives(graph);
    const limit = input.limit ?? 25;
    /* Capped, and the cap is REPORTED per section rather than applied silently —
       "3 untested files" when there are 300 is a worse answer than no answer. */
    const cap = <T>(rows: T[]) => ({
      shown: rows.slice(0, limit),
      total: rows.length,
      ...(rows.length > limit ? { omitted: rows.length - limit } : {}),
    });
    return ok({
      repoName: graph.repoName,
      routeInventory: n.routeInventory,
      testCoverage: n.testCoverage,
      foreignTableReads: cap(n.foreignTableReads),
      uncalledRoutes: cap(n.uncalledRoutes),
      ...(n.uncalledRouteCaveat ? { uncalledRouteCaveat: n.uncalledRouteCaveat } : {}),
      unconsumedTopics: cap(n.unconsumedTopics),
      untestedFiles: cap(n.untestedFiles),
    });
  } catch (e) {
    return fail(`find_negatives failed: ${(e as Error).message}`);
  }
}

/**
 * `coverage` → the claim no other tool in this list can make.
 *
 * Every other tool answers a question. This one answers "how much of your
 * repository did the answer actually see", which is the thing that separates a
 * grounded tool from a confident one — and until now an agent consuming
 * Sequence could not carry it. `edgesTotal` is the whole scanned graph and the
 * cap cannot shrink it; `packagesMissed` names the components that contributed
 * nothing, which is where a scoped ask loses information.
 */
export async function coverageTool(input: {
  repoPath: string;
  claimExtension?: string;
}): Promise<ToolResult> {
  try {
    const graph: ArchGraph = await scanRepoCached(input.repoPath, { cluster: true });
    const digest = buildDigest(graph);
    const c = computeAskCoverage(graph, digest);
    const pct = c.edgesTotal > 0 ? Math.round((c.edgesSeen / c.edgesTotal) * 100) : 0;
    /*
     * THE OTHER HALF OF COVERAGE, and the bigger one. `edgesSeen/edgesTotal`
     * measures what the DIGEST saw of the graph; this measures what the SCAN
     * saw of the repository. A 100% digest over a graph that is missing an
     * entire C# service is the more reassuring number and the more wrong one.
     */
    const unreadable = graph.unfollowed ?? [];
    const caveat = unfollowedSentence(unreadable);

    /*
     * THE THIRD THING COVERAGE HAS TO SAY, and it is asked rather than
     * re-derived. `scanCoverage` is the one place that answers "did the walk
     * actually look here", over the file-walk cap, `unfollowed` and `unscanned`
     * together. This tool asking it — instead of reading `graph.unfollowed` and
     * calling that coverage — is what stops a second definition drifting from
     * the first, which is the defect this repository keeps finding.
     *
     * `unfollowed` alone is NOT coverage, and this repo is the proof: measured
     * 2026-08-22, 59 tracked source files were absent from the graph with
     * `unfollowed` reporting `[]` — its own contract's words for "looked, and
     * everything was readable". They were outside every discovered service, so
     * the walk never went there at all.
     */
    const cov = scanCoverage(graph);
    const unvisited = [...cov.unvisitedExtensions].sort();
    const entitled =
      typeof input.claimExtension === 'string' && input.claimExtension.trim() !== ''
        ? canRefuteExtension(cov, input.claimExtension)
        : undefined;
    const ext = input.claimExtension?.trim();

    /* An absence claim is the one an agent most wants and is least entitled to. */
    const entitlement =
      entitled === undefined
        ? undefined
        : entitled
          ? `The walk covered everywhere ${ext} could live, so "there is no ${ext} here" is a ` +
            'claim this scan supports.'
          : `DO NOT say "there is no ${ext} here". ${ext} would sit in a region this walk never ` +
            `read${cov.reasons.length > 0 ? ` (${cov.reasons[0]})` : ''}, so the scan can neither ` +
            'confirm nor rule it out. Say that instead.';

    const coverageSentence =
      cov.verdict === 'complete'
        ? 'The walk entered every region and parsed everything it found, so an absence in this graph is evidence of an absence in the repository.'
        : cov.verdict === 'unknown'
          ? 'This graph does not record what the scan covered, so NO absence in it is evidence of anything. Treat every "there is no X" as unknown.'
          : `The walk did not read everything: ${cov.reasons.slice(0, 4).join('; ')}. An absence in this graph is not an absence in the repository.`;

    return ok({
      repoName: graph.repoName,
      edgesSeen: c.edgesSeen,
      edgesTotal: c.edgesTotal,
      percentOfEdgesSeen: pct,
      packagesSeen: c.packagesSeen,
      packagesMissed: c.packagesMissed,
      unreadableSource: unreadable,
      ...(caveat ? { unreadableCaveat: caveat } : {}),
      scanCoverage: {
        verdict: cov.verdict,
        truncated: cov.truncated,
        neverVisited: cov.reasons,
        extensionsPossiblyMissed: unvisited,
      },
      ...(entitled === undefined ? {} : { absenceClaimEntitled: entitled }),
      answer:
        (c.edgesTotal === 0
          ? 'This scan found no edges, so there is no coverage to report — nothing is being hidden.'
          : `An answer built from this digest sees ${c.edgesSeen} of ${c.edgesTotal} edges (${pct}%)` +
            (c.packagesMissed.length > 0
              ? `; these components contributed nothing: ${c.packagesMissed.join(', ')}.`
              : '; every component contributed.') + (caveat ? ` ${caveat}` : '')) +
        ` ${coverageSentence}` +
        (entitlement ? ` ${entitlement}` : ''),
    });
  } catch (e) {
    return fail(`coverage failed: ${(e as Error).message}`);
  }
}

/**
 * `architecture_changed` → what a change did to the SHAPE of the system.
 *
 * Not a graph delta. A file-level diff of a rescan is mostly noise — every
 * import that moved a line shows up, and the one edge that crossed a service
 * boundary is lost in it. This answers at the service level, which is the level
 * a reviewer is deciding at.
 */
export async function architectureChangedTool(input: {
  beforePath: string;
  afterPath: string;
}): Promise<ToolResult> {
  try {
    const [before, after] = await Promise.all([
      scanRepoCached(input.beforePath, { cluster: true }),
      scanRepoCached(input.afterPath, { cluster: true }),
    ]);
    const v = rescanVerdict(before, after);
    return ok({
      unchanged: v.unchanged,
      addedConnections: v.added,
      removedConnections: v.removed,
      addedComponents: v.addedNodes,
      removedComponents: v.removedNodes,
      answer: v.summary,
    });
  } catch (e) {
    return fail(`architecture_changed failed: ${(e as Error).message}`);
  }
}

/* ------------------------------------------------------------ registration -- */

/** Zod input shapes, reused for MCP tool registration and as the tool contract. */
export const risksShape = {
  repoPath: z.string().describe('Absolute path to the repository to scan (cached).'),
  topN: z.number().int().min(1).max(50).optional().describe('How many risks (default 10).'),
};

export const impactShape = {
  repoPath: z.string().describe('Absolute path to the repository to scan (cached).'),
  node: z
    .string()
    .describe('Node to assess: an exact node id, a unique label, or a unique id/label suffix.'),
};

export const whiteboardShape = {
  repoPath: z.string().describe('Absolute path to the repository to scan (cached).'),
  outPath: z
    .string()
    .optional()
    .describe(
      'Where to write the HTML, inside the repo (relative, or absolute within it). ' +
        'A path outside the repo is refused. Default .sequence/whiteboard.html',
    ),
};

export const scanRepoShape = {
  repoPath: z.string().describe('Absolute or relative path to the repo to scan.'),
  cluster: z.boolean().optional().describe('Cluster services into communities (default true).'),
};
export const repoPathShape = {
  repoPath: z.string().describe('Absolute or relative path to the repo.'),
};
export const graphQueryShape = {
  repoPath: z.string().describe('Absolute or relative path to the repo.'),
  name: z
    .string()
    .describe(
      // Two things were cut from here, both out of a 2 KB budget this tool was
      // already over:
      //   - the resolution ORDER (id → path → exact name → filename stem →
      //     function name → substring). Implementation detail no caller can act
      //     on; it changes no argument anyone would pass.
      //   - tie-breaking ("ties go to the most connected node, runners-up come
      //     back as `alsoNamed`"). The tool's own description already says an
      //     ambiguous name lists the alternatives, and one budget should not pay
      //     for the same sentence twice.
      // What survives is the part a caller acts on: what to pass.
      'What to ask about: a service, topic, module, file, repo-relative PATH or path suffix ' +
        '(e.g. "web/src/state/store.ts"), or a FUNCTION name ("scanRepo", or ' +
        '"scan.ts#scanRepo" to pin the file).',
    ),
  includeImports: z
    .boolean()
    .optional()
    .describe(
      // This said "default false" while the code had defaulted to true since v3.2
      // iteration 7 — the one thing an MCP client reads before calling was describing
      // a tool that does not exist. Imports dominate this repo's edges, so
      // excluding them by default answered almost every real question with silence.
      'Include file-level import edges (default TRUE). Pass false for the cross-service ' +
        'lens — http and queue traffic only — the right view for "what talks to this ' +
        'service".',
    ),
  limit: z
    .number()
    .optional()
    // "whatever the cap removes is reported, never dropped silently" lived here
    // and in the tool description. One copy, in the description, where a client
    // reads it before it has an argument to think about.
    .describe('Max hits per direction (default 200).'),
  depth: z
    .number()
    .optional()
    .describe(
      'Hops to walk out from the target (default 1, max 5). Depth 4 on a central module ' +
        'returns its whole blast radius in ONE call, where reaching depth 2 by grep costs ' +
        'dozens of round trips. Every hit is labelled with the hop it was found at; each ' +
        'node appears once, at its shortest distance.',
    ),
};
export const pathBetweenShape = {
  repoPath: z.string().describe('Absolute or relative path to the repo.'),
  from: z.string().describe('Start of the route: a service, file, path suffix, or topic.'),
  to: z.string().describe('End of the route, in the same forms as `from`.'),
  includeImports: z
    .boolean()
    .optional()
    .describe(
      'Include file-level import edges (default TRUE). Pass false for the cross-service ' +
        'lens — http, grpc, queue and db traffic only.',
    ),
  maxPaths: z.number().optional().describe('Most routes to return (default 20).'),
  maxDepth: z.number().optional().describe('Longest route to consider, in nodes (default 12).'),
};
export const findNegativesShape = {
  repoPath: z.string().describe('Absolute or relative path to the repo.'),
  limit: z.number().optional().describe('Max rows per section (default 25). Whatever is cut is counted.'),
};
export const coverageShape = {
  repoPath: z.string().describe('Absolute or relative path to the repo.'),
  claimExtension: z
    .string()
    .optional()
    .describe(
      'A file extension (".py", "rb") you are about to make an ABSENCE claim about — ' +
        '"there is no Python here". Answers whether this scan is entitled to say that, or ' +
        'whether the extension sits in a region the walk never entered.',
    ),
};
export const architectureChangedShape = {
  beforePath: z.string().describe('The repo as it was — a path to the previous checkout or worktree.'),
  afterPath: z.string().describe('The repo as it is now.'),
};
export const designSuggestShape = {
  description: z.string().describe('Plain-English description of the system to design.'),
  parentTitle: z.string().optional().describe('Existing block these proposals sit under.'),
  repoName: z.string().optional().describe('Name of the project being designed.'),
  apiKey: z.string().optional().describe('AI provider key (never logged or returned).'),
  provider: z.enum(['anthropic', 'openai-compatible']).optional(),
  model: z.string().optional(),
  baseUrl: z.string().optional().describe('Override host (required for openai-compatible).'),
};
export const validateDiagramShape = {
  filePath: z.string().describe('Path to a SeqDiagram v1 JSON file (.seqd / .seqd.json).'),
};
export const exportDiagramShape = {
  repoPath: z.string().optional().describe('Repo directory to scan into an ArchGraph (mutually exclusive with graphPath).'),
  graphPath: z.string().optional().describe('Path to an ArchGraph JSON file (mutually exclusive with repoPath).'),
  format: z.enum(['seqd', 'svg', 'mermaid']).describe('Export format.'),
  outPath: z
    .string()
    .optional()
    .describe('When set, write export to this path. Otherwise return content in the tool result.'),
};

/**
 * Server-declared result budgets, in characters, published on every tool as
 * `_meta["anthropic/maxResultSizeChars"]`. Until 2026-08-20 nothing was
 * declared, so a client had no server-stated ceiling at all for a payload that
 * runs to megabytes on a monorepo.
 *
 * These are BUDGETS, deliberately, not measurements. A number measured from a
 * corpus is wrong the week after it is written — that is the whole lesson of
 * `graphQueryRepo.test.ts` and commit e54f822e — so both figures are derived
 * from a context window instead, at the conventional ~4 chars per token:
 *
 *   - {@link RESULT_BUDGET_ANSWER} ≈ 12.5k tokens. A targeted answer that still
 *     leaves room for the work it was asked in service of. Comfortably above the
 *     deepest closure `graphQueryDepth.test.ts` measures, so `who_calls`'s
 *     "nothing is dropped silently" contract is unaffected by it.
 *   - {@link RESULT_BUDGET_DUMP} ≈ 100k tokens: half of a 200k window, the point
 *     past which a whole-structure dump has eaten the session.
 *
 * `scan_repo` and `plain_tree` CAN exceed the dump budget on a large monorepo,
 * and that is the point of declaring it: the server is telling the client where
 * to cut, and both descriptions already steer a specific question to `who_calls`
 * first.
 */
const RESULT_BUDGET_ANSWER = 50_000;
const RESULT_BUDGET_DUMP = 400_000;

/**
 * The tool surface, in one place. Each entry maps an MCP tool name to its
 * description, its zod input shape, its declared result budget, and the handler
 * that wraps a verified engine function. Exported so tests and the stdio
 * entrypoint share one definition.
 *
 * **Every entry is on a byte budget.** A client keeps a bounded amount of
 * advertised text per tool — 2 KB — and past it the tool's text is truncated
 * mid-sentence, which is worse than a short description because the model cannot
 * tell it was cut. The budget covers the whole listing entry, `description` plus
 * every `.describe()` on the shape, because they ship together and are read
 * together. `mcpHygiene.test.ts` measures the entry a client actually receives
 * and fails the build if one goes over.
 */
export const TOOLS = [
  {
    name: 'scan_repo',
    description:
      'Statically scan a repo into a real architecture graph (services, datastores, files, ' +
      'and the edges between them). Handles container-manifest repos (compose/k8s/helm) AND ' +
      '(v9) manifest-less code repos via their package manifests (package.json, pyproject, ' +
      'go.mod, Cargo.toml, …). Returns node/edge counts and the FULL ArchGraph JSON. ' +
      'WARNING: the full graph is large — on a monorepo it runs to megabytes of JSON and ' +
      'can exceed a 200k context window on its own. Use `who_calls` for a specific ' +
      'question; reach for this only when you genuinely need the whole graph (writing it ' +
      'to a file, diffing, or feeding another tool).',
    shape: scanRepoShape,
    maxResultSizeChars: RESULT_BUDGET_DUMP,
    handler: (a: ScanRepoInput) => scanRepoTool(a),
  },
  {
    name: 'who_calls',
    description:
      // Trimmed on 2026-08-20 from a version whose listing entry measured 2,390
      // bytes — over the 2 KB ceiling, so the last thing an agent read about the
      // repo's most useful tool was a truncated sentence. What went: the
      // "~1.1 MB graph" figure (a corpus number that moves; the honesty guard's
      // own lesson), and one clause of redundancy per sentence. No claim dropped.
      //
      // Keep that quotation on ONE line. The guard exempts double-quoted figures
      // as history, but its exemption regex is deliberately newline-free so one
      // stray quote cannot swallow a file — so a retraction that WRAPS stops
      // being exempt and reads as a live claim. It did, and the guard failed on
      // a figure this comment exists to retract.
      'Answer "what calls X, and what does X call?" from the grounded static scan, with ' +
      'file:line evidence on every edge. X can be a FILE ("store.ts"), a PATH suffix ' +
      '("web/src/state/store.ts", to disambiguate a name several files share), a FUNCTION ' +
      '("scanRepo", or "scan.ts#scanRepo"), a service, or a topic. Prefer this over grep ' +
      'when the question is about CALLS rather than text: it reads the call graph, so it ' +
      'never reports an identifier that only appears in a comment or a string, and never ' +
      'misses a caller that reaches the target through a re-export. Prefer it over ' +
      'scan_repo whenever the question is specific. Nothing is dropped silently: an ' +
      'ambiguous name lists the alternatives, and a capped answer says how many hits it ' +
      'withheld.',
    shape: graphQueryShape,
    maxResultSizeChars: RESULT_BUDGET_ANSWER,
    handler: (a: { repoPath: string; name: string; includeImports?: boolean; limit?: number }) =>
      whoCallsTool(a),
  },
  {
    name: 'architecture_changed',
    description:
      'Answer "what did this change do to the SHAPE of the system?" by comparing two scans at ' +
      'the SERVICE level — which connections appeared, which went, which components arrived. ' +
      'Not a graph delta: a file-level diff of a rescan is mostly import churn, and the one ' +
      'edge that crossed a service boundary is lost in it. "The architecture is unchanged" is ' +
      'a real and common answer, and it is said plainly so that the times it DID change are ' +
      'worth reading. Point it at two checkouts, or a worktree and its base.',
    shape: architectureChangedShape,
    maxResultSizeChars: RESULT_BUDGET_ANSWER,
    handler: (a: { beforePath: string; afterPath: string }) => architectureChangedTool(a),
  },
  {
    name: 'coverage',
    description:
      'Report how much of a repository an answer built from this scan can actually SEE — the ' +
      'claim that separates a grounded tool from a confident one. Returns edges seen vs edges ' +
      'in the whole graph, and NAMES the components that contributed nothing. `edgesTotal` is ' +
      'the whole scanned graph and no cap can shrink it, so a low percentage is a real fact ' +
      'about what an answer was built from rather than a rounding of one. ALSO reports source ' +
      'the scanner could not read at all — it parses TypeScript, JavaScript, Python, Go and ' +
      'Java, and a repo whose payment service is C# yields a graph with no payment service in ' +
      'it. A 100% digest over a graph missing an entire service is the more reassuring number ' +
      'and the more wrong one. Call it before trusting a summary of a large repo.',
    shape: coverageShape,
    maxResultSizeChars: RESULT_BUDGET_ANSWER,
    handler: (a: { repoPath: string; claimExtension?: string }) => coverageTool(a),
  },
  {
    name: 'find_negatives',
    description:
      'Find what is in this repo that nothing uses, and what is missing that should not be — ' +
      'the four questions a static scan can answer and usually is not asked. (1) A TABLE read ' +
      'by a service that does not own it: the coupling nobody declared, and why a schema ' +
      'change breaks a service nobody mentioned. (2) A ROUTE with no caller — a dead endpoint, ' +
      'reported with its registration file:line. (3) A TOPIC published and never consumed. ' +
      '(4) A product FILE no test reaches anywhere in its import closure — stricter than a ' +
      'filename convention, because a file a test reaches transitively is covered. Absence is ' +
      'reported honestly: a graph with no route inventory says so rather than calling every ' +
      'route dead, and a repo with no tests says THAT rather than listing every file. An uncalled ' +
      'route is reported with the caveat that a caller OUTSIDE this repo — a health probe, a ' +
      'webhook, a mobile client — is invisible to a single-repo scan.',
    shape: findNegativesShape,
    maxResultSizeChars: RESULT_BUDGET_ANSWER,
    handler: (a: { repoPath: string; limit?: number }) => findNegativesTool(a),
  },
  {
    name: 'path_between',
    description:
      'Answer "how does A reach B?" — the actual ROUTE through the architecture, not a set ' +
      'of neighbours. `who_calls` returns what touches a node and the impact engine returns ' +
      'closures; both leave you unable to say what runs in between. Endpoints take the same ' +
      'forms `who_calls` accepts (service, file, path suffix, topic). Returns every simple ' +
      'route, shortest first. Nothing is dropped silently: a name that does not resolve is ' +
      'reported as unresolved rather than as "no route", and a list cut by a bound says so ' +
      'and says which bound cut it.',
    shape: pathBetweenShape,
    maxResultSizeChars: RESULT_BUDGET_ANSWER,
    handler: (a: {
      repoPath: string;
      from: string;
      to: string;
      includeImports?: boolean;
      maxPaths?: number;
      maxDepth?: number;
    }) => pathBetweenTool(a),
  },
  {
    name: 'explain_repo',
    description:
      'Explain a repo as a plain-English, indented outline of its system (deterministic ' +
      'structural translation — no AI key needed). Returns { outline, mode }.',
    shape: repoPathShape,
    maxResultSizeChars: RESULT_BUDGET_DUMP,
    handler: (a: RepoPathInput) => explainRepoTool(a),
  },
  {
    name: 'plain_tree',
    description:
      'Return the full PlainTree (expandable plain-English view-model) for a repo as JSON, ' +
      'built deterministically from real structure. No AI key needed.',
    shape: repoPathShape,
    maxResultSizeChars: RESULT_BUDGET_DUMP,
    handler: (a: RepoPathInput) => plainTreeTool(a),
  },
  {
    name: 'classify_repo',
    description:
      'Deterministically classify a repo\'s PRODUCT TYPE (mobile / spa / microservices / ' +
      'monolith / server-web / cli / library / pipeline / ml / serverless / infra / generic) ' +
      'from its framework signals and graph shape. No AI, no key. Returns { type, ' +
      'matchedSignals, confidence }.',
    shape: repoPathShape,
    maxResultSizeChars: RESULT_BUDGET_ANSWER,
    handler: (a: RepoPathInput) => classifyRepoTool(a),
  },
  {
    name: 'design_suggest',
    description:
      'Propose plain-English building blocks for a NEW system from a natural-language ' +
      'description. These are PROPOSED (not detected). Requires an AI key; with no key it ' +
      'returns a connect-a-key message and never fabricates.',
    shape: designSuggestShape,
    maxResultSizeChars: RESULT_BUDGET_ANSWER,
    handler: (a: DesignSuggestInput) => designSuggestTool(a),
  },
  {
    name: 'validate_diagram',
    description:
      'Validate a SeqDiagram v1 JSON file (.seqd). Returns node/edge counts on success; ' +
      'lists schema problems on failure. Keyless.',
    shape: validateDiagramShape,
    maxResultSizeChars: RESULT_BUDGET_ANSWER,
    handler: (a: { filePath: string }) => validateDiagramTool(a),
  },
  {
    name: 'export_diagram',
    description:
      'Export a grounded SeqDiagram from a repo scan (repoPath) or ArchGraph JSON (graphPath). ' +
      'Formats: seqd, svg, mermaid. Returns content unless outPath is set (then writes file). ' +
      'Never auto-writes into .sequence/diagrams/. Keyless.',
    shape: exportDiagramShape,
    maxResultSizeChars: RESULT_BUDGET_DUMP,
    handler: (a: {
      repoPath?: string;
      graphPath?: string;
      format: DiagramExportFormat;
      outPath?: string;
    }) => exportDiagramTool(a),
  },
  {
    name: 'risks',
    description:
      "The logic engine's ranked structural risks for a repo, from the grounded scan: " +
      'single points of failure, high-blast-radius hubs, dependency concentration. Every ' +
      'risk names its node and carries a score; nothing is inferred from prose. Keyless.',
    shape: risksShape,
    maxResultSizeChars: RESULT_BUDGET_ANSWER,
    handler: async (a: { repoPath: string; topN?: number }) => {
      try {
        const graph = await scanRepoCached(a.repoPath, { cluster: true });
        return okCompact(risksFromGraph(graph, a.topN ?? 10));
      } catch (e) {
        if (isNoManifests(e)) return fail(NO_MANIFEST_MESSAGE);
        return fail(`risks failed: ${(e as Error).message}`);
      }
    },
  },
  {
    name: 'impact',
    description:
      'The blast radius of changing ONE named node, from the grounded scan: everything that ' +
      'transitively depends on it (what breaks) and everything it depends on (what it needs). ' +
      'An ambiguous name returns the candidate ids instead of guessing. Keyless.',
    shape: impactShape,
    maxResultSizeChars: RESULT_BUDGET_ANSWER,
    handler: async (a: { repoPath: string; node: string }) => {
      try {
        const graph = await scanRepoCached(a.repoPath, { cluster: true });
        const res = resolveNodeName(graph, a.node);
        if ('candidates' in res) {
          return res.candidates.length === 0
            ? fail(`no node matches "${a.node}"`)
            : okCompact({ ambiguous: a.node, candidates: res.candidates });
        }
        return okCompact(impactFromGraph(graph, res.id));
      } catch (e) {
        if (isNoManifests(e)) return fail(NO_MANIFEST_MESSAGE);
        return fail(`impact failed: ${(e as Error).message}`);
      }
    },
  },
  {
    name: 'whiteboard',
    description:
      'Generate an INTERACTIVE system-design whiteboard for a repo and write it as ONE ' +
      'self-contained HTML file (default .sequence/whiteboard.html): the grounded ' +
      'service/datastore/queue graph with pan, zoom, search, and click-a-node evidence — ' +
      'no server, no network, no login; open the file in any browser. The same board the ' +
      'Sequence app draws, portable to any editor or workspace. Keyless.',
    shape: whiteboardShape,
    maxResultSizeChars: RESULT_BUDGET_ANSWER,
    handler: async (a: { repoPath: string; outPath?: string }) => {
      try {
        const graph = await scanRepoCached(a.repoPath, { cluster: true });
        const written = writeWhiteboard(graph, a.repoPath, a.outPath);
        return okCompact({
          written: written.path,
          nodes: written.nodes,
          edges: written.edges,
          open: 'Open the file in a browser — it is fully self-contained.',
        });
      } catch (e) {
        if (isNoManifests(e)) return fail(NO_MANIFEST_MESSAGE);
        return fail(`whiteboard failed: ${(e as Error).message}`);
      }
    },
  },
] as const;

/**
 * Server-level `instructions`, returned to the client at initialize.
 *
 * This was undefined until 2026-08-20, and its absence was not cosmetic: a
 * client that discovers servers by their description — tool-search — had nothing
 * to match against, so the server was invisible to exactly the clients this
 * package exists to be consumed by.
 *
 * It says three things a per-tool description structurally cannot: what kind of
 * question this server is for at all, which tool to reach for FIRST, and which
 * one will cost a context window. Kept inside the same 2 KB ceiling the tool
 * descriptions live under — a preamble that is itself truncated has spent the
 * budget and delivered nothing. `mcpHygiene.test.ts` measures it.
 */
const SERVER_INSTRUCTIONS =
  'Sequence reads a repository into a grounded architecture graph by static analysis — no AI ' +
  'key, no guessing, and a file:line citation behind every edge it reports.\n\n' +
  'Reach for it when the question is about how a codebase is WIRED rather than what its text ' +
  'says: what calls this, what breaks if I change it, what talks to this service, what kind of ' +
  'project is this, what does the system actually look like.\n\n' +
  'Start with `who_calls`. It answers one question with the edges that justify it, and `depth` ' +
  '(up to 5) returns a whole blast radius in a single call — the thing grep cannot do at any ' +
  'number of round trips. Ambiguity and capping are always reported, never silent: a shared ' +
  'filename comes back with `alsoNamed`, and a capped answer says how many hits it withheld.\n\n' +
  'Use `scan_repo` only when you genuinely need the entire graph — writing it to a file, ' +
  'diffing it, feeding another tool. On a monorepo it is megabytes of JSON and will dominate a ' +
  'context window.\n\n' +
  '`explain_repo`, `plain_tree` and `classify_repo` describe a repo you have not seen yet. ' +
  '`export_diagram` and `validate_diagram` handle SeqDiagram files. All of those are ' +
  'deterministic and keyless. `design_suggest` is the one tool that needs an AI key, and ' +
  'without one it says so rather than inventing a design.';

/**
 * Build a fully-wired {@link McpServer} with every Sequence tool registered.
 * Callers connect it to a transport — `StdioServerTransport` in production, an
 * in-memory transport in tests.
 */
export function createServer(): McpServer {
  const server = new McpServer(
    { name: '@sequence/mcp', version: '0.1.0' },
    { instructions: SERVER_INSTRUCTIONS },
  );
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.shape,
        // The server's own statement of how big this tool's result can get.
        // Nothing declared one until 2026-08-20, so a client had no ceiling at
        // all for `scan_repo`'s megabytes. See {@link RESULT_BUDGET_DUMP}.
        _meta: { 'anthropic/maxResultSizeChars': tool.maxResultSizeChars },
      },
      // The SDK parses/validates args against `shape` before calling us.
      async (args: unknown) => (await tool.handler(args as never)) as never
    );
  }
  return server;
}
