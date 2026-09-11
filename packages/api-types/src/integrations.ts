/**
 * Agents / MCP / GitHub — the agents, MCP and GitHub routes in `server/repoServer.ts`.
 *
 * The ACP routes are LOCAL-ONLY by design: hosted (auth-on) mode, a
 * non-loopback/cross-origin request, or `SEQUENCE_DISABLE_ACP` each turn them off.
 * A client must feature-detect through `/api/acp/available` and hide the path when
 * it answers `available:false`.
 */

import type { GraphSummary } from './attach.js';

/* ------------------------ GET /api/acp/available — :2451 ------------------ */

export type GetAcpAvailableRequest = void;

/**
 * 200 for any LOCAL caller — including an honest `available:false` in hosted mode.
 * A genuinely non-local (cross-origin / DNS-rebound) prober gets a **403** instead.
 */
export interface GetAcpAvailableResponse {
  available: boolean;
  /** Present whenever `available` is false; the copy to show the user verbatim. */
  reason?: string;
}

/* ------------------------- GET /api/acp/agents — :2462 -------------------- */

export type GetAcpAgentsRequest = void;

/**
 * One registered local coding agent (`agentsStore.ts:23`). Holds no secret — just
 * how to launch a local binary — so nothing is redacted.
 */
export interface AgentEntry {
  /** Stable id the user (and a program's `acp.agentRef`) references. */
  id: string;
  command: string;
  args?: string[];
  cwd?: string;
  label?: string;
}

/**
 * **READ-ONLY, CLI-ONLY REGISTRATION.** `addAgent`/`removeAgent` are reachable
 * only from `cli.ts` — there is no HTTP CRUD (gap G10), so a GUI cannot onboard an
 * agent. Do not design an "add agent" form against this route.
 */
export interface GetAcpAgentsResponse {
  agents: AgentEntry[];
}

/* ----------------------- POST /api/acp/run-node — :2487 ------------------- */

export interface PostAcpRunNodeRequest {
  /** Must match a registered agent id, else 400. */
  agentRef: string;
  prompt: string;
  /**
   * Honoured only when it resolves INSIDE the attached repo root; an absolute or
   * `..`-escaping value is dropped and the turn stays pinned to the root.
   */
  cwd?: string;
  /**
   * Opaque key (`${runScope}::${agentRef}`) that reuses one live session and
   * serialises turns on it. Never parsed, trusted, or logged by the server.
   * Omitted ⇒ a fresh session per call.
   */
  sessionKey?: string;
}

/** The real ACP stop reason. Never fabricated. */
export type AcpStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'max_turn_requests'
  | 'refusal'
  | 'cancelled';

/**
 * `text` is accumulated from streamed `agent_message_chunk` updates.
 *
 * The streamed `session/update` notifications and the permission prompt are BOTH
 * discarded on this path (gap G9): `new AcpClient(launch)` is constructed with
 * launch config only, so permissions fall through to `defaultPermissionPolicy`,
 * which allows only `read`/`fetch`/`search`/`think`. A local agent driven through
 * this route today is read-only, silently.
 */
export interface PostAcpRunNodeResponse {
  stopReason: AcpStopReason;
  text: string;
}

/* -------------------------- GET /api/mcp/tools — :3468 -------------------- */

export type GetMcpToolsRequest = void;

