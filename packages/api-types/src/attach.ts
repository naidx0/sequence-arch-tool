/**
 * Attach / browse — the S0→S1 path. `POST /api/attach` and `GET /api/browse`
 * in `server/repoServer.ts`.
 *
 * SINGLE ACTIVE REPO. `repoRoot` / `currentGraph` / `repoOwner` are closure
 * variables on one server instance (module scope, `server/repoServer.ts`), self-documented as
 * "hosted mode is SINGLE-ACTIVE-REPO — one attached repo for the whole server".
 * A multi-repo client is not expressible against this contract.
 */

import type { Policy } from '@sequence/schema';

/* ---------------------------- GET /api/status — :1051 --------------------- */

/** No request payload. */
export type GetStatusRequest = void;

/**
 * Attached, and the caller owns the repo (always true in local/auth-off mode).
 * `root` is the absolute server-side path.
 *
 * Optional `stale*` fields (P5): present when the served graph is behind disk —
 * known writes or `fs.watch`. Same shape as `/archgraph.json`'s stale marker.
 */
export interface GetStatusOwnedResponse {
  attached: true;
  repoName: string;
  root: string;
  stale?: true;
  staleSince?: string;
  stalePaths?: string[];
  staleTruncated?: boolean;
}

/**
 * Attached, but an authenticated NON-owner asked. The name and the absolute path
 * are withheld deliberately (the non-owner branch of `POST /api/attach`) — this is a leak fix, not
 * an omission, so a client must handle the narrow shape rather than assume the wide one.
 */
export interface GetStatusForeignResponse {
  attached: true;
}

export interface GetStatusDetachedResponse {
  attached: false;
}

export type GetStatusResponse =
  | GetStatusOwnedResponse
  | GetStatusForeignResponse
  | GetStatusDetachedResponse;

/* ---------------------------- GET /api/browse — :1067 --------------------- */

/** `?path=<dir>`; absent/empty means "the browse root itself". */
export interface GetBrowseQuery {
  path?: string;
}

/** One immediate sub-directory. This route NEVER returns file contents. */
export interface BrowseEntry {
  name: string;
  /** Absolute path (lexical, stable for display + re-navigation). */
  path: string;
  /** The dir looks like a project root (`.git` / `package.json` / a compose file). */
  isRepo: boolean;
  /** The dir has at least one browsable sub-directory (picker expand hint). */
  hasChildren: boolean;
}

export interface GetBrowseResponse {
  /** The browse-root boundary (absolute, canonical) — nothing above it is reachable. */
  root: string;
  /** The directory being listed (absolute, canonical). */
  path: string;
  /** Parent directory, or null at the browse root (cannot ascend past it). */
  parent: string | null;
  entries: BrowseEntry[];
}

/* ---------------------------- POST /api/attach — :1083 -------------------- */

export interface PostAttachRequest {
  /** A directory inside the caller's browse root. Never the browse root itself. */
  path: string;
}

/** `graphSummary()` in `server/repoServer.ts`. Five counts, all present, all numbers. */
export interface GraphSummary {
  nodes: number;
  edges: number;
  services: number;
  datastores: number;
  topics: number;
}

export interface PostAttachResponse {
  attached: true;
  repoName: string;
  /** Absolute canonical path of the newly attached root. */
  root: string;
  graphSummary: GraphSummary;
}

/**
 * The calm 422 the attach dialog must render as an informational note, never as
 * an error wall (the `NoManifestsError` branch in `server/repoServer.ts`). `code` is the stable discriminator set by
 * `NoManifestsError` (`scan.ts:71`).
 */
export interface PostAttachNoManifestsError {
  error: string;
  code: 'no-manifests';
  repoName: string;
}

/**
 * Every attach failure the dialog has to render honestly:
 * **415** wrong content-type · **400** malformed body / missing `path` /
 * "pick a project folder inside your home directory, not the home directory
 * itself" / the path is not a directory · **403** the path escapes the browse
 * root · **404** directory not found · **422** {@link PostAttachNoManifestsError}
 * · **500** the scan itself threw.
 */
