export { scanRepo } from './scan.js';
// The cached scan path, shared by the CLI and the MCP server so both obey one set of
// signature rules. Opt-in on purpose: fixture tests must keep hitting the real scanner.
export { scanRepoCached } from './server/graphCache.js';
export { discover } from './discovery/compose.js';
export { discoverKubernetes } from './discovery/kubernetes.js';
export { scoreGraph, projectToServiceLevel } from './score.js';
// The containment lift: a file's nearest service/datastore/topic ancestor. It is
// TOTAL and cycle-safe, which is why `path_between` uses this rather than walking
// `parentId` itself — a persisted or AI-authored graph need not be a tree.
export { liftToTopLevel } from './explain/serviceGraph.js';
// The four NEGATIVES — a table read by a non-owner, a route with no caller, a
// topic nobody consumes, a product file no test reaches. Everything else this
// engine computes is a positive; these are the questions a person actually opens
// an architecture tool with.
export { findNegatives, type Negatives } from './moat/negatives.js';
// The post-edit verdict: what an edit did to the ARCHITECTURE, in the
// reviewer's terms rather than as a graph delta. Affordable in the loop —
// graphCache's warm rescan measured 0.38s against 3.96s cold.
export { rescanVerdict, type RescanVerdict } from './moat/rescanVerdict.js';
// What a scan could NOT read. The scanner parses five languages; every other
// source file was skipped silently, so a repo whose payment service is C#
// produced a graph with no payment service and nothing saying why.
export {
  UnfollowedTally,
  unfollowedLanguageOf,
  unfollowedSentence,
  type UnfollowedSource,
} from './lang/unfollowed.js';
export { renderBrief, renderBriefFromGraph, scopeGraph, type ScopeResult } from './brief.js';
export { renderDDL, hasDbTables } from './ddl.js';
export * from './types.js';

// --- v9 Phase 1: additive public API for the @sequence/mcp server. ---
// These re-export already-verified engine functions so the MCP wraps the public
// package surface instead of reaching into deep dist paths. Additive only — no
// behavior change to any existing export above.
export {
  buildPlainTree,
  buildStructuralTree,
  buildDesignSuggestPrompt,
  buildDesignAskPrompt,
  normalizeDesignSuggestion,
  buildAnnotatePrompt,
  parseAnnotations,
  buildAnnotations,
  // The coverage claim, so the MCP surface can carry it too — an agent
  // consuming Sequence could not say how much of a repo an answer saw.
  buildDigest,
  computeAskCoverage,
} from './explain/explain.js';
export type { DesignSuggestNode, DesignAskContext, AnnotationsResult } from './explain/explain.js';
export {
  ASK_SURFACE_IDS,
  parseAskSurface,
  isDeicticSurfaceQuestion,
  renderAskSurfaceSection,
  answerSurfaceQuestion,
} from './explain/askSurface.js';
export type {
  AskSurfaceId,
  AskSurfaceContext,
  AskSurfaceFocus,
  AskSurfaceStep,
} from './explain/askSurface.js';
export { renderOutline } from './explain/plaintree.js';
export type { PlainNode, PlainKind, PlainTreeResult } from './explain/plaintree.js';
export { seqdNodeDetailFromStructuralTree } from './explain/seqdEnrichment.js';
export { generateText } from './server/provider.js';
export type { AiConfig } from './server/provider.js';
export { buildTree, type TreeNode } from './server/tree.js';

// --- v9 Phase 3b: the deterministic product-type classifier. ---
// Re-exported from @sequence/schema so the MCP server (and any consumer) reads
// the public analyzer surface rather than depending on schema directly. Additive.
export { classifyProject } from '@sequence/schema';
export type { ProjectType, ClassifyResult } from '@sequence/schema';

// --- understanding-v2 P3b: grounded function-level graph (separate from ArchGraph). ---
export { buildFunctionGraph } from './functions/buildFunctionGraph.js';
export { buildRepoFunctionGraph } from './functions/repoFunctionGraph.js';
// The read-through function-graph cache — ONE definition of `.sequence/functions.json`,
// shared by the app server's GET /api/functions and by the MCP server, which is a
// fresh process per client and so has no in-RAM memo to hide a 3.1 s reparse behind.
export {
  buildRepoFunctionGraphCached,
  readCachedFunctionGraph,
  writeCachedFunctionGraph,
  FUNCTION_GRAPH_CACHE_VERSION,
  type FunctionGraphCacheFile,
} from './server/functionGraphCache.js';

// --- G-B: language mix + language packs. ---
// The repo/service language breakdown (counted from real `meta.language` /
// `meta.loc`) and the per-language comprehension packs composed from it. Pure
// functions; a consumer that wants to SHOW "62% Python · 31% TypeScript" reads
// the same numbers the labeller and the prompts are biased by.
export { languageMix, graphLanguageMix, formatLanguageMix, isParsedLanguage } from './lang/mix.js';
export type { LanguageMix, LanguageShare, LanguageSample, GraphLanguageMix } from './lang/mix.js';
export {
  directoryHeatMap,
  heatLevelFromScore,
  HEAT_DECAY,
  HEAT_WEIGHT,
} from './lore/directoryHeat.js';
export { packFor, selectPacks, composeLabelHints, composePromptGuidance, LANGUAGE_PACKS } from './lang/packs.js';
export type { LanguagePack, PackId } from './lang/packs.js';
export { composePolicies } from './policies/compose.js';

// Rationale & decision-record mining (deterministic, key-free): the *why* the
// team wrote down in comments, attached to the node it belongs to with a real
// `file:line` in the schema's own Evidence shape. Never a graph edge — prose is
// not a dependency.
export {
  extractRationale,
  rollUpRationale,
  rationaleSentence,
  commentLines,
  looksLikeCode,
  MAX_NOTES_PER_FILE,
  MAX_NOTES_PER_MODULE,
} from './rationale.js';
export type { RationaleNote, RationaleTag } from './rationale.js';
