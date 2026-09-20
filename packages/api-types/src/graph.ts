/**
 * The graph — what the board consumes. `/archgraph.json` in `server/repoServer.ts`.
 *
 * `/archgraph.json` is all-or-nothing today: no `?scope=`, no `?depth=`, no
 * delta-since-`scannedAt`, no `ETag`. That is engine gaps G7/G8 and it is fixed in
 * Wave 1 (items 1.8), which will ADD optional query fields — nothing here changes shape.
 */

import type {
  ArchGraph,
  FunctionGraph,
  PlainNode,
  SeqDiagramNodeDetail,
} from '@sequence/schema';

/** Shared by `/api/explain` and `/api/annotate`. */
export type DetailLevel = 'regular' | 'advanced';

/** Shared by `/api/explain`. `bestfit` is deterministic; `recommended` may call the provider. */
export type ExplainProfile = 'recommended' | 'bestfit';

/* ------------------------- GET /archgraph.json — :1451 -------------------- */

export type GetArchGraphRequest = void;

/**
 * The whole scanned graph plus the MADR detail slots, keyed by real `ArchNode.id`.
 * `nodeDetail` is derived per graph by `seqdNodeDetailFromStructuralTree`
 * (`seqdNodeDetailFromStructuralTree`, wired in `server/repoServer.ts`) and is `{}`
 * when there is no graph — never absent.
 * This is the object the breakout renders.
 */
export type GetArchGraphResponse = ArchGraph & {
  nodeDetail: Record<string, SeqDiagramNodeDetail>;
};

/* ---------------------------- POST /api/scan — :1587 ---------------------- */

/** No body. The route always force-re-crawls; it never consults the read cache. */
export type PostScanRequest = void;

/** Byte-identical in shape to {@link GetArchGraphResponse} — the freshly scanned graph. */
export type PostScanResponse = GetArchGraphResponse;

/* ---------------------------- GET /api/tree — :1460 ----------------------- */

export type GetTreeRequest = void;

/**
 * `TreeNode` (`tree.ts:5`). `.sequence`, `.git`, `.ssh`, `.aws` and `.gnupg` never
 * appear at any depth, and neither do credential-bearing files — this tree feeds
 * the provider prompt builders, so the omissions are load-bearing.
 */
export interface TreeNode {
  name: string;
  /** Repo-relative path (POSIX separators); `''` for the root node. */
  path: string;
  type: 'file' | 'dir';
  children?: TreeNode[];
}

/** The root node itself, not a wrapper object. */
export type GetTreeResponse = TreeNode;

/* -------------------------- GET /api/functions — :1745 -------------------- */

export type GetFunctionsRequest = void;

/**
 * The grounded function-level graph. Never 500s: a build failure is an empty
 * graph. `warnings` is the read-and-clear route-handler attribution ambiguity
 * from the build, replayed from the cache on a hit so a cached answer is as
 * qualified as a fresh one.
 *
 * NOT in `SENSITIVE_EXACT` — it relies on `requireOwner()` alone, which returns
 * false when no owner is recorded. See gap G15.
 */
export interface GetFunctionsResponse {
  functionGraph: FunctionGraph;
  warnings: string[];
}

/* --------------------------- POST /api/explain — :1602 -------------------- */

/**
 * Both fields optional. A body-less POST (and a garbage body) is tolerated and
 * means `recommended` + `regular`.
 */
export interface PostExplainRequest {
  profile?: ExplainProfile;
  detailLevel?: DetailLevel;
}

/**
 * `profile` and `detailLevel` are ALWAYS echoed back (the cached branch defaults
 * them, the fresh branch passes them through), so they are required on the
 * response even though they are optional on the request. `provider` is present
 * only when the AI path produced the tree; `projectType` only on `bestfit`.
 */
export interface PostExplainResponse {
  tree: PlainNode;
  mode: 'ai' | 'structural';
  provider?: string;
  profile: ExplainProfile;
  projectType?: string;
  detailLevel: DetailLevel;
}

/* -------------------------- POST /api/annotate — :1679 -------------------- */

export interface PostAnnotateRequest {
  detailLevel?: DetailLevel;
}

/**
 * Per-node plain-English bullets keyed by REAL `ArchNode.id` — ids the model
 * invented are stripped before this map is built. No provider configured ⇒ an
 * honest `{ annotations: {}, mode: 'none' }` at 200, never fabricated prose (and
 * in that one branch `detailLevel` is still echoed).
 *
 * NOT in `SENSITIVE_EXACT` — same G15 caveat as `/api/functions`.
 */
export interface PostAnnotateResponse {
  annotations: Record<string, string[]>;
  mode: 'ai' | 'none';
  provider?: string;
  detailLevel: DetailLevel;
}

/* ----------------------------- POST /api/ddl — :3033 ---------------------- */

/**
 * Pure preview — this route writes nothing. `spec` omitted ⇒ the stored
 * `.sequence/spec.json`; `scope` is a list of node ids to carve a sub-spec from.
 */
export interface PostDdlRequest {
  spec?: ArchGraph;
  scope?: string[];
}

export interface PostDdlResponse {
  sql: string;
}