/** A tool declared by a configured server (from `tools/list`). */
export interface McpToolInfo {
  /** The allowlisted server name that declared this tool. */
  server: string;
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/**
 * Partial success by design: `errors` carries one entry per server that failed to
 * list, and the call still returns 200 with whatever did list.
 */
export interface GetMcpToolsResponse {
  tools: McpToolInfo[];
  errors: string[];
}

/* -------------------------- POST /api/mcp/call — :3479 -------------------- */

export interface PostMcpCallRequest {
  /** Must be in the merged allowlist (`.sequence/mcp.json` + env), else 400 — never spawned. */
  server: string;
  tool: string;
  args?: unknown;
}

/** Forwarded verbatim. `isError` mirrors the MCP `isError` flag; a tool error is not an HTTP error. */
export interface PostMcpCallResponse {
  server: string;
  tool: string;
  content?: unknown;
  isError?: boolean;
}

/* ------------------------- GET/PUT /api/mcp — C2.2 config ------------------- */

/** One stdio MCP server entry in `.sequence/mcp.json`. */
export interface McpServerConfigDocument {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface McpConfigDocument {
  servers: Record<string, McpServerConfigDocument>;
}

/** GET /api/mcp — repo file only (Settings editor; not env merge). */
export interface GetMcpConfigResponse {
  path: string;
  exists: boolean;
  document: McpConfigDocument;
  text: string;
  warnings: string[];
}

/** PUT /api/mcp — write `.sequence/mcp.json` from canonical text. */
export interface PutMcpConfigRequest {
  text: string;
}

export interface PutMcpConfigResponse {
  path: string;
  document: McpConfigDocument;
  text: string;
  warnings: string[];
}

/* ------------------------- GET /api/plugins — C2.3 list ------------------- */

export type GetPluginsRequest = void;

/** One readonly plugin from `.sequence/plugins.json` (v0). */
export interface PluginListEntry {
  id: string;
  title?: string;
  mode: 'readonly';
  tools: Array<{ name: string; description?: string }>;
}

/**
 * Read-only list for Settings / Index.
 * `ok: false` is an honest parse error, not an empty list.
 */
export interface GetPluginsResponse {
  ok: boolean;
  plugins: PluginListEntry[];
  /** Present when ok is false (invalid plugins.json). */
  error?: string;
  /** Absolute path when a file was read; null when missing (empty success). */
  path: string | null;
  /**
   * Binding honesty for the UI: true when ask may dispatch declared tools via
   * `call_plugin` (readonly builtins / honest no-handler).
   */
  askWired: boolean;
}

/* ------------------------ POST /api/net-fetch — Browser panel -------------- */

export interface PostNetFetchRequest {
  url: string;
}

/** Grounded fetch result — URL, status, and capped plain text only. */
export interface PostNetFetchResponse {
  url: string;
  ok: boolean;
  status?: number;
  title?: string;
  /** Plain text excerpt (truncated). Absent when ok is false. */
  text?: string;
  error?: string;
}

/* ---------------------------- /api/github — :2633 ------------------------- */

export type GetGithubRequest = void;

export interface GithubNotConnectedResponse {
  connected: false;
}

/** `tokenMasked` is `••••`+last4. The real PAT is never returned. */
export interface GithubConnectedResponse {
  connected: true;
  tokenMasked: string;
}

export type GetGithubResponse = GithubNotConnectedResponse | GithubConnectedResponse;

/** The token is persisted ONLY to the user-level `~/.sequence/github.json`. */
export interface PutGithubRequest {
  token: string;
}

export type PutGithubResponse = GithubConnectedResponse;

export type DeleteGithubRequest = void;

export type DeleteGithubResponse = GithubNotConnectedResponse;

/* ------------------------- GET /api/github/repos — :2682 ------------------ */

export type GetGithubReposRequest = void;

/** An honest subset of GitHub's payload, capped at 100 entries. */
export interface GithubRepo {
  fullName: string;
  cloneUrl: string;
  private: boolean;
}

export interface GetGithubReposResponse {
  repos: GithubRepo[];
}

/**
 * **502** when GitHub itself failed. Any attached body is GitHub's OWN response —
 * it can never contain the token we sent.
 */
export interface GithubUpstreamErrorResponse {
  error: string;
  githubResponse?: string;
}

/* ------------------------ POST /api/github/clone — :2717 ------------------ */

/**
 * Exactly one of the two. `fullName` is resolved against the token owner's own
 * repo list (an allow-list); a raw `cloneUrl` must still be an
 * `https://github.com/<owner>/<repo>` URL.
 */
export interface PostGithubCloneRequest {
  fullName?: string;
  cloneUrl?: string;
}

/**
 * Deliberately the `/api/attach` shape plus `clonedTo`, so a client reuses one
 * attach handler and lands in the newly attached workspace.
 */
export interface PostGithubCloneResponse {
  attached: true;
  repoName: string;
  root: string;
  graphSummary: GraphSummary;
  /** Absolute path the repo was cloned to, under `<browseRoot>/sequence-workspaces/`. */
  clonedTo: string;
}

/**
 * **422** — cloned successfully but there was nothing to scan. The repo STAYS on
 * disk, which is why this carries `clonedTo` where `/api/attach` does not.
 */
export interface PostGithubCloneNoManifestsError {
  error: string;
  code: 'no-manifests';
  repoName: string;
  clonedTo: string;
}