export type PostAttachErrorResponse = { error: string } | PostAttachNoManifestsError;

/* ---------------------------- POST /api/detach — :1166 -------------------- */

export type PostDetachRequest = void;

export interface PostDetachResponse {
  attached: false;
}

/* ---------------------------- GET /api/recent — :1182 --------------------- */

export type GetRecentRequest = void;

export interface RecentRepo {
  /** Absolute path. */
  path: string;
  /** `path.basename(path)` — computed by the route, not stored. */
  name: string;
}

/** Most-recent first, already filtered to the caller's own browse jail. */
export interface GetRecentResponse {
  recent: RecentRepo[];
}

/* ---------------------------- GET /api/policies — :1204 ------------------- */

export type GetPoliciesRequest = void;

/**
 * `LoadedPolicies` (`store.ts:114`). ALWAYS 200 — "this repo has no policies" is a
 * real answer (`{ policies: [], warnings: [] }`), never a 404. `warnings` carries
 * one line per policy file that did NOT load; a client must surface them, because
 * a policy the user believes is enforced but which the server quietly ignored is
 * the worst outcome this feature can produce.
 */
export interface GetPoliciesResponse {
  policies: Policy[];
  warnings: string[];
}

/* ---------------------- GET/PUT /api/repo-trust — the trust boundary ------ */

/**
 * WHAT A REPOSITORY IS ASKING FOR, AS DATA.
 *
 * The text of the repository's own instruction file (`.sequence/instructions.md`,
 * `AGENTS.md`, `CLAUDE.md` or `.cursorrules` — the first that exists). It is
 * returned so the SURFACE can show it and the person can read what the repo
 * wants before deciding; it is NOT what the model receives. Those are two
 * different paths and `explain/instructions.ts` names both
 * (`describeRepoInstructions` vs `renderTrustedInstructionsSection`).
 */
export interface RepoInstructionsDisclosure {
  /** Repo-relative path of the file that was found. */
  file: string;
  /** Its text, capped at `INSTRUCTIONS_CAP_BYTES`. */
  text: string;
  /** True when the cap bit and this is not the whole file. */
  truncated: boolean;
}

export type GetRepoTrustRequest = void;

/**
 * ALWAYS 200 while a repo is attached. `trusted:false` with `instructions:null`
 * is an ordinary answer — most repositories carry no instruction file — and the
 * surface needs it to know there is nothing to show.
 *
 * UNTRUSTED IS THE DEFAULT AND IT MEANS THREE THINGS: the instruction file is
 * not fed to the model as binding instruction, `run_command` is off, and
 * repo-provided config is ignored.
 *
 * "CONFIG" IS TWO FILES, and the second was nearly missed. `.sequence/
 * permissions.json` grants power, so gating it is the obvious half.
 * `.sequence/ai.json` REDIRECTS TRAFFIC: it wins over the user's own config
 * when valid, so a hostile repository could commit one whose `baseUrl` is its
 * own host and every question, file excerpt and snippet would go there. It
 * steals no credential — the repo supplies its own key — which is exactly why
 * it reads as harmless and is not: the user's CODE leaves the machine to an
 * endpoint they never chose. Both are gated in `loadAiConfig` and
 * `loadPermissionPolicy` respectively.
 */
export interface GetRepoTrustResponse {
  /** Absolute server-side root, as `/api/status` reports it. */
  root: string;
  repoName: string;
  trusted: boolean;
  instructions: RepoInstructionsDisclosure | null;
}

/** The one explicit action, scoped to this repo root. */
export interface PutRepoTrustRequest {
  trusted: boolean;
}

/**
 * What the USER-LEVEL store says AFTER the write, re-read rather than echoed —
 * a write that failed (read-only home) must not report success.
 */
export interface PutRepoTrustResponse {
  root: string;
  trusted: boolean;
}
