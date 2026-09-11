import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  checkScaffoldability,
  validateGraph,
  validateProgram,
  isProgramRunLogRow,
  pathMatchesProgramEditAllowlist,
  parseProgramEditAllowlist,
  parseSequenceBoardDoc,
  emptySequenceBoardDoc,
  type ArchGraph,
  type NodeExecutor,
  type Program,
  type SeqDiagramNodeDetail,
} from '@sequence/schema';
/**
 * The SHARED WIRE CONTRACT (W0.5, gap G12). Before this package every request
 * shape here was narrowed inline (`let body: { path?: unknown }`) and every
 * response was an untyped object literal handed to `sendJson`, so a field could
 * be renamed on one side and the client would keep compiling against the old one.
 *
 * `Unvalidated<T>` is the same mapped type those inline narrowings spelled out by
 * hand: every key optional and `unknown`, because `JSON.parse` output is
 * untrusted. The validation below is unchanged — what changed is that the shape
 * being validated TOWARDS now has one definition, shared with the client.
 */
import type {
  Unvalidated,
  GetMeResponse,
  GetStatusResponse,
  GetBrowseResponse,
  PostAttachRequest,
  PostAttachResponse,
  GraphSummary,
  PostDetachResponse,
  GetRecentResponse,
  GetPoliciesResponse,
  GetRepoTrustResponse,
  PutRepoTrustResponse,
  GetArchGraphResponse,
  PostScanResponse,
  GetTreeResponse,
  GetFunctionsResponse,
  PutFileRequest,
  PutFileResponse,
  PostDdlRequest,
  PostDdlResponse,
  GetUsageResponse,
  GetGitStatusResponse,
  PostGitCommitRequest,
  PostGitCommitResponse,
  PostGitBranchRequest,
  PostGitBranchResponse,
  GetGitWorktreesResponse,
  PostGitWorktreeRequest,
  PostGitWorktreeResponse,
  DeleteGitWorktreeResponse,
  PostCheckpointRequest,
  PostCheckpointResponse,
  GetCheckpointsResponse,
  PostCheckpointRestoreRequest,
  PostCheckpointPlanResponse,
  PostCheckpointRestoreResponse,
  GetMcpToolsResponse,
  PostMcpCallRequest,
  PostMcpCallResponse,
  GetMcpConfigResponse,
  PutMcpConfigRequest,
  PutMcpConfigResponse,
  PostNetFetchRequest,
  PostNetFetchResponse,
  GetPluginsResponse,
  PostAcpRunNodeRequest,
  PostAcpRunNodeResponse,
  PostTrajectoryResponse,
  GetProgramRunLogResponse,
  PostProgramRunRequest,
  PostProgramRunResponse,
  GetProgramRunsResponse,
  GetProgramRunResponse,
  PostProgramRunCancelResponse,
  ProgramInvalidResponse,
  ProgramRunEvent,
  GetPermissionsResponse,
  PutPermissionsRequest,
  PutPermissionsResponse,
  GetAutoApproveResponse,
  PutAutoApproveRequest,
  PutAutoApproveResponse,
} from '@sequence/api-types';
import { scanRepo, MAX_FILE_BYTES, NoManifestsError, IGNORE_DIRS, type ScanOptions } from '../scan.js';
import { buildRepoFunctionGraphCached } from './functionGraphCache.js';
import { diffGraphs } from '../diff.js';
import { buildLift } from '../score.js';
import { renderBriefFromGraph, scopeGraph } from '../brief.js';
import { renderDDL, hasDbTables } from '../ddl.js';
import type { GitDiffScope } from './gitWorkspace.js';
import { executeSearchFiles } from './askTools.js';
import {
  BLOCKING_EVENTS,
  HOOK_EVENTS,
  HOOK_EVENTS_LIVE,
  isTrusted,
  runHooks,
  unfiredHookWarning,
} from './hooks.js';
import { applyAskFileWrites } from './applyAskFileWrites.js';
import { startRepoWatch, type RepoWatchHandle } from './repoWatch.js';
import {
  emptyPermissionDocument,
  parsePermissionsDocument,
  permissionsFilePath,
  serializePermissionsDocument,
  writePermissionsDocument,
} from './permissionRules.js';
import { canonicalRoot, resolveInRepo, realpathContained } from './jail.js';
import {
  computeSignature,
  readCachedGraph,
  writeCachedGraph,
  clearCachedGraph,
} from './graphCache.js';
import { attachTerminal, isOriginAllowed, TERMINAL_PATH } from './terminal.js';
import { listAgents, getAgent, type AgentEntry } from './agentsStore.js';
import {
  AcpClient,
  createAcpExecutor,
  defaultPermissionPolicy,
  type AcpAgentClient,
  type AcpClientConfig,
  type PermissionDecision,
} from '@sequence/acp';
import { createAcpSessionCache, type AcpSessionCache } from './acpSessionCache.js';
import {
  createProgramRunner,
  TooManyRunsError,
  type BuiltExecutors,
  type ProgramRunner,
  type RunExecutionContext,
} from './programRunner.js';
import { isRunId } from './programRunStore.js';
import { canonicalBrowseRoot, browseDir, resolveInBrowseRoot } from './browse.js';
import { buildTree } from './tree.js';
import { findWebDist, serveStatic } from './static.js';
import {
  readJson,
  writeJson,
  readRecent,
  addRecent,
  readHookFile,
  readHookTrust,
  setHookTrust,
  readPolicies,
  readUserJson,
  writeUserJson,
  deleteUserJson,
  userStoreDir,
  usageFileForIdentity,
  userBrowseSubdir,
  userRecentStoreDir,
  SPEC_FILE,
  AI_FILE,
  EXPLAIN_FILE,
  ANNOTATIONS_FILE,
  BOARD_FILE,
  GITHUB_FILE,
  WORKSPACES_DIR,
} from './store.js';
import { appendProgramRunLog, readProgramEditAllowlist, readProgramRunLog, readProgramStrategy } from './programMemory.js';
import {
  ensureSessionsMigrated,
  createSession,
  readSessionChat,
  readSessionMeta,
  readSessionBoard,
  readSessionCanvas,
  setActiveSession,
  updateSession,
  deleteSession,
  listRepoSessionSections,
  readLesson,
  writeLesson,
} from './sessionsStore.js';
import { resolveAskThreadId } from './askSession.js';
import { readCarry, writeCarry } from './carryStore.js';
import { beginTeachTurn } from './teachTurn.js';
import { buildStamp } from './buildStamp.js';
import { migrateCheckpoint, readCheckpoint } from './checkpoint.js';
import { gradeCheckIn } from './checkIn.js';
import {
  advanceLesson,
  lessonExhausted,
  buildTeachContext,
  needsPlan,
  newLesson,
  nextConcept,
} from './lessonState.js';
import {
  decide,
  recordUse,
  normalizeUsage,
  currentMonthYear,
  DEFAULT_METER_POLICY,
  type MeterUsage,
} from './meter.js';
import {
  validateGithubConfig,
  redactGithubConfig,
  listGithubRepos,
  GithubError,
  defaultGithubFetch,
  type GithubConfig,
  type GithubFetch,
} from './github.js';
import {
  gitClone,
  validateGithubCloneUrl,
  cloneTargetFromFullName,
  safeRepoDirName,
  type GithubCloneTarget,
  type CloneRepoFn,
} from './gitClone.js';
import {
  gitStatus,
  gitDiff,
  gitRevisions,
  gitCommit,
  gitDiscard,
  gitNumstatSnapshot,
  gitCreateBranch,
  gitHandoffWorktree,
  gitListWorktrees,
  gitRemoveWorktree,
  GitWorkspaceError,
} from './gitWorkspace.js';
import {
  applyRestore,
  captureCheckpoint,
  isCheckpointSessionId,
  listCheckpoints,
  listTrackedFiles,
  planRestore,
  trackSessionWrite,
} from './checkpointStore.js';
import {
  askTurnExists,
  isAskTurnId,
  openAskTurnLog,
  readAskTurnEvents,
} from './askTurnLog.js';
import {
  listAttachments,
  putAttachment,
  readAttachment,
  readAttachmentText,
  renderAttachmentSection,
} from './attachmentStore.js';
import {
  loadPluginManifestV0,
} from './pluginManifest.js';
import {
  listMcpTools,
  callMcpTool,
  loadMcpConfigFromFile,
  parseMcpConfigDocument,
  serializeMcpConfig,
  writeMcpConfigDocument,
  UnknownMcpServerError,
  McpTransportError,
} from './mcpClient.js';
import { netFetchUrl } from './netFetch.js';
import {
  buildPlainTree,
  buildDigest,
  buildDesignSuggestPrompt,
  normalizeDesignSuggestion,
  buildAnnotations,
  parseAskHistoryTurns,
  renderAskHistorySection,
} from '../explain/explain.js';
import { describeRepoInstructions, renderTrustedInstructionsSection } from '../explain/instructions.js';
import { isRepoTrusted, setRepoTrust } from './repoTrust.js';
import { clearAutoApprove, readAutoApprove, setAutoApprove } from './autoApprove.js';
import type { DesignAskContext } from '../explain/explain.js';
import {
  parseAskIntents,
  parseAskMode,
  parseAskContextLines,
} from '../explain/askIntents.js';
import {
  parseAskSurface,
  isDeicticSurfaceQuestion,
  answerSurfaceQuestion,
} from '../explain/askSurface.js';
import {
  runAskPipeline,
  computeAskInstructionHash,
  isTeachTurn,
  type AskPipelineResult,
  type AskStreamEvent,
} from './askPipeline.js';
import { buildRunReceipt, writeRunReceipt } from './runReceipt.js';
import { parseAskJobMode, askToolsForJobMode, openaiAskToolDefinitions } from './askTools.js';
import {
  writeTrajectory,
  readTrajectory,
  buildAskTrajectoryGraph,
  isTrajectoryDoc,
  askMetricsFromTerminal,
  type TrajectoryDoc,
} from './trajectoryStore.js';
import {
  loadSkillSummaries,
  matchSkillBody,
  renderSkillSummaryLines,
  renderSkillBodyLines,
} from '../harness/skillLoader.js';
import { distillSkillsFromTrajectories } from '../harness/skillDistill.js';
import { planRefineFromTrajectories } from '../harness/refinePlanner.js';
import { runLearningLoop } from '../harness/learningLoop.js';
import {
  buildRefineEnhancePrompt,
  buildSkillDistillPrompt,
  harnessLlmCaller,
} from '../harness/harnessLlm.js';
import {
  applyRefineProposal,
  denyRefineProposal,
  rollbackRefineProposal,
  listRefineProposals,
  readRefineProposal,
  writeRefineProposal,
} from '../harness/refineProposal.js';
import {
  runDesignatedVerify,
  isVerifyPassed,
  runAllowlistedRepoCommand,
  parseAskDoneWhen,
} from '../harness/verifyGate.js';
import { parse as parseYaml } from 'yaml';
import { approxTokens } from '../llm/tokenBudget.js';
import type { PlainNode } from '../explain/plaintree.js';
import {
  detectLocalProviders,
  probeContextWindow,
  probeEffectiveContext,
  isLocalOllama,
} from './localProviders.js';
import { seqdNodeDetailFromStructuralTree } from '../explain/seqdEnrichment.js';
import { runLiveResearch } from '../research/liveResearch.js';
import {
  buildGeneratePrompt,
  buildPromptFilePrompt,
  generateFiles,
  generateText,
  generateTextWithUsage,
  isMaskedApiKey,
  redactAiConfig,
  validateAiConfig,
  migrateAiConfigToProfiles,
  aiConfigFromEnv,
  preferEnvOverUnservableDefault,
  readAiEnvPrefill,
  ProviderError,
  RateLimitError,
  deepSeekConfigured,
  deepSeekBaseUrl,
  deepSeekModel,
  type AiConfig,
  type GeneratedFile,
  type ProviderReply,
  type ProviderStreamOptions,
  type ProviderToolRequest,
} from './provider.js';
import {
  createInMemoryDailyGate,
  createDurableDailyGate,
  freeTierDailyLimit,
  FREE_TIER_LIMIT_UNAVAILABLE_MSG,
  type DailyGate,
} from './freeTierLimit.js';
import {
  signSession,
  signState,
  verifySession,
  verifyState,
  readCookie,
  buildSetCookie,
  clearCookie,
  SESSION_COOKIE,
  STATE_COOKIE,
  DEFAULT_SESSION_TTL,
} from './session.js';
import {
  loadAuthConfig,
  authEnabled,
  availableProviders,
  providerConfigured,
  buildAuthorizeUrl,
  randomState,
  generatePkce,
  exchangeCode,
  defaultAuthFetch,
  type AuthConfig,
  type AuthFetch,
  type AuthProvider,
} from './auth.js';
import { createPgUsageStore, createPgDailyUsageStore } from './pgStore.js';

/** Cap for JSON request bodies (a posted design spec, a file write). Matches the file read cap. */
const MAX_BODY_BYTES = 1_000_000;

/** Honest refusal shared by every HTTP API/graph request origin guard. */
const API_ORIGIN_ERROR =
  "forbidden request host or origin: use the Sequence app's own URL (local-only loopback in local mode)";

/** OAuth CSRF-state cookie lifetime: a login round-trip is short. */
const OAUTH_STATE_TTL_SECONDS = 600;

/**
 * Byte caps on model-authored writes. A hostile or confused provider response
 * could otherwise try to write one enormous file (or an enormous TOTAL across
 * many files) and fill the disk. A breach of EITHER cap rejects the WHOLE
 * request (nothing is written), matching vetWritePaths' all-or-nothing
 * semantics for unsafe paths.
 */
const MAX_WRITE_FILE_BYTES = 2_000_000; // 2 MB per single file
const MAX_WRITE_TOTAL_BYTES = 20_000_000; // 20 MB across the whole response

/**
 * ===================== v13 request-level authorization =======================
 * The app was built local-first: every localhost request was the one trusted
 * user, so identity was `'local'` and there was no per-request authz. v12 added
 * OAuth (for metering) + a public `0.0.0.0` bind option WITHOUT request-level
 * authz — an exploitable gap. These helpers close it, ENV-GATED so the local
 * path (no auth) stays byte-identical: with auth OFF every check below is a no-op.
 *
 * SENSITIVE = endpoints that require a valid signed session when auth is enabled.
 * Anything not listed here is PUBLIC (static web assets, GET /api/me, /auth/*)
 * and needs no session. The terminal WS upgrade is guarded separately (see the
 * upgrade gate in createRepoServer).
 *
 * v13 Finding B: `/api/status` is SENSITIVE too — it echoes the attached repo
 * name + absolute server path, which must not leak to an anonymous caller on a
 * public bind. Under auth an anonymous request is 401'd here, and even an
 * authenticated NON-owner gets a minimal body (see the handler). Local mode
 * (auth off) leaves it public + harmless exactly as before.
 */
const SENSITIVE_EXACT: ReadonlySet<string> = new Set([
  '/archgraph.json',
  '/api/status',
  '/api/browse',
  '/api/attach',
  '/api/detach',
  '/api/tree',
  '/api/file',
  /* Reads repository CONTENT — exactly as sensitive as /api/file, and more
     reachable: one request greps the whole tree. Omitting it would let an
     anonymous caller on a public bind search a repo they cannot open a file
     from, which is the same leak by a wider door. */
  '/api/search',
  '/api/scan',
  '/api/ddl',
  '/api/usage',
  '/api/ai-config',
  '/api/permissions',
  '/api/mcp',
  '/api/net-fetch',
  '/api/recent',
  '/api/policies',
  '/api/generate',
  '/api/prompt-file',
  '/api/research',
  '/api/program/strategy',
  '/api/program/run-log',
  '/api/explain',
  '/api/design-suggest',
  '/api/git/status',
  '/api/git/diff',
  '/api/git/revisions',
  '/api/hooks',
  '/api/git/commit',
  // P12 — branch creation and worktree handoff mutate the repository, so they
  // are session-gated exactly like commit.
  '/api/git/branch',
  '/api/git/worktree',
  '/api/git/worktrees',
  // P10 — checkpoints hold file CONTENT from the repo, and a restore
  // rewrites the working tree. Both are at least as sensitive as commit.
  '/api/checkpoint',
  '/api/checkpoints',
  '/api/checkpoint/plan',
  '/api/checkpoint/restore',
  /* An attachment is user-supplied content stored INSIDE the repository, and
     reading one back hands out whatever was put in. Gated like every other
     route that touches repository bytes. */
  '/api/attachment',
  '/api/attachments',
  /* A turn log replays whatever the assistant said about this repository,
     which is at least as sensitive as the answer was live. */
  '/api/ask/events',
]);

/** True when `pathname` requires a valid session under auth (the SENSITIVE set). */
function isSensitivePath(pathname: string): boolean {
  if (SENSITIVE_EXACT.has(pathname)) return true;
  // /api/github and every subpath (repos, clone) are all session-gated.
  if (pathname === '/api/github' || pathname.startsWith('/api/github/')) return true;
  if (pathname === '/api/sessions' || pathname.startsWith('/api/sessions/')) return true;
  if (pathname === '/api/trajectory' || pathname.startsWith('/api/trajectory/')) return true;
  if (pathname === '/api/harness' || pathname.startsWith('/api/harness/')) return true;
  /*
   * WAVE 1 — the ask family is gated as a PREFIX, not as one exact string.
   *
   * `/api/ask` used to sit in SENSITIVE_EXACT on its own, so `/api/ask/stream`
   * — the same question, the same digest of the same private repo, the same
   * provider call — was answered to an anonymous caller on a hosted bind while
   * its buffered twin 401'd. The bug was not that someone forgot one path: it
   * was that the ask family was the only multi-route family on this server
   * expressed as an exact match, so adding a route to it silently added a hole.
   * Listing it beside github/sessions/trajectory/harness makes the next ask
   * route inherit the gate instead of reopening the gap.
   */
  if (pathname === '/api/ask' || pathname.startsWith('/api/ask/')) return true;
  /*
   * P8 — the program family is gated as a PREFIX for the reason spelled out
   * directly above for the ask family, and this is the case that comment
   * predicted. `/api/program/strategy` and `/api/program/run-log` are listed in
   * SENSITIVE_EXACT (and stay listed — nothing depends on removing them), but
   * server-side runs add `/api/program/run` plus a whole `/api/program/runs/:id`
   * subtree with a DYNAMIC segment, which an exact set cannot express at all. A
   * program run reads the private repo, spawns local agents and spends metered
   * calls; a route in that family reachable without a session would be the same
   * hole `/api/ask/stream` was.
   */
  if (pathname === '/api/program' || pathname.startsWith('/api/program/')) return true;
  return false;
}

/** Is a bind host a loopback name? (Public = anything else.) */
export function isLoopbackBindHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

/**
 * Refuse an UNSAFE bind. A non-loopback (public) bind is only ever safe when auth
 * is enabled, because the browse/file/tree endpoints would otherwise be publicly
 * reachable with no request-level authz. Throws a clear Error (the caller does NOT
 * listen) when `bindHost` is non-loopback and auth is not enabled. Returns whether
 * the bind is loopback so the caller can also fold it into terminal resolution.
 */
export function assertSafeBind(bindHost: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const loopback = isLoopbackBindHost(bindHost);
  if (!loopback && !authEnabled(loadAuthConfig(env))) {
    throw new Error(
      `sequence: refusing to bind ${bindHost} (non-loopback) with NO auth configured — ` +
        `the browse/file endpoints would be publicly reachable with no request-level ` +
        `authorization. Configure OAuth (SESSION_SECRET + PUBLIC_BASE_URL + ` +
        `GOOGLE_/GITHUB_CLIENT_ID+SECRET) before exposing this server, or bind 127.0.0.1.`
    );
  }
  return loopback;
}

/**
 * Resolve whether the repo-scoped terminal WS may be enabled for a bind.
 * SECURITY INVARIANT: a non-loopback (public) bind ALWAYS forces the terminal OFF,
 * regardless of `authOn` or `SEQUENCE_ENABLE_TERMINAL` — a pipe shell hands the
 * caller a shell as the server user, never acceptable on a shared/public bind.
 * Only a loopback bind may enable it:
 *   - loopback + auth ON  ⇒ opt-in only (SEQUENCE_ENABLE_TERMINAL === '1').
 *   - loopback + auth OFF ⇒ ON (the local single-user default, unchanged).
 * (`SEQUENCE_DISABLE_TERMINAL` still applies downstream in attachTerminal.)
 */
export function resolveTerminalEnabled(
  loopbackBind: boolean,
  authOn: boolean,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!loopbackBind) return false;
  if (authOn) return env.SEQUENCE_ENABLE_TERMINAL === '1';
  return true;
}

/**
 * The on-disk shape of `.sequence/explain.json`. Keyed on the graph's
 * `scannedAt` so a rescan (which mints a new timestamp) transparently
 * invalidates it — a stale explanation is never served for changed structure.
 */
interface ExplainCache {
  scannedAt: string;
  tree: PlainNode;
  mode: 'ai' | 'structural';
  provider?: string;
  /** v9 Phase 3b: which generate profile produced this tree. */
  profile?: 'recommended' | 'bestfit';
  /** v9 Phase 3b: the deterministic product type (best-fit only). */
  projectType?: string;
  /** v9 Phase 4: which detail level produced this tree (absent ⇒ 'regular'). */
  detailLevel?: 'regular' | 'advanced';
}

/**
 * The explain cache is FOLDED on BOTH the chosen profile (v9 Phase 3b) and the
 * detail level (v9 Phase 4): recommended|bestfit × regular|advanced are four
 * distinct views of the same scan, so they must never collide. Recommended+regular
 * keeps the original `explain.json` file (shape unchanged, body-less callers stay
 * here); the other three live in sibling files. All are still invalidated by
 * `scannedAt`. Filenames: explain.json, explain.advanced.json, explain.bestfit.json,
 * explain.bestfit.advanced.json.
 */
function explainCacheFile(
  profile: 'recommended' | 'bestfit',
  detailLevel: 'regular' | 'advanced'
): string {
  const parts: string[] = [];
  if (profile === 'bestfit') parts.push('bestfit');
  if (detailLevel === 'advanced') parts.push('advanced');
  const suffix = parts.length > 0 ? `.${parts.join('.')}.json` : '.json';
  return EXPLAIN_FILE.replace(/\.json$/, suffix);
}

const ANNOTATIONS_CACHE_VERSION = 1;

/**
 * The on-disk shape of `.sequence/annotations.json`. Keyed on the graph's
 * `scannedAt` and `detailLevel` so a rescan or detail-level change transparently
 * invalidates it.
 */
interface AnnotationsCache {
  version: typeof ANNOTATIONS_CACHE_VERSION;
  scannedAt: string;
  detailLevel: 'regular' | 'advanced';
  annotations: Record<string, string[]>;
  mode: 'ai' | 'none';
  provider?: string;
}

/** Fold detail level into the annotations cache filename (mirrors explainCacheFile). */
function annotationsCacheFile(detailLevel: 'regular' | 'advanced'): string {
  if (detailLevel === 'advanced') {
    return ANNOTATIONS_FILE.replace(/\.json$/, '.advanced.json');
  }
  return ANNOTATIONS_FILE;
}

// The `.sequence/functions.json` shape, its version and its read/write live in
// `./functionGraphCache.js`. They used to live here as a private const + interface,
// which was fine while this handler was the only reader — and stopped being fine when
// the MCP server needed the same cache for `who_calls <function>`. One definition, or
// two processes start disagreeing about what a repo contains.

export interface RepoServerOptions {
  /** Path to the built web viewer dist. Omitted ⇒ auto-discover; absent ⇒ no static viewer. */
  webDist?: string;
  /** Scan options forwarded to scanRepo (cluster/llm). */
  scan?: { cluster?: boolean; llm?: boolean };
  /**
   * The folder-picker boundary for GET /api/browse + POST /api/attach. Every
   * browsed/attached path is realpath-contained within this dir; nothing above
   * it is reachable. Defaults to the user's home dir (canonicalised). Tests set
   * it to a temp tree.
   */
  browseRoot?: string;
  /**
   * Where the user-level recent-repos store lives (`recent.json`). Defaults to
   * `~/.sequence`. Tests point it at a temp dir so they never touch real home.
   */
  recentStoreDir?: string;
  /**
   * Where the USER-LEVEL AI config (`ai.json`) lives when NO repo is attached —
   * the repo-less design fallback (v8 Phase B2). Defaults to `~/.sequence`. When a
   * repo IS attached, the PER-REPO `.sequence/ai.json` is used instead (per-repo
   * wins), exactly as before. Tests point this at a temp dir so they never touch
   * real home.
   *
   * NOTE: the LOCAL GitHub token (`github.json`) ALSO lives here and is ALWAYS
   * user-level regardless of attach state — a GitHub PAT is a user credential, not
   * per-project memory, and must never be written into a scanned repo.
   */
  userConfigDir?: string;
  /**
   * What is answering on this machine, for the config read to offer.
   *
   * INJECTABLE FOR TWO REASONS, and the first one is a real defect it caused.
   * The detection is a live probe of two localhost ports, so an ai-config test
   * running on a machine where Ollama HAPPENS to be up got a different answer
   * from the same test on a machine where it is not — and two of them, which
   * compare the redacted view exactly, went red for that reason alone. A test
   * whose result depends on what the operator installed is not a test.
   *
   * Second: it is two network round trips on a route unit tests call often.
   *
   * Defaults to the real probe, so production behaviour is unchanged and a
   * caller that forgets this gets the honest answer rather than an empty one.
   */
  detectLocal?: () => Promise<{ name: string; baseUrl: string; models: string[] }[]>;
  /**
   * Test/deploy seam for the FREE metered default's hosted gateway (v9 Phase 2).
   * When set, a `'default'`-mode AI config is routed here instead of the fixed
   * {@link DEFAULT_GATEWAY_URL} placeholder — the tests point it at a MOCK
   * gateway so the whole default-mode + metering path round-trips with NO real
   * network. Absent in production (the real funded gateway is a deploy step
   * outside this build — the one unverified seam). It carries NO secret.
   */
  gatewayBaseUrl?: string;
  /**
   * Injection seam for the GitHub API call (GET /api/github/repos), mirroring how
   * {@link buildPlainTree} injects `callProvider`. Defaults to the platform
   * `fetch`. Tests substitute a mock so the real github.com call is never made in
   * the sandbox — the real call is the identical client path (honest mock-only
   * boundary, the same class as the AI provider and the Electron binary).
   */
  githubFetch?: GithubFetch;
  /**
   * v10 Phase 2: enable the real repo-scoped terminal (WS at /api/terminal).
   * Defaults to true. Set false (or the env `SEQUENCE_DISABLE_TERMINAL=1`) to refuse
   * every terminal upgrade — REQUIRED for any multi-user / non-localhost deploy,
   * since a pipe shell hands the caller a shell as the server user. See terminal.ts.
   */
  terminalEnabled?: boolean;
  /**
   * v10 Phase 4 — THE AUTH-MIDDLEWARE SLOT. Resolves a per-request identity for
   * metering. Returns undefined (the default) ⇒ single-user local mode, so
   * {@link handle}'s `extractIdentity` yields `'local'` and metering keeps its
   * pre-v10 single-file behaviour. A DEPLOYED build injects a resolver that
   * VALIDATES the authenticated session (a signed OAuth cookie / JWT set by the
   * account middleware AFTER Google/GitHub login) and returns the stable user id.
   * A resolver must NEVER trust an unauthenticated client-supplied header on a
   * public bind — that is the deploy contract documented in DEPLOY_BLUEPRINT.md.
   * Tests inject a resolver that reads a header to simulate two authenticated users.
   */
  resolveIdentity?: (req: http.IncomingMessage) => string | undefined;
  /**
   * v10 Phase 4 — the clone seam. The DEFAULT is the real {@link gitClone} (a genuine
   * `git clone --depth 1` of the validated github.com URL, verifiable here). Tests
   * inject a clone that pulls from a LOCAL bare repo so the import→attach path is
   * deterministic and network-independent, while the endpoint's host validation +
   * dest jail-vetting still run on the real code path. Mirrors {@link githubFetch}.
   */
  cloneRepo?: CloneRepoFn;
  /**
   * v12 Phase 2 — the OAuth config powering `/auth/*` + `/api/me`. Absent (the
   * default) ⇒ auth routes report "not configured" and `resolveIdentity` stays
   * unset, so identity is `'local'` exactly as before. A deployed build passes the
   * env-derived {@link loadAuthConfig} result AND a matching `resolveIdentity` (from
   * the session cookie). Carries the client secrets — never returned to a client.
   */
  authConfig?: AuthConfig;
  /**
   * v12 Phase 2 — injection seam for the OAuth token/userinfo calls, mirroring
   * {@link githubFetch}. Defaults to the platform `fetch`; tests substitute a mock
   * so the real provider round-trip is never made in the sandbox.
   */
  authFetch?: AuthFetch;
  /**
   * r31 — tuning for the LOCAL ACP session cache (the server half of session
   * continuity: `POST /api/acp/run-node` reuses one live session per `sessionKey`).
   * Absent ⇒ production defaults ({@link ACP_SESSION_IDLE_TTL_MS} idle TTL,
   * {@link ACP_SESSION_MAX} live sessions). The locking tests inject a tiny TTL /
   * small cap to drive the reap + LRU-evict paths without fake timers.
   */
  acpSession?: { ttlMs?: number; maxSessions?: number };
}

/**
 * The per-identity metering store (v10 Phase 4). The whole point of the seam:
 * meter.ts stays identity-AGNOSTIC (its pure decide/recordUse take usage as a
 * param), and ALL single-user coupling lives behind these two methods. The LOCAL
 * impl is per-identity FILE (see {@link usageFileForIdentity}); a DEPLOYED impl is a
 * per-user DB row — same interface, meter.ts unchanged.
 */
export interface UsageStore {
  /** The identity's usage, normalized to the current month (never throws — zeroed when absent). */
  read(identity: string): MeterUsage;
  /** Persist the identity's usage. */
  write(identity: string, usage: MeterUsage): void;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(payload);
}

function sendError(res: http.ServerResponse, status: number, message: string, extra?: object): void {
  sendJson(res, status, { error: message, ...extra });
}

/**
 * Answer a cancelled request (item 1.3).
 *
 * 499 is nginx's "client closed request" — not an IANA code, but the one every
 * log aggregator already reads as "the caller went away", and materially better
 * than a 200 (which claims an answer) or a 500 (which blames the server for a
 * user action). In the ordinary case the socket is already gone and nothing is
 * written at all; the write only happens for a programmatic abort where a reader
 * is still attached, which is why it is guarded rather than assumed.
 */
function sendAborted(res: http.ServerResponse): void {
  if (res.headersSent || res.writableEnded || !res.writable) return;
  sendError(res, 499, 'request aborted by the client');
}

function startSse(res: http.ServerResponse): void {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/event-stream; charset=utf-8');
  res.setHeader('cache-control', 'no-cache');
  res.setHeader('connection', 'keep-alive');
  // Send the head NOW rather than lazily on the first body write. A client's
  // `fetch` does not resolve until the headers land, so without this the reader
  // is not even attached while the first phase of work runs.
  res.flushHeaders();
}

/**
 * Yield to the event loop so writes already queued on the socket actually leave
 * the process before the caller starts blocking work.
 *
 * This exists because of a measured failure, not a theory. The first cut of the
 * `/api/scan` progress feed emitted all four phase events and the result at
 * +5,395 ms on this monorepo — one burst, at the end. `scanRepo` is synchronous
 * once entered, so it pins the loop for the whole scan and everything written
 * beforehand sits in the outgoing buffer until it finishes. A progress feed that
 * arrives after the work is not progress, and every existence-based assertion
 * about it still passed.
 */
function drainTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function writeSseEvent(res: http.ServerResponse, event: AskStreamEvent, seq: number | null = null): void {
  /*
   * THE `id:` LINE IS WHAT MAKES A BLIP RECOVERABLE, and the ask stream did
   * not have one. `programRunStore`'s own header names exactly this as why a
   * dropped connection loses an ask while a program run survives it: with no
   * id the browser sends no `Last-Event-ID` on reconnect, and a client has
   * nothing it can say it already saw.
   *
   * Null when the turn could not be recorded - an id pointing at a log that
   * does not exist would promise a replay that cannot happen.
   */
  const id = seq === null ? '' : `id: ${seq}\n`;
  res.write(`${id}data: ${JSON.stringify(event)}\n\n`);
}

/**
 * The same framing as {@link writeSseEvent} for events that are NOT part of the
 * `AskStreamEvent` union — the scan-progress feed and the ACP bridge. They ride
 * the identical `data: <json>\n\n` shape so one client reader parses every
 * stream this server produces, but they are deliberately not squeezed into the
 * ask union: an ACP `session/update` reshaped into a `tool:start` row loses the
 * agent's own payload, and a scan phase is not a step of an ask.
 */
function writeSseData(res: http.ServerResponse, event: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/** Does this request want an SSE response? (`accept:` header, or an explicit `?stream=1`.) */
function wantsEventStream(req: http.IncomingMessage, url: URL): boolean {
  const accept = req.headers.accept ?? '';
  if (accept.includes('text/event-stream')) return true;
  const q = url.searchParams.get('stream');
  return q === '1' || q === 'true';
}

/* ============================ WAVE 1 ITEM 1.3 — CANCELLATION =================
 * Gap G3: `AbortController` appeared exactly twice in this file, both inside
 * `/api/acp/run-node`, so Stop was cosmetic on every AI route — and, the part
 * that is not merely a missing feature, THE CALL WAS STILL METERED after the
 * user stopped it (`recordUse`, below).
 *
 * The invariant these helpers establish is narrow and checkable: **a generation
 * the caller stopped is never charged to them.** `recordUse` sits strictly after
 * the awaited provider call inside the metered wrapper, so making the abort win
 * that race is the whole fix — there is no second place a charge can happen.
 *
 * The outbound provider `fetch` receives the same abort signal via
 * `ProviderStreamOptions.signal` (see {@link providerCallOptions}), so Stop
 * tears down the provider socket and the ask pipeline stops its tool loop.
 */

/** Thrown when a caller stopped the request before its provider call resolved. */
class RequestAbortedError extends Error {
  constructor() {
    super('request aborted by the client');
    this.name = 'RequestAbortedError';
  }
}

function isRequestAbortedError(e: unknown): boolean {
  return e instanceof RequestAbortedError || (e instanceof Error && e.name === 'RequestAbortedError');
}

/** Never begin work the caller has already stopped. */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RequestAbortedError();
}

/**
 * Settle on whichever happens first: the work, or the abort.
 *
 * Deliberately a race and not a poll-after-await. Polling after the provider
 * returned would refuse to charge a generation that genuinely completed for the
 * caller a millisecond before they clicked Stop; racing gives the honest rule
 * "charged ⇔ the answer arrived before the stop did", with no free-call window
 * either side.
 */
function raceAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) {
    // Still attach a handler so an in-flight rejection is never unhandled.
    void work.catch(() => {});
    return Promise.reject(new RequestAbortedError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new RequestAbortedError());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

/**
 * The per-request cancellation seam: one controller, aborted when the client
 * goes away before the response is finished.
 *
 * `res` 'close' rather than `req` 'close' for the same reason the ACP route
 * documents at its own listener — by the time a handler runs, `readBody` has
 * already drained and ended the request stream, so a late `req` 'close' can be
 * missed entirely. `res` 'close' also fires on NORMAL completion, which is why
 * the guard checks `writableEnded`: a finished response is not a cancellation.
 */
function requestAbort(res: http.ServerResponse): { signal: AbortSignal; dispose: () => void } {
  const ac = new AbortController();
  const onClose = (): void => {
    if (!res.writableEnded) ac.abort();
  };
  res.on('close', onClose);
  return {
    signal: ac.signal,
    dispose: () => {
      res.off('close', onClose);
    },
  };
}

/**
 * Options handed to the provider layer for one call.
 *
 * `signal` is passed through the widened type on purpose. `provider.ts` does not
 * read it yet (`ProviderStreamOptions` declares only `onDelta`), so today it is
 * inert — but it is the seam that lane owns, and offering it from this side
 * means closing the socket becomes a one-line change there rather than a change
 * in two files owned by two people. The metering invariant above does not depend
 * on it.
 */
type ProviderCallOptions = ProviderStreamOptions & { signal?: AbortSignal };

function providerCallOptions(
  signal?: AbortSignal,
  onDelta?: (text: string) => void,
  tools?: ProviderStreamOptions['tools'],
  cacheBreakpointChars?: number,
): ProviderCallOptions {
  const out: ProviderCallOptions = {};
  if (signal) out.signal = signal;
  /* Absent unless a caller actually wants tokens — `provider.ts` branches on the
   * presence of this field to decide whether to ask the provider to stream. */
  if (onDelta) out.onDelta = onDelta;
  if (tools && tools.length > 0) out.tools = tools;
  /* Prompt caching (ask tool loop): absent ⇒ request bodies byte-identical. */
  if (cacheBreakpointChars !== undefined && cacheBreakpointChars > 0) {
    out.cacheBreakpointChars = cacheBreakpointChars;
  }
  return out;
}

/* ================== WAVE 1 ITEM 1.8 — SCOPED GRAPH READ =====================
 * Gap G7: `/archgraph.json` was all-or-nothing, so every board mount paid for
 * the whole graph even when it wanted one service — and `scopeGraph` (brief.ts)
 * already existed, used only by `/api/generate` and `/api/ddl`. This adds the
 * query surface in front of that same function rather than a second, subtly
 * different narrowing: one definition of what a subgraph is, or the HTTP read
 * and the generate path start disagreeing about what "scoped" means.
 */

/* ==================== WAVE 1 ITEM 1.10 — ACP PERMISSIONS =====================
 * The two notification/permission parameter types are derived FROM the config
 * this server already passes rather than re-declared here, so they can never
 * drift from `@sequence/acp`'s contract, and so this file needs no dependency on
 * the ACP SDK it does not otherwise speak.
 */
type AcpPermissionRequest = Parameters<NonNullable<AcpClientConfig['onPermission']>>[0];
type AcpSessionNotification = Parameters<NonNullable<AcpClientConfig['onUpdate']>>[0];

/** Where a turn's `session/update` and permission events go. */
interface AcpTurnSink {
  onUpdate: (n: AcpSessionNotification) => void;
  onPermission: (r: AcpPermissionRequest) => PermissionDecision;
}

/**
 * The autonomy dial for one ACP turn — Claude Code's `Shift+Tab` modes reduced
 * to the two this server can honestly enforce today (P3 ships the full algebra).
 *
 *  - `default`   — `defaultPermissionPolicy`: read/fetch/search/think only.
 *                  Byte-identical to the pre-1.10 decision.
 *  - `acceptEdits` — additionally allows `edit`. It does NOT allow `execute`,
 *                  `delete` or `move`: "accept edits" is a claim about writing
 *                  files, and quietly folding shell execution into it would be
 *                  the kind of scope creep a permission control exists to stop.
 */
const ACP_PERMISSION_MODES = ['default', 'acceptEdits'] as const;
type AcpPermissionMode = (typeof ACP_PERMISSION_MODES)[number];

/** Absent ⇒ `default`. A PRESENT but unrecognised value is a 400, never a guess. */
function parseAcpPermissionMode(raw: unknown): { mode: AcpPermissionMode } | { error: string } {
  if (raw === undefined || raw === null) return { mode: 'default' };
  if (typeof raw !== 'string' || !(ACP_PERMISSION_MODES as readonly string[]).includes(raw)) {
    return {
      error: `"permissionMode" must be one of: ${ACP_PERMISSION_MODES.join(', ')}`,
    };
  }
  return { mode: raw as AcpPermissionMode };
}

function acpPermissionDecision(r: AcpPermissionRequest, mode: AcpPermissionMode): PermissionDecision {
  if (mode === 'acceptEdits' && r.toolCall?.kind === 'edit') return 'allow';
  return defaultPermissionPolicy(r);
}

/**
 * How many files the scanner will consider under `root` (item 1.5's `files`).
 *
 * A deliberate re-walk rather than a guess, and deliberately the SAME rules as
 * `scan.ts`'s own `walkFiles`: the shared `IGNORE_DIRS` set (imported, not
 * copied) and the same dot-entry exception for `.env`. If those rules ever
 * diverge, this number stops describing the scan it is reporting on — which is
 * precisely why the ignore set is imported rather than restated here.
 *
 * Never throws: an unreadable directory contributes nothing rather than failing
 * a scan that would otherwise have succeeded.
 */
function countScannableFiles(root: string): number {
  let count = 0;
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.env') continue;
      if (e.isDirectory()) {
        if (!IGNORE_DIRS.has(e.name)) walk(path.join(dir, e.name));
      } else if (e.isFile()) {
        count += 1;
      }
    }
  };
  walk(root);
  return count;
}

/** Matches `who_calls`' ceiling: past 5 hops a "scope" is the whole graph again. */
const MAX_SCOPE_DEPTH = 5;

/**
 * Every node CONTAINED by one of `seeds`, transitively (`parentId` closure).
 *
 * `scopeGraph` walks containment UPWARDS — a scoped node brings its ancestors so
 * the result is a well-formed graph. Downwards is this function's job, and it is
 * load-bearing rather than a nicety: in a real scan the edges live between FILE
 * nodes, and services are their parents. Without this, `?scope=svc:analyzer`
 * answered with the service, the repo root and ZERO edges at every depth —
 * measured on this monorepo — because the seed had no edges of its own and
 * nothing below it came along. An empty box that a client renders and believes.
 *
 * Deliberately applied to the REQUESTED ids only, never to nodes reached by an
 * edge hop. "What you named, plus what is inside it, plus N hops out" is a rule a
 * caller can predict; expanding the contents of every hop-reached container turns
 * one hop from a file into that file's whole sibling package.
 */
function containedNodeIds(graph: ArchGraph, seeds: readonly string[]): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const n of graph.nodes) {
    if (!n.parentId) continue;
    const list = childrenOf.get(n.parentId);
    if (list) list.push(n.id);
    else childrenOf.set(n.parentId, [n.id]);
  }
  const out = new Set(seeds);
  const queue = [...seeds];
  while (queue.length > 0) {
    for (const child of childrenOf.get(queue.pop()!) ?? []) {
      if (out.has(child)) continue;
      out.add(child);
      queue.push(child);
    }
  }
  return [...out];
}

/**
 * Grow `seeds` by `depth` hops along edges, in BOTH directions.
 *
 * Undirected on purpose: the question a scoped read answers is "show me this
 * node and its surroundings", and a caller who asked for a datastore wants the
 * services that write to it — which are all *inbound*. A directed walk would
 * return the datastore alone and look like a bug.
 */
function expandScopeSeeds(graph: ArchGraph, seeds: readonly string[], depth: number): string[] {
  const reached = new Set(seeds);
  if (depth <= 0) return [...reached];
  let frontier = [...reached];
  for (let hop = 0; hop < depth && frontier.length > 0; hop += 1) {
    const next: string[] = [];
    const inFrontier = new Set(frontier);
    for (const e of graph.edges) {
      if (inFrontier.has(e.srcId) && !reached.has(e.dstId)) {
        reached.add(e.dstId);
        next.push(e.dstId);
      }
      if (inFrontier.has(e.dstId) && !reached.has(e.srcId)) {
        reached.add(e.srcId);
        next.push(e.srcId);
      }
    }
    frontier = next;
  }
  return [...reached];
}

/** What a scoped read reports about its own narrowing — never a silent drop. */
interface GraphScopeReport {
  /** The ids the caller asked for, exactly as given. */
  requested: string[];
  depth: number;
  /** Nodes in the answer (after `scopeGraph` pulled in ancestors + the repo root). */
  nodes: number;
  /**
   * Edges with exactly ONE endpoint inside the scope. They are real edges that
   * this view cannot draw, so they are counted — the same stance as
   * `GraphQueryAnswer.omitted` in the MCP layer.
   */
  omittedEdges: number;
}

interface GraphScopeView {
  graph: ArchGraph;
  nodeDetail: Record<string, SeqDiagramNodeDetail>;
  /** Identifies this view for cache validation; `''` is the whole graph. */
  key: string;
  scope?: GraphScopeReport;
}

/**
 * Read `?scope=` / `?depth=` off a graph request.
 *
 * An id that matches no node is a 404 naming it, not a silently-ignored filter:
 * answering a bad scope with the whole graph is how a client renders everything
 * and believes it rendered one service.
 */
function parseGraphScopeQuery(
  url: URL,
  graph: ArchGraph,
  nodeDetail: Record<string, SeqDiagramNodeDetail>,
): { view: GraphScopeView } | { error: string; status: number } {
  const raw = url.searchParams.getAll('scope').flatMap((v) => v.split(','));
  const seeds = raw.map((v) => v.trim()).filter((v) => v !== '');
  const depthRaw = url.searchParams.get('depth');
  if (seeds.length === 0) {
    if (depthRaw !== null) {
      return { error: '"depth" is only meaningful with a "scope"', status: 400 };
    }
    return { view: { graph, nodeDetail, key: '' } };
  }
  let depth = 0;
  if (depthRaw !== null) {
    const n = Number(depthRaw);
    if (!Number.isInteger(n) || n < 0 || n > MAX_SCOPE_DEPTH) {
      return { error: `"depth" must be an integer 0..${MAX_SCOPE_DEPTH}`, status: 400 };
    }
    depth = n;
  }
  const known = new Set(graph.nodes.map((n) => n.id));
  const missing = seeds.filter((id) => !known.has(id));
  if (missing.length > 0) {
    return { error: `unknown scope node id(s): ${missing.join(', ')}`, status: 404 };
  }
  // Contents first, then edge hops: a hop out of a contained file is a hop the
  // caller asked for, and reaching it only from the container would miss it.
  const expanded = expandScopeSeeds(graph, containedNodeIds(graph, seeds), depth);
  const { scoped, droppedEdges } = scopeGraph(graph, expanded);
  /*
   * `scopeGraph` returns `warnings: []` — correct for its original caller, which
   * carves a SPEC to scaffold from, and where a scan warning is not part of the
   * design. It is wrong for a graph READ: erasing them means the same repository
   * looks clean the instant a client narrows the view, and warnings of the form
   * "this looks like a deployment-only repo" are exactly what a narrowed view most
   * needs to carry. They are repo-global facts, so the whole list is restored
   * rather than filtered — there is no honest way to decide which of "no compose
   * manifest found" applies to one service.
   */
  const scopedWithWarnings: ArchGraph = { ...scoped, warnings: graph.warnings };
  const keptIds = new Set(scoped.nodes.map((n) => n.id));
  const scopedDetail: Record<string, SeqDiagramNodeDetail> = {};
  for (const [id, detail] of Object.entries(nodeDetail)) {
    if (keptIds.has(id)) scopedDetail[id] = detail;
  }
  return {
    view: {
      graph: scopedWithWarnings,
      nodeDetail: scopedDetail,
      key: `scope=${[...seeds].sort().join(',')}&depth=${depth}`,
      scope: {
        requested: [...seeds],
        depth,
        nodes: scoped.nodes.length,
        omittedEdges: droppedEdges.length,
      },
    },
  };
}

/**
 * Does an `If-None-Match` header validate `etag`?
 *
 * Comparison is WEAK (the `W/` prefix is stripped from both sides) because that
 * is what RFC 9110 specifies for If-None-Match, and because a graph body that is
 * byte-identical apart from key order is still the same graph.
 */
function etagMatches(header: string | string[] | undefined, etag: string): boolean {
  if (header === undefined) return false;
  const raw = Array.isArray(header) ? header.join(',') : header;
  const strip = (t: string): string => t.trim().replace(/^W\//, '');
  const mine = strip(etag);
  for (const candidate of raw.split(',')) {
    const c = strip(candidate);
    if (c === '*' || c === mine) return true;
  }
  return false;
}

function isJsonRequest(req: http.IncomingMessage): boolean {
  const ct = req.headers['content-type'] ?? '';
  return ct.includes('application/json');
}

/** Read the request body as text, rejecting once it exceeds `max` bytes. */
function readBody(req: http.IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Parse the YAML frontmatter block from a `SKILL.md` file's text content.
 * Returns the parsed frontmatter object (unvalidated), or undefined when the
 * file has no frontmatter fence or the YAML is unparseable. Used by the Phase 4
 * refine-accept handler to run the Phase 5 schema-validate verify gate on the
 * proposed `after` content before it lands.
 */
function parseSkillFrontmatter(fileText: string): unknown | undefined {
  const m = /^---\n([\s\S]*?)\n---/.exec(fileText);
  if (!m) return undefined;
  try {
    return parseYaml(m[1]);
  } catch {
    return undefined;
  }
}

/**
 * Build the local platform HTTP server. The server is created but NOT yet
 * listening — the caller (or a test) calls `.listen(port, host)`.
 *
 * `repoRootInput` may be omitted (null/undefined) to start in the NO-REPO state:
 * the server still serves the web app (home screen) plus the browse/attach/
 * status/recent endpoints, and the repo-scoped endpoints (/api/tree, /api/scan,
 * …) return a clean 409 until a repo is attached (via POST /api/attach). When a
 * root IS supplied it is scanned up-front and everything behaves exactly as v6.
 *
 * Every response is JSON except the static viewer and raw file contents. All
 * handlers are wrapped so a thrown error becomes a 4xx/5xx JSON body, never a
 * crashed socket. File access is jailed to the (symlink-resolved) repo root,
 * which fully RE-POINTS on every attach (the old repo's files are unreachable).
 */
export async function createRepoServer(
  repoRootInput: string | null | undefined,
  opts: RepoServerOptions = {}
): Promise<http.Server> {
  const webDist = opts.webDist ?? findWebDist();
  const browseRoot = canonicalBrowseRoot(opts.browseRoot ?? os.homedir());
  const recentStoreDir = opts.recentStoreDir ?? userStoreDir();
  const userConfigDir = opts.userConfigDir ?? userStoreDir();
  const githubFetch = opts.githubFetch ?? defaultGithubFetch;
  const gatewayBaseUrl = opts.gatewayBaseUrl;
  // Per-user DAILY free-tier cap (U6 round; made durable in the deploy round).
  // Keyed by identity + UTC day; only the FREE default is capped (api-key mode is
  // never metered). The cap is env-configurable (FREE_TIER_DAILY_LIMIT, default
  // 100 ⇒ ≈ $0.25/day/user).
  //
  // DATABASE_URL set ⇒ the Postgres-backed gate: ONE cap shared by every instance
  // behind the load balancer, surviving restarts/redeploys (without it the
  // effective cap was N× the intended one and reset on every deploy). Unset ⇒ the
  // in-memory per-instance gate, byte-identical to before for local/single-instance.
  const dailyGate: DailyGate = process.env.DATABASE_URL
    ? createDurableDailyGate({
        limit: freeTierDailyLimit(),
        store: createPgDailyUsageStore({ connectionString: process.env.DATABASE_URL }),
      })
    : createInMemoryDailyGate(freeTierDailyLimit());
  // v12 Phase 2 — OAuth. Absent authConfig ⇒ auth routes are off and identity stays 'local'.
  const authConfig = opts.authConfig;
  const authFetch = opts.authFetch ?? defaultAuthFetch;

  /**
   * The LOCAL per-identity {@link UsageStore}: one file per identity under the
   * user-level config dir. `read` normalizes to the current month (matching the
   * pre-v10 loadUsage), `write` persists. meter.ts is not touched — it still takes
   * usage as a pure parameter; only the STORAGE key (which file) is now per-identity.
   * A deployed build replaces this object with a DB-backed one behind the same shape.
   */
  // v12 Phase 3 — env-gated store selection. DATABASE_URL set ⇒ the Postgres
  // per-user store (deployed free tier); unset ⇒ the existing file literal below,
  // byte-identical to pre-v12 so 'local'→usage.json and every usage/CLI gate stay
  // green. The else branch is unchanged from the pre-v12 file store.
  const usageStore: UsageStore = process.env.DATABASE_URL
    ? createPgUsageStore({ connectionString: process.env.DATABASE_URL })
    : {
        read: (identity) =>
          normalizeUsage(
            readUserJson<Partial<MeterUsage>>(userConfigDir, usageFileForIdentity(identity)),
            currentMonthYear()
          ),
        write: (identity, usage) => writeUserJson(userConfigDir, usageFileForIdentity(identity), usage),
      };

  // Mutable attach state. `repoRoot` is the canonical jail root (null = no repo);
  // every file/reserved helper closes over it, so a runtime attach re-points the
  // WHOLE jail by reassigning it. `currentGraph` is what GET /archgraph.json
  // serves and POST /api/scan replaces.
  let repoRoot: string | null = null;
  let currentGraph: ArchGraph | null = null;
  /** MADR detail slots for GET /archgraph.json — keyed by real ArchGraph node ids. */
  let currentNodeDetail: Record<string, SeqDiagramNodeDetail> | null = null;

  /* ===================== WAVE 1 ITEM 1.5 — STALENESS ==========================
   * Gap G5: `PUT /api/file` writes to disk and invalidates the persisted cache
   * WITHOUT rescanning, so from that moment the graph this server is serving is
   * knowingly behind the repo — and said nothing about it. A canvas that is
   * silently wrong is worse than one that admits it, and the admission has to be
   * on the GRAPH READ as well as on the write's own response: the tab that reads
   * `/archgraph.json` is frequently not the tab that did the write.
   *
   * `stalePaths` names WHAT moved, not merely THAT something did — a bare boolean
   * cannot tell a client whether the node it is looking at is one of the affected
   * ones. It is capped because the marker is a hint, not a changelog; past the cap
   * `staleTruncated` says so rather than quietly showing a short list as complete.
   */
  const MAX_STALE_PATHS = 50;
  let staleSince: string | null = null;
  const stalePaths: string[] = [];
  let staleTruncated = false;
  /** P5 — recursive fs.watch on the attached root; null when detached. */
  let repoWatcher: RepoWatchHandle | null = null;

  /** Record that `relPath` changed under the graph currently being served. */
  function markGraphStale(relPath: string): void {
    if (staleSince === null) staleSince = new Date().toISOString();
    const posix = relPath.replace(/\\/g, '/');
    if (stalePaths.includes(posix)) return;
    if (stalePaths.length >= MAX_STALE_PATHS) {
      staleTruncated = true;
      return;
    }
    stalePaths.push(posix);
  }

  function stopRepoWatch(): void {
    repoWatcher?.stop();
    repoWatcher = null;
  }

  function armRepoWatch(root: string): void {
    stopRepoWatch();
    repoWatcher = startRepoWatch(root, {
      onChange: (paths) => {
        for (const p of paths) markGraphStale(p);
      },
    });
  }

  /** The staleness fields to merge into a graph response; empty when fresh. */
  function staleMarker(): Record<string, unknown> {
    if (staleSince === null) return {};
    return {
      stale: true,
      staleSince,
      stalePaths: [...stalePaths],
      ...(staleTruncated ? { staleTruncated: true } : {}),
    };
  }

  /**
   * The `/archgraph.json` validator (item 1.8, gap G8).
   *
   * Derived from `scannedAt` — the natural version the plan names — but NOT from
   * it alone. `variant` folds in the scope/depth of this view, and the staleness
   * marker is folded in here, because both change the response bytes. A tag that
   * covered only `scannedAt` would 304 a scoped request against a cached full
   * graph, and would keep serving a "fresh" cached copy after a write made the
   * live answer say `stale:true`. Strong (unquoted-W) because the body for a
   * given tag is byte-stable.
   */
  function graphEtag(graph: ArchGraph, variant: string): string {
    // JSON.stringify rather than a delimiter join: a node id or a scope key can
    // contain any punctuation a separator might use, and two DIFFERENT views whose
    // fields ran together into the same string would share a validator — which is
    // exactly the bug a 304 turns into a wrong graph on screen.
    const material = JSON.stringify([
      graph.scannedAt,
      graph.nodes.length,
      graph.edges.length,
      variant,
      staleSince,
      stalePaths.length,
    ]);
    return `"${crypto.createHash('sha256').update(material).digest('hex').slice(0, 32)}"`;
  }

  function setCurrentGraph(graph: ArchGraph | null): void {
    currentGraph = graph;
    currentNodeDetail = graph ? seqdNodeDetailFromStructuralTree(graph) : null;
    // A graph that was just produced from the disk is by definition not behind it.
    // Clearing here rather than at each call site means no future scan path can
    // forget to, which is how a stale flag becomes a permanently-on warning nobody
    // reads.
    staleSince = null;
    stalePaths.length = 0;
    staleTruncated = false;
  }
  /**
   * v13 cross-tenant owner-check. When auth is enabled, the session identity that
   * attached/cloned the active repo is recorded here; repo-scoped endpoints 403
   * any OTHER session, so an authenticated user can never read a repo (incl. its
   * private source) that a different user attached. `null` = no owner recorded:
   * local mode (no auth) has no owner and no check — the single shared repo is
   * reachable exactly as before, and a CLI `--repo` start is likewise unowned.
   *
   * NOTE: hosted mode is SINGLE-ACTIVE-REPO — one attached repo for the whole
   * server, and a new attach/clone by any authenticated user re-sets ownership
   * (taking over). That is a UX limitation, not a security hole once this
   * owner-check is in place, and is lifted by PER-USER WORKSPACES — a documented
   * v13 follow-up. Until then the owner-check is what isolates tenants.
   */
  let repoOwner: string | null = null;

  /**
   * v13 Finding A — the PER-USER browse/attach/clone jail (closes the last
   * multi-tenant confidentiality blocker). Resolves the browse root a given
   * request may see:
   *   - LOCAL / auth-off (or no session) ⇒ the shared {@link browseRoot}
   *     (`os.homedir()`), byte-identical to pre-v13 — single trusted user.
   *   - HOSTED / auth-on with a real session ⇒ a DEDICATED subtree under the
   *     browse root (`<browseRoot>/sequence-users/<hash>`), created on demand.
   * Every signed-in tenant is physically confined to their own subtree, so user
   * B can never browse, attach, or clone into (and thus read) user A's files:
   * a path outside the caller's own root fails the realpath jail (403/empty),
   * never resolves into another user's tree. The returned root is canonical
   * (realpath-resolved) so it plugs straight into {@link resolveInBrowseRoot}.
   */
  function browseRootFor(sessionId: string | undefined): string {
    const authOn = authConfig ? authEnabled(authConfig) : false;
    if (!authOn || !sessionId) return browseRoot;
    const dir = userBrowseSubdir(browseRoot, sessionId);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      /* best-effort: a failed mkdir just yields an empty (still-contained) jail */
    }
    return canonicalBrowseRoot(dir);
  }

  /**
   * v13 Finding (round-4) — the PER-USER recents store. `recent.json` is a
   * user-level list of attached-repo PATHS + names; under auth it must be scoped
   * per tenant, else user B's GET /api/recent leaks A's private repo names +
   * absolute server paths (the same leak class as the /api/status fix).
   *   - LOCAL / auth-off (or no session) ⇒ the shared {@link recentStoreDir},
   *     byte-identical to pre-v13 (single trusted user, one shared `recent.json`).
   *   - HOSTED / auth-on with a session ⇒ a DEDICATED per-identity sub-dir, so
   *     one user's attaches never land in — or are read from — another's list.
   * Signature-compatible with {@link addRecent}/{@link readRecent} (both take a
   * store DIR). Paired with a {@link browseRootFor} filter on the read path so a
   * stale/foreign entry could never even be listed.
   */
  function recentStoreFor(sessionId: string | undefined): string {
    const authOn = authConfig ? authEnabled(authConfig) : false;
    if (!authOn || !sessionId) return recentStoreDir;
    return userRecentStoreDir(recentStoreDir, sessionId);
  }

  /**
   * Attach (or switch to) a repo: canonicalise, scan, and re-point the jail.
   * `owner` records the attaching session identity for the cross-tenant check
   * (null in local/CLI mode ⇒ unowned/shared). Every attach RE-SETS ownership.
   */
  async function attachRepo(dir: string, record: boolean, owner: string | null = null): Promise<ArchGraph> {
    const root = canonicalRoot(dir); // realpath; throws if missing
    // PERSISTENCE MOAT: if a persisted graph exists AND the content signature
    // still matches, load it VERBATIM (preserving its stored `scannedAt`) and
    // SKIP the full re-crawl. A cache-loaded graph is identical to a fresh scan
    // of the same content — the signature guarantees any relevant change forces
    // a re-scan below. Otherwise scan once and persist for the next open.
    const signature = await computeSignature(root, opts.scan);
    const cached = readCachedGraph(root);
    let graph: ArchGraph;
    if (cached && cached.signature === signature) {
      graph = cached.graph;
    } else {
      graph = await scanRepo(root, opts.scan);
      writeCachedGraph(root, signature, graph);
    }
    repoRoot = root;
    setCurrentGraph(graph);
    repoOwner = owner;
    /* P5 — external edits must mark stale the same as PUT /api/file. */
    armRepoWatch(root);
    // Only runtime attaches touch the user-level recent store — starting with
    // `--repo X` must not silently write to the caller's home during e.g. tests.
    // v13 round-4: scope the write PER USER under auth (owner === the attaching
    // session id), so one tenant's attaches never land in another's recents.
    if (record) addRecent(recentStoreFor(owner ?? undefined), root);
    return graph;
  }

  if (repoRootInput != null) {
    await attachRepo(repoRootInput, false);
  }

  /**
   * The active jail root, asserted non-null. Every repo-scoped handler runs the
   * {@link requireRepo} 409 guard first, so this never throws in practice; it is
   * the type-narrowing bridge from the mutable `string | null` state to the
   * `string` the jail/reserved helpers need.
   */
  function activeRoot(): string {
    if (repoRoot === null) throw new Error('no repo attached');
    return repoRoot;
  }

  /**
   * Force-refresh path (POST /api/scan, and the auto-rescan after a scaffold
   * apply): ALWAYS re-crawl — never consult the read-cache — AND rewrite
   * `graph.json` with the fresh content signature, so a user-triggered scan both
   * reflects the latest content and updates the persisted cache for the next
   * open. Returns the freshly scanned graph (caller assigns `currentGraph`).
   */
  async function forceScan(root: string): Promise<ArchGraph> {
    const signature = await computeSignature(root, opts.scan);
    // A user-triggered rescan uses the model the user CONNECTED, so pressing
    // Scan after adding a key actually improves the names. Before r90 the
    // labeller read `ANTHROPIC_API_KEY` from the environment instead, so
    // connecting an OpenRouter key improved the assistant and changed nothing
    // on the board — with no way to tell why.
    const graph = await scanRepo(root, withLabelModel(opts.scan));
    writeCachedGraph(root, signature, graph);
    return graph;
  }

  /** 409 when no repo is attached; returns true when the caller should bail. */
  function requireRepo(res: http.ServerResponse): boolean {
    if (repoRoot === null || currentGraph === null) {
      sendError(res, 409, 'no repo attached — open a repository from the home screen first');
      return true;
    }
    return false;
  }

  /**
   * Where session chat + board snapshots live. Attached ⇒ per-repo
   * `.sequence/sessions/`; blank workspace ⇒ `~/.sequence/sessions/`.
   */
  function sessionsRoot(): string {
    if (repoRoot !== null) return repoRoot;
    return path.dirname(userConfigDir);
  }

  function sessionsScope(): 'workspace' | 'repo' {
    return repoRoot !== null ? 'repo' : 'workspace';
  }

  /**
   * Two absolute paths naming the same repo. EQUALITY on resolved paths — never
   * `startsWith`, which is a prefix test and not a containment test: `/work/app`
   * is a prefix of the SIBLING `/work/app-secrets`. `insightTools.ts` fixed
   * exactly that bug at its own jail (see the BOUNDARY comment there), and a
   * membership check written the loose way would hand a caller the sibling repo.
   *
   * Windows only: the path makes a round trip through the browser before it
   * comes back, so a drive-letter case flip must not read as a different repo.
   */
  function sameRepoPath(a: string, b: string): boolean {
    const ra = path.resolve(a);
    const rb = path.resolve(b);
    if (ra === rb) return true;
    return process.platform === 'win32' && ra.toLowerCase() === rb.toLowerCase();
  }

  /**
   * Which root a session WRITE (`PUT`/`DELETE /api/sessions/:id`) may touch.
   *
   * OWNER, 2026-09-02: "Should also let you edit any type of chat session
   * without actually being in that chat session, just whenever you want." The
   * workspace catalog lists other repos' threads ({@link listRepoSessionSections}),
   * and until now they could only be opened — rename/pin/delete needed the repo
   * to be the attached one.
   *
   * A free-text path on a write route is a write-anywhere primitive, so the
   * repo is accepted ONLY when it is one of the repos THIS CALLER'S catalog was
   * built from — the same list, for the same caller, that the GET serves. An
   * unknown path is a 400 that SAYS SO; it must never fall back to
   * {@link sessionsRoot}, because a silent fallback renames a DIFFERENT repo's
   * thread and looks to the user like it worked.
   *
   * Two ways the first version of this fence was wider than its own docstring,
   * both fixed here:
   *
   *   - It read the PROCESS-WIDE {@link recentStoreDir}/{@link browseRoot}
   *     instead of {@link recentStoreFor}/{@link browseRootFor} for the calling
   *     identity. Under auth on a machine that had previously run locally, the
   *     shared `recent.json` still holds the operator's repos, so a tenant with
   *     no repo attached (⇒ `repoOwner === null` ⇒ `requireOwner()` is a no-op)
   *     could `DELETE /api/sessions/<id>?repoPath=<operator repo>` and destroy
   *     transcripts in a repo `browseRootFor` would never have let them browse,
   *     attach or clone. The catalog is per-tenant on the read path; the write
   *     fence must be the SAME per-tenant list or it is not a fence.
   *   - It ignored SCOPE. With a repo attached the GET answers `{scope:'repo'}`
   *     and omits `repos` entirely — no catalog is offered — yet a `repoPath`
   *     naming any recently-browsed repo was still honoured 200. A write route
   *     must never accept a set the read route refuses to disclose, so in repo
   *     scope the only accepted path is the attached repo itself (identical to
   *     omitting the field).
   *
   * Absent ⇒ the active root, byte-identical to the pre-catalog behaviour.
   */
  function sessionWriteRoot(
    repoPath: unknown,
    caller: string | undefined,
  ): { root: string } | { error: string } {
    if (repoPath === undefined || repoPath === null) return { root: sessionsRoot() };
    if (typeof repoPath !== 'string' || repoPath.trim() === '') {
      return { error: 'repoPath must be a non-empty string when present' };
    }
    const wanted = repoPath.trim();
    if (sessionsScope() === 'repo') {
      if (sameRepoPath(sessionsRoot(), wanted)) return { root: sessionsRoot() };
      return {
        error:
          'repoPath must name the attached repo — no session catalog is served while a repo is open',
      };
    }
    const known = listRepoSessionSections(
      readRecent(recentStoreFor(caller), browseRootFor(caller)),
    );
    const hit = known.find((section) => sameRepoPath(section.path, wanted));
    if (!hit) {
      return {
        error: 'repoPath is not one of the repos in this workspace session catalog',
      };
    }
    return { root: hit.path };
  }

  /**
   * Phase 3 progressive disclosure — build the skill prompt lines for one ask.
   * Summaries are ALWAYS loaded (one bullet per skill under `.sequence/skills/`);
   * the full body of the single skill that matches `question` is loaded too.
   * Both are empty when there are no skills, so the prompt is byte-identical to
   * the pre-skill seam. Best-effort: a read failure yields empty lines, never a
   * thrown error that would break the ask.
   */
  function buildSkillLines(question: string): { summaryLines: string[]; bodyLines: string[] } {
    if (repoRoot === null) return { summaryLines: [], bodyLines: [] };
    try {
      const { summaries } = loadSkillSummaries(repoRoot);
      const summaryLines = renderSkillSummaryLines(summaries);
      const matched = matchSkillBody(repoRoot, question);
      const bodyLines = matched ? renderSkillBodyLines(matched.name, matched.body) : [];
      return { summaryLines, bodyLines };
    } catch {
      return { summaryLines: [], bodyLines: [] };
    }
  }

  // r31 — the LOCAL ACP session cache (server half of session continuity). One
  // live `{ client, sessionId }` per opaque `sessionKey`, turns serialized per key,
  // idle-TTL + hard-cap + shutdown disposal. Per-server-instance closure state, like
  // usageStore/dailyGate above; nothing here parses or logs a key's contents.
  const acpSessions: AcpSessionCache = createAcpSessionCache({
    ...(opts.acpSession?.ttlMs !== undefined ? { ttlMs: opts.acpSession.ttlMs } : {}),
    ...(opts.acpSession?.maxSessions !== undefined ? { maxSessions: opts.acpSession.maxSessions } : {}),
  });

  /**
   * Item 1.10 — the observation sink for the CURRENT turn on each cached ACP
   * session, keyed by the same opaque `sessionKey` the cache uses.
   *
   * It exists because a cached `AcpClient` outlives the request that spawned it:
   * hooks bound at construction would stream a later turn's updates into a
   * response that closed minutes ago, and would apply the FIRST caller's
   * permission mode to every caller after them. One entry at a time is correct
   * because `acpSessions.run` serializes turns per key. An absent entry falls
   * back to the conservative default, never to a remembered opt-in.
   */
  const acpTurnSinks = new Map<string, AcpTurnSink>();

  /* ================== P8 — SERVER-SIDE PROGRAM RUNS ==========================
   * `runProgram` used to execute in the BROWSER, so closing the tab killed a
   * run — the reason `docs/CANON.md` marks "we're better at agent workflows" as
   * ✗ NOT TRUE. The supervisor lives in `programRunner.ts` and its durable log
   * in `programRunStore.ts`; this is the wiring, and it is deliberately thin.
   *
   * The two injected executors are the ONLY non-deterministic work in a program
   * (the scheduler is pure control flow), so this factory is where a run touches
   * money and subprocesses — and therefore where cancellation has to bite:
   *
   *   agent · gateway  the SAME metered wrapper every ask uses, handed the RUN's
   *                    signal. Wave 1 item 1.3 made `recordUse` lose the race
   *                    against an abort; nothing new is invented here, the
   *                    existing signal is simply threaded one level further.
   *   agent · acp      a real local coding-agent turn, contained to the repo
   *                    root, torn down (SIGTERM→SIGKILL) in `dispose`.
   *   command          allowlisted verifyGate constants only (same spawn as ask
   *                    `run_command`). Unsafe / non-allowlisted cmds are refused
   *                    by name — there is still no ambient shell on this server.
   */
  /**
   * Build one run's executors.
   *
   * `ctx.identity` is the identity captured when the run STARTED, so a run's
   * provider calls are charged to whoever launched it for its whole life — a
   * later request from someone else cannot re-point the meter at them.
   */
  const DEFAULT_PROGRAM_AGENT_REF = 'default';

  /**
   * Resolve the ACP executor's implicit `default` ref against the same local
   * agent registry the CLI uses.
   *
   * An exact id always wins, including a configured agent literally named
   * `default`. Otherwise the implicit ref falls back only when the choice is
   * unambiguous: exactly one local agent is configured. Picking the first of
   * several would make registry order a routing decision the reader never
   * made, so that case is an honest refusal instead.
   *
   * This is shared by the request-door preflight and real executor
   * construction. Two resolvers would recreate the defect as soon as their
   * fallback rules drifted.
   */
  function resolveProgramAgent(agentRef: string): AgentEntry {
    const exact = getAgent(userConfigDir, agentRef);
    if (exact) return exact;

    if (agentRef !== DEFAULT_PROGRAM_AGENT_REF) {
      throw new Error(
        `unknown agentRef '${agentRef}' — register it with: sequence agent add ${agentRef} --command <bin>`,
      );
    }

    const agents = listAgents(userConfigDir);
    if (agents.length === 1) return agents[0];
    if (agents.length === 0) {
      throw new Error(
        'no local agent is configured — configure one with: sequence agent add <id> --command <bin>',
      );
    }

    throw new Error(
      `this program does not name a local agent, and ${agents.length} are configured (${agents
        .map((agent) => agent.id)
        .join(', ')}) — set agent.acp.agentRef to one of those ids`,
    );
  }

  function buildProgramExecutors(ctx: RunExecutionContext): BuiltExecutors {
    const createdClients: AcpAgentClient[] = [];

    const acpExecutor = createAcpExecutor({
      getClient: (agentRef: string): AcpAgentClient => {
        const entry = resolveProgramAgent(agentRef);
        // v16 Finding 4, applied here too: a write-capable agent runs at the
        // repo root, never at the agent entry's own configured cwd, because the
        // run is about THIS repo. Same containment the /api/acp/run-node route
        // enforces; a program node must not be the looser door.
        const client = new AcpClient({
          command: entry.command,
          ...(entry.args ? { args: entry.args } : {}),
          cwd: ctx.repoRoot,
        });
        createdClients.push(client);
        return client;
      },
    });

    const gatewayExecutor: NodeExecutor = async (node, _state, execCtx) => {
      const prompt = node.agent?.prompt;
      if (typeof prompt !== 'string' || prompt.trim() === '') {
        return { ok: false, error: `agent node '${node.id}' has no prompt to run.` };
      }
      const cfg = loadAiConfig();
      if (!cfg) {
        return {
          ok: false,
          error:
            `agent node '${node.id}' needs an AI provider — connect your AI key in Settings, ` +
            `or set runtime:'acp' to drive a local agent instead.`,
        };
      }
      try {
        const { text } = await callProviderMeteredWithUsage(
          cfg,
          prompt,
          ctx.identity,
          // The RUN's signal, not a request's. Cancelling the run makes this call
          // lose the race inside the wrapper, so `recordUse` is never reached —
          // the "a cancelled run does not keep metering" guarantee, unchanged
          // from item 1.3 and not re-implemented.
          execCtx.signal ?? ctx.signal,
        );
        return { ok: true, value: text };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    };

    return {
      executors: {
        agent: (node, state, execCtx) =>
          node.agent?.runtime === 'acp'
            ? acpExecutor(node, state, execCtx)
            : gatewayExecutor(node, state, execCtx),
        command: async (node) => {
          const cmd = node.command?.command?.trim() ?? '';
          if (!cmd) {
            return {
              ok: false,
              error: `command node '${node.id}' has no command string`,
            };
          }
          const ran = runAllowlistedRepoCommand(cmd, ctx.repoRoot);
          if (ran.refuseReason) {
            return {
              ok: false,
              error:
                `command node '${node.id}' refused: ${ran.refuseReason} ` +
                `(allowlisted verifyGate constants only; no ambient shell)`,
            };
          }
          const exitLabel = ran.exitCode === null ? 'exit unrecorded' : `exit ${ran.exitCode}`;
          const detail = ran.output.trim().length > 0 ? `${exitLabel}\n${ran.output}` : exitLabel;
          if (!ran.ok) {
            return { ok: false, error: detail };
          }
          return {
            ok: true,
            value: { exitCode: ran.exitCode, output: ran.output },
            detail,
          };
        },
      },
      // Whatever happened — completion, failure, or a cancel — every agent
      // subprocess this run spawned is killed. A cancelled run that left an agent
      // alive would still be spending.
      dispose: async () => {
        await Promise.all(createdClients.map((c) => c.dispose().catch(() => {})));
      },
    };
  }

  const programRunner: ProgramRunner = createProgramRunner({
    makeExecutors: buildProgramExecutors,
    // Read at start, so a `checker` node verifies against the graph the run began
    // with rather than against whatever a mid-run rescan produced.
    groundedGraph: () => currentGraph,
    /*
     * MEASURED WITH GIT, not with our own write tracking. An ACP agent edits
     * the tree with its own tooling, so a counter built on `PUT /api/file`
     * would report three files for a run that changed forty - silently, with
     * no error to suggest the number was partial. Git sees every write.
     */
    snapshotTree: (root) => gitNumstatSnapshot(root),
  });

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      // Last-resort guard: a handler that threw before responding.
      if (!res.headersSent) {
        sendError(res, 500, `server error: ${(e as Error).message}`);
      } else {
        res.end();
      }
    });
  });
  // Server shutdown disposes every cached ACP session (SIGTERM→SIGKILL per client),
  // so `server.close()` leaves no orphaned agent subprocess behind.
  server.on('close', () => {
    void acpSessions.disposeAll();
    // A live program run is aborted on shutdown for the same reason: no orphaned
    // agent subprocess, and no metered call still in flight for a server that is
    // gone. A run whose record never reaches a terminal status because the
    // process exited first is reported `interrupted` on the next read — never
    // `running`, which nothing would be advancing.
    void programRunner.disposeAll();
  });

  /**
   * v10 Phase 4 — extract the caller's identity for metering. THIS IS THE
   * AUTH-MIDDLEWARE SLOT. Today (local single-user) it returns `'local'`: there is
   * no auth layer, so every localhost request is the one trusted user, and metering
   * keeps its pre-v10 single-file (`usage.json`) behaviour.
   *
   * In a DEPLOYED build the injected {@link RepoServerOptions.resolveIdentity}
   * validates the authenticated session — a signed OAuth cookie / JWT the account
   * middleware sets AFTER Google/GitHub login (the future `Authorization`/cookie
   * read) — and returns the stable per-user id. That id then flows unchanged into
   * the {@link UsageStore}, so free-plan users are rate-limited per person without
   * touching meter.ts. A resolver must never trust an unauthenticated header on a
   * public bind (see DEPLOY_BLUEPRINT.md).
   */
  function extractIdentity(req: http.IncomingMessage): string {
    if (opts.resolveIdentity) {
      const id = opts.resolveIdentity(req);
      if (typeof id === 'string' && id.trim() !== '') return id.trim();
    }
    return 'local';
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const { pathname } = url;
    const method = req.method ?? 'GET';

    // ================= DNS-rebinding / cross-origin request gate =================
    // This must run before routing, auth, body reads, file access or provider calls.
    // A page loaded from seq.attacker.example keeps that Host + Origin after its DNS
    // is rebound to 127.0.0.1; without the non-loopback Host refusal the browser sees
    // the local server as same-origin and can read the response. Origin validation
    // separately refuses an ordinary hostile page aimed directly at localhost.
    //
    // Native callers for the documented local JSON API omit Origin, but still send
    // a loopback Host, so they remain supported. Hosted auth has one explicit public
    // origin; passing it here preserves that same-origin API while refusing every
    // other public Host/Origin pair. /archgraph.json is included because it carries
    // private repository topology even though it predates the /api namespace.
    const authOn = authConfig ? authEnabled(authConfig) : false;
    const engineRequest =
      pathname === '/archgraph.json' || pathname === '/api' || pathname.startsWith('/api/');
    if (
      engineRequest &&
      !isOriginAllowed(req, authOn ? authConfig!.publicBaseUrl : undefined)
    ) {
      sendError(res, 403, API_ORIGIN_ERROR);
      return;
    }

    // The metering identity for THIS request (the auth-middleware slot). Every
    // metered path (ask/explain/design-suggest) and GET /api/usage key off it, so a
    // deployed multi-tenant build isolates usage per user with zero further wiring.
    const identity = extractIdentity(req);

    // ================= v13 request-level authorization gate ======================
    // ENV-GATED: with auth OFF (local single-user) `authOn` is false and this whole
    // block is a no-op — every endpoint behaves byte-identically and identity stays
    // 'local'. With auth ON, a SENSITIVE endpoint requires a valid signed session
    // (401 otherwise), and repo-scoped endpoints additionally enforce the
    // cross-tenant owner-check via `requireOwner()` (403 for a different user). The
    // session is verified DIRECTLY against the auth secret here (independent of the
    // injected `resolveIdentity` metering slot), matching the deploy contract.
    const sessionId = authOn ? verifySession(req.headers.cookie, authConfig!.sessionSecret)?.userId : undefined;
    if (authOn && isSensitivePath(pathname) && !sessionId) {
      sendError(res, 401, 'authentication required');
      return;
    }

    /**
     * The cross-tenant owner-check for repo-scoped endpoints. Returns true (the
     * caller should bail with a 403 already sent) when auth is on, a repo owner is
     * recorded, and the caller is NOT that owner. A no-op in local mode (no auth) or
     * when the active repo is unowned (CLI `--repo` start) — shared exactly as before.
     */
    function requireOwner(): boolean {
      if (!authOn || repoOwner === null) return false;
      if (sessionId !== repoOwner) {
        sendError(res, 403, 'forbidden: this repo belongs to another user');
        return true;
      }
      return false;
    }

    // ================= Auth (v12 Phase 2): OAuth login/callback + session ========
    // Env-gated: with no authConfig these report "not configured" (or an empty
    // providers list) and identity stays 'local'. The client secrets never leave
    // the server; only availability + display fields are ever returned.

    // ---- GET /api/me — session state + which providers the UI may offer ----
    if (pathname === '/api/me' && method === 'GET') {
      const providers = authConfig ? availableProviders(authConfig) : [];
      const session =
        authConfig && authConfig.sessionSecret !== ''
          ? verifySession(req.headers.cookie, authConfig.sessionSecret)
          : null;
      if (session) {
        const body: GetMeResponse = {
          signedIn: true,
          availableProviders: providers,
          provider: session.provider,
          name: session.name,
          email: session.email,
        };
        sendJson(res, 200, body);
      } else {
        const body: GetMeResponse = { signedIn: false, availableProviders: providers };
        sendJson(res, 200, body);
      }
      return;
    }

    // ---- GET /auth/login/:provider — set signed CSRF state → 302 to provider ----
    if (pathname.startsWith('/auth/login/') && method === 'GET') {
      const provider = pathname.slice('/auth/login/'.length);
      if (!authConfig || !authEnabled(authConfig) || !providerConfigured(authConfig, provider)) {
        sendError(res, 404, `auth provider not configured: ${provider}`);
        return;
      }
      const state = randomState();
      // PKCE: the verifier stays server-side inside the signed HttpOnly state cookie;
      // only the S256 challenge goes out on the authorize redirect.
      const { verifier, challenge } = generatePkce();
      // Sign state + PKCE verifier into a short-lived cookie (typ:'state'); the callback requires it to match.
      const stateToken = signState({ state, provider, v: verifier }, authConfig.sessionSecret, OAUTH_STATE_TTL_SECONDS);
      const authorizeUrl = buildAuthorizeUrl(authConfig, provider, state, challenge);
      res.setHeader('set-cookie', buildSetCookie(STATE_COOKIE, stateToken, { maxAge: OAUTH_STATE_TTL_SECONDS }));
      res.statusCode = 302;
      res.setHeader('location', authorizeUrl);
      res.end();
      return;
    }

    // ---- GET /auth/callback/:provider — verify state, exchange code, mint session --
    if (pathname.startsWith('/auth/callback/') && method === 'GET') {
      const provider = pathname.slice('/auth/callback/'.length);
      if (!authConfig || !authEnabled(authConfig) || !providerConfigured(authConfig, provider)) {
        sendError(res, 404, `auth provider not configured: ${provider}`);
        return;
      }
      // CSRF: the `state` query param MUST match the signed state cookie (same provider).
      const stateParam = (url.searchParams.get('state') ?? '').trim();
      const stateCookie = readCookie(req.headers.cookie, STATE_COOKIE);
      // verifyState requires typ:'state' — a replayed session cookie can never pass.
      const verifiedState = stateCookie ? verifyState(stateCookie, authConfig.sessionSecret) : null;
      if (
        stateParam === '' ||
        !verifiedState ||
        verifiedState.state !== stateParam ||
        verifiedState.provider !== provider
      ) {
        res.setHeader('set-cookie', clearCookie(STATE_COOKIE));
        sendError(res, 400, 'invalid or missing OAuth state (possible CSRF) — start sign-in again');
        return;
      }
      const code = (url.searchParams.get('code') ?? '').trim();
      if (code === '') {
        res.setHeader('set-cookie', clearCookie(STATE_COOKIE));
        sendError(res, 400, 'missing authorization code');
        return;
      }
      // Replay the PKCE verifier bound to this login attempt (older cookies omit it).
      const codeVerifier = typeof verifiedState.v === 'string' ? verifiedState.v : undefined;
      let ident;
      try {
        ident = await exchangeCode(authConfig, provider, code, authFetch, codeVerifier);
      } catch (e) {
        // AuthError carries only the provider's own response — never our secret.
        res.setHeader('set-cookie', clearCookie(STATE_COOKIE));
        sendError(res, 502, `sign-in failed: ${(e as Error).message}`);
        return;
      }
      const sessionToken = signSession(
        { userId: ident.userId, provider: ident.provider, name: ident.name, email: ident.email },
        authConfig.sessionSecret
      );
      res.setHeader('set-cookie', [
        buildSetCookie(SESSION_COOKIE, sessionToken, { maxAge: DEFAULT_SESSION_TTL }),
        clearCookie(STATE_COOKIE),
      ]);
      res.statusCode = 302;
      res.setHeader('location', '/');
      res.end();
      return;
    }

    // ---- POST /auth/logout — clear the session cookie ----
    if (pathname === '/auth/logout' && method === 'POST') {
      res.setHeader('set-cookie', clearCookie(SESSION_COOKIE));
      sendJson(res, 200, { signedIn: false });
      return;
    }

    // ---- GET /api/status (attach state for the home screen) ----
    // Presence of this endpoint is what the web app feature-detects on: a legacy
    // static viewer (serveGraph) has no /api/status, so it keeps today's behaviour.
    // v13 Finding B: session-gated under auth (SENSITIVE), and the repo NAME +
    // absolute server PATH are included ONLY for the repo owner. A non-owner
    // authenticated caller gets a minimal `{ attached }` with no name/path leak.
    // In local mode (auth off) `authOn` is false ⇒ the owner branch is always
    // taken ⇒ the full body is returned, byte-identical to pre-v13.
    if (pathname === '/api/build' && method === 'GET') {
      /* WHAT IS THIS SERVER RUNNING? A day-old process served the product
         while five fixes sat unrun in dist. See server/buildStamp.ts. */
      /*
       * BOTH HALVES. The server's own build was never the whole answer: on
       * 2026-09-06 this reported `stale: false` while the browser was served a
       * bundle from the previous night, and half of one commit was missing from
       * the product with every test green. The client bundle is named here
       * because this is the process that serves it.
       */
      sendJson(
        res,
        200,
        buildStamp(undefined, {
          /* dist/cli.js -> its own directory -> ../src. Derived from the entry
             the process was actually given, not from a constant that would go
             stale the moment the layout moved. */
          serverDist: process.argv[1] ?? undefined,
          serverSrc:
            process.argv[1] === undefined
              ? undefined
              : path.resolve(path.dirname(process.argv[1]), '..', 'src'),
          ...(webDist === undefined || webDist === null
            ? {}
            : { clientBundle: path.join(webDist, 'index.html'), clientSrc: path.resolve(webDist, '..', 'src') }),
        }) as unknown as Record<string, unknown>,
      );
      return;
    }
    if (pathname === '/api/status' && method === 'GET') {
      if (repoRoot !== null && currentGraph !== null) {
        const isOwner = !authOn || repoOwner === null || sessionId === repoOwner;
        const body: GetStatusResponse = isOwner
          ? {
              attached: true,
              repoName: currentGraph.repoName,
              root: repoRoot,
              /* P5 — client polls this to enter repo/stale without fetching the
                 whole graph. Same marker /archgraph.json already carries. */
              ...staleMarker(),
            }
          : { attached: true };
        sendJson(res, 200, body);
      } else {
        const body: GetStatusResponse = { attached: false };
        sendJson(res, 200, body);
      }
      return;
    }

    // ---- GET /api/browse?path=<dir> (folder picker; browse-root jailed) ----
    // Lists immediate SUB-DIRECTORIES only; never file contents. No repo needed.
    if (pathname === '/api/browse' && method === 'GET') {
      const target = url.searchParams.get('path') ?? '';
      // v13 Finding A: list only within the CALLER'S own browse jail. In auth
      // mode this is the per-user subtree, so a path escaping it (or another
      // user's tree) is 403/empty — never another tenant's directory listing.
      const outcome = browseDir(browseRootFor(sessionId), target);
      if (!outcome.ok) {
        sendError(res, outcome.status, outcome.error);
        return;
      }
      const listing: GetBrowseResponse = outcome.result;
      sendJson(res, 200, listing);
      return;
    }

    // ---- POST /api/attach { path } (re-point the served repo at runtime) ----
    if (pathname === '/api/attach' && method === 'POST') {
      if (!isJsonRequest(req)) {
        sendError(res, 415, 'expected content-type application/json');
        return;
      }
      let body: Unvalidated<PostAttachRequest>;
      try {
        body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
      } catch (e) {
        sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
        return;
      }
      const target = body.path;
      if (typeof target !== 'string' || target.length === 0) {
        sendError(res, 400, 'body must include a string "path"');
        return;
      }
      // SAME browse-root jail as GET /api/browse: only an existing directory
      // inside the boundary can be attached (blocks absolute/`..`/symlink escape).
      // v13 Finding A: the boundary is the CALLER'S own per-user root under auth,
      // so user B attaching user A's path (e.g. a peeked clone dir) is refused
      // (403) — it realpath-escapes B's jail and never resolves into A's tree.
      const callerRoot = browseRootFor(sessionId);
      const dir = resolveInBrowseRoot(callerRoot, target);
      if (dir === null) {
        sendError(res, 403, 'path escapes the browse root');
        return;
      }
      // F1 (layer 1, load-bearing): refuse attaching the browse root ITSELF — or
      // any ANCESTOR of it. The default browse root is the user's HOME dir, so a
      // one-click "Attach this folder" at the landing screen would otherwise
      // re-root the whole file jail over HOME: /api/file could then read
      // ~/.ssh/id_rsa and ~/.aws/credentials, and a hostile model response could
      // write ~/.ssh/authorized_keys through the generate path (everything jailed
      // to root=home). A repo is a PROJECT folder INSIDE home, never home itself.
      // (`dir` is realpath-contained in browseRoot by the jail above, so an
      // ancestor is only reachable as equality; the startsWith check is a
      // belt-and-suspenders guard against any future jail relaxation.)
      if (dir === callerRoot || callerRoot.startsWith(dir + path.sep)) {
        sendError(res, 400, 'Pick a project folder inside your home directory, not the home directory itself.');
        return;
      }
      let st: fs.Stats;
      try {
        st = fs.statSync(dir);
      } catch {
        sendError(res, 404, 'directory not found');
        return;
      }
      if (!st.isDirectory()) {
        sendError(res, 400, 'path is not a directory');
        return;
      }
      let graph: ArchGraph;
      try {
        // Record the attaching session as the repo owner (null in local mode).
        // Every attach RE-SETS ownership — single-active-repo (v13 follow-up: per-user workspaces).
        graph = await attachRepo(dir, true, sessionId ?? null);
      } catch (e) {
        // A repo with no compose/K8s/Helm manifests is out of v1 scope, not a
        // failure: surface it as a calm 422 carrying a distinct `code` so the
        // home screen renders an informational note, never the red error wall.
        if (e instanceof NoManifestsError) {
          sendError(res, 422, e.message, { code: e.code, repoName: e.repoName });
          return;
        }
        sendError(res, 500, `scan failed: ${(e as Error).message}`);
        return;
      }
      /* AUTONOMY DOES NOT FOLLOW YOU TO THE NEXT REPOSITORY. `readAutoApprove`
         re-checks trust on every call, so a hostile repo could never inherit
         the grant anyway — but a grant left armed for a root the user has
         walked away from is state nothing on screen explains, and the mode is
         scoped to a sitting with ONE repo. */
      clearAutoApprove();
      // `activeRoot()` and `repoRoot` are the same string here — attachRepo has
      // just assigned it — but the accessor carries the non-null through to the
      // shared response type instead of asserting it inline.
      const attachBody: PostAttachResponse = {
        attached: true,
        repoName: graph.repoName,
        root: activeRoot(),
        graphSummary: graphSummary(graph),
      };
      sendJson(res, 200, attachBody);
      return;
    }

    // ---- POST /api/detach — leave the attached repo; board becomes unattached ----
    if (pathname === '/api/detach' && method === 'POST') {
      stopRepoWatch();
      repoRoot = null;
      setCurrentGraph(null);
      repoOwner = null;
      /* Same rule as attach: the unattended grant is scoped to a sitting with
         one repository, and detaching ends that sitting. */
      clearAutoApprove();
      const body: PostDetachResponse = { attached: false };
      sendJson(res, 200, body);
      return;
    }

    // ---- GET /api/recent (user-level recent repos, most-recent first) ----
    // Session-gated under auth (in the SENSITIVE set) so the recent-repo PATHS are
    // not exposed to anonymous callers on a public bind. v13 round-4: recents are
    // now PER-USER under auth — read from the caller's OWN store dir AND filtered
    // against the caller's OWN browse jail — so user B never sees user A's repo
    // names or absolute paths (the /api/status leak's sibling, now closed). Local
    // mode ⇒ the shared store + shared browse root, byte-identical to pre-v13.
    if (pathname === '/api/recent' && method === 'GET') {
      // Pass the caller's browse root so entries outside it (another tenant's repo,
      // or a hand-edited recent.json pointing at /etc) are dropped, not displayed (F3).
      const recent = readRecent(recentStoreFor(sessionId), browseRootFor(sessionId)).map((p) => ({
        path: p,
        name: path.basename(p),
      }));
      const body: GetRecentResponse = { recent };
      sendJson(res, 200, body);
      return;
    }

    // ---- GET /api/policies (G-E: per-org harness policies, repo-committed) ----
    // The rules `.sequence/policies/*.json` declares, plus an honest warning line
    // for every file that did NOT load. Read-only and key-free: a policy holds no
    // secret (it names services and states a reason), and there is no PUT — a
    // policy is authored in the user's editor and committed like any other source,
    // so the server never needs a write hole under `.sequence`.
    //
    // ALWAYS 200, never 404: "this repo has no policies" is a real, useful answer
    // (`{ policies: [], warnings: [] }`), and it is the answer that keeps the
    // no-policy path byte-identical to before this endpoint existed.
    if (pathname === '/api/policies' && method === 'GET') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      const loaded: GetPoliciesResponse = readPolicies(activeRoot());
      sendJson(res, 200, loaded);
      return;
    }

    // ---- GET/PUT /api/board (B1: Sequence-native Task Board doc) ----
    // Persisted under `.sequence/board.json` — platform memory, git-ignored.
    // ALWAYS 200 on GET (no board yet ⇒ empty doc). PUT validates the schema.
    if (pathname === '/api/board') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      if (method === 'GET') {
        const stored = readJson(activeRoot(), BOARD_FILE);
        const parsed = stored ? parseSequenceBoardDoc(stored) : undefined;
        sendJson(res, 200, parsed ?? emptySequenceBoardDoc());
        return;
      }
      if (method === 'PUT') {
        const body = await readBody(req, MAX_BODY_BYTES);
        let raw: unknown;
        try {
          raw = JSON.parse(body);
        } catch {
          sendError(res, 400, 'invalid JSON');
          return;
        }
        const doc = parseSequenceBoardDoc(raw);
        if (!doc) {
          sendError(res, 400, 'invalid board document');
          return;
        }
        writeJson(activeRoot(), BOARD_FILE, doc);
        sendJson(res, 200, { ok: true, path: `.sequence/${BOARD_FILE}` });
        return;
      }
    }

    // ---- GET/POST /api/sessions — loadable per-session chat + board snapshots ----
  if (pathname === '/api/sessions') {
    if (requireOwner()) return;
    if (method === 'GET') {
      const root = sessionsRoot();
      const index = ensureSessionsMigrated(root);
      const scope = sessionsScope();
      const body: {
        index: ReturnType<typeof ensureSessionsMigrated>;
        scope: typeof scope;
        repos?: ReturnType<typeof listRepoSessionSections>;
      } = { index, scope };
      if (scope === 'workspace') {
        /* PER-TENANT, like every other recents read (see {@link recentStoreFor}).
           The process-wide store leaked one user's repo paths, names and every
           session id to any signed-in caller — and, once the catalog became a
           write fence in {@link sessionWriteRoot}, made that listing a delete
           primitive against repos the caller could not even browse. */
        body.repos = listRepoSessionSections(
          readRecent(recentStoreFor(sessionId), browseRootFor(sessionId)),
        );
      }
      sendJson(res, 200, body);
      return;
    }
    if (method === 'POST') {
      // Optional `{ mode: 'work' | 'code' }` body. Missing body / invalid JSON ⇒
      // the work-less default (current createSession behaviour).
      let mode: 'work' | 'code' | undefined;
      try {
        const body = await readBody(req, MAX_BODY_BYTES);
        if (body.trim() !== '') {
          const raw = JSON.parse(body) as { mode?: unknown };
          if (raw && typeof raw === 'object' && (raw.mode === 'work' || raw.mode === 'code')) {
            mode = raw.mode;
          }
        }
      } catch {
        /* invalid JSON → fall through to default createSession */
      }
      const created = createSession(sessionsRoot(), mode ? { mode } : undefined);
      sendJson(res, 200, {
        index: created.index,
        session: { id: created.id, chat: created.chat, meta: created.meta },
      });
      return;
    }
  }

  if (pathname === '/api/sessions/active' && method === 'PUT') {
    if (requireOwner()) return;
    const body = await readBody(req, MAX_BODY_BYTES);
    let raw: unknown;
    try {
      raw = JSON.parse(body);
    } catch {
      sendError(res, 400, 'invalid JSON');
      return;
    }
    const activeId = (raw as { activeId?: unknown }).activeId;
    if (typeof activeId !== 'string' || !activeId.trim()) {
      sendError(res, 400, 'activeId required');
      return;
    }
    const index = setActiveSession(sessionsRoot(), activeId.trim());
    if (!index) {
      sendError(res, 404, 'session not found');
      return;
    }
    sendJson(res, 200, { index });
    return;
  }

  if (pathname.startsWith('/api/sessions/')) {
    /* `threadId`, not `sessionId`: this block used to bind the CHAT thread id to
       the name the handler already uses for the AUTHENTICATED IDENTITY, which
       shadowed the tenant id inside the one block that most needs it — the
       write fence in {@link sessionWriteRoot} silently ran process-wide instead
       of per-caller. Two different things do not share a name here. */
    const threadId = decodeURIComponent(pathname.slice('/api/sessions/'.length));
    if (!threadId || threadId.includes('/')) {
      sendError(res, 404, 'not found');
      return;
    }
    if (requireOwner()) return;
    if (method === 'GET') {
      const index = ensureSessionsMigrated(sessionsRoot());
      if (!index.sessions.some((s) => s.id === threadId)) {
        sendError(res, 404, 'session not found');
        return;
      }
      const chat = readSessionChat(sessionsRoot(), threadId);
      const meta = readSessionMeta(sessionsRoot(), threadId);
      const boardSeqd = readSessionBoard(sessionsRoot(), threadId);
      const canvas = readSessionCanvas(sessionsRoot(), threadId);
      /*
       * ── THE MIGRATION, ON THE PATH THAT SERVES THE SESSION ────────────────
       *
       * A saved chart was derived from the graph as it was when the lesson ran.
       * If the scanner has moved since, that picture is a claim about a
       * repository that no longer matches — and until now it was served anyway,
       * with nothing on screen saying so. `docs/journeys/teach-mode.md` has to
       * carry that caveat in prose precisely because the file could not.
       *
       * So: read the checkpoint, and when the build that wrote it is not this
       * build, RE-DERIVE from the current graph and serve that. The stored
       * derivation is discarded, not warned about — a stale picture shown with a
       * badge is still a false claim, and this product's first law is that a
       * claim traces to evidence.
       *
       * `migrated` rides on the payload so a reader (and the seat) can say what
       * happened rather than infer it.
       */
      const cp = readCheckpoint(sessionsRoot(), threadId);
      let migrated: { migrated: boolean; reason: string } | undefined;
      if (cp.checkpoint !== undefined && cp.checkpoint.charts.length > 0) {
        const m = migrateCheckpoint({
          checkpoint: cp.checkpoint,
          graph: currentGraph ?? undefined,
          builtAt: buildStamp().builtAt,
        });
        migrated = { migrated: m.migrated, reason: m.reason };
        if (m.migrated) canvas.charts = [...m.charts];
      }
      sendJson(res, 200, { chat, meta, boardSeqd, canvas, ...(migrated ? { migrated } : {}) });
      return;
    }
    if (method === 'PUT') {
      const body = await readBody(req, MAX_BODY_BYTES);
      let raw: unknown;
      try {
        raw = JSON.parse(body);
      } catch {
        sendError(res, 400, 'invalid JSON');
        return;
      }
      const o = raw as {
        chat?: unknown;
        meta?: unknown;
        boardSeqd?: unknown;
        canvas?: unknown;
        title?: unknown;
        pinned?: unknown;
        mode?: unknown;
        clonedFromId?: unknown;
        repoPath?: unknown;
      };
      /* `repoPath` names the repo this write belongs to — see
         {@link sessionWriteRoot} for why it is validated against the catalog
         list and never falls back. It is NOT part of the patch: the store's
         `updateSession` already takes the root as its first argument. */
      const writeRoot = sessionWriteRoot(o.repoPath, sessionId);
      if ('error' in writeRoot) {
        sendError(res, 400, writeRoot.error);
        return;
      }
      const patch: {
        chat?: ReturnType<typeof readSessionChat>;
        meta?: ReturnType<typeof readSessionMeta>;
        boardSeqd?: string;
        canvas?: ReturnType<typeof readSessionCanvas>;
        title?: string;
        pinned?: boolean;
        mode?: 'work' | 'code';
        clonedFromId?: string;
      } = {};
      if (o.chat && typeof o.chat === 'object') {
        const c = o.chat as { version?: unknown; sessionId?: unknown; turns?: unknown };
        if (
          (c.version === 1 || c.version === 2) &&
          typeof c.sessionId === 'string' &&
          Array.isArray(c.turns)
        ) {
          if (c.sessionId.trim() !== threadId) {
            sendError(res, 400, 'chat.sessionId must match path id');
            return;
          }
          patch.chat = c as ReturnType<typeof readSessionChat>;
        } else {
          sendError(res, 400, 'invalid chat document');
          return;
        }
      }
      if (o.meta && typeof o.meta === 'object') {
        patch.meta = o.meta as ReturnType<typeof readSessionMeta>;
      }
      if (typeof o.boardSeqd === 'string') {
        patch.boardSeqd = o.boardSeqd;
      }
      if (o.canvas && typeof o.canvas === 'object') {
        const c = o.canvas as { version?: unknown; sessionId?: unknown; blocks?: unknown };
        if (c.version === 1 && typeof c.sessionId === 'string' && Array.isArray(c.blocks)) {
          if (c.sessionId.trim() !== threadId) {
            sendError(res, 400, 'canvas.sessionId must match path id');
            return;
          }
          patch.canvas = c as ReturnType<typeof readSessionCanvas>;
        } else {
          sendError(res, 400, 'invalid canvas document');
          return;
        }
      }
      if (typeof o.title === 'string') {
        patch.title = o.title;
      }
      if (typeof o.pinned === 'boolean') {
        patch.pinned = o.pinned;
      }
      if (o.mode === 'work' || o.mode === 'code') {
        patch.mode = o.mode;
      }
      if (typeof o.clonedFromId === 'string' && o.clonedFromId.trim()) {
        patch.clonedFromId = o.clonedFromId.trim();
      }
      const index = updateSession(writeRoot.root, threadId, patch);
      if (!index) {
        sendError(res, 404, 'session not found');
        return;
      }
      sendJson(res, 200, { ok: true, index });
      return;
    }
    if (method === 'DELETE') {
      /* DELETE carries no body here, so the repo travels as `?repoPath=` —
         same field name, same validation, same no-fallback rule as the PUT. */
      const deleteRoot = sessionWriteRoot(url.searchParams.get('repoPath') ?? undefined, sessionId);
      if ('error' in deleteRoot) {
        sendError(res, 400, deleteRoot.error);
        return;
      }
      /* "Always keep one live thread" is a rule about the repo you are IN. In a
         catalogued OTHER repo it re-mints the row you just deleted, so the
         delete reads as a no-op with the transcript gone — see
         {@link deleteSession}. Foreign is decided here, not from the presence
         of `?repoPath=`: naming your own repo must behave like omitting it. */
      const foreign = !sameRepoPath(deleteRoot.root, sessionsRoot());
      const index = deleteSession(deleteRoot.root, threadId, { keepOneLiveThread: !foreign });
      if (!index) {
        sendError(res, 404, 'session not found');
        return;
      }
      sendJson(res, 200, { ok: true, index });
      return;
    }
  }

    // ---- GET/PUT /api/chat-memory — compat shim → active loadable session ----
    // Do not write a forever shared `.sequence/chat-memory.json` blob.
    if (pathname === '/api/chat-memory') {
      if (requireOwner()) return;
      if (method === 'GET') {
        const root = sessionsRoot();
        const index = ensureSessionsMigrated(root);
        sendJson(res, 200, readSessionChat(root, index.activeId));
        return;
      }
      if (method === 'PUT') {
        const body = await readBody(req, MAX_BODY_BYTES);
        let raw: unknown;
        try {
          raw = JSON.parse(body);
        } catch {
          sendError(res, 400, 'invalid JSON');
          return;
        }
        if (
          !raw ||
          typeof raw !== 'object' ||
          ((raw as { version?: unknown }).version !== 1 &&
            (raw as { version?: unknown }).version !== 2) ||
          typeof (raw as { sessionId?: unknown }).sessionId !== 'string' ||
          !Array.isArray((raw as { turns?: unknown }).turns)
        ) {
          sendError(res, 400, 'invalid chat memory document');
          return;
        }
        const root = sessionsRoot();
        const index = ensureSessionsMigrated(root);
        const chat = {
          ...(raw as ReturnType<typeof readSessionChat>),
          sessionId: index.activeId,
        };
        const next = updateSession(root, index.activeId, { chat });
        if (!next) {
          sendError(res, 404, 'session not found');
          return;
        }
        sendJson(res, 200, {
          ok: true,
          path: `.sequence/sessions/${index.activeId}/chat.json`,
        });
        return;
      }
    }

    // ---- GET/PUT /api/canvas-doc — compat shim → active session canvas.json ----
    if (pathname === '/api/canvas-doc') {
      if (requireOwner()) return;
      if (method === 'GET') {
        const root = sessionsRoot();
        const index = ensureSessionsMigrated(root);
        const canvas = readSessionCanvas(root, index.activeId);
        /*
         * ── THE MIGRATION BELONGS ON THE ROUTE THE CANVAS ACTUALLY READS ─────
         *
         * It was wired into `GET /api/sessions/:id` first, which returns the
         * canvas and is the obvious "open the session" endpoint — and the client
         * hydrates its canvas from HERE instead (`connect.tsx` fetches
         * `/api/canvas-doc`; the other route's canvas field is not read for
         * this). So the API migrated and the SCREEN did not.
         *
         * Found by re-running the journey capture and looking at screen 4: it
         * still showed the stored chart. The endpoint test passed and the
         * product was unchanged, which is the exact shape of a claim this
         * repository has been wrong about before.
         *
         * Both routes migrate now, because a rule that lives in one of two
         * handlers is a rule that half the callers do not get.
         */
        const cp = readCheckpoint(root, index.activeId);
        if (cp.checkpoint !== undefined && cp.checkpoint.charts.length > 0) {
          const m = migrateCheckpoint({
            checkpoint: cp.checkpoint,
            graph: currentGraph ?? undefined,
            builtAt: buildStamp().builtAt,
          });
          if (m.migrated) canvas.charts = [...m.charts];
        }
        sendJson(res, 200, canvas);
        return;
      }
      if (method === 'PUT') {
        const body = await readBody(req, MAX_BODY_BYTES);
        let raw: unknown;
        try {
          raw = JSON.parse(body);
        } catch {
          sendError(res, 400, 'invalid JSON');
          return;
        }
        const o = raw as { version?: unknown; sessionId?: unknown; blocks?: unknown };
        if (o.version !== 1 || !Array.isArray(o.blocks)) {
          sendError(res, 400, 'invalid canvas document');
          return;
        }
        const root = sessionsRoot();
        const index = ensureSessionsMigrated(root);
        const canvas = {
          ...(raw as ReturnType<typeof readSessionCanvas>),
          sessionId: index.activeId,
        };
        const next = updateSession(root, index.activeId, { canvas });
        if (!next) {
          sendError(res, 404, 'session not found');
          return;
        }
        sendJson(res, 200, {
          ok: true,
          path: `.sequence/sessions/${index.activeId}/canvas.json`,
        });
        return;
      }
    }

    // ---- current scanned graph (canvas source) ----
    if (pathname === '/archgraph.json' && method === 'GET') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      const parsedScope = parseGraphScopeQuery(url, currentGraph!, currentNodeDetail ?? {});
      if ('error' in parsedScope) {
        sendError(res, parsedScope.status, parsedScope.error);
        return;
      }
      const view = parsedScope.view;
      // ITEM 1.8 / gap G8 — the validator. It must cover everything that can change
      // the BYTES, not just `scannedAt`: scope, depth and the staleness marker all
      // alter the body, and a tag that ignored them would hand a caller a 304 for a
      // body it has never seen.
      const etag = graphEtag(currentGraph!, view.key);
      // `no-cache` means STORE IT BUT ALWAYS ASK. Without a directive, RFC 9111
      // lets a browser invent its own freshness lifetime for a 200 that carries an
      // ETag and serve the body again WITHOUT ever revalidating — so a tab could
      // keep drawing a graph from three scans ago and the validator this endpoint
      // just grew would never be consulted. The saving here is the transfer, not
      // the round trip.
      res.setHeader('cache-control', 'no-cache');
      if (etagMatches(req.headers['if-none-match'], etag)) {
        res.statusCode = 304;
        res.setHeader('etag', etag);
        res.end();
        return;
      }
      const graphBody: GetArchGraphResponse & Record<string, unknown> = {
        ...view.graph,
        nodeDetail: view.nodeDetail,
        ...staleMarker(),
        ...(view.scope ? { scope: view.scope } : {}),
      };
      res.setHeader('etag', etag);
      sendJson(res, 200, graphBody);
      return;
    }

    // ---- GET /api/search?query=&glob= ----
    if (pathname === '/api/search' && method === 'GET') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;

      const query = url.searchParams.get('query') ?? undefined;
      const glob = url.searchParams.get('glob') ?? undefined;
      if (!query && !glob) {
        sendError(res, 400, 'query or glob required');
        return;
      }

      /*
       * THE SAME FUNCTION THE AGENT USES.
       *
       * Repo-wide search existed as an agent-internal tool and as nothing a
       * person could reach — a reader had to ask the assistant to grep for
       * them, spending a provider round on a question the machine answers for
       * free.
       *
       * Reused rather than reimplemented: a second search would be a second
       * set of caps, a second jail check and a second answer to "what is in
       * this repository", and the two would drift apart the first time either
       * changed.
       */
      const result = executeSearchFiles(
        { ...(query ? { query } : {}), ...(glob ? { glob } : {}) },
        {
          repoRoot: activeRoot(),
          /* The SAME jail choke point GET /api/file uses. A search that could
             read what the file route refuses would be a way around it. */
          /* The SAME signature the ask path passes — one jail choke point. */
          resolveReadable: resolveReadablePath,
          designMode: false,
        } as never,
      );

      sendJson(res, 200, {
        ok: result.ok,
        /* The tool's own text, verbatim. It already carries the match count,
           the capped snippets and the sentence it uses when there are none —
           rewriting any of that here would be a second voice for one answer. */
        text: result.ok ? (result.content ?? '') : '',
        evidence: result.evidence ?? '',
      });
      return;
    }

    // ---- GET /api/tree ----
    if (pathname === '/api/tree' && method === 'GET') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      const tree: GetTreeResponse = buildTree(activeRoot());
      sendJson(res, 200, tree);
      return;
    }

    // ---- GET /api/file?path=<repo-relative> ----
    if (pathname === '/api/file' && method === 'GET') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      const rel = url.searchParams.get('path') ?? '';
      // Same choke point as /api/prompt-file: the jail AND the reserved-dir
      // refusal. Without the reserved guard, GET /api/file?path=.sequence/ai.json
      // would ship the plaintext API key to any localhost caller, and .git/*
      // would be readable too.
      const abs = resolveReadablePath(rel);
      if (abs === null) {
        sendError(res, 403, 'path escapes repo root or is reserved');
        return;
      }
      let stat: fs.Stats;
      try {
        stat = fs.statSync(abs);
      } catch {
        sendError(res, 404, 'file not found');
        return;
      }
      if (stat.isDirectory()) {
        sendError(res, 400, 'path is a directory');
        return;
      }
      if (stat.size > MAX_FILE_BYTES) {
        sendError(res, 413, `file too large (>${MAX_FILE_BYTES} bytes)`);
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end(fs.readFileSync(abs, 'utf8'));
      return;
    }

    // ---- PUT /api/file  { path, content }  (jailed single-file save) ----
    // The board's editable file view saves through here. This is a WRITE surface,
    // so it goes through the EXACT same jail + reserved-dir guard as the model
    // write path (resolveInRepo + isReservedResolved, mirroring vetWritePaths): a
    // traversal, an absolute path, a symlink escape, or any .sequence/.git/.ssh/
    // .aws/.gnupg target is refused with the same 403 shape as GET /api/file. No
    // new way to write outside the repo or into a reserved dir.
    // ---- GET/PUT /api/hooks — what this repo declares, and whether it may run ----
    // The two halves are deliberately different files: `.sequence/hooks.json` is
    // COMMITTED and only declares; the trust list is USER-level and the repo
    // cannot write it. A repo proposes; only the person consents. GET is
    // therefore safe on any repo — it reads a declaration, it runs nothing.
    if (pathname === '/api/hooks') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      if (method === 'GET') {
        const declared = readHookFile(activeRoot());
        sendJson(res, 200, {
          events: [...HOOK_EVENTS],
          blocking: [...BLOCKING_EVENTS],
          /*
           * WHICH OF THE SIX ACTUALLY FIRE. Only `pre-write` and `pre-commit`
           * have a call site; the other four are declared, documented,
           * accepted by the file reader, and invoked by nothing. A user who
           * writes a `pre-tool` hook gets silence and debugs their own script.
           */
          live: [...HOOK_EVENTS_LIVE],
          /* And if THIS repo has configured one that cannot fire, the sentence
             saying so — rather than leaving the reader to compare two lists. */
          unfired: unfiredHookWarning(Object.keys(declared?.hooks ?? {})),
          declared: declared?.hooks ?? {},
          trusted: isTrusted(activeRoot(), readHookTrust(userConfigDir)),
        });
        return;
      }
      if (method === 'PUT') {
        if (!isJsonRequest(req)) {
          sendError(res, 415, 'expected content-type application/json');
          return;
        }
        let body: unknown;
        try {
          body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
        } catch (e) {
          sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
          return;
        }
        const trusted = (body as { trusted?: unknown } | null)?.trusted;
        if (typeof trusted !== 'boolean') {
          // A consent flag we half understand is the one field that must never
          // be guessed at — the same rule the generate-consent flag follows.
          sendError(res, 400, 'body must include a boolean "trusted"');
          return;
        }
        setHookTrust(userConfigDir, activeRoot(), trusted);
        sendJson(res, 200, { trusted });
        return;
      }
      sendError(res, 405, 'method not allowed');
      return;
    }

    /* ---- GET/PUT /api/repo-trust — THE TRUST BOUNDARY ---------------------
     *
     * GET answers two things at once, because the decision needs both: is this
     * repository trusted, and WHAT IS IT ASKING FOR. The instruction file's own
     * words are returned AS DATA — never rendered as instruction — so the
     * person deciding has read the thing they are deciding about. That is the
     * split `describeRepoInstructions` and `renderTrustedInstructionsSection`
     * make in `explain/instructions.ts`.
     *
     * PUT is the one explicit action, scoped to this repo root, and it writes
     * to the USER-level store (`~/.sequence/repo-trust.json`). It can never
     * write inside the repository, which is the entire design: a repo that
     * could mark itself trusted would be a repo that runs its own code the
     * first time you open it.
     *
     * ALWAYS 200 on GET, including for a repo with no instruction file at all —
     * `{trusted:false, instructions:null}` is a real answer and the surface
     * needs it to know there is nothing to show.
     *
     * KNOWN AND OUT OF SCOPE: like every other `/api` route this is defended
     * against hostile WEB PAGES by the global origin check in `handle()`, and
     * not against a hostile LOCAL PROCESS, which sends no `Origin` at all.
     * `docs/research/trust-boundary-verification.md` §3 records that gap and
     * names the per-launch capability token as its fix; it is a separate wave
     * and is not smuggled in here.
     */
    if (pathname === '/api/repo-trust') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      const root = activeRoot();
      if (method === 'GET') {
        const disclosure = describeRepoInstructions(root);
        const body: GetRepoTrustResponse = {
          root,
          repoName: path.basename(root),
          trusted: disclosure.trusted,
          instructions:
            disclosure.instructions === null
              ? null
              : {
                  file: disclosure.instructions.file,
                  text: disclosure.instructions.text,
                  truncated: disclosure.instructions.truncated,
                },
        };
        sendJson(res, 200, body);
        return;
      }
      if (method === 'PUT') {
        if (!isJsonRequest(req)) {
          sendError(res, 415, 'expected content-type application/json');
          return;
        }
        let body: unknown;
        try {
          body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
        } catch (e) {
          sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
          return;
        }
        const trusted = (body as { trusted?: unknown } | null)?.trusted;
        if (typeof trusted !== 'boolean') {
          /* A consent flag we half understand is the one field that must never
             be guessed at — the same rule `/api/hooks` PUT follows. */
          sendError(res, 400, 'body must include a boolean "trusted"');
          return;
        }
        /*
         * `userStoreDir()`, NOT the injectable `userConfigDir`.
         *
         * The gates that ENFORCE trust — `repoExecutionRefusal` inside
         * `runAllowlistedRepoCommand`, `renderTrustedInstructionsSection`,
         * `loadPermissionPolicy`'s project scope — are called from deep in the
         * harness with no server object in scope, so they read `userStoreDir()`
         * and nothing else. Writing the decision anywhere else would split the
         * writer from the readers: the UI would report "trusted" while every
         * gate still refused, or worse, the reverse. A boundary has exactly one
         * store. `SEQUENCE_USER_DIR` moves that one store, for everyone at
         * once, which is what test isolation actually needs.
         */
        setRepoTrust(userStoreDir(), root, trusted);
        /* Answer what the STORE now says, re-read through the same canonical
           key the gate uses — not the boolean that was asked for. A write that
           silently failed (read-only home) must not report success, and
           `activeRoot()` need not be spelled the way the store keys it. */
        const after: PutRepoTrustResponse = {
          root,
          trusted: isRepoTrusted(root),
        };
        sendJson(res, 200, after);
        return;
      }
      sendError(res, 405, 'method not allowed');
      return;
    }

    /* ---- GET/PUT /api/auto-approve — THE UNATTENDED AUTONOMY MODE ---------
     *
     * The owner's ask, 2026-09-02: a mode where the tools run "like its own
     * agentic workflow fully independent". Mechanically it converts an `ask`
     * verdict into `allow` for the session and nothing else — see
     * `server/autoApprove.ts`, which owns every rule this route enforces.
     *
     * IT SITS DIRECTLY BELOW `/api/repo-trust` BECAUSE IT IS THE SAME DECISION,
     * ONE STEP FURTHER. Enabling is REFUSED (403) on an untrusted repository
     * rather than recorded and deferred: a switch that stored "on, pending
     * trust" would mean trusting a repo later ALSO granted it autonomy, in one
     * click the user thought was about instructions and commands.
     *
     * NOTHING IS PERSISTED. The state is a `Set` inside the server process, so
     * a restart turns it off and there is no file for a hostile repo to forge —
     * the deliberate opposite of `repo-trust.json`, whose header explains why
     * THAT one is written down.
     *
     * TURNING IT OFF ALWAYS SUCCEEDS, on an untrusted repo too: a user revoking
     * autonomy must never be told they may not.
     */
    if (pathname === '/api/auto-approve') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      const root = activeRoot();
      if (method === 'GET') {
        const state = readAutoApprove(root);
        const body: GetAutoApproveResponse = {
          root,
          trusted: state.trusted,
          on: state.on,
          refusal: state.refusal,
        };
        sendJson(res, 200, body);
        return;
      }
      if (method === 'PUT') {
        if (!isJsonRequest(req)) {
          sendError(res, 415, 'expected content-type application/json');
          return;
        }
        let body: Unvalidated<PutAutoApproveRequest>;
        try {
          body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
        } catch (e) {
          sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
          return;
        }
        const on = body.on;
        if (typeof on !== 'boolean') {
          /* A consent flag we half understand is the one field that must never
             be guessed at — the rule `/api/repo-trust` and `/api/hooks` follow. */
          sendError(res, 400, 'body must include a boolean "on"');
          return;
        }
        const state = setAutoApprove(root, on);
        if (on && !state.on) {
          /* 403 AND THE REASON, not a quiet `{on:false}`. A switch that answers
             200 and stays off teaches the user the control is broken; the
             sentence names TRUST, which is the thing they can actually change. */
          sendError(res, 403, state.refusal ?? 'auto-approve was refused');
          return;
        }
        const after: PutAutoApproveResponse = {
          root,
          trusted: state.trusted,
          on: state.on,
          refusal: state.refusal,
        };
        sendJson(res, 200, after);
        return;
      }
      sendError(res, 405, 'method not allowed');
      return;
    }

    // ---- GET/PUT /api/permissions — project `.sequence/permissions.json` ----
    // Same algebra `askTools` loads. Settings edits the file text; no shadow DB.
    if (pathname === '/api/permissions') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      const file = permissionsFilePath(activeRoot());
      const rel = `.sequence/permissions.json`;
      if (method === 'GET') {
        let raw: string | undefined;
        try {
          raw = fs.readFileSync(file, 'utf8');
        } catch {
          raw = undefined;
        }
        if (raw === undefined) {
          const document = emptyPermissionDocument();
          const text = serializePermissionsDocument(document);
          const body: GetPermissionsResponse = {
            path: rel,
            exists: false,
            document,
            text,
            warnings: [],
          };
          sendJson(res, 200, body);
          return;
        }
        const { doc, warnings } = parsePermissionsDocument(raw, rel);
        const body: GetPermissionsResponse = {
          path: rel,
          exists: true,
          document: doc,
          text: serializePermissionsDocument(doc),
          warnings,
        };
        sendJson(res, 200, body);
        return;
      }
      if (method === 'PUT') {
        if (!isJsonRequest(req)) {
          sendError(res, 415, 'expected content-type application/json');
          return;
        }
        let body: Unvalidated<PutPermissionsRequest>;
        try {
          body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
        } catch (e) {
          sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
          return;
        }
        if (typeof body.text !== 'string') {
          sendError(res, 400, 'body must include a string "text" (the permissions.json contents)');
          return;
        }
        const { doc, warnings } = parsePermissionsDocument(body.text, rel);
        /* Refuse to write when JSON did not parse into any usable document —
           empty default + a "not readable" warning means the user would lose
           their draft if we overwrote with empty. */
        if (warnings.some((w) => /NO RULES LOADED|not readable as JSON|expected a JSON object/i.test(w))) {
          sendError(res, 400, warnings[0] ?? 'invalid permissions document');
          return;
        }
        writePermissionsDocument(activeRoot(), doc);
        const written: PutPermissionsResponse = {
          path: rel,
          document: doc,
          text: serializePermissionsDocument(doc),
          warnings,
        };
        sendJson(res, 200, written);
        return;
      }
      sendError(res, 405, 'method not allowed');
      return;
    }

    // ---- GET /api/git/revisions — what a reviewer can NAME ----
    // `?scope=commit&rev=` and `?scope=branch&base=` exist and the pane could
    // not use either, because it had no way to name a revision or a base. This
    // is the list it picks from. Read-only, and it takes no revision from the
    // caller — the only input is a bounded count, so there is nothing to inject.
    if (pathname === '/api/git/revisions' && method === 'GET') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      const raw = Number(url.searchParams.get('limit') ?? '20');
      try {
        sendJson(res, 200, await gitRevisions(activeRoot(), Number.isFinite(raw) ? raw : 20));
      } catch (e) {
        if (e instanceof GitWorkspaceError) sendError(res, e.status, e.message);
        else sendError(res, 500, (e as Error).message);
      }
      return;
    }

    if (pathname === '/api/file' && method === 'PUT') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      if (!isJsonRequest(req)) {
        sendError(res, 415, 'expected content-type application/json');
        return;
      }
      let body: Unvalidated<PutFileRequest>;
      try {
        body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
      } catch (e) {
        sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
        return;
      }
      const rel = body.path;
      const content = body.content;
      if (typeof rel !== 'string' || rel.length === 0) {
        sendError(res, 400, 'body must include a string "path"');
        return;
      }
      if (typeof content !== 'string') {
        sendError(res, 400, 'body must include a string "content"');
        return;
      }
      // Same choke point as the model write path: jail (traversal/symlink) AND the
      // reserved-dir refusal, judged on the realpath.
      const abs = resolveInRepo(activeRoot(), rel);
      if (
        abs === null ||
        (isReservedResolved(abs) &&
          !isDecisionRecordWritePath(abs) &&
          !isSeqDiagramWritePath(abs) &&
          !isPlanWritePath(abs))
      ) {
        sendError(res, 403, 'path escapes repo root or is reserved');
        return;
      }
      const relPosix = rel.replace(/\\/g, '/');
      if (/(?:^|\/)(?:docs\/adr|\.sequence\/decisions)\/ADR-\d{3}-.+\.md$/.test(relPosix)) {
        try {
          if (fs.existsSync(abs)) {
            sendError(res, 409, 'decision record already exists — never overwrite');
            return;
          }
        } catch {
          /* stat failure — proceed; write will surface errors */
        }
      }
      const editAllowlist = readProgramEditAllowlist(activeRoot());
      if (editAllowlist && !pathMatchesProgramEditAllowlist(relPosix, editAllowlist)) {
        sendError(res, 403, 'path outside program.md Agent may edit allowlist');
        return;
      }

      /*
       * ══ pre-write HOOK — the only moment disk changes ═══════════════════
       *
       * CANON reports this repository's own three gates as "enforced by prose".
       * This is where a project's rule gets to be code instead: a `pre-write`
       * hook exiting 2 stops the write, with its own stderr as the reason.
       *
       * IT RUNS ONLY IF THE USER TRUSTED THIS REPO. `.sequence/hooks.json` is
       * committed, so running it unasked would mean opening someone's project
       * executes their code; the trust list is USER-level and the repo cannot
       * write it. A repo proposes, only the person consents.
       *
       * A 403 rather than a 400: the write was understood and REFUSED.
       */
      const hookOutcome = await runHooks('pre-write', {
        repoRoot: activeRoot(),
        file: readHookFile(activeRoot()),
        trusted: isTrusted(activeRoot(), readHookTrust(userConfigDir)),
        payload: { path: relPosix },
      });
      if (!hookOutcome.allowed) {
        const blocked = hookOutcome.outcomes.find((o) => o.kind === 'blocked');
        sendError(
          res,
          403,
          `blocked by a pre-write hook (${blocked?.command ?? 'hook'}): ${
            blocked && 'reason' in blocked ? blocked.reason : 'no reason given'
          }`,
        );
        return;
      }
      // Refuse to clobber a directory; a new file is fine (jail already vetted it).
      try {
        if (fs.statSync(abs).isDirectory()) {
          sendError(res, 400, 'path is a directory');
          return;
        }
      } catch {
        /* not-yet-existing file — allowed (creating a new file) */
      }
      /*
       * P10 — register this write with the session's checkpoint store BEFORE it
       * lands, so the file's PRE-write state becomes the baseline a rewind can
       * return to. Doing it after the write would record the new content as the
       * baseline and make every rewind past the first touch a silent no-op,
       * which is the failure that looks exactly like the feature working.
       *
       * Absent `sessionId` ⇒ nothing is tracked and no checkpoint directory is
       * created, so every pre-P10 caller behaves byte-identically. A tracking
       * failure never fails the write: the user's edit is the request, and
       * refusing it because bookkeeping failed would trade a real loss for a
       * hypothetical one. It is surfaced on stderr instead.
       */
      if (isCheckpointSessionId(body.sessionId)) {
        try {
          trackSessionWrite(activeRoot(), body.sessionId, path.relative(activeRoot(), abs));
        } catch (e) {
          process.stderr.write(`sequence: checkpoint tracking failed: ${(e as Error).message}
`);
        }
      }
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
      // The edit changes content, so the persisted graph cache is now stale.
      // This endpoint does not itself re-scan (currentGraph is refreshed via the
      // board's explicit rescan), so INVALIDATE the on-disk cache: the next
      // attach recomputes the signature and re-scans fresh. Belt-and-suspenders
      // for coarse-mtime filesystems where a same-size edit might not perturb
      // the signature on its own.
      /*
       * STILL UNSCOPED, deliberately, and this is a handoff rather than an oversight.
       *
       * W1.4 gave `clearCachedGraph` an optional `changedPath` that poisons the
       * whole-repo signature (so the next attach still re-crawls) but invalidates
       * only the written file's PART, leaving every other package readable — the
       * 46x win that work exists to deliver, and W1.4's own report names this line
       * as the place to use it. Passing `abs` here is the whole change, and it was
       * verified working: with it, a write into `frontend-ace` leaves
       * `backend-shared`'s cached slice readable while `frontend-ace` correctly
       * misses.
       *
       * It is NOT shipped because `graph-cache.test.ts:257` asserts
       * `!fs.existsSync(cacheFilePath(repo))` — the cache FILE must be gone. The
       * scoped form rewrites that file instead of removing it, so the one-line
       * change turns a pre-existing test red. That assertion pins the mechanism
       * rather than the invariant (line 264 already asserts the real one: the next
       * attach re-scans, which the scoped form preserves), but it belongs to a test
       * file this wave assigned to someone else, and quietly rewriting another
       * owner's assertion to make my change pass is the exact move the file-
       * ownership rule exists to prevent.
       */
      clearCachedGraph(activeRoot());
      const writtenRel = path.relative(activeRoot(), abs);
      // ITEM 1.5 — the write's own answer says the graph is now behind the disk.
      // `stale` is not a warning about THIS response (the file was written); it is
      // the honest state of the graph the caller is still holding, which is the
      // thing a client has to react to.
      markGraphStale(writtenRel);
      const written: PutFileResponse & { stale: true; staleSince: string } = {
        ok: true,
        path: writtenRel,
        stale: true,
        staleSince: staleSince!,
      };
      sendJson(res, 200, written);
      return;
    }

    // ---- POST /api/scan ----
    if (pathname === '/api/scan' && method === 'POST') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      /*
       * ITEM 1.5 / gap G4 — PROGRESS. A scan of this monorepo is seconds long and
       * used to be one blocking call behind a spinner. A caller that asks for a
       * stream (Accept: text/event-stream, or ?stream=1) now gets the phase feed;
       * a caller that does not gets the identical single JSON graph it always did,
       * so no existing client changes.
       *
       * WHAT `done`/`total` COUNT, stated because a progress bar that lies is
       * worse than none: they count the PHASES THIS ROUTE EXECUTES, not files.
       * Per-file analysis progress is not observable from here — `scanRepo`
       * (scan.ts) takes no progress callback, and inventing one by ticking a
       * counter against wall-clock would be a fabricated number. The measured file
       * count IS real and rides along as `files`, enumerated with the scanner's own
       * IGNORE_DIRS so it describes the same set of files the scan will consider.
       */
      if (!wantsEventStream(req, url)) {
        setCurrentGraph(await forceScan(activeRoot()));
        const scanned: PostScanResponse = { ...currentGraph!, nodeDetail: currentNodeDetail ?? {} };
        sendJson(res, 200, scanned);
        return;
      }
      const root = activeRoot();
      // Exactly the three units of real work this route performs, in order.
      // Nothing is listed here that the JSON path does not also do, so the two
      // paths cannot drift into different scans.
      const phases = ['enumerate', 'analyze', 'detail'] as const;
      const total = phases.length;
      let completed = 0;
      startSse(res);
      // Async on purpose: each announcement is flushed to the client BEFORE the
      // phase it announces begins blocking the loop (see drainTick).
      const progress = async (
        phase: string,
        subject: string,
        extra: Record<string, unknown> = {},
      ): Promise<void> => {
        writeSseData(res, { type: 'scan:progress', phase, done: completed, total, path: subject, ...extra });
        await drainTick();
      };
      try {
        await progress('enumerate', '.');
        const files = countScannableFiles(root);
        completed = 1;

        await progress('analyze', '.', { files });
        const graph = await forceScan(root);
        completed = 2;

        await progress('detail', '.', { files, nodes: graph.nodes.length, edges: graph.edges.length });
        setCurrentGraph(graph);

        completed = total;

        await progress('done', '.', { files, nodes: graph.nodes.length, edges: graph.edges.length });
        const scanned: PostScanResponse = { ...currentGraph!, nodeDetail: currentNodeDetail ?? {} };
        writeSseData(res, { type: 'scan:result', graph: scanned });
        res.end();
      } catch (e) {
        // The stream is already open, so the failure is reported ON it rather than
        // as a status code nobody can still receive.
        writeSseData(res, { type: 'scan:error', error: (e as Error).message });
        res.end();
      }
      return;
    }

    // ---- POST /api/explain (plain-English PlainTree for the attached repo) ----
    // Reuses the current scanned graph (never a new detector pass) + the folder
    // walk as the deterministic STRUCTURE, and the configured provider (if any)
    // to GROUP/RELABEL it. Cached under .sequence/explain.json, invalidated
    // whenever the graph is rescanned (the cache is keyed on graph.scannedAt).
    // Read-only: the only write is the cache, which holds no secrets.
    if (pathname === '/api/explain' && method === 'POST') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      const graph = currentGraph!;
      // The chosen generate profile + detail level (default recommended+regular).
      // Read from an optional JSON body; a body-less POST (the existing callers)
      // stays recommended+regular so the pre-Phase-4 cache file/shape is unchanged.
      let profile: 'recommended' | 'bestfit' = 'recommended';
      let detailLevel: 'regular' | 'advanced' = 'regular';
      if (isJsonRequest(req)) {
        try {
          const body = JSON.parse(await readBody(req, MAX_BODY_BYTES)) as {
            profile?: unknown;
            detailLevel?: unknown;
          };
          if (body.profile === 'bestfit') profile = 'bestfit';
          if (body.detailLevel === 'advanced') detailLevel = 'advanced';
        } catch {
          /* tolerate an empty/garbage body — default to recommended+regular */
        }
      }
      const cacheFile = explainCacheFile(profile, detailLevel);
      const cached = readJson<ExplainCache>(activeRoot(), cacheFile);
      if (
        cached &&
        cached.scannedAt === graph.scannedAt &&
        cached.tree &&
        (cached.profile ?? 'recommended') === profile &&
        (cached.detailLevel ?? 'regular') === detailLevel
      ) {
        sendJson(res, 200, {
          tree: cached.tree,
          mode: cached.mode,
          provider: cached.provider,
          profile: cached.profile ?? 'recommended',
          projectType: cached.projectType,
          detailLevel: cached.detailLevel ?? 'regular',
        });
        return;
      }
      const cfg = loadAiConfig();
      const explainAbort = requestAbort(res);
      let result: Awaited<ReturnType<typeof buildPlainTree>>;
      try {
        result = await buildPlainTree(graph, {
          provider: cfg,
          profile,
          detailLevel,
          tree: buildTree(activeRoot()),
          // Meter the default-mode path (no-op for api-key). A backstop block throws
          // and buildPlainTree falls back to the structural tree — never a crash.
          // Closed over the request identity so metering keys per user.
          callProvider: (c, p) => callProviderMetered(c, p, identity, explainAbort.signal),
        });
      } finally {
        explainAbort.dispose();
      }
      if (explainAbort.signal.aborted) {
        // buildPlainTree swallows provider failures and falls back to the
        // structural tree, so an abort surfaces here as "we produced something
        // nobody asked for any more" rather than as a throw. Do not cache it and
        // do not answer: the request is over.
        sendAborted(res);
        return;
      }
      const toCache: ExplainCache = {
        scannedAt: graph.scannedAt,
        tree: result.tree,
        mode: result.mode,
        provider: result.provider,
        profile: result.profile ?? profile,
        projectType: result.projectType,
        detailLevel,
      };
      writeJson(activeRoot(), cacheFile, toCache);
      sendJson(res, 200, {
        tree: result.tree,
        mode: result.mode,
        provider: result.provider,
        profile: result.profile ?? profile,
        projectType: result.projectType,
        detailLevel,
      });
      return;
    }

    // ---- POST /api/annotate (per-node plain-English bullets for arch cards) ----
    // Reuses the current scanned graph + structure digest; the configured provider
    // (if any) writes SHORT grounded bullets per real node id. Cached under
    // `.sequence/annotations.json`, invalidated whenever the graph is rescanned.
    // No key ⇒ honest empty map (200), never fabricated prose.
    if (pathname === '/api/annotate' && method === 'POST') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      const graph = currentGraph!;
      let detailLevel: 'regular' | 'advanced' = 'regular';
      if (isJsonRequest(req)) {
        const raw = await readBody(req, MAX_BODY_BYTES);
        if (raw.trim() !== '') {
          try {
            const body = JSON.parse(raw) as { detailLevel?: unknown };
            if (body.detailLevel === 'advanced') detailLevel = 'advanced';
          } catch {
            sendError(res, 415, 'expected valid JSON body');
            return;
          }
        }
      }
      const cacheFile = annotationsCacheFile(detailLevel);
      const cached = readJson<AnnotationsCache>(activeRoot(), cacheFile);
      if (
        cached &&
        cached.version === ANNOTATIONS_CACHE_VERSION &&
        cached.scannedAt === graph.scannedAt &&
        (cached.detailLevel ?? 'regular') === detailLevel &&
        cached.annotations
      ) {
        sendJson(res, 200, {
          annotations: cached.annotations,
          mode: cached.mode ?? 'none',
          provider: cached.provider,
          detailLevel,
        });
        return;
      }
      const cfg = loadAiConfig();
      if (!cfg) {
        sendJson(res, 200, { annotations: {}, mode: 'none', detailLevel });
        return;
      }
      const annotateAbort = requestAbort(res);
      let result: Awaited<ReturnType<typeof buildAnnotations>>;
      try {
        result = await buildAnnotations(graph, {
          provider: cfg,
          detailLevel,
          tree: buildTree(activeRoot()),
          callProvider: (c, p) => callProviderMetered(c, p, identity, annotateAbort.signal),
        });
      } finally {
        annotateAbort.dispose();
      }
      if (annotateAbort.signal.aborted) {
        // Same shape as /api/explain: annotations degrade to an empty map rather
        // than throwing, so the abort is checked, not caught.
        sendAborted(res);
        return;
      }
      const toCache: AnnotationsCache = {
        version: ANNOTATIONS_CACHE_VERSION,
        scannedAt: graph.scannedAt,
        detailLevel,
        annotations: result.annotations,
        mode: result.mode,
        provider: result.provider,
      };
      writeJson(activeRoot(), cacheFile, toCache);
      sendJson(res, 200, {
        annotations: result.annotations,
        mode: result.mode,
        provider: result.provider,
        detailLevel,
      });
      return;
    }

    // ---- GET /api/functions (grounded function-level graph) ----
    // Reuses the current scanned graph's `scannedAt` for cache invalidation.
    // Cached under `.sequence/functions.json`. Never 500 on parse/build issues.
    if (pathname === '/api/functions' && method === 'GET') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      const graph = currentGraph!;
      // Read-through cache keyed on `scannedAt`, plus the read-and-clear
      // route-handler ambiguities from the build (unresolved/ambiguous handlers,
      // degraded to the registration site — see functions/crossServiceEdges.ts).
      // Surfaced rather than left silent, same rationale as ArchGraph.warnings, and
      // replayed from the cache on a hit so a cached answer is as qualified as a
      // fresh one. Never 500s: a build failure is an empty graph.
      const { functionGraph, warnings } = await buildRepoFunctionGraphCached(
        activeRoot(),
        graph,
        opts.scan
      );
      const fnBody: GetFunctionsResponse = { functionGraph, warnings };
      sendJson(res, 200, fnBody);
      return;
    }

    // ---- POST /api/research  { query, urls? }  (live research gateway) ----
    // Fetch real http(s) URLs (explicit, extracted from query, or DuckDuckGo
    // Instant Answer FirstURLs), then ask the CONFIGURED provider for a brief that
    // cites ONLY what was actually fetched. Never invents sources. Needs a key
    // (or live free tier) — without one ⇒ honest 400. SSRF: private/loopback
    // hosts refused (test seam: SEQUENCE_RESEARCH_ALLOW_LOOPBACK).
    if (pathname === '/api/research' && method === 'POST') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      if (!isJsonRequest(req)) {
        sendError(res, 415, 'expected content-type application/json');
        return;
      }
      let body: { query?: unknown; urls?: unknown };
      try {
        body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
      } catch (e) {
        sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
        return;
      }
      const query = body.query;
      if (typeof query !== 'string' || query.trim() === '') {
        sendError(res, 400, 'body must include a non-empty string "query"');
        return;
      }
      const urls = Array.isArray(body.urls)
        ? body.urls.filter((u): u is string => typeof u === 'string' && u.trim() !== '')
        : undefined;
      const cfg = loadAiConfig();
      if (!cfg) {
        sendError(
          res,
          400,
          'AI provider not configured — connect your AI key in Settings to research',
        );
        return;
      }
      const digest = buildDigest(currentGraph!, buildTree(activeRoot()));
      const digestSummary = [
        `repo: ${currentGraph!.repoName}`,
        `nodes: ${currentGraph!.nodes.length}`,
        `edges: ${currentGraph!.edges.length}`,
        `digest:\n${JSON.stringify(digest).slice(0, 4_000)}`,
      ].join('\n');
      const researchAbort = requestAbort(res);
      try {
        const result = await runLiveResearch({
          query,
          urls,
          digestSummary,
          callModel: (prompt) => callProviderMetered(cfg, prompt, identity, researchAbort.signal),
        });
        sendJson(res, 200, result);
      } catch (e) {
        if (isRequestAbortedError(e)) {
          sendAborted(res);
          return;
        }
        if (e instanceof ProviderError) {
          const errBody: Record<string, unknown> = { error: e.message };
          if (e.body !== undefined) errBody.providerResponse = e.body;
          sendJson(res, e.httpStatus ?? 502, errBody);
          return;
        }
        throw e;
      } finally {
        researchAbort.dispose();
      }
      return;
    }

    // ---- GET /api/program/strategy  (`.sequence/program.md` — customer autoresearch) ----
    // Human-edited loop rules for BYO-key Program runs. Key-free read; absent ⇒ 404.
    if (pathname === '/api/program/strategy' && method === 'GET') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      const text = readProgramStrategy(activeRoot());
      if (text === undefined) {
        sendError(res, 404, 'no program strategy — add .sequence/program.md');
        return;
      }
      const editAllowlist = parseProgramEditAllowlist(text);
      const body: { path: string; content: string; editAllowlist?: string[] } = {
        path: '.sequence/program.md',
        content: text,
      };
      if (editAllowlist) body.editAllowlist = editAllowlist;
      sendJson(res, 200, body);
      return;
    }

    // ---- POST /api/program/run-log  (append `.sequence/runs/results.tsv`) ----
    // Harness-owned experiment log (autoresearch results.tsv). Agents cannot write
    // via /api/file; only this append endpoint updates the TSV. Key-free.
    if (pathname === '/api/program/run-log' && method === 'POST') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      if (!isJsonRequest(req)) {
        sendError(res, 415, 'expected content-type application/json');
        return;
      }
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
      } catch (e) {
        sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
        return;
      }
      if (!isProgramRunLogRow(body)) {
        sendError(
          res,
          400,
          'body must be a run log row: { runId, programId, metric, status, description }',
        );
        return;
      }
      appendProgramRunLog(activeRoot(), body);
      sendJson(res, 200, { ok: true, path: '.sequence/runs/results.tsv' });
      return;
    }

    // ---- GET /api/program/run-log  (read `.sequence/runs/results.tsv`) ----
    if (pathname === '/api/program/run-log' && method === 'GET') {
      if (requireRepo(res)) return;
      const rows = readProgramRunLog(activeRoot());
      const runLog: GetProgramRunLogResponse = { rows };
      sendJson(res, 200, runLog);
      return;
    }

    /* ================= P8 — SERVER-SIDE RUNS: THE ROUTES ======================
     * `POST /api/program/run` starts one and answers with a run id; the run is
     * NOT tied to that request. `GET /api/program/runs` lists, `GET
     * /api/program/runs/:id` reads one, `GET /api/program/runs/:id/events`
     * tails/replays, `POST /api/program/runs/:id/cancel` stops.
     *
     * THE ONE THING TO NOT GET WRONG, written here because it is invisible in a
     * diff: NONE of these routes wires `requestAbort(res)` into the run. That
     * helper exists to stop work when the caller goes away, and it is exactly
     * right for an ask — but wiring it here would mean closing the tab kills the
     * run, which is the bug being closed. A disconnect ends a SUBSCRIPTION.
     * Cancelling ends a RUN, and it is a separate verb.
     */

    // ---- POST /api/program/run  { program, inputs?, timeoutMs?, maxSteps? } ----
    if (pathname === '/api/program/run' && method === 'POST') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      if (!isJsonRequest(req)) {
        sendError(res, 415, 'expected content-type application/json');
        return;
      }
      let body: Unvalidated<PostProgramRunRequest>;
      try {
        body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
      } catch (e) {
        sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
        return;
      }
      if (!body.program || typeof body.program !== 'object') {
        sendError(res, 400, 'body must include a "program" object');
        return;
      }
      const program = body.program as Program;
      // The SAME validator the CLI runs. A program that would not survive
      // `sequence program run` must not survive this route either, or the two
      // entry points disagree about what a valid program is.
      const validation = validateProgram(program);
      if (!validation.ok) {
        const invalid: ProgramInvalidResponse = {
          error: `program is not valid (${validation.errors.length} problem${validation.errors.length === 1 ? '' : 's'})`,
          problems: validation.errors,
        };
        sendJson(res, 400, invalid);
        return;
      }
      /*
       * The ACP gate is evaluated HERE, against the request that starts the run,
       * and never again. A detached run has no request to check `isOriginAllowed`
       * against, so the choice is to check it at the door or not at all — and a
       * local-only capability that stops being checked once it is behind a run id
       * is not local-only. A program with no acp node is unaffected.
       */
      const wantsAcp = program.nodes.some((n) => n.kind === 'agent' && n.agent?.runtime === 'acp');
      if (wantsAcp) {
        const g = acpGate();
        if (!g.available) {
          sendError(res, 403, g.reason ?? 'ACP is not available');
          return;
        }

        /*
         * RESOLVE BEFORE ACCEPTING. The runner is deliberately detached from
         * this request, so an executor-construction error otherwise arrives
         * only after a 202 and becomes a failed row. Every ACP ref the executor
         * will ask for is knowable from the validated program right now; a
         * request the server already knows cannot start is a 400 and creates no
         * run record.
         */
        const refs = new Set(
          program.nodes
            .filter((node) => node.kind === 'agent' && node.agent?.runtime === 'acp')
            .map((node) => node.agent?.acp?.agentRef ?? DEFAULT_PROGRAM_AGENT_REF),
        );
        try {
          for (const agentRef of refs) resolveProgramAgent(agentRef);
        } catch (e) {
          sendError(res, 400, (e as Error).message);
          return;
        }
      }
      const inputs: Record<string, string> = {};
      if (body.inputs && typeof body.inputs === 'object') {
        for (const [k, v] of Object.entries(body.inputs as Record<string, unknown>)) {
          if (typeof v === 'string') inputs[k] = v;
        }
      }
      let started;
      try {
        started = programRunner.start({
          repoRoot: activeRoot(),
          program,
          identity,
          ...(Object.keys(inputs).length > 0 ? { inputs } : {}),
          ...(typeof body.timeoutMs === 'number' ? { timeoutMs: body.timeoutMs } : {}),
          ...(typeof body.maxSteps === 'number' ? { maxSteps: body.maxSteps } : {}),
          ...(typeof body.sourceDiagramId === 'string'
            ? { sourceDiagramId: body.sourceDiagramId }
            : {}),
          ...(typeof body.sourceDiagramHash === 'string'
            ? { sourceDiagramHash: body.sourceDiagramHash }
            : {}),
        });
      } catch (e) {
        if (e instanceof TooManyRunsError) {
          sendError(res, 429, e.message);
          return;
        }
        throw e;
      }
      const accepted: PostProgramRunResponse = {
        runId: started.runId,
        status: started.status,
        startedAt: started.startedAt,
        // 0, deliberately, and NOT `started.lastEventSeq`. This field is the
        // caller's resume CURSOR, and this caller has seen nothing yet. The run
        // may already have committed `run:started` synchronously; echoing that
        // number back would make the client's first reconnect skip it.
        lastEventSeq: 0,
      };
      // 202, not 200: the run is ACCEPTED and registered, and has not finished.
      // A 200 here would read as "done", which is the one thing it is not.
      sendJson(res, 202, accepted);
      return;
    }

    // ---- GET /api/program/runs  → every run for this repo, newest first ----
    if (pathname === '/api/program/runs' && method === 'GET') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      const runs: GetProgramRunsResponse = { runs: programRunner.list(activeRoot()) };
      sendJson(res, 200, runs);
      return;
    }

    // ---- /api/program/runs/:runId  (+ /events, /cancel) ----
    if (pathname.startsWith('/api/program/runs/')) {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      const rest = pathname.slice('/api/program/runs/'.length);
      const slash = rest.indexOf('/');
      const runId = decodeURIComponent(slash === -1 ? rest : rest.slice(0, slash));
      const tail = slash === -1 ? '' : rest.slice(slash + 1);
      // `isRunId` is a whitelist over the exact alphabet this server mints, so a
      // traversal attempt never reaches `path.join` — the store refuses to build
      // a path for anything else, and this refuses before it even asks.
      if (!isRunId(runId)) {
        sendError(res, 404, 'run not found');
        return;
      }

      // ---- POST /api/program/runs/:runId/cancel ----
      if (tail === 'pause' && method === 'POST') {
        /*
         * PAUSE IS NOT CANCEL. Cancel aborts mid-node and the run is over;
         * pause lets the node in flight finish and halts before the next, which
         * is what makes the scheduler's `paused` status resumable from its own
         * checkpoint.
         *
         * It is the producer "Waiting on you" never had. `shouldPause` is the
         * only thing that yields `paused` and nothing called it, so that bucket
         * counted zero on every real list — honestly, and uselessly.
         */
        const outcome = programRunner.pause(activeRoot(), runId);
        if (!outcome.found) {
          sendError(res, 404, 'run not found');
          return;
        }
        /* 200 even when nothing was paused, for cancel's reason: a run that has
           already finished satisfies "stop going" too, and a 409 would make
           "you were too late" look like a failure to act on. */
        sendJson(res, 200, {
          ok: true,
          runId,
          paused: outcome.cancelled,
          status: outcome.status,
        });
        return;
      }

      if (tail === 'resume' && method === 'POST') {
        /*
         * THE OTHER HALF OF PAUSE, WHICH DID NOT EXIST.
         *
         * `pause` set `pauseRequested` and nothing anywhere cleared it, so a
         * paused run was paused permanently — while `runProgram` had supported
         * resuming from a checkpoint since Harness W4 and the checkpoint was
         * already persisted on every node. The primitive was complete and
         * every layer above it was missing, and a notification was telling
         * users the run "can be resumed".
         */
        const outcome = programRunner.resume(activeRoot(), runId);
        if (!outcome.found) {
          sendError(res, 404, 'run not found');
          return;
        }
        /* 200 even when nothing restarted, for pause's reason: a run that is
           already running, or long finished, does not need resuming and a 409
           would make "there was nothing to do" look like a failure. The
           `resumed` flag is what says which happened. */
        sendJson(res, 200, {
          ok: true,
          runId,
          resumed: outcome.cancelled,
          status: outcome.status,
        });
        return;
      }

      if (tail === 'cancel' && method === 'POST') {
        const outcome = programRunner.cancel(activeRoot(), runId);
        if (!outcome.found) {
          sendError(res, 404, 'run not found');
          return;
        }
        const cancelled: PostProgramRunCancelResponse = {
          ok: true,
          runId,
          cancelled: outcome.cancelled,
          status: outcome.status,
        };
        // 200 even when nothing was cancelled: the caller's intent — this run
        // must not keep going — is already satisfied by a run that finished.
        // A 409 would make "you were too late" look like a failure to act on.
        sendJson(res, 200, cancelled);
        return;
      }

      // ---- GET /api/program/runs/:runId/events  (SSE, resumable) ----
      if (tail === 'events' && method === 'GET') {
        const stored = programRunner.read(activeRoot(), runId);
        if (!stored) {
          sendError(res, 404, 'run not found');
          return;
        }
        const sinceParam = url.searchParams.get('since');
        const lastEventId = req.headers['last-event-id'];
        /*
         * `?since=` wins over `Last-Event-ID` when both are present. The header
         * is what a browser `EventSource` sends BY ITSELF on an automatic
         * reconnect; the query is what a client that manages its own cursor
         * sends deliberately. When they disagree, the deliberate one is the one
         * that reflects what the client has actually processed.
         */
        const rawSince =
          sinceParam !== null ? sinceParam : typeof lastEventId === 'string' ? lastEventId : '';
        const parsedSince = Number.parseInt(rawSince, 10);
        const since = Number.isFinite(parsedSince) && parsedSince > 0 ? parsedSince : 0;

        startSse(res);
        let lastSent = since;
        /**
         * One writer for both replayed and live events.
         *
         * The `seq <= lastSent` drop is what makes a reconnect idempotent
         * regardless of which path an event arrives on — the property ml-harness
         * §1.1 calls "idempotent by construction rather than by timing". The
         * `id:` line is the cursor the client sends back; the ask stream has no
         * such line, which is exactly why a blip there loses the turn.
         */
        const sendEvent = (event: ProgramRunEvent): void => {
          if (event.seq <= lastSent || res.writableEnded) return;
          lastSent = event.seq;
          res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
        };

        /*
         * SUBSCRIBE FIRST, THEN REPLAY, and never await between the two.
         *
         * `subscribe` and `programRunner.events` are both synchronous, and Node
         * runs this handler to completion before the run's next `await` boundary
         * can commit anything — so there is no interleaving window at all. The
         * ORDER still matters: subscribing after the read would open one, and a
         * future edit that adds an await between them is caught by the
         * `lastSent` guard rather than by silently dropping an event.
         */
        const unsubscribe = programRunner.subscribe(runId, (event) => {
          sendEvent(event);
          // Nothing follows the terminal event, so the response ends with it
          // rather than holding a socket open on a run that is over.
          if (event.type === 'run:finished') {
            unsubscribe?.();
            if (!res.writableEnded) res.end();
          }
        });
        for (const event of programRunner.events(activeRoot(), runId, since)) sendEvent(event);

        if (!unsubscribe) {
          // Not live: the durable log is complete, so there is nothing further to
          // wait for. This is the same code path a finished run's tail takes.
          res.end();
          return;
        }
        // A disconnect drops the SUBSCRIPTION and nothing else. The run keeps
        // going; the client reconnects with `?since=<lastSeq>` and misses nothing.
        res.on('close', () => unsubscribe());
        return;
      }

      // ---- GET /api/program/runs/:runId ----
      if (tail === '' && method === 'GET') {
        const stored = programRunner.read(activeRoot(), runId);
        if (!stored) {
          sendError(res, 404, 'run not found');
          return;
        }
        const one: GetProgramRunResponse = { run: stored.run, events: stored.events };
        sendJson(res, 200, one);
        return;
      }

      sendError(res, 404, 'not found');
      return;
    }

    // ---- POST /api/ask  { question, intents?, context?, mode?, design? } ----
    // A minimal board-level "ask the AI about your system": it sends the SAME
    // deterministic structure digest used by /api/explain plus the question to the
    // CONFIGURED provider (the v6 BYO-key path — never a new provider path) and
    // returns { text }. It is an assistant OVER the real digest; it never invents
    // structure. No provider configured ⇒ a clear 400 the UI shows verbatim. The
    // key is loaded via loadAiConfig and only ever put on the wire by provider.ts
    // (same key hygiene as generate/explain); it is never logged.
    //
    // DESIGN MODE (owner report: "I just started a new file, why would I need a
    // repo?"): a from-scratch designer has no repo to attach, so a hard requireRepo
    // made the assistant unusable in Design mode. When NO repo is attached and the
    // body carries `design: { title, outline }` with a non-empty outline, the design
    // outline becomes the grounding context instead of a scan digest — same provider
    // path, same key hygiene, and a prompt that forbids scan claims and file:line
    // citations (buildDesignAskPrompt). No repo AND no design ⇒ the honest 409.
    //
    // INTENTS AS CAPABILITIES (owner: "It shouldn't be seen. It should just be
    // added as a tool, and our backend runs that way."). The composer's `+`
    // picks used to be PROSE the client concatenated onto the front of the
    // user's typed words, so the instruction genuinely WAS the user's message on
    // the wire. Now the client sends its own three things separately:
    //
    //   question : the user's typed words, and nothing else
    //   intents  : [{ id, subject?, subjectNodeId? }] — which capabilities were invoked
    //   context  : { lines } — the compiled grounded scope (budgeted client-side)
    //   mode     : 'research' | 'implementation'
    //
    // and the SERVER composes the prompt: `explain/askIntents.ts` executes each
    // intent (deterministically off the real graph where it can — blast radius
    // and component breakdown are computed by the same engines the canvas uses)
    // and `buildAskPrompt` renders the result as labelled sections ALONGSIDE the
    // question, never inside it.
    //
    // BACKWARDS COMPATIBLE BY CONSTRUCTION: every new field is optional, and each
    // composition section is skipped when empty, so a request carrying only
    // `{question}` (or `{question, design}`) produces a byte-identical prompt to
    // before — locked by ask-intents.test.ts.
    //
    // NO NATIVE TOOL-CALL ROUND TRIP, and that is deliberate rather than a gap:
    // the user already chose the capability by clicking the chip, so handing the
    // model a tool list to "choose" it would add a provider round trip and a
    // hallucination surface for nothing, and the capabilities that matter are
    // computed here, not by the model. Every provider — Anthropic api-key, any
    // openai-compatible BYO key, the hosted default gateway — therefore takes the
    // SAME server-composed path; there is no provider capability branch and so
    // no invisible degradation. See the header of `explain/askIntents.ts`.
    if (pathname === '/api/ask' && method === 'POST') {
      // requireOwner runs BEFORE requireRepo here because the repo check is now
      // conditional; repo-less ⇒ unowned ⇒ requireOwner is a no-op (same stance as
      // /api/design-suggest), so no auth behaviour changes for an attached repo.
      if (requireOwner()) return;
      if (!isJsonRequest(req)) {
        sendError(res, 415, 'expected content-type application/json');
        return;
      }
      let body: {
        question?: unknown;
        design?: unknown;
        intents?: unknown;
        context?: unknown;
        mode?: unknown;
        surface?: unknown;
        history?: unknown;
        historyDropped?: unknown;
        maxRounds?: unknown;
        permission?: unknown;
        jobMode?: unknown;
        teach?: unknown;
        teachKnown?: unknown;
        attachmentIds?: unknown;
        sessionId?: unknown;
        doneWhen?: unknown;
      };
      try {
        body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
      } catch (e) {
        sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
        return;
      }
      const question = body.question;
      if (typeof question !== 'string') {
        sendError(res, 400, 'body must include a non-empty string "question"');
        return;
      }
      const askCheckpoint = askTurnCheckpointTracker(body.sessionId, question);
      /* The done-when gate, narrowed by the same `parseAskDoneWhen` the CLI
         uses: a malformed gate — a skip with no reason above all — is a 400,
         never a silent no-gate. */
      const parsedDoneWhen = parseAskDoneWhen(body.doneWhen);
      if ('error' in parsedDoneWhen) {
        sendError(res, 400, parsedDoneWhen.error);
        return;
      }
      // A PRESENT but malformed `intents` field is a client bug, and dropping it
      // would silently answer without the capability the user asked for — 400 so
      // it is visible. An ABSENT field is the legacy shape and stays legal.
      const parsedIntents = parseAskIntents(body.intents);
      if ('error' in parsedIntents) {
        sendError(res, 400, parsedIntents.error);
        return;
      }
      // A chip-only send is a complete request (Cursor-style: the chip alone is
      // the message) — the invoked intents ARE the instruction, so an empty
      // `question` is legal exactly when at least one intent came with it. With
      // neither, there is nothing to answer, and the pre-intent 400 stands
      // byte-for-byte for every legacy caller.
      if (question.trim() === '' && parsedIntents.intents.length === 0) {
        sendError(res, 400, 'body must include a non-empty string "question"');
        return;
      }
      const askMode = parseAskMode(body.mode);
      const jobMode = parseAskJobMode(body.jobMode);
      const teach = body.teach === true;
      /* ONE CLICK, three values, closed union — anything else is absent rather
         than an error, because a client sending a value we do not know is not a
         reason to fail a lesson. A fourth value is deliberately unreachable: see
         PostAskRequest.teachKnown. */
      const teachKnown =
        body.teachKnown === 'new' || body.teachKnown === 'used-it' || body.teachKnown === 'ship-it'
          ? body.teachKnown
          : undefined;
      /* ONE assembly of a teach turn, shared with /api/ask/stream -- see
         server/teachTurn.ts. Built here so the lesson exists BEFORE the first
         turn rather than after it. */
      const askTurn = beginTeachTurn({
        teach,
        question,
        threadIdFromRequest: (body as { threadId?: unknown }).threadId,
        sessionsRoot: sessionsRoot(),
        ...(currentGraph ? { graph: currentGraph } : {}),
        ...(teachKnown ? { teachKnown } : {}),
      });
      /*
       * THE CARRY'S KEY. The RESOLVED thread, which includes the active-session
       * fallback -- `askTurn.threadId` is deliberately request-only, and using
       * it here would give every no-threadId client a permanently empty carry.
       *
       * NOT `body.sessionId`: on this route that is the AUTHENTICATED USER, and
       * keying a conversation's material on the person would hand one
       * conversation's files and lists to another of theirs.
       */
      const carryThreadId = resolveAskThreadId(
        (body as { threadId?: unknown }).threadId,
        sessionsRoot(),
      ).threadId;
      const carriedIn = readCarry(carryThreadId);
      const scopeLines = parseAskContextLines(body.context);
      // SURFACE CONTEXT (owner report E2/G5: "I sent that workbook flow thing,
      // and it looks confusing itself"). Until now the only thing the assistant
      // knew about the user's screen was the graph selection, so "this workflow"
      // asked on the Agents surface was resolved against the only noun the
      // server had — the repo — and answered "the digest contains no workflow
      // definitions". The composer now carries WHICH surface is active and what
      // is focused on it. Absent field ⇒ nothing added anywhere; present but
      // malformed ⇒ 400, same stance as `intents`, because silently dropping it
      // brings the reported bug straight back.
      const parsedSurface = parseAskSurface(body.surface);
      if ('error' in parsedSurface) {
        sendError(res, 400, parsedSurface.error);
        return;
      }
      const surface = parsedSurface.surface;
      const deictic = isDeicticSurfaceQuestion(question);
      // DETERMINISTIC SURFACE ANSWER — "what is this workflow?" asked while a
      // Program is on the Agents canvas is answered FROM THAT PROGRAM, before
      // any repo requirement and before any provider call: it needs no scan, no
      // key and no network (local-first), and it cannot drift from the canvas.
      // Skipped whenever the user attached a chip — those are instructions that
      // genuinely want the model, and answering them from a step list would be
      // ignoring what they asked for.
      if (parsedIntents.intents.length === 0) {
        const surfaceAnswer = answerSurfaceQuestion(surface, question);
        if (surfaceAnswer) {
          // `source` is the honest marker: this text came off the surface, not
          // from a provider, so nothing was metered and nothing was generated.
          sendJson(res, 200, { text: surfaceAnswer, source: 'surface' });
          return;
        }
      }
      // A LESSON REQUEST WITH NO SUBJECT is refused BEFORE any provider call —
      // see server/lessonState.ts:subjectlessRefusal and
      // docs/research/design-the-subjectless-lesson.md. Without it the model
      // fills the gap with a paraphrase of the architecture digest: confident
      // prose, no concept, no picture, and no sign that no subject was found.
      // `source: 'lesson'` is the honest marker, as `surface` is above: nothing
      // was metered and nothing was generated.
      const askRefusal = askTurn.refusal();
      if (askRefusal !== undefined) {
        sendJson(res, 200, { text: askRefusal, source: 'lesson' });
        return;
      }
      // The design payload is only honoured when it can actually ground an answer:
      // an object with a non-empty outline string. Anything else is ignored, so a
      // junk/empty `design` still falls through to the honest no-repo 409.
      const rawDesign = body.design;
      const design: DesignAskContext | undefined =
        rawDesign !== null &&
        typeof rawDesign === 'object' &&
        typeof (rawDesign as { outline?: unknown }).outline === 'string' &&
        (rawDesign as { outline: string }).outline.trim() !== ''
          ? {
              title:
                typeof (rawDesign as { title?: unknown }).title === 'string'
                  ? (rawDesign as { title: string }).title
                  : '',
              outline: (rawDesign as { outline: string }).outline,
              ...((rawDesign as { proposeArchitecture?: unknown }).proposeArchitecture === true
                ? { proposeArchitecture: true }
                : {}),
            }
          : undefined;
      const repoAttached = repoRoot !== null && currentGraph !== null;
      const designMode = !repoAttached && design !== undefined;
      // Not design mode ⇒ the normal repo requirement (and its honest 409) stands.
      if (!designMode && requireRepo(res)) return;
      const cfg = loadAiConfig();
      if (!cfg) {
        sendError(res, 400, 'AI provider not configured — connect your AI key in Settings to chat');
        return;
      }
      const digest = designMode ? undefined : buildDigest(currentGraph!, buildTree(activeRoot()));
      const historyTurns = parseAskHistoryTurns(body.history);
      const historyDropped =
        typeof body.historyDropped === 'number' && Number.isFinite(body.historyDropped)
          ? Math.max(0, Math.floor(body.historyDropped))
          : 0;
      const historyLines = renderAskHistorySection(historyTurns, 20, { droppedTurns: historyDropped });
      /*
       * THE REPOSITORY'S OWN RULES. Every competitor reads a project
       * instruction file; this product read none, while carrying AGENTS.md and
       * CLAUDE.md at its own root written expressly to be read by an
       * assistant. Read per request rather than cached, so editing the file
       * takes effect on the next question rather than the next restart.
       */
      /*
       * ONLY WHEN A REPOSITORY IS ATTACHED. `activeRoot()` THROWS when none is
       * — and `/api/ask` legitimately answers without one on the design path,
       * which this turned into a 500. Instructions belong to a repository, so
       * having no repository is simply having no instructions.
       */
      /*
       * AND ONLY WHEN THE REPOSITORY IS TRUSTED. `renderTrustedInstructionsSection`
       * asks that question; this line used to call the renderer directly, which
       * meant attaching a repository was consenting to take its orders. The text
       * is still READABLE — `GET /api/repo-trust` serves it to the surface as
       * content — it just does not enter the belt as instruction.
       */
      const instructionLines = renderTrustedInstructionsSection(repoRoot);
      /*
       * ATTACHMENTS THE TURN NAMED. Ids only on the wire, never content: the
       * text is already on disk, and re-sending it every turn would put the
       * same log through the request body once per follow-up.
       *
       * An id that names nothing is SKIPPED rather than 400ing the whole turn.
       * A sweep can remove an attachment the client still has a chip for, and
       * refusing the question because one piece of evidence aged out would
       * lose the question too.
       */
      const attachmentLines = ((): string[] => {
        const root = repoRoot;
        if (root === null || !Array.isArray(body.attachmentIds)) return [];
        const found = (body.attachmentIds as unknown[])
          .map((id) => {
            const record = readAttachment(root, String(id));
            const text = readAttachmentText(root, String(id));
            return record && text !== null
              ? { name: record.name, text, truncated: record.truncated }
              : null;
          })
          .filter((a): a is { name: string; text: string; truncated: boolean } => a !== null);
        return renderAttachmentSection(found);
      })();
      const skillLines = buildSkillLines(question);
      /*
       * THE WINDOW A LOCAL MODEL WILL ACTUALLY RUN, probed once per ask.
       *
       * Only for the local Ollama profile: for a hosted provider we neither know
       * nor control the window, and reporting "unknown" on every cloud turn would
       * be a warning nobody reads. The probe is a bounded loopback call that fails
       * to null, so a slow or absent Ollama costs this turn its timeout and
       * nothing else — and null is a real answer here, meaning the Modelfile sets
       * no num_ctx so the server default silently decides.
       */
      const localContext = isLocalOllama(cfg.provider, cfg.baseUrl)
        ? { window: await probeEffectiveContext(cfg.baseUrl!, cfg.model, fetch) }
        : undefined;
      // Item 1.3 — a Stop (or a closed tab) must reach the provider call.
      const askAbort = requestAbort(res);
      try {
        /*
         * A SINK ONLY FOR WHAT THE LESSON NEEDS TO KNOW.
         *
         * This route does not stream, so it passed no observer and could see a
         * visual only as `result.diagram`. The bench calls the pipeline directly
         * WITH an observer and counts `chart:proposal`, so the two disagreed
         * about whether a turn taught: a turn that drew a chart advanced the
         * lesson in the bench and did not in the product. A bench that measures a
         * more generous rule than the product ships is measuring the wrong
         * product.
         */
        let chartsThisTurn = 0;
        const result = await runAskPipeline({
          question,
          /* The registered wiring. `readCarry` returns undefined when the flag
             is off, so this is exactly today's input until it is turned on. */
          ...(carriedIn ? { carry: carriedIn.carry, turnIndex: carriedIn.turnIndex } : {}),
          ...(localContext ? { localContext } : {}),
          intents: parsedIntents.intents,
          scopeLines,
          surface,
          deictic,
          design,
          designMode,
          askMode,
          jobMode,
          teach,
          /*
           * THE LESSON, KEYED BY THE CONVERSATION THIS ASK BELONGS TO.
           *
           * `TeachTurnContext.concept` was read by the belt and written by
           * nobody, because this handler could not say which conversation a turn
           * was part of — and I reported that as "/ask has no session identity",
           * which was wrong. `PUT /api/sessions/active` has been persisting
           * `SessionIndex.activeId` all along; nothing here read it. The name
           * `sessionId` in this file is the AUTHENTICATED USER, which is what
           * sent me looking for something that already existed.
           *
           * An explicit `threadId` on the request wins; the workspace's active
           * session is the fallback, which is what makes this work today with no
           * client change.
           */
          ...askTurn.contextField(),
          instructionLines,
          attachmentLines,
          historyLines,
          /* Clamped inside the pipeline by `clampAskRounds`, so a hostile or
             mistaken number cannot buy unbounded provider calls. Passed raw
             here on purpose: one clamp, in one place, is what keeps the
             enforced cap and the cap quoted back to the user identical. */
          maxRounds: typeof body.maxRounds === 'number' ? body.maxRounds : undefined,
          doneWhen: parsedDoneWhen.doneWhen,
          /* Modes the client may send. Unknown values fall through to propose
             behaviour (stage only) rather than failing the ask. */
          permission:
            body.permission === 'plan' ||
            body.permission === 'propose' ||
            body.permission === 'autoEdit' ||
            body.permission === 'full'
              ? body.permission
              : undefined,
          skillSummaryLines: skillLines.summaryLines,
          skillBodyLines: skillLines.bodyLines,
          surfaceAnswer: undefined,
          graph: designMode ? null : currentGraph,
          digest,
          cfg,
          resolveReadable: resolveReadablePath,
          applyProposedFiles: designMode
            ? undefined
            : (files) => applyAskProposedFiles(files, askCheckpoint.trackWrite),
          repoRoot: designMode ? null : repoRoot,
          signal: askAbort.signal,
          callProvider: async (c, prompt, _onDelta, opts) => {
            const permission =
              body.permission === 'plan' ||
              body.permission === 'propose' ||
              body.permission === 'autoEdit' ||
              body.permission === 'full'
                ? body.permission
                : undefined;
            /* The native schemas are the same belt the prompt hint renders, so
               they carry the teach narrowing too — a schema for a tool the
               pipeline will refuse is the belt lying in the one channel a
               native-tool model actually reads. */
            const tools =
              designMode || repoRoot === null
                ? undefined
                : openaiAskToolDefinitions(
                    askToolsForJobMode(jobMode, permission, {
                      teach: isTeachTurn({ teach, question }),
                    }),
                  );
            /*
             * A TEACH TURN DOES NOT THINK OUT LOUD, because the bench does not
             * and the two must run the same configuration or the bench measures
             * nothing about the product.
             *
             * MEASURED on the seat check (docs/research/seat-check-2026-09-05.md):
             * granite42-hermes thinks by default, and on the same prompt that
             * costs 2.8s and 299 completion tokens against 0.7s and 75 with
             * reasoning off -- four times the cost and latency for an answer of
             * the same length. Across four rounds of a real-repo turn that is
             * the difference between finishing and hitting the wall-clock
             * budget: a person asking to be taught got 337 seconds and the
             * deadline message, no lesson and no chart.
             *
             * SCOPED TO THE TEACH TURN and to a value the caller has not set.
             * This is not a default chosen for every user on one measurement --
             * it is the bench's own configuration reaching the path the bench
             * claims to describe. An explicit reasoningEffort in config wins,
             * here as everywhere.
             */
            const forTurn = askTurn.configFor(c);
            const metered = await callProviderMeteredWithUsage(
              forTurn,
              prompt,
              identity,
              askAbort.signal,
              undefined,
              tools,
              opts?.cacheBreakpointChars,
            );
            return {
              text: metered.text,
              usage: metered.usage,
              ...(metered.toolRequests?.length ? { toolRequests: metered.toolRequests } : {}),
            };
          },
        }, (e) => {
          if (e.type === 'chart:proposal') chartsThisTurn += 1;
        });
        /*
         * THE LESSON, WRITTEN BEFORE THE ANSWER GOES OUT.
         *
         * A lesson has to be CREATED on the opening turn or the queue never
         * exists and every later turn reads an empty slot — which is exactly the
         * state the belt was in. It advances only when the turn actually taught:
         * a visual AND a closing check, the grader's own two hard rules, so a
         * bounced turn re-teaches the same concept instead of silently skipping
         * it.
         *
         * `endsWithCheck`, not a trailing question mark: 15 of 31 measured
         * closing questions were clarifying offers the contract bans, and every
         * one satisfied the old test.
         */
        writeCarry(carryThreadId, result.carryOut);
        askTurn.finish({
          text: result.text,
          ...(result.diagram === undefined ? {} : { diagram: result.diagram }),
          chartsThisTurn,
          /* Carried so the NEXT turn can reveal it with its arrow. Both routes
             pass it, because a rule that lives in two handlers is one rule until
             it is measured — and this one was measured on the plain ask. */
          ...(result.openPrediction === undefined ? {} : { openPrediction: result.openPrediction }),
        });
        const payload: Record<string, unknown> = { text: result.text };
        if (result.diagram) payload.diagram = result.diagram;
        if (result.unsupportedIntents?.length) payload.unsupportedIntents = result.unsupportedIntents;
        if (result.usage) payload.usage = result.usage;
        if (result.source) payload.source = result.source;
        // ITEM 1.1's WIRING. The pipeline computes coverage and `resultPayload`
        // already puts it on the SSE `result` event; this hand-built JSON payload
        // was the one place it was dropped, so the buffered route answered without
        // the one claim a terminal agent structurally cannot make. Copied, never
        // recomputed — the two routes must not be able to disagree.
        if (result.coverage) payload.coverage = result.coverage;
        /* AND `claims` IS THE SECOND ONE, dropped the same way and for longer. The
           pipeline runs checkAnswerClaims against the scanned graph and attaches the
           result ONLY when it has something to say, so its presence means "look at
           this". resultPayload() puts it on the SSE result event; this hand-built
           payload did not, so the buffered route answered with the fabrication and no
           sign that the product had already noticed. Copied, never recomputed. */
        if (result.claims) payload.claims = result.claims;
        /* AND `premise` IS THE THIRD, caught the same night it was written. It is
           the mirror of `claims`: that one checks what the MODEL said, this one
           checks what the USER said, and it exists because a false premise steered
           a whole turn while only its consequence was examined. A verdict no caller
           can observe is a verdict that cannot be made to fail, so it rides here as
           a machine-readable field — no prose, no tone taken, which keeps the
           surfacing decision the owner's. Copied, never recomputed. */
        if (result.premise) payload.premise = result.premise;
        /* AND `contextFit` — whether the prompt fit the window the local model
           actually runs. Same rule as the three above: on both routes or on
           neither, copied and never recomputed. */
        if (result.contextFit) payload.contextFit = result.contextFit;
        /* AND `verify` WAS THE FOURTH — the done-when receipt, on the streaming
           route and undeclared, so this file's own rule ("a field absent from the
           buffered payload and not named as streaming-only is a bug, not a choice")
           had been quietly broken. A buffered caller that just wrote files has no
           transcript to watch, so it needs the gate result MORE than a streaming
           one, not less. */
        if (result.verify) payload.verify = result.verify;
        sendJson(res, 200, payload);
      } catch (e) {
        if (isRequestAbortedError(e)) {
          sendAborted(res);
          return;
        }
        if (e instanceof ProviderError) {
          const errBody: Record<string, unknown> = { error: e.message };
          if (e.body !== undefined) errBody.providerResponse = e.body;
          sendJson(res, e.httpStatus ?? 502, errBody);
          return;
        }
        throw e;
      } finally {
        askAbort.dispose();
      }
      return;
    }

    if (pathname === '/api/ask/stream' && method === 'POST') {
      if (requireOwner()) return;
      if (!isJsonRequest(req)) {
        sendError(res, 415, 'expected content-type application/json');
        return;
      }
      /*
       * PARITY WITH `/api/ask`, AND IT IS NOT COSMETIC.
       *
       * These four fields were read by the OTHER ask handler and not by this
       * one - and the client only ever posts here (`askClient.ts:29`). So four
       * separately-shipped, separately-tested features did nothing at all for
       * every real user: a pasted attachment was ignored, choosing Plan
       * changed nothing, the per-request round cap could not be lowered, and
       * this repository's own AGENTS.md was never read on any turn a person
       * could produce.
       *
       * `ask-stream-parity.test.ts` now compares the two declarations directly,
       * so the NEXT field to drift fails a test rather than quietly doing
       * nothing.
       */
      let body: {
        question?: unknown;
        design?: unknown;
        intents?: unknown;
        context?: unknown;
        mode?: unknown;
        surface?: unknown;
        history?: unknown;
        historyDropped?: unknown;
        jobMode?: unknown;
        teach?: unknown;
        teachKnown?: unknown;
        maxRounds?: unknown;
        permission?: unknown;
        attachmentIds?: unknown;
        sessionId?: unknown;
        doneWhen?: unknown;
      };
      try {
        body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
      } catch (e) {
        sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
        return;
      }
      const question = body.question;
      if (typeof question !== 'string') {
        sendError(res, 400, 'body must include a non-empty string "question"');
        return;
      }
      /*
       * Request-scoped on purpose: the "first write this turn" latch lives in
       * this closure and nowhere else, so two concurrent turns on the same
       * session each take their own restore point and a module-level flag
       * cannot leave the second turn without one.
       */
      const askCheckpoint = askTurnCheckpointTracker(body.sessionId, question);
      /* The done-when gate, narrowed by the same `parseAskDoneWhen` the CLI
         uses: a malformed gate — a skip with no reason above all — is a 400,
         never a silent no-gate. */
      const parsedDoneWhen = parseAskDoneWhen(body.doneWhen);
      if ('error' in parsedDoneWhen) {
        sendError(res, 400, parsedDoneWhen.error);
        return;
      }
      const parsedIntents = parseAskIntents(body.intents);
      if ('error' in parsedIntents) {
        sendError(res, 400, parsedIntents.error);
        return;
      }
      if (question.trim() === '' && parsedIntents.intents.length === 0) {
        sendError(res, 400, 'body must include a non-empty string "question"');
        return;
      }
      const askMode = parseAskMode(body.mode);
      const jobMode = parseAskJobMode(body.jobMode);
      const teach = body.teach === true;
      /* ONE CLICK, three values, closed union — anything else is absent rather
         than an error, because a client sending a value we do not know is not a
         reason to fail a lesson. A fourth value is deliberately unreachable: see
         PostAskRequest.teachKnown. */
      const teachKnown =
        body.teachKnown === 'new' || body.teachKnown === 'used-it' || body.teachKnown === 'ship-it'
          ? body.teachKnown
          : undefined;
      const askPermission =
        body.permission === 'plan' ||
        body.permission === 'propose' ||
        body.permission === 'autoEdit' ||
        body.permission === 'full'
          ? body.permission
          : undefined;
      /* ONE assembly of a teach turn, shared with /api/ask -- see
         server/teachTurn.ts. This route had NONE of it: no thread resolution,
         no lesson read or write, no concept in the belt -- and it is the route
         the web client drives, so no real user turn ever had a lesson. */
      const askTurn = beginTeachTurn({
        teach,
        question,
        threadIdFromRequest: (body as { threadId?: unknown }).threadId,
        sessionsRoot: sessionsRoot(),
        ...(currentGraph ? { graph: currentGraph } : {}),
        ...(teachKnown ? { teachKnown } : {}),
      });
      /*
       * THE CARRY'S KEY. The RESOLVED thread, which includes the active-session
       * fallback -- `askTurn.threadId` is deliberately request-only, and using
       * it here would give every no-threadId client a permanently empty carry.
       *
       * NOT `body.sessionId`: on this route that is the AUTHENTICATED USER, and
       * keying a conversation's material on the person would hand one
       * conversation's files and lists to another of theirs.
       */
      const carryThreadId = resolveAskThreadId(
        (body as { threadId?: unknown }).threadId,
        sessionsRoot(),
      ).threadId;
      const carriedIn = readCarry(carryThreadId);
      const scopeLines = parseAskContextLines(body.context);
      const parsedSurface = parseAskSurface(body.surface);
      if ('error' in parsedSurface) {
        sendError(res, 400, parsedSurface.error);
        return;
      }
      const surface = parsedSurface.surface;
      const deictic = isDeicticSurfaceQuestion(question);
      if (parsedIntents.intents.length === 0) {
        const surfaceAnswer = answerSurfaceQuestion(surface, question);
        if (surfaceAnswer) {
          const runId = crypto.randomUUID();
          const startedAt = new Date().toISOString();
          const askTrace: Array<Record<string, unknown>> = [];
          startSse(res);
          const surfaceInstructionHash = computeAskInstructionHash({
            designMode: false,
            repoRoot,
            jobMode,
          teach,
          ...askTurn.contextField(),
            permission: askPermission,
            surface,
            question,
          });
          writeSseEvent(res, {
            type: 'trajectory:start',
            runId,
            instructionHash: surfaceInstructionHash,
          });
          const surfaceResult = { type: 'result', text: surfaceAnswer, source: 'surface' } as AskStreamEvent;
          writeSseEvent(res, surfaceResult);
          askTrace.push(surfaceResult as Record<string, unknown>);
          res.end();
          if (repoRoot !== null) {
            try {
              writeTrajectory(repoRoot, {
                version: 1,
                runId,
                kind: 'ask',
                startedAt,
                finishedAt: new Date().toISOString(),
                question,
                askTrace,
                askTerminal: { type: 'result', text: surfaceAnswer, source: 'surface' },
                graph: buildAskTrajectoryGraph(runId, askTrace),
              });
            } catch {
              /* trajectory persistence is best-effort; the stream already succeeded */
            }
          }
          return;
        }

      // THE SAME RULE, AND IT LIVES ON THE TeachTurn SO IT IS ONE RULE. A rule
      // implemented at two call sites is one rule until it is measured, and
      // these two handlers have drifted before. Refused before any provider
      // call; the stream carries the same `source: 'lesson'` marker.
      const streamRefusal = askTurn.refusal();
      if (streamRefusal !== undefined) {
        /* No askTrace here: it is scoped to the surface block above, and a
           refusal has no trajectory to record — nothing ran. The JSON handler
           writes none either, so the two stay identical. */
        writeSseEvent(res, { type: 'result', text: streamRefusal, source: 'lesson' } as AskStreamEvent);
        res.end();
        return;
      }
      }
      const rawDesign = body.design;
      const design: DesignAskContext | undefined =
        rawDesign !== null &&
        typeof rawDesign === 'object' &&
        typeof (rawDesign as { outline?: unknown }).outline === 'string' &&
        (rawDesign as { outline: string }).outline.trim() !== ''
          ? {
              title:
                typeof (rawDesign as { title?: unknown }).title === 'string'
                  ? (rawDesign as { title: string }).title
                  : '',
              outline: (rawDesign as { outline: string }).outline,
              ...((rawDesign as { proposeArchitecture?: unknown }).proposeArchitecture === true
                ? { proposeArchitecture: true }
                : {}),
            }
          : undefined;
      const repoAttached = repoRoot !== null && currentGraph !== null;
      const designMode = !repoAttached && design !== undefined;
      if (!designMode && requireRepo(res)) return;
      const cfg = loadAiConfig();
      if (!cfg) {
        sendError(res, 400, 'AI provider not configured — connect your AI key in Settings to chat');
        return;
      }
      const digest = designMode ? undefined : buildDigest(currentGraph!, buildTree(activeRoot()));
      const historyTurns = parseAskHistoryTurns(body.history);
      const historyDropped =
        typeof body.historyDropped === 'number' && Number.isFinite(body.historyDropped)
          ? Math.max(0, Math.floor(body.historyDropped))
          : 0;
      const historyLines = renderAskHistorySection(historyTurns, 20, { droppedTurns: historyDropped });
      /*
       * THE REPOSITORY'S OWN INSTRUCTIONS, on the route the product uses.
       *
       * `readRepoInstructions` and `renderInstructionsSection` shipped with 13
       * tests and were wired into `/api/ask` only. Rank 26's own statement -
       * "THIS REPOSITORY IS ITS OWN BEST EXAMPLE ... nothing in the product
       * ever opened either one" - stayed true after the item was marked done,
       * because the product does not call that route.
       *
       * Guarded on an attached repository for the same reason the other
       * handler is: `activeRoot()` throws when there is none, and the design
       * path legitimately answers without one.
       */
      /* Trust-gated, exactly as on `/api/ask` — see the note there. The two
         call sites are the only ones, and `repo-trust.test.ts` asserts this
         file never reaches `renderInstructionsSection` directly again. */
      const instructionLines = renderTrustedInstructionsSection(repoRoot);

      /*
       * ATTACHMENTS. Ids only on the wire; the text is already on disk. An id
       * that resolves to nothing is SKIPPED rather than failing the turn - a
       * sweep can remove an attachment the client still shows a chip for, and
       * losing the question because a piece of evidence aged out is the worse
       * failure.
       */
      const attachmentLines = ((): string[] => {
        const root = repoRoot;
        if (root === null || !Array.isArray(body.attachmentIds)) return [];
        const found = (body.attachmentIds as unknown[])
          .map((id) => {
            const record = readAttachment(root, String(id));
            const text = readAttachmentText(root, String(id));
            return record && text !== null
              ? { name: record.name, text, truncated: record.truncated }
              : null;
          })
          .filter((a): a is { name: string; text: string; truncated: boolean } => a !== null);
        return renderAttachmentSection(found);
      })();

      const skillLines = buildSkillLines(question);
      const runId = crypto.randomUUID();
      const startedAt = new Date().toISOString();
      const askTrace: Array<Record<string, unknown>> = [];
      // Item 1.3 — on a streamed ask the reader IS the response socket, so its
      // close is the cancellation signal. Registered before the first frame so a
      // client that disconnects immediately is still observed.
      const askAbort = requestAbort(res);
      /*
       * THE TURN IS WRITTEN DOWN AS IT HAPPENS, so losing the socket does not
       * lose the answer.
       *
       * It would be reasonable to think the tradeoff here is "keep going after
       * a disconnect and burn spend on an abandoned tab". It is not.
       * `requestAbort` builds a signal from the socket close and hands it to
       * the provider layer and the ask pipeline. Stop tears down the outbound
       * provider fetch, stops the tool loop, and the metering race ensures an
       * aborted turn is not charged.
       *
       * Absent a repository there is nowhere to write, and the design path
       * legitimately answers without one - so the log is optional and every
       * use of it is guarded. A turn that cannot be recorded still streams.
       */
      const turnLog =
        repoRoot === null
          ? null
          : (() => {
              try {
                return openAskTurnLog(repoRoot, runId);
              } catch {
                /* A statistic-grade failure must never fail the turn. */
                return null;
              }
            })();
      startSse(res);
      /*
       * COMMIT BEFORE YIELD. The append happens first and the socket write
       * second, so an event a client saw is always an event on disk. The other
       * order produces the one unrecoverable case: a client that received
       * event 7 reconnects asking for 8 and is told the turn only reached 6.
       */
      const record = (event: AskStreamEvent): void => {
        let seq: number | null = null;
        try {
          seq = turnLog?.append(event as unknown as Record<string, unknown>).seq ?? null;
        } catch {
          /* Disk full, or the directory went away. Stream anyway - the live
             reader is the one actually waiting on this. */
        }
        writeSseEvent(res, event, seq);
      };

      /*
       * `trajectory:start` IS STREAMED AND LOGGED BUT NEVER TRACED.
       *
       * It is a CONTROL event - it announces the run id so a client knows what
       * to resume - and `askTrace` is the record of what the assistant
       * actually did. `trajectory-capture.test.ts` asserts every askTrace entry
       * was really streamed as a payload event and excludes this one by name,
       * so tracing it turns that suite red. It goes in the DURABLE log, though,
       * because a client replaying a turn from scratch needs the run id as much
       * as a live one does.
       */
      const instructionHash = computeAskInstructionHash({
        designMode,
        repoRoot: designMode ? null : repoRoot,
        jobMode,
        teach,
        permission: askPermission,
        surface,
        question,
      });
      record({ type: 'trajectory:start', runId, instructionHash });
      /*
       * THE ONE GENUINELY NEW MEASUREMENT IN THE RUN RECEIPT. Every provider
       * call this turn reports how many retries `requestModelTextWithUsage`
       * took before answering; they are summed here, per request, and land
       * in `.sequence/receipts/<runId>.json` via `finalizeTrajectory`. Stays
       * `undefined` until a call reports — a receipt must not say `0` about
       * a turn whose provider path never counted.
       */
      let providerRetriesThisTurn: number | undefined;

      const emit = (event: AskStreamEvent): void => {
        record(event);
        askTrace.push(event as Record<string, unknown>);
      };
      const finalizeTrajectory = (
        terminal: { type: 'result' | 'error' } & Record<string, unknown>,
        /** The pipeline's return on an ok terminal; an error terminal has none. */
        pipelineResult?: AskPipelineResult,
      ): void => {
        if (repoRoot === null) return;
        /*
         * THE TURN'S ROLLBACK POINT IS IN SCOPE HERE: `askCheckpoint.rollbackPoint()`
         * is the `seq` of the checkpoint taken before this turn's first agent
         * write, or `undefined` when the turn wrote nothing (or came without a
         * session id). It is deliberately NOT written into the trajectory —
         * `writeTrajectory`'s record has no field for it and nothing reads one,
         * and this repo does not add fields nothing reads. The run receipt
         * below is what reads it.
         */
        const finishedAt = new Date().toISOString();
        /*
         * THE CHANGE RECEIPT (audit G3), written FIRST and in its own guard so
         * a trajectory failure cannot take it down, and vice versa. Every
         * terminal gets one — an error turn that wrote files before the
         * provider died is the turn a reader most needs a receipt for. Best
         * effort like the trajectory: a receipt that cannot be written is one
         * stderr line, never a failed turn the client already saw succeed.
         */
        try {
          writeRunReceipt(
            repoRoot,
            buildRunReceipt({
              runId,
              startedAt,
              finishedAt,
              terminal: terminal.type,
              ...(typeof terminal.error === 'string' ? { error: terminal.error } : {}),
              events: askTrace,
              ...(pipelineResult ? { result: pipelineResult } : {}),
              instructionHash,
              cfg,
              ...(askPermission !== undefined ? { permissionMode: askPermission } : {}),
              ...(providerRetriesThisTurn !== undefined ? { providerRetries: providerRetriesThisTurn } : {}),
              ...(askCheckpoint.rollbackPoint() !== undefined ? { rollbackPoint: askCheckpoint.rollbackPoint() } : {}),
            }),
          );
        } catch (e) {
          process.stderr.write(`sequence: run receipt for ${runId} not written: ${(e as Error).message}\n`);
        }
        try {
          const askTerminal: { type: 'result' | 'error' } & Record<string, unknown> = { ...terminal };
          if (askTerminal.type === 'result' && typeof askTerminal.text === 'string' && askTerminal.text.length > 2000) {
            askTerminal.text = askTerminal.text.slice(0, 2000);
          }
          const askMetrics = askMetricsFromTerminal(askTerminal);
          writeTrajectory(repoRoot, {
            version: 1,
            runId,
            kind: 'ask',
            startedAt,
            finishedAt,
            question,
            askTrace,
            askTerminal,
            ...(askMetrics ? { askMetrics } : {}),
            graph: buildAskTrajectoryGraph(runId, askTrace),
          });
        } catch {
          /* trajectory persistence is best-effort; the stream already succeeded */
          return;
        }
        /*
         * THE LEARNING LOOP'S ONLY AUTOMATIC CALLER. A failed turn is the
         * evidence `planRefineFromTrajectories` reads, and until this hook
         * nothing ran the planner after one (audit G4: five /api/harness/*
         * routes, no caller). It runs only on an ERROR terminal — a successful
         * turn is skill-distill material, not a failure pattern — and only
         * after `writeTrajectory` returned, so the run that just failed is in
         * the set it reads. Fire-and-forget: the stream has already ended and
         * nothing on the request path waits for it. It PROPOSES under
         * `.sequence/refinements/`; the target is written only by the
         * verify-gated accept route. `runLearningLoop` never throws, so the
         * `.catch` is for a rejection the contract says cannot happen.
         */
        if (terminal.type === 'error') {
          void runLearningLoop(repoRoot)
            .then((outcome) => {
              if (outcome.error) {
                process.stderr.write(`sequence: learning loop after ${runId}: ${outcome.error}\n`);
              }
            })
            .catch((e) => {
              process.stderr.write(`sequence: learning loop after ${runId} threw: ${(e as Error).message}\n`);
            });
        }
      };
      try {
        const pipelineResult = await runAskPipeline(
          {
            question,
            /* See the buffered route above: undefined until the flag is on. */
            ...(carriedIn ? { carry: carriedIn.carry, turnIndex: carriedIn.turnIndex } : {}),
            intents: parsedIntents.intents,
            scopeLines,
            surface,
            deictic,
            design,
            designMode,
            askMode,
            jobMode,
          teach,
          ...askTurn.contextField(),
            /* The four that this route dropped. See the body declaration
               above for what each one being missing actually did. */
            instructionLines,
            attachmentLines,
            permission: askPermission,
            /* Clamped inside the pipeline by `clampAskRounds`, so a hostile or
               mistaken number cannot buy unbounded provider calls. Passed raw
               for the same reason the other handler does: one clamp in one
               place keeps the enforced cap and the quoted cap identical. */
            maxRounds: typeof body.maxRounds === 'number' ? body.maxRounds : undefined,
            doneWhen: parsedDoneWhen.doneWhen,
            historyLines,
            skillSummaryLines: skillLines.summaryLines,
            skillBodyLines: skillLines.bodyLines,
            surfaceAnswer: undefined,
            graph: designMode ? null : currentGraph,
            digest,
            cfg,
            resolveReadable: resolveReadablePath,
            applyProposedFiles: designMode
              ? undefined
              : (files) => applyAskProposedFiles(files, askCheckpoint.trackWrite),
            repoRoot: designMode ? null : repoRoot,
            signal: askAbort.signal,
            callProvider: async (c, prompt, onDelta, opts) => {
              const tools =
                designMode || repoRoot === null
                  ? undefined
                  : openaiAskToolDefinitions(
                      askToolsForJobMode(jobMode, askPermission, {
                        teach: isTeachTurn({ teach, question }),
                      }),
                    );
              const metered = await callProviderMeteredWithUsage(
                askTurn.configFor(c),
                prompt,
                identity,
                askAbort.signal,
                onDelta,
                tools,
                opts?.cacheBreakpointChars,
              );
              if (metered.retries !== undefined) {
                providerRetriesThisTurn = (providerRetriesThisTurn ?? 0) + metered.retries;
              }
              return {
                text: metered.text,
                usage: metered.usage,
                ...(metered.toolRequests?.length ? { toolRequests: metered.toolRequests } : {}),
              };
            },
          },
          emit,
        );
        /* THE LESSON, WRITTEN BEFORE THE READER IS RELEASED. Counted off the
           trace this route already keeps, so a chart the pipeline derived counts
           as the turn's visual exactly as it does on /api/ask. */
        writeCarry(carryThreadId, pipelineResult.carryOut);
        askTurn.finish({
          text: pipelineResult.text,
          ...(pipelineResult.diagram === undefined ? {} : { diagram: pipelineResult.diagram }),
          chartsThisTurn: askTrace.filter((e) => e.type === 'chart:proposal').length,
          ...(pipelineResult.openPrediction === undefined
            ? {}
            : { openPrediction: pipelineResult.openPrediction }),
        });
        res.end();
        const resultEvent = askTrace.find((e) => e.type === 'result') as
          | { type: 'result'; text: string; [k: string]: unknown }
          | undefined;
        if (resultEvent) finalizeTrajectory(resultEvent, pipelineResult);
      } catch (e) {
        if (isRequestAbortedError(e)) {
          // The reader is gone; there is nobody to send an error frame to. The
          // trajectory still records the turn as ABORTED rather than leaving a
          // run with a start and no ending — a cancelled turn is a fact about
          // what happened, not an absence of one.
          const abortedEvent = { type: 'error' as const, error: 'aborted by the client' };
          if (!res.writableEnded) {
            emit(abortedEvent);
            res.end();
          } else {
            askTrace.push(abortedEvent as unknown as Record<string, unknown>);
          }
          finalizeTrajectory(abortedEvent);
          return;
        }
        if (e instanceof ProviderError) {
          const errorEvent: AskStreamEvent = {
            type: 'error',
            error: e.message,
            ...(e.body !== undefined ? { providerResponse: e.body } : {}),
            httpStatus: e.httpStatus ?? 502,
            /* Carried through UNCHANGED from the throw site, which is the only
               place that knows whether this failure has a route out. Spread
               conditionally so an ordinary outage does not claim a fix it does
               not have. */
            ...(e.fix !== undefined ? { fix: e.fix } : {}),
          };
          emit(errorEvent);
          res.end();
          /* The call that exhausted its retries never returned a count; the
             provider layer pins it on the error instead (see the retry loop
             in `requestModelTextWithUsage`). Summed here so the error
             receipt counts the retries the turn actually spent. */
          const failedRetries = (e as { retries?: unknown }).retries;
          if (typeof failedRetries === 'number') {
            providerRetriesThisTurn = (providerRetriesThisTurn ?? 0) + failedRetries;
          }
          finalizeTrajectory(errorEvent);
          return;
        }
        throw e;
      } finally {
        askAbort.dispose();
      }
      return;
    }

    /*
     * REMOVED (r179, feature honesty): POST /api/diff, GET|PUT /api/spec and
     * GET|PUT /api/state.
     *
     * All three were registered but UNREACHABLE from the product: no surface in
     * packages/web ever called them, and no other package did either. Worse, the
     * design they implied was circular — /api/generate and /api/prompt-file read
     * `.sequence/spec.json`, but the ONLY writer was the PUT nothing called, so
     * the stored spec was always absent and prompt-file's conformance diff was
     * always null in the shipped app.
     *
     * What replaced them:
     *  - the spec is now SAVED BY /api/generate itself (the design you generated
     *    from is the project's spec), so the read side is real for the first time;
     *  - conformance against a spec file without generating stays available in the
     *    product as the `sequence diff <spec.json> <scan.json>` CLI;
     *  - free-form per-project UI state had no reader anywhere — it is gone, not
     *    hidden (`.sequence/state.json` is no longer written by anything).
     *
     * They now fall through to the generic unknown-endpoint 404 below, and
     * server.test.ts asserts exactly that.
     */

    // ---- GET/PUT /api/ai-config (bring-your-own key; key redacted on GET) ----
    // No requireRepo guard: with a repo attached this reads/writes the PER-REPO
    // .sequence/ai.json (today's behavior, unchanged); with NO repo attached it
    // reads/writes the USER-LEVEL ~/.sequence/ai.json so the from-scratch design
    // flow can connect a key before any repo exists (v8 Phase B2).
    if (pathname === '/api/ai-config') {
      // Keyed on repoRoot ALONE, to match loadAiConfig's read-source predicate
      // exactly — the write target (per-repo vs user-level) can never diverge from
      // where the key is later read (v8 review, correctness F2: the old extra
      // `currentGraph !== null` conjunct was redundant since a repo is only ever
      // bound with a non-null graph, but aligning removes any doubt).
      const attached = repoRoot !== null;
      /*
       * THE VIEW EVERY ANSWER ON THIS ROUTE GIVES.
       *
       * `redactAiConfig` returns the saved-model list when the file has one. A
       * config written before profiles existed has none — and a picker that saw
       * nothing would tell the reader they have no saved model when they plainly
       * do. So the flat config is presented as the one-entry list it is, using
       * the SAME one-way migration a first save would apply. Nothing is written
       * by looking.
       */
      const aiConfigView = (cfg: AiConfig): Record<string, unknown> => {
        const view = redactAiConfig(cfg) as Record<string, unknown>;
        if ('mode' in view || 'profiles' in view) return view;
        const migrated = migrateAiConfigToProfiles(cfg);
        return { ...view, ...(redactAiConfig({ ...cfg, ...migrated }) as Record<string, unknown>) };
      };
      /*
       * A PUT that carries a profile list carries MASKED keys or none at all —
       * the real ones never left this process. Re-attach the stored key to any
       * profile that came back without one, matched by id, BEFORE validation.
       * Anything that is not a profile list passes through untouched, so the
       * single-config PUT is byte-for-byte the request it always was.
       */
      const mergeStoredProfileKeys = (raw: unknown): unknown => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
        const o = raw as Record<string, unknown>;
        if (!Array.isArray(o.profiles)) return raw;
        const stored = loadAiConfig();
        const keyed = new Map<string, string>();
        for (const pr of stored?.profiles ?? []) {
          if (pr.apiKey !== undefined) keyed.set(pr.id, pr.apiKey);
        }
        /* The pre-profiles config is one saved model too: its key must survive
           the first save that turns it into a list. */
        if (stored && !stored.profiles && stored.apiKey !== undefined) {
          keyed.set(migrateAiConfigToProfiles(stored).defaultProfileId, stored.apiKey);
        }
        return {
          ...o,
          profiles: o.profiles.map((entry) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
            const e = entry as Record<string, unknown>;
            /* A MASK IS NOT A KEY. GET returns every key masked, so the panel only
               ever holds masks; sending one back used to satisfy this "did they send a
               key?" test and overwrite the credential with its own redaction. Editing a
               profile's NAME destroyed its key. A mask means 'unchanged' — fall through
               and re-attach the stored one. */
            const sent = typeof e.apiKey === 'string' ? e.apiKey.trim() : '';
            if (sent !== '' && !isMaskedApiKey(sent)) return e;
            const id = typeof e.id === 'string' ? e.id.trim() : '';
            const kept = keyed.get(id);
            return kept === undefined ? e : { ...e, apiKey: kept };
          }),
        };
      };
      // When a repo is attached, ai-config reads/writes that repo's per-repo
      // .sequence/ai.json — so the owner-check applies to BOTH GET and PUT: a
      // non-owner must not read or write another user's repo config. Repo-less
      // (user-level ~/.sequence/ai.json) is unowned ⇒ requireOwner is a no-op (that
      // shared user-level config is part of the v13 per-user-workspace follow-up).
      if (requireOwner()) return;
      if (method === 'GET') {
        /*
         * A signed-in user is not automatically entitled to MACHINE-WIDE AI
         * inventory or the shared user-level config. Under auth, the only
         * principal with a grounded relationship to this process state is the
         * owner of the attached repo. A repo-less or CLI-attached/unowned
         * server therefore refuses before reading config or probing localhost.
         * Auth-off local mode never enters this branch and stays byte-identical.
         */
        if (authOn && (repoOwner === null || sessionId !== repoOwner)) {
          sendError(res, 403, 'forbidden: AI configuration requires an attached repository owned by this session');
          return;
        }
        const cfg = loadAiConfig();

        /*
         * ── WHAT IS ALREADY RUNNING ON THIS MACHINE ────────────────────────
         *
         * CLAUDE.md's second non-negotiable is that the app delivers its core
         * with no network and no key, and the ENGINE honours it: a full
         * grounded answer runs against a local OpenAI-compatible model with
         * neither. THE PRODUCT NEVER SAID SO. The shipped default points at an
         * undeployed gateway and the first failure a new reader meets is a form
         * asking for an API key — for a capability already on their machine.
         *
         * Carried on the config read rather than on a route of its own,
         * because the moment it matters is the moment a client asks what is
         * configured, and a second route is a second thing to remember to call.
         * Twenty-one routes in this server already serve surfaces nobody built.
         *
         * IT IS AN OFFER, NOT A CHOICE. Nothing here writes a config: which
         * model answers is the reader's decision, and a server that set it
         * because it found something would be choosing on their behalf.
         */
        const localProviders = await (opts.detectLocal ?? detectLocalProviders)();

        if (!cfg) {
          // Prefill hints for Connect AI when OPENROUTER_*/SEQUENCE_AI_* env is
          // set but empty/incomplete — never includes the key value.
          const envPrefill = readAiEnvPrefill();
          sendJson(res, 200, {
            configured: false,
            ...(envPrefill ? { envPrefill } : {}),
            ...(localProviders.length > 0 ? { localProviders } : {}),
          });
          return;
        }
        /*
         * The window, when the provider will say what it is. Ollama's /api/show
         * carries the real number; nothing else does, and an absent field means
         * the surface draws no meter rather than a plausible default.
         *
         * Asked here rather than at ask-time because this route is already the
         * one the client reads for the model, and the probe is a bounded
         * loopback call that fails to `null` — so a slow or missing Ollama costs
         * this GET its timeout and nothing else.
         */
        const contextWindow =
          cfg.provider === 'openai-compatible' && typeof cfg.baseUrl === 'string'
            ? await probeContextWindow(cfg.baseUrl, cfg.model, fetch)
            : null;
        sendJson(res, 200, {
          ...aiConfigView(cfg),
          ...(contextWindow !== null ? { contextWindow } : {}),
          ...(localProviders.length > 0 ? { localProviders } : {}),
        });
        return;
      }
      if (method === 'PUT') {
        if (!isJsonRequest(req)) {
          sendError(res, 415, 'expected content-type application/json');
          return;
        }
        let body: unknown;
        try {
          body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
        } catch (e) {
          sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
          return;
        }
        /*
         * ── SWITCH WHICH SAVED MODEL ANSWERS ───────────────────────────────
         *
         * `{ selectProfileId }` and nothing else. It exists because the picker
         * cannot re-send the profile list: the client only ever holds MASKED
         * keys, so a switch expressed as "PUT the whole list back" would write
         * `••••9f3a` over a working credential. One field in, one field
         * changed, every key untouched on disk.
         */
        const selectId =
          body !== null && typeof body === 'object' && !Array.isArray(body)
            ? (body as { selectProfileId?: unknown }).selectProfileId
            : undefined;
        if (selectId !== undefined) {
          if (typeof selectId !== 'string' || selectId.trim() === '') {
            sendError(res, 400, 'selectProfileId must be a non-empty string');
            return;
          }
          const stored = loadAiConfig();
          if (!stored || (stored.mode ?? 'api-key') === 'default') {
            sendError(res, 409, 'no saved models to switch between yet');
            return;
          }
          const migrated = migrateAiConfigToProfiles(stored);
          const wanted = selectId.trim();
          if (!migrated.profiles.some((pr) => pr.id === wanted)) {
            sendError(res, 404, `selectProfileId '${wanted}' names no saved model`);
            return;
          }
          const next = { profiles: migrated.profiles, defaultProfileId: wanted };
          const revalidated = validateAiConfig(next);
          if (!revalidated.config) {
            sendError(res, 400, revalidated.error ?? 'invalid ai config');
            return;
          }
          if (attached && isRepoTrusted(repoRoot)) writeJson(activeRoot(), AI_FILE, next);
          else writeUserJson(userConfigDir, AI_FILE, next);
          sendJson(res, 200, aiConfigView(loadAiConfig() ?? revalidated.config));
          return;
        }
        /*
         * ── A SAVED LIST KEEPS ITS KEYS ────────────────────────────────────
         *
         * The client never holds a real key, so a profile it sends back with no
         * `apiKey` means "the one already stored", exactly as the single-config
         * form's empty key box has always meant. Merged BEFORE validation, so a
         * remote profile whose key was omitted is not rejected as keyless — and
         * a profile with no stored key still hits the same refusal it would
         * have hit on first save.
         */
        const withKeys = mergeStoredProfileKeys(body);
        const { config, error } = validateAiConfig(withKeys);
        if (!config) {
          // `error` is a shape message; it never echoes the submitted key.
          sendError(res, 400, error ?? 'invalid ai config');
          return;
        }
        // The full key is written ONLY here. Per-repo when attached (git-ignored
        // .sequence/ai.json), else the user-level ~/.sequence/ai.json — same file
        // shape, same "never returned unredacted" hygiene.
        //
        // A profiles config is written as the LIST, not as the resolved-flat
        // object validateAiConfig hands back: writing the flat resolution would
        // duplicate the active profile's key at the top level for no reader.
        const onDisk: unknown =
          config.profiles && config.profiles.length > 0
            ? { profiles: config.profiles, defaultProfileId: config.defaultProfileId }
            : config;
        /*
         * THE USER'S OWN CONFIG GOES WHERE THE USER'S OWN CONFIG IS READ.
         *
         * `.sequence/ai.json` holds TWO different things under one name: the
         * config THIS USER set through the app, and whatever config the
         * repository happened to ship. `loadAiConfig` ignores the repo's copy
         * on an untrusted repository — a hostile one could otherwise point
         * `baseUrl` at its own host and take every question and file excerpt
         * with it. Writing the user's answer into that same ignored file made
         * the app unable to configure itself: PUT succeeded, the next read
         * dropped it, and `/api/ask` answered 400 "no AI configured" — which is
         * exactly the "the user's own config inexplicably stopped applying"
         * failure the gate's own comment warned about, caused by the gate.
         *
         * So an untrusted repo's directory is not a place to keep the user's
         * settings. It goes to the user store, which is read whatever the repo
         * is, and the repo's own file stays repo-shipped data. Trusting the
         * repository restores the old per-repo behaviour exactly.
         */
        if (attached && isRepoTrusted(repoRoot)) {
          writeJson(activeRoot(), AI_FILE, onDisk);
        } else {
          writeUserJson(userConfigDir, AI_FILE, onDisk);
        }
        // Answer with the view a GET would give for what we just stored: reload
        // through loadAiConfig so the runtime `gatewayLive` stamp is applied. The
        // validated object alone has no stamp, so replying with it would tell a
        // just-connected free-tier user "not live" on a deploy where the gateway
        // IS live (and the UI would only self-correct on the next GET).
        sendJson(res, 200, aiConfigView(loadAiConfig() ?? config));
        return;
      }
      /*
       * ── DOES THIS MODEL ACTUALLY ANSWER? ─────────────────────────────────
       *
       * `POST /api/ai-config { test: true }`. Before this, the FIRST evidence
       * that a model id was misspelled or a local server was down was a failed
       * chat turn — the reader had already written their question. This sends
       * the real body a real ask sends (same wire, same headers, same knobs) with
       * a trivial prompt, under a deadline, and reports what came back.
       *
       * It reports rather than throws: a model that refused is a FACT about the
       * configuration, not a server fault, so the failure arrives as `ok:false`
       * with the provider's own message next to the model it names.
       */
      if (method === 'POST') {
        if (authOn && (repoOwner === null || sessionId !== repoOwner)) {
          sendError(res, 403, 'forbidden: AI configuration requires an attached repository owned by this session');
          return;
        }
        let probeBody: unknown;
        try {
          probeBody = JSON.parse(await readBody(req, MAX_BODY_BYTES));
        } catch (e) {
          sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
          return;
        }
        const asked =
          probeBody !== null && typeof probeBody === 'object' && !Array.isArray(probeBody)
            ? (probeBody as { test?: unknown; profileId?: unknown })
            : {};
        if (asked.test !== true) {
          /* Named as what to SEND, never as a verb and a route — error copy in
             this server says what the reader can do (see error-copy.test.ts). */
          sendError(res, 400, 'a model test must send { test: true }, and optionally a profileId');
          return;
        }
        const stored = loadAiConfig();
        if (!stored) {
          sendError(res, 409, 'no model is configured to test');
          return;
        }
        let probeCfg = stored;
        if (typeof asked.profileId === 'string' && asked.profileId.trim() !== '') {
          const wanted = asked.profileId.trim();
          const found = (stored.profiles ?? []).find((pr) => pr.id === wanted);
          if (!found) {
            sendError(res, 404, `profileId '${wanted}' names no saved model`);
            return;
          }
          probeCfg = {
            ...stored,
            provider: found.provider,
            model: found.model,
            baseUrl: found.baseUrl,
            apiKey: found.apiKey,
            params: found.params,
          };
        }
        /* The reader's own deadline when they set one; otherwise the same 20 s
           `doctor.ts` has used for its probe since it was written. A test that
           can hang is not a test. */
        probeCfg = {
          ...probeCfg,
          params: { ...(probeCfg.params ?? {}), timeoutMs: probeCfg.params?.timeoutMs ?? 20_000 },
        };
        const startedAt = Date.now();
        try {
          const text = await generateText(probeCfg, 'Reply with the single word: ok');
          sendJson(res, 200, {
            ok: true,
            model: probeCfg.model,
            ms: Date.now() - startedAt,
            /* A short sample, so "it answered" is something the reader can see
               rather than a green tick they have to believe. */
            sample: text.trim().slice(0, 120),
          });
        } catch (e) {
          sendJson(res, 200, {
            ok: false,
            model: probeCfg.model,
            ms: Date.now() - startedAt,
            /* The provider's own words. Rewriting them would hide the one
               sentence that says what to fix. */
            error: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }
      sendError(res, 405, 'method not allowed');
      return;
    }

    // ---- GET /api/usage (free metered default: per-user usage state) ----
    // User-level, no repo required. Reports the free default's meter so the UI can
    // show "X of N this month" and the honest soft-cap nudge. Holds no secret. The
    // soft cap NEVER hard-blocks here — it is surfaced as `softCapped:true` only.
    // api-key mode is not metered, but the endpoint still reports the (zeroed) meter.
    if (pathname === '/api/usage' && method === 'GET') {
      const usage = loadUsage(identity);
      const { monthlyAllotment } = DEFAULT_METER_POLICY;
      const meter: GetUsageResponse = {
        usedThisMonth: usage.usedThisMonth,
        allotment: monthlyAllotment,
        softCapped: usage.usedThisMonth >= monthlyAllotment,
      };
      sendJson(res, 200, meter);
      return;
    }

    // ================= v16 Wave 2a: LOCAL-ONLY ACP endpoints =====================
    // Drive the user's OWN local coding agent over ACP from the web UI. These are
    // the security twin of the terminal WS: a real subprocess with filesystem
    // writes in the repo, so they are LOCAL-ONLY and MUST refuse when the server is
    // hosted or the request is not local. The gate MIRRORS the terminal:
    //   - HOSTED (auth enabled) ⇒ disabled outright. No hosted free-tier agent
    //     exposure — that is the whole v16 honesty posture. (On any public bind
    //     auth is forced on by assertSafeBind, so this also covers non-loopback.)
    //   - NON-LOCAL request ⇒ refused via the SAME isOriginAllowed() DNS-rebinding /
    //     cross-origin check the terminal upgrade uses (a non-loopback Host or a
    //     cross-origin browser page is rejected).
    //   - An explicit SEQUENCE_DISABLE_ACP kill-switch, mirroring SEQUENCE_DISABLE_TERMINAL.
    // The gate. `originOk` is the SAME DNS-rebinding / cross-origin check the
    // terminal upgrade uses (a non-loopback Host or a cross-origin page is not
    // local). `available` additionally folds the hosted-mode and kill-switch
    // refusals. A genuinely non-local caller (originOk=false) is REFUSED outright,
    // even from the probe; a same-origin caller in hosted mode gets an honest
    // `available:false` from the probe so the web UI can feature-detect and hide
    // the ACP path (never a hosted free-tier agent runner).
    // A FUNCTION DECLARATION, not a `const` arrow, and the difference is
    // load-bearing: `POST /api/program/run` sits ~950 lines EARLIER in this same
    // handler and must consult this gate before it accepts a program carrying an
    // `acp` node. A `const` is in its temporal dead zone up there and the call
    // would throw a ReferenceError at runtime while typechecking cleanly. Hoisting
    // is what lets one gate serve both doors instead of two gates drifting apart.
    // eslint-disable-next-line no-inner-declarations
    function acpGate(): { available: boolean; originOk: boolean; reason?: string } {
      const originOk = isOriginAllowed(req);
      if (process.env.SEQUENCE_DISABLE_ACP) {
        return { available: false, originOk, reason: 'the local ACP agent bridge is disabled (SEQUENCE_DISABLE_ACP).' };
      }
      if (authOn) {
        return {
          available: false,
          originOk,
          reason: 'ACP agents are local-only and are disabled in hosted (multi-user) mode — run Sequence locally to drive your own agent.',
        };
      }
      if (!originOk) {
        return { available: false, originOk, reason: 'ACP agents are local-only — this request did not come from localhost.' };
      }
      return { available: true, originOk };
    }

    // ---- GET /api/acp/available → { available, reason? } (capability probe) ----
    // 200 for any LOCAL caller (so a same-origin web client can feature-detect,
    // incl. an honest `available:false` in hosted mode); a genuinely non-local
    // (cross-origin / rebound) prober is refused with 403.
    if (pathname === '/api/acp/available' && method === 'GET') {
      const g = acpGate();
      if (!g.originOk) {
        sendError(res, 403, g.reason ?? 'ACP is not available');
        return;
      }
      sendJson(res, 200, { available: g.available, ...(g.reason ? { reason: g.reason } : {}) });
      return;
    }

    // ---- GET /api/acp/agents → { agents: [...] } (the configured local agents) ----
    if (pathname === '/api/acp/agents' && method === 'GET') {
      const g = acpGate();
      if (!g.available) {
        sendError(res, 403, g.reason ?? 'ACP is not available');
        return;
      }
      sendJson(res, 200, { agents: listAgents(userConfigDir) });
      return;
    }

    // ---- POST /api/acp/run-node { agentRef, prompt, cwd?, sessionKey? } ----
    // Runs ONE ACP prompt turn against the named local agent and returns the REAL
    // { stopReason, text } (never fabricated). Honest errors: unknown agentRef → 400;
    // not local → 403; a spawn / protocol failure → 502.
    //
    // r31 — SESSION CONTINUITY. When the body carries a valid string `sessionKey`
    // (`${runScope}::${agentRef}`; omitted when a node opts out via
    // shareSession===false), the turn runs on ONE cached live session per key
    // (spawn + newSession on first use, reuse thereafter) and turns on that key
    // SERIALIZE — so two nodes sharing a session can't interleave prompts. The key
    // is OPAQUE: never parsed, trusted, or logged. No `sessionKey` (or a non-string /
    // empty one) → the original FRESH-session-per-call path below, byte-identical.
    // Either way a client disconnect aborts the in-flight turn (ACP cancel); on the
    // fresh path dispose() also kills the subprocess, while on the cached path the
    // shared session survives for other requests (reaped by the idle TTL / cap).
    if (pathname === '/api/acp/run-node' && method === 'POST') {
      const g = acpGate();
      if (!g.available) {
        sendError(res, 403, g.reason ?? 'ACP is not available');
        return;
      }
      if (!isJsonRequest(req)) {
        sendError(res, 415, 'expected content-type application/json');
        return;
      }
      // `permissionMode` is item 1.10's opt-in and is not yet in the shared wire
      // contract (`@sequence/api-types` is another owner's file this wave); it is
      // narrowed here exactly as every other field on this body is.
      let body: Unvalidated<PostAcpRunNodeRequest> & { permissionMode?: unknown };
      try {
        body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
      } catch (e) {
        sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
        return;
      }
      const agentRef = typeof body.agentRef === 'string' ? body.agentRef.trim() : '';
      const prompt = typeof body.prompt === 'string' ? body.prompt : '';
      if (agentRef === '') {
        sendError(res, 400, 'body must include a non-empty string "agentRef"');
        return;
      }
      if (prompt.trim() === '') {
        sendError(res, 400, 'body must include a non-empty string "prompt"');
        return;
      }
      const entry = getAgent(userConfigDir, agentRef);
      if (!entry) {
        sendError(res, 400, `unknown agentRef '${agentRef}' — register it with: sequence agent add ${agentRef} --command <bin>`);
        return;
      }
      // v16 Finding 4 — CONTAIN the agent cwd to the attached repo root (getRoot),
      // mirroring the terminal (which pins cwd to getRoot()). A write-capable agent
      // must not run outside the repo. When a repo is attached, an explicit
      // `body.cwd` is honored ONLY if it resolves to a path INSIDE the root; an
      // absolute or `..`-escaping cwd is IGNORED and the turn runs at the root. With
      // no repo attached there is nothing to contain to, so we fall back to the
      // agent's OWN server-side configured cwd (never the caller-supplied one).
      let cwd = entry.cwd;
      const root = repoRoot;
      if (root) {
        cwd = root;
        const requested = typeof body.cwd === 'string' && body.cwd.trim() !== '' ? body.cwd : undefined;
        if (requested) {
          const resolved = path.resolve(root, requested);
          const rel = path.relative(root, resolved);
          if (resolved === root || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
            cwd = resolved; // a contained subdirectory is allowed
          }
          // else: an escaping cwd is dropped — the turn stays pinned to the root.
        }
      }

      /* ================= WAVE 1 ITEM 1.10 — THE TWO ACP SEAMS ==================
       * Gap G9: both call sites constructed `new AcpClient(launch)` with launch
       * config ONLY. `AcpClientConfig` declares `onUpdate` and `onPermission`, and
       * the client already RECEIVES the agent's streamed `session/update`
       * notifications — so the HTTP bridge threw every one of them away, and every
       * permission request fell through to `defaultPermissionPolicy`, which denies
       * anything mutating. A local coding agent driven through Sequence was
       * read-only AND silent about it: the agent asked, the server said no, and
       * nobody was ever shown the question.
       *
       * What changes, and what deliberately does not:
       *  - `onUpdate` is wired on BOTH paths and surfaces the notification VERBATIM.
       *    It is not reshaped into an ask-stream `tool:start` row, because that
       *    projection discards the agent's own payload — the part a caller needs.
       *  - `onPermission` DEFAULTS TO EXACTLY THE OLD DECISION
       *    (`defaultPermissionPolicy`). By default the only difference is that the
       *    refusal is now VISIBLE. Allowing an edit is opt-in per request and is
       *    never inferred from the presence of a listener.
       */
      const parsedMode = parseAcpPermissionMode(body.permissionMode);
      if ('error' in parsedMode) {
        sendError(res, 400, parsedMode.error);
        return;
      }
      const permissionMode = parsedMode.mode;
      const streaming = wantsEventStream(req, url);
      if (streaming) startSse(res);
      const emitAcp = (event: Record<string, unknown>): void => {
        if (streaming && !res.writableEnded) writeSseData(res, event);
      };
      const onUpdate = (n: AcpSessionNotification): void => {
        emitAcp({ type: 'acp:update', update: n });
      };
      const onPermission = (r: AcpPermissionRequest): PermissionDecision => {
        const decision = acpPermissionDecision(r, permissionMode);
        emitAcp({
          type: 'acp:permission',
          toolCallId: r.toolCall?.toolCallId,
          title: r.toolCall?.title,
          toolKind: r.toolCall?.kind ?? undefined,
          mode: permissionMode,
          decision,
        });
        return decision;
      };
      const finishTurn = (turn: PostAcpRunNodeResponse): void => {
        if (streaming) {
          emitAcp({ type: 'acp:result', ...turn });
          if (!res.writableEnded) res.end();
        } else {
          sendJson(res, 200, turn);
        }
      };
      const failTurn = (message: string): void => {
        if (streaming) {
          emitAcp({ type: 'acp:error', error: message });
          if (!res.writableEnded) res.end();
        } else if (!res.headersSent) {
          sendError(res, 502, message);
        }
      };

      const launch = {
        command: entry.command,
        ...(entry.args ? { args: entry.args } : {}),
        ...(cwd ? { cwd } : {}),
      };

      // r31 — CACHED path: a valid non-empty string sessionKey reuses one live
      // session per key with turns serialized (queue). A client disconnect aborts
      // the in-flight turn (ACP cancel) but LEAVES the shared session cached for
      // other requests — genuine agent/stream death (a non-abort throw) disposes it,
      // and the idle TTL / cap reap it otherwise.
      const sessionKey =
        typeof body.sessionKey === 'string' && body.sessionKey !== '' ? body.sessionKey : undefined;
      if (sessionKey) {
        const ac = new AbortController();
        const onClientGone = (): void => ac.abort();
        res.on('close', onClientGone);
        // A cached client OUTLIVES the request that created it, so its hooks cannot
        // close over this response. They dispatch through `acpTurnSinks`, which is
        // re-pointed at whoever owns the current turn — correct precisely because
        // `acpSessions.run` serializes turns per key, so one turn is ever active.
        const previousSink = acpTurnSinks.get(sessionKey);
        acpTurnSinks.set(sessionKey, { onUpdate, onPermission });
        try {
          const { stopReason, text } = await acpSessions.run(
            sessionKey,
            async () => {
              const client = new AcpClient({
                ...launch,
                onUpdate: (n) => acpTurnSinks.get(sessionKey)?.onUpdate(n),
                // No sink registered (a reaped/idle turn) falls back to the
                // CONSERVATIVE default rather than to the last caller's mode —
                // an opt-in must never outlive the request that opted in.
                onPermission: (r) =>
                  acpTurnSinks.get(sessionKey)?.onPermission(r) ?? defaultPermissionPolicy(r),
              });
              await client.start();
              const sessionId = await client.newSession(cwd);
              return { client, sessionId };
            },
            (client) => client.prompt(prompt, { signal: ac.signal }),
            // A disconnect (ac.abort) is an EXPECTED interruption — keep the shared
            // session; any other throw broke the client, so dispose it.
            { disposeOnError: () => !ac.signal.aborted }
          );
          finishTurn({ stopReason, text });
        } catch (e) {
          if (!ac.signal.aborted) failTurn(`ACP agent failed: ${(e as Error).message}`);
          else if (streaming && !res.writableEnded) res.end();
        } finally {
          res.off('close', onClientGone);
          if (previousSink) acpTurnSinks.set(sessionKey, previousSink);
          else acpTurnSinks.delete(sessionKey);
        }
        return;
      }

      const client = new AcpClient({ ...launch, onUpdate, onPermission });
      // v16 Finding 1 — a client disconnect must FORCEFULLY kill the subprocess (no
      // orphan, no continued real cost), like the terminal WS's killProcessTree on
      // close. So on `req 'close'` we (a) abort the in-flight turn (ACP cancel) AND
      // (b) call dispose() DIRECTLY — SIGTERM→SIGKILL — without waiting for prompt()
      // to resolve. A hung/uncooperative agent (or a hang during init) is therefore
      // still killed. The signal is also threaded into start()/newSession() so a
      // hang BEFORE the prompt is abortable too. dispose() is idempotent and guarded
      // so the normal (finally) path and the disconnect path never double-fire.
      const ac = new AbortController();
      let disposed = false;
      const forceDispose = (): void => {
        if (disposed) return;
        disposed = true;
        void client.dispose().catch(() => {});
      };
      const onClientGone = (): void => {
        ac.abort();
        forceDispose();
      };
      // Listen on the RESPONSE's 'close': by the time we get here `readBody` has
      // already drained (and ended) the request stream, so a late `req.on('close')`
      // would miss the event entirely. `res` 'close' fires reliably when the client
      // disconnects mid-turn (and, harmlessly, on normal completion — forceDispose
      // is idempotent and the finally handles the normal path).
      res.on('close', onClientGone);
      try {
        await client.start(ac.signal);
        await client.newSession(cwd, ac.signal);
        const { stopReason, text } = await client.prompt(prompt, { signal: ac.signal });
        finishTurn({ stopReason, text });
      } catch (e) {
        if (!ac.signal.aborted) failTurn(`ACP agent failed: ${(e as Error).message}`);
        else if (streaming && !res.writableEnded) res.end();
      } finally {
        res.off('close', onClientGone);
        forceDispose();
      }
      return;
    }

    // ---- GET/PUT/DELETE /api/github (LOCAL bring-your-own token; token redacted) ----
    // No requireRepo guard: connecting GitHub is a repo-less onboarding step. The
    // token ALWAYS lives at the USER level (~/.sequence/github.json) — never in a
    // scanned repo — with the EXACT same hygiene as the AI key: written only here,
    // never logged, and only ever returned REDACTED (a `••••` mask). This is LOCAL
    // only; it is NOT hosted OAuth (that is deferred).
    if (pathname === '/api/github') {
      if (method === 'GET') {
        const cfg = loadGithubConfig();
        if (!cfg) {
          sendJson(res, 200, { connected: false });
          return;
        }
        sendJson(res, 200, redactGithubConfig(cfg));
        return;
      }
      if (method === 'PUT') {
        if (!isJsonRequest(req)) {
          sendError(res, 415, 'expected content-type application/json');
          return;
        }
        let body: unknown;
        try {
          body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
        } catch (e) {
          sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
          return;
        }
        const { config, error } = validateGithubConfig(body);
        if (!config) {
          // `error` is a shape message; it never echoes the submitted token.
          sendError(res, 400, error ?? 'invalid github config');
          return;
        }
        // The full token is written ONLY here, to the user-level github.json.
        writeUserJson(userConfigDir, GITHUB_FILE, config);
        sendJson(res, 200, redactGithubConfig(config));
        return;
      }
      if (method === 'DELETE') {
        deleteUserJson(userConfigDir, GITHUB_FILE);
        sendJson(res, 200, { connected: false });
        return;
      }
      sendError(res, 405, 'method not allowed');
      return;
    }

    // ---- GET /api/github/repos (read-only: list the token owner's repositories) ----
    // Connect + READ only — there is NO clone, NO push, NO write to GitHub this
    // round. The token is loaded via loadGithubConfig and put on the wire ONLY by
    // github.ts (Authorization header), never logged/returned. No token ⇒ 400; an
    // upstream failure ⇒ a clean 502 whose body is GitHub-authored (token-free).
    // The real github.com call is unverifiable in this sandbox; it is verified
    // against a MOCK over the injectable fetch (same honest boundary as the AI key).
    if (pathname === '/api/github/repos' && method === 'GET') {
      const cfg = loadGithubConfig();
      if (!cfg) {
        sendError(res, 400, 'connect GitHub in Settings first');
        return;
      }
      try {
        const repos = await listGithubRepos(cfg, githubFetch);
        sendJson(res, 200, { repos });
      } catch (e) {
        if (e instanceof GithubError) {
          // 502: GitHub failed / returned an unusable body. Any attached body is
          // GitHub's OWN response — it can never contain the token we sent.
          const errBody: Record<string, unknown> = { error: e.message };
          if (e.body !== undefined) errBody.githubResponse = e.body;
          sendJson(res, 502, errBody);
          return;
        }
        throw e;
      }
      return;
    }

    // ---- POST /api/github/clone { fullName? | cloneUrl? } (REAL clone-import) ----
    // Clone a GitHub repo INTO the workspace, then attach it. Unlike list (mock-only),
    // this is verifiable here (git present + github.com reachable). Guard order:
    //   1. SSRF: the target must be an https://github.com/<owner>/<repo> URL (fixed
    //      host — validateGithubCloneUrl; any other scheme/host is refused). A
    //      `fullName` is resolved against the token owner's OWN repo list (allow-list);
    //      a raw `cloneUrl` must still pass the host check.
    //   2. dest INSIDE the browse root: <browseRoot>/sequence-workspaces/<safe-name>,
    //      unique (no clobber). Vetted realpath-contained BEFORE the clone (parent) AND
    //      AFTER (the clone's realpath) — attachRepo has no intrinsic jail check.
    //   3. token via GIT_ASKPASS only — NEVER argv/.git/config/logs (see gitClone.ts).
    //   4. clone is time-capped (disk/network DoS guard).
    if (pathname === '/api/github/clone' && method === 'POST') {
      if (!isJsonRequest(req)) {
        sendError(res, 415, 'expected content-type application/json');
        return;
      }
      let body: { fullName?: unknown; cloneUrl?: unknown };
      try {
        body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
      } catch (e) {
        sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
        return;
      }

      const cfg = loadGithubConfig(); // may be undefined — public repos need no token

      // --- 1. Resolve to a validated github.com target (the SSRF guard) ---
      let target: GithubCloneTarget | null = null;
      if (typeof body.fullName === 'string' && body.fullName.trim() !== '') {
        // Prefer the allow-list: the fullName must be one of the token owner's OWN
        // repos, so a picker click can only ever clone a repo the user can see.
        if (!cfg) {
          sendError(res, 400, 'connect GitHub in Settings first to clone by name, or paste a clone URL');
          return;
        }
        let repos;
        try {
          repos = await listGithubRepos(cfg, githubFetch);
        } catch (e) {
          if (e instanceof GithubError) {
            const errBody: Record<string, unknown> = { error: e.message };
            if (e.body !== undefined) errBody.githubResponse = e.body;
            sendJson(res, 502, errBody);
            return;
          }
          throw e;
        }
        const wanted = body.fullName.trim();
        const match = repos.find((r) => r.fullName === wanted);
        if (!match) {
          sendError(res, 404, 'that repository is not in your GitHub account');
          return;
        }
        // Defence-in-depth: still host-check GitHub's OWN clone_url, and prefer the
        // canonical fixed-host URL over whatever string GitHub returned.
        target = validateGithubCloneUrl(match.cloneUrl) ?? cloneTargetFromFullName(match.fullName);
        if (!target) {
          sendError(res, 400, 'the repository clone URL is not a supported github.com URL');
          return;
        }
      } else if (typeof body.cloneUrl === 'string' && body.cloneUrl.trim() !== '') {
        target = validateGithubCloneUrl(body.cloneUrl);
        if (!target) {
          sendError(res, 400, 'cloneUrl must be an https://github.com/<owner>/<repo> URL');
          return;
        }
      } else {
        sendError(res, 400, 'body must include a string "fullName" or "cloneUrl"');
        return;
      }

      // --- 2. Choose + jail-vet a dest INSIDE the browse root (BEFORE cloning) ---
      // v13 Finding A: the browse root is the CALLER'S own per-user jail under
      // auth, so a clone lands under <callerRoot>/sequence-workspaces/ — never a
      // shared dir another tenant can browse/attach. Local mode ⇒ callerRoot ===
      // browseRoot, so the clone dest is byte-identical to pre-v13.
      const callerRoot = browseRootFor(sessionId);
      const workspacesDir = path.join(callerRoot, WORKSPACES_DIR);
      try {
        fs.mkdirSync(workspacesDir, { recursive: true });
      } catch (e) {
        sendError(res, 500, `could not create the workspaces directory: ${(e as Error).message}`);
        return;
      }
      // The parent must realpath-resolve INSIDE the caller's browse root (reuse the jail).
      const realWorkspaces = resolveInBrowseRoot(callerRoot, workspacesDir);
      if (realWorkspaces === null) {
        sendError(res, 500, 'the workspaces directory escapes the browse root');
        return;
      }
      // A filesystem-safe, no-clobber dest under the (real) workspaces dir. The safe
      // name has no separators/`..`, so the join stays lexically contained.
      const dest = uniqueDest(realWorkspaces, safeRepoDirName(target.repo));
      if (dest !== realWorkspaces && !dest.startsWith(realWorkspaces + path.sep)) {
        sendError(res, 500, 'the clone destination escapes the browse root');
        return;
      }

      // --- 3. Clone (default = real gitClone; tests inject a local-origin clone) ---
      const doClone: CloneRepoFn = opts.cloneRepo ?? gitClone;
      let cloneOk: { ok: boolean; error?: string };
      try {
        cloneOk = await doClone(target.cloneUrl, dest, cfg?.token);
      } catch (e) {
        try {
          fs.rmSync(dest, { recursive: true, force: true });
        } catch {
          /* best-effort cleanup */
        }
        sendError(res, 502, `clone failed: ${(e as Error).message}`);
        return;
      }
      if (!cloneOk.ok) {
        try {
          fs.rmSync(dest, { recursive: true, force: true });
        } catch {
          /* best-effort cleanup of a partial clone */
        }
        sendError(res, 502, cloneOk.error ?? 'git clone failed');
        return;
      }

      // --- 4. Re-vet the REALPATH of the cloned dest, THEN attach ---
      let realDest: string;
      try {
        realDest = fs.realpathSync(dest);
      } catch {
        sendError(res, 500, 'the clone did not produce a directory');
        return;
      }
      // attachRepo has NO intrinsic jail check, so vet containment here (a symlinked
      // clone escaping the jail is refused and removed before any scan/attach).
      if (realDest !== callerRoot && !realDest.startsWith(callerRoot + path.sep)) {
        try {
          fs.rmSync(dest, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
        sendError(res, 403, 'the cloned path escapes the browse root');
        return;
      }
      // Mirror /api/attach: never attach the browse root itself or an ancestor.
      if (realDest === callerRoot || callerRoot.startsWith(realDest + path.sep)) {
        sendError(res, 400, 'invalid clone destination');
        return;
      }
      let graph: ArchGraph;
      try {
        // The cloning session becomes the repo owner (re-sets ownership; null locally).
        graph = await attachRepo(realDest, true, sessionId ?? null);
      } catch (e) {
        // A cloned repo with no compose/K8s/Helm manifests is out of scope, not a
        // crash — the same calm 422 shape as /api/attach (the repo stays on disk).
        if (e instanceof NoManifestsError) {
          sendError(res, 422, e.message, { code: e.code, repoName: e.repoName, clonedTo: realDest });
          return;
        }
        sendError(res, 500, `scan failed: ${(e as Error).message}`);
        return;
      }
      // The /api/attach response shape (so the web client reuses AttachResult and the
      // UI lands in the attached workspace), plus where it was cloned.
      sendJson(res, 200, {
        attached: true,
        repoName: graph.repoName,
        root: repoRoot,
        graphSummary: graphSummary(graph),
        clonedTo: realDest,
      });
      return;
    }

    // ---- POST /api/design-suggest { repoName?, parentTitle?, description } ----
    // The from-scratch "describe → propose blocks" path (v8 Phase B2). Does NOT
    // requireRepo: it works with no repo attached (that is the point). It sends the
    // description + the plain-English scheme instruction to the CONFIGURED provider
    // (per-repo if attached, else user-level — same loadAiConfig precedence) and
    // returns { nodes, proposed:true } — a subtree of PROPOSED design blocks,
    // normalized/capped server-side (never eval, never throws on garbage). These
    // are DESIGN INTENT ("proposed", the user edits/keeps them), never a detection
    // claim. No provider configured ⇒ a clear 400. The key is never logged/returned.
    if (pathname === '/api/design-suggest' && method === 'POST') {
      // No requireRepo (this works repo-less). When a repo IS attached it uses that
      // repo's AI config, so guard it with the owner-check; repo-less ⇒ unowned ⇒ ok.
      if (requireOwner()) return;
      if (!isJsonRequest(req)) {
        sendError(res, 415, 'expected content-type application/json');
        return;
      }
      let body: { description?: unknown; parentTitle?: unknown; repoName?: unknown };
      try {
        body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
      } catch (e) {
        sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
        return;
      }
      const description = body.description;
      if (typeof description !== 'string' || description.trim() === '') {
        sendError(res, 400, 'body must include a non-empty string "description"');
        return;
      }
      const parentTitle = typeof body.parentTitle === 'string' ? body.parentTitle : undefined;
      const repoName = typeof body.repoName === 'string' ? body.repoName : undefined;
      const cfg = loadAiConfig();
      if (!cfg) {
        sendError(res, 400, 'AI provider not configured — connect your AI key in Settings to design');
        return;
      }
      const suggestAbort = requestAbort(res);
      try {
        const text = await callProviderMetered(
          cfg,
          buildDesignSuggestPrompt(description, parentTitle, repoName),
          identity,
          suggestAbort.signal
        );
        // Normalized/capped into safe proposed design nodes. Never throws.
        const nodes = normalizeDesignSuggestion(text);
        sendJson(res, 200, { nodes, proposed: true });
      } catch (e) {
        if (isRequestAbortedError(e)) {
          sendAborted(res);
          return;
        }
        if (e instanceof ProviderError) {
          const errBody: Record<string, unknown> = { error: e.message };
          if (e.body !== undefined) errBody.providerResponse = e.body;
          sendJson(res, e.httpStatus ?? 502, errBody);
          return;
        }
        throw e;
      } finally {
        suggestAbort.dispose();
      }
      return;
    }

    // ---- POST /api/generate  { prompt?, specOverride? } ----
    if (pathname === '/api/generate' && method === 'POST') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      if (!isJsonRequest(req)) {
        sendError(res, 415, 'expected content-type application/json');
        return;
      }
      let body: { prompt?: unknown; specOverride?: unknown; scope?: unknown; overwrite?: unknown };
      try {
        body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
      } catch (e) {
        sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
        return;
      }
      // Scaffolding invents files; it is never a licence to replace work that is
      // already there. Nothing here is confirmed unless the request says so.
      const genConsent = parseOverwriteConsent(body.overwrite);
      if ('error' in genConsent) {
        sendError(res, 400, genConsent.error);
        return;
      }
      // Resolve the spec: explicit override, else the spec this project was last
      // generated from (written below on success).
      const baseSpec = (body.specOverride ?? readJson<ArchGraph>(activeRoot(), SPEC_FILE)) as ArchGraph | undefined;
      if (!baseSpec || typeof baseSpec !== 'object') {
        sendError(res, 400, 'no design spec found — create one on the Design board first');
        return;
      }
      // Optional scope: carve a coherent sub-spec (the vision's "generate just
      // that selection"). The scoped result becomes THE spec the whole pipeline
      // runs on — brief, generate, and (recommended) the conformance diff, so
      // "conformance measures the scope you generated", not the full stored spec.
      const scopeIds = parseScope(body.scope);
      if (scopeIds && scopeIds.error) {
        sendError(res, 400, scopeIds.error);
        return;
      }
      let spec = baseSpec;
      let droppedEdges: string[] = [];
      const isScoped = !!(scopeIds && scopeIds.ids.length > 0);
      if (isScoped) {
        const { scoped, droppedEdges: dropped } = scopeGraph(baseSpec, scopeIds!.ids);
        spec = scoped;
        droppedEdges = dropped.map((e) => summarizeEdge(baseSpec, e));
      }
      // Fail on an unscaffoldable spec BEFORE spending the user's tokens. For a
      // scoped generate this validates the SCOPED sub-spec (e.g. a selection of
      // only a datastore has no service ⇒ 422, zero provider calls).
      const structural = validateGraph(spec);
      if (structural.length > 0) {
        sendError(res, 422, 'spec failed validation', { problems: structural, droppedEdges });
        return;
      }
      const scaffold = checkScaffoldability(spec);
      if (scaffold.length > 0) {
        sendError(res, 422, 'spec is not scaffoldable', { problems: scaffold, droppedEdges });
        return;
      }
      const cfg = loadAiConfig();
      if (!cfg) {
        sendError(res, 400, 'AI provider not configured — connect your AI key in Settings');
        return;
      }
      let brief: string;
      try {
        brief = renderBriefFromGraph(spec);
      } catch (e) {
        sendError(res, 422, `could not render brief: ${(e as Error).message}`);
        return;
      }
      const genPrompt = buildGeneratePrompt(brief, typeof body.prompt === 'string' ? body.prompt : undefined);
      // Diff against the SCOPED spec (recommended semantics: you generated the
      // scope, so conformance should measure the scope). For a scoped generate
      // we ALSO filter the rescan to the scope (see filterScanToScope) so an
      // out-of-scope service already in the repo is not reported as "Not in
      // spec" drift. Also write db/schema.sql when this spec has any db edges.
      const genAbort = requestAbort(res);
      let result: Awaited<ReturnType<typeof generateAndApply>>;
      try {
        result = await generateAndApply(
          cfg,
          genPrompt,
          identity,
          spec,
          spec,
          isScoped ? spec : undefined,
          { consent: genConsent.consent },
          genAbort.signal,
        );
      } catch (e) {
        if (isRequestAbortedError(e)) {
          sendAborted(res);
          return;
        }
        throw e;
      } finally {
        genAbort.dispose();
      }
      // The design that actually produced code becomes the project's spec (r179).
      // This is the ONLY writer of `.sequence/spec.json` — it is what makes the
      // read side real: a later generate can run with no spec in the request, the
      // DDL preview has a spec to render, and a prompt-file edit can be measured
      // for conformance against the design the code came from. We store the FULL
      // design, never a scoped subset (the scope is one request's selection, not
      // the project), and only after a successful, structurally valid generate.
      if (result.status === 200 && validateGraph(baseSpec).length === 0) {
        writeJson(activeRoot(), SPEC_FILE, baseSpec);
      }
      if (droppedEdges.length > 0 && result.body && typeof result.body === 'object') {
        (result.body as Record<string, unknown>).droppedEdges = droppedEdges;
      }
      sendJson(res, result.status, result.body);
      return;
    }

    // ---- POST /api/ddl  { spec?, scope? }  → { sql }  (pure preview; no writes) ----
    if (pathname === '/api/ddl' && method === 'POST') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      if (!isJsonRequest(req)) {
        sendError(res, 415, 'expected content-type application/json');
        return;
      }
      let body: Unvalidated<PostDdlRequest>;
      try {
        body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
      } catch (e) {
        sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
        return;
      }
      const baseSpec = (body.spec ?? readJson<ArchGraph>(activeRoot(), SPEC_FILE)) as ArchGraph | undefined;
      if (!baseSpec || typeof baseSpec !== 'object') {
        sendError(res, 400, 'no design spec found — create one on the Design board first');
        return;
      }
      const scopeIds = parseScope(body.scope);
      if (scopeIds && scopeIds.error) {
        sendError(res, 400, scopeIds.error);
        return;
      }
      const target =
        scopeIds && scopeIds.ids.length > 0 ? scopeGraph(baseSpec, scopeIds.ids).scoped : baseSpec;
      const ddl: PostDdlResponse = { sql: renderDDL(target) };
      sendJson(res, 200, ddl);
      return;
    }

    // ---- POST /api/prompt-file  { path, prompt } ("point at a file and prompt") ----
    if (pathname === '/api/prompt-file' && method === 'POST') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      if (!isJsonRequest(req)) {
        sendError(res, 415, 'expected content-type application/json');
        return;
      }
      let body: { path?: unknown; prompt?: unknown; overwrite?: unknown };
      try {
        body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
      } catch (e) {
        sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
        return;
      }
      const editConsent = parseOverwriteConsent(body.overwrite);
      if ('error' in editConsent) {
        sendError(res, 400, editConsent.error);
        return;
      }
      const rel = body.path;
      const prompt = body.prompt;
      if (typeof rel !== 'string' || rel.length === 0) {
        sendError(res, 400, 'body must include a string "path"');
        return;
      }
      if (typeof prompt !== 'string' || prompt.trim() === '') {
        sendError(res, 400, 'body must include a non-empty string "prompt"');
        return;
      }
      const abs = resolveReadablePath(rel);
      if (abs === null) {
        // Reserved-path guard: reading .sequence/ai.json here would ship the key
        // straight to the provider, so it is refused like a traversal.
        sendError(res, 403, 'path escapes repo root or is reserved');
        return;
      }
      const relPosix = rel.replace(/\\/g, '/');
      const editAllowlist = readProgramEditAllowlist(activeRoot());
      if (editAllowlist && !pathMatchesProgramEditAllowlist(relPosix, editAllowlist)) {
        sendError(res, 403, 'path outside program.md Agent may edit allowlist');
        return;
      }
      let stat: fs.Stats;
      try {
        stat = fs.statSync(abs);
      } catch {
        sendError(res, 404, 'file not found');
        return;
      }
      if (stat.isDirectory()) {
        sendError(res, 400, 'path is a directory');
        return;
      }
      if (stat.size > MAX_FILE_BYTES) {
        sendError(res, 413, `file too large (>${MAX_FILE_BYTES} bytes)`);
        return;
      }
      const cfg = loadAiConfig();
      if (!cfg) {
        sendError(res, 400, 'AI provider not configured — connect your AI key in Settings');
        return;
      }
      const content = fs.readFileSync(abs, 'utf8');
      const genPrompt = buildPromptFilePrompt(rel, content, prompt);
      // Diff the rescan against the spec this project was generated from, when
      // there is one; else omit it.
      const specForDiff = readJson<ArchGraph>(activeRoot(), SPEC_FILE);
      // The human pointed at THIS file and asked for it to be changed — that is
      // the consent for this one path, and rewriting it is the whole feature. Any
      // OTHER existing file the model decides to touch is still protected unless
      // the request confirmed it.
      const result = await generateAndApply(cfg, genPrompt, identity, specForDiff, undefined, undefined, {
        consent: editConsent.consent,
        // Derived from the RESOLVED path, not the raw request string, so the
        // consent matches the file that will actually be written however the
        // caller spelled it (`./a/b.ts`, `a\\b.ts`, …).
        impliedPath: path.relative(activeRoot(), abs),
      });
      sendJson(res, result.status, result.body);
      return;
    }

    // ---- GET /api/trajectory/:runId — read a persisted trajectory doc ----
    // Repo-scoped (lives under .sequence/trajectory/), so requireRepo + owner.
    if (pathname.startsWith('/api/trajectory/')) {
      const runId = decodeURIComponent(pathname.slice('/api/trajectory/'.length));
      if (!runId || runId.includes('/')) {
        sendError(res, 404, 'not found');
        return;
      }
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      if (method !== 'GET') {
        sendError(res, 405, 'method not allowed');
        return;
      }
      const doc = readTrajectory(activeRoot(), runId);
      if (!doc) {
        sendError(res, 404, 'trajectory not found');
        return;
      }
      sendJson(res, 200, doc);
      return;
    }

    // ---- POST /api/trajectory — client finalizes a program-run trajectory ----
    // Body is a TrajectoryDoc (kind 'program' or 'ask'); validated lightly and
    // written under .sequence/trajectory/. Repo-scoped, so requireRepo + owner.
    if (pathname === '/api/trajectory' && method === 'POST') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      if (!isJsonRequest(req)) {
        sendError(res, 415, 'expected content-type application/json');
        return;
      }
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
      } catch (e) {
        sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
        return;
      }
      if (!isTrajectoryDoc(body)) {
        sendError(res, 400, 'invalid trajectory document');
        return;
      }
      const doc = body as TrajectoryDoc;
      if (doc.kind !== 'program' && doc.kind !== 'ask') {
        sendError(res, 400, 'kind must be "program" or "ask"');
        return;
      }
      try {
        writeTrajectory(activeRoot(), doc);
      } catch (e) {
        sendError(res, 500, `failed to persist trajectory: ${(e as Error).message}`);
        return;
      }
      const persisted: PostTrajectoryResponse = { runId: doc.runId };
      sendJson(res, 200, persisted);
      return;
    }

    // ---- POST /api/harness/distill-skills — Phase 3 skill distill (owner only) ----
    // Runs the template distill over `.sequence/trajectory/` and writes
    // `.sequence/skills/<slug>/SKILL.md` for every eligible cluster (≥3
    // successful asks sharing a first intent id). No LLM, no network, no key —
    // local-first. When a graph is attached, its service ids are passed as
    // `knownServiceIds` so a skill naming an unknown service is refused.
    if (pathname === '/api/harness/distill-skills' && method === 'POST') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      try {
        const knownServiceIds = currentGraph
          ? new Set(currentGraph.nodes.filter((n) => n.kind === 'service').map((n) => n.id))
          : undefined;
        const distillCfg = loadAiConfig();
        const { written, errors } = await distillSkillsFromTrajectories(activeRoot(), {
          knownServiceIds,
          ...(distillCfg
            ? {
                summarizeBody: async (input) => {
                  const llm = harnessLlmCaller(async (prompt) => {
                    const { text } = await callProviderMeteredWithUsage(distillCfg, prompt, identity);
                    return { text };
                  });
                  return llm(buildSkillDistillPrompt(input));
                },
              }
            : {}),
        });
        sendJson(res, 200, {
          written: written.map((s) => ({ slug: s.slug, name: s.frontmatter.name, filePath: s.filePath })),
          errors,
        });
      } catch (e) {
        sendError(res, 500, `skill distill failed: ${(e as Error).message}`);
      }
      return;
    }

    // ---- Phase 4: /refine + board Accept/Deny (thin seam, local-first) ----
    // The planner reads `.sequence/trajectory/` for a repeated failure pattern
    // (≥2 failed asks sharing an intent key OR a file:read path) and proposes the
    // smallest evidence-backed edit to a supplemental harness artifact (append a
    // pitfalls section to an existing SKILL.md, or a tip to .sequence/memory/NOTES.md).
    // No LLM, no network, no key. Accept/Deny is owner-gated; accept runs the
    // Phase 5 schema-validate verify gate when the target is a SKILL.md.

    // POST /api/harness/refine/plan — create (and persist) a pending proposal.
    if (pathname === '/api/harness/refine/plan' && method === 'POST') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      try {
        const refineCfg = loadAiConfig();
        const proposal = await planRefineFromTrajectories(activeRoot(), {
          ...(refineCfg
            ? {
                enhanceAfter: async (input) => {
                  const llm = harnessLlmCaller(async (prompt) => {
                    const { text } = await callProviderMeteredWithUsage(refineCfg, prompt, identity);
                    return { text };
                  });
                  return llm(buildRefineEnhancePrompt(input));
                },
              }
            : {}),
        });
        if (!proposal) {
          sendJson(res, 200, { proposal: null });
          return;
        }
        writeRefineProposal(activeRoot(), proposal);
        sendJson(res, 200, { proposal });
      } catch (e) {
        sendError(res, 500, `refine plan failed: ${(e as Error).message}`);
      }
      return;
    }

    // GET /api/harness/refine — list persisted proposals (newest-first by id).
    if (pathname === '/api/harness/refine' && method === 'GET') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      const proposals = listRefineProposals(activeRoot()).slice().reverse();
      sendJson(res, 200, { proposals });
      return;
    }

    // POST /api/harness/refine/:id/accept — write `after` to targetPath, mark accepted.
    // When the target is a SKILL.md, run the Phase 5 schema-validate verify gate
    // on the proposed frontmatter FIRST; a failed gate refuses the accept (the
    // edit does not land). A skipped gate is never used here — accept is a write.
    if (pathname.startsWith('/api/harness/refine/') && pathname.endsWith('/accept') && method === 'POST') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      const id = decodeURIComponent(pathname.slice('/api/harness/refine/'.length, -'/accept'.length));
      if (!id || id.includes('/')) {
        sendError(res, 404, 'not found');
        return;
      }
      const proposal = readRefineProposal(activeRoot(), id);
      if (!proposal) {
        sendError(res, 404, 'refine proposal not found');
        return;
      }
      if (proposal.targetPath.endsWith('SKILL.md')) {
        const fm = parseSkillFrontmatter(proposal.after);
        if (fm === undefined) {
          sendError(res, 400, 'refine accept refused: target SKILL.md has no parseable frontmatter');
          return;
        }
        const schemaVerify = runDesignatedVerify({ kind: 'schema-validate', subject: fm });
        if (!isVerifyPassed(schemaVerify)) {
          sendJson(res, 409, { verify: schemaVerify });
          return;
        }
        const cmdVerify = runDesignatedVerify({
          kind: 'command',
          cmd: 'pnpm --filter @sequence/schema test',
          repoRoot: activeRoot(),
        });
        if (!isVerifyPassed(cmdVerify)) {
          sendJson(res, 409, { verify: cmdVerify });
          return;
        }
      }
      const result = applyRefineProposal(activeRoot(), id);
      if (!result.ok) {
        sendError(res, 400, result.error ?? 'refine accept failed');
        return;
      }
      sendJson(res, 200, { proposal: result.proposal });
      return;
    }

    // POST /api/harness/refine/:id/deny — mark denied (edit discarded, auditable).
    if (pathname.startsWith('/api/harness/refine/') && pathname.endsWith('/deny') && method === 'POST') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      const id = decodeURIComponent(pathname.slice('/api/harness/refine/'.length, -'/deny'.length));
      if (!id || id.includes('/')) {
        sendError(res, 404, 'not found');
        return;
      }
      const result = denyRefineProposal(activeRoot(), id);
      if (!result.ok) {
        sendError(res, 400, result.error ?? 'refine deny failed');
        return;
      }
      sendJson(res, 200, { proposal: result.proposal });
      return;
    }

    // POST /api/harness/refine/:id/rollback — restore BEFORE_FILE for an accepted refine.
    if (pathname.startsWith('/api/harness/refine/') && pathname.endsWith('/rollback') && method === 'POST') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      const id = decodeURIComponent(pathname.slice('/api/harness/refine/'.length, -'/rollback'.length));
      if (!id || id.includes('/')) {
        sendError(res, 404, 'not found');
        return;
      }
      const result = rollbackRefineProposal(activeRoot(), id);
      if (!result.ok) {
        sendError(res, 400, result.error ?? 'refine rollback failed');
        return;
      }
      sendJson(res, 200, { proposal: result.proposal });
      return;
    }

    // ==================== Wave 3a: Index Changes git APIs ====================
    // GET /api/git/status  → { branch, files: [{ path, status }] }
    // GET /api/git/diff?path=<rel> → { path, diff }
    // POST /api/git/commit { message, paths?: string[] } → { ok, commit? }
    // All three are repo-scoped (requireRepo + owner check) and jail every
    // caller-supplied path through resolveInRepo via gitWorkspace. No ambient
    // shell — only `git` child_processes with cwd=repoRoot.

    if (pathname === '/api/git/status' && method === 'GET') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      try {
        const result: GetGitStatusResponse = await gitStatus(activeRoot());
        sendJson(res, 200, result);
      } catch (e) {
        sendError(res, 500, (e as Error).message);
      }
      return;
    }

    if (pathname === '/api/git/diff' && method === 'GET') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      const rel = url.searchParams.get('path') ?? '';
      if (rel === '') {
        sendError(res, 400, 'query parameter "path" is required');
        return;
      }
      /*
       * WHAT THE DIFF IS AGAINST. This route took `?path` and nothing else, so
       * the review pane could serve two of its five scopes and rendered the
       * other three as unavailable with a note naming the missing route. These
       * are those routes.
       *
       * An UNKNOWN scope is a 400, never a silent fall back to the working
       * tree: answering a question the caller did not ask, with a diff that
       * looks right, is worse than refusing.
       */
      const scopeParam = url.searchParams.get('scope') ?? 'worktree';
      let scope: GitDiffScope;
      if (scopeParam === 'worktree' || scopeParam === 'staged') {
        scope = { kind: scopeParam };
      } else if (scopeParam === 'commit') {
        const rev = url.searchParams.get('rev') ?? '';
        if (rev === '') {
          sendError(res, 400, 'scope "commit" requires the query parameter "rev"');
          return;
        }
        scope = { kind: 'commit', rev };
      } else if (scopeParam === 'branch') {
        const base = url.searchParams.get('base') ?? '';
        if (base === '') {
          sendError(res, 400, 'scope "branch" requires the query parameter "base"');
          return;
        }
        scope = { kind: 'branch', base };
      } else {
        sendError(
          res,
          400,
          `unknown scope ${JSON.stringify(scopeParam)} — expected worktree, staged, commit or branch`,
        );
        return;
      }

      try {
        const result = await gitDiff(activeRoot(), rel, scope);
        sendJson(res, 200, result);
      } catch (e) {
        if (e instanceof GitWorkspaceError) {
          sendError(res, e.status, e.message);
        } else {
          sendError(res, 500, (e as Error).message);
        }
      }
      return;
    }

    // ---- POST /api/git/discard { paths: string[] } ----
    if (pathname === '/api/git/discard' && method === 'POST') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      if (!isJsonRequest(req)) {
        sendError(res, 415, 'expected content-type application/json');
        return;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(await readBody(req, MAX_BODY_BYTES));
      } catch {
        sendError(res, 400, 'invalid JSON');
        return;
      }
      const paths = (raw as { paths?: unknown }).paths;
      if (!Array.isArray(paths) || paths.length === 0) {
        /*
         * NEVER "EVERYTHING". This is the one genuinely destructive operation
         * in the product — the content is not in the index, not in a commit,
         * and not recoverable by git once it is gone. An empty list is a
         * caller that lost its argument, and guessing here would guess
         * destructively.
         */
        sendError(res, 400, 'paths required; discard never applies to the whole tree');
        return;
      }

      const result = await gitDiscard(activeRoot(), paths as string[]);
      if (!result.ok) {
        sendError(res, 400, result.error ?? 'discard failed');
        return;
      }

      /*
       * THE GRAPH IS NOW OUT OF DATE, exactly as after an accepted edit.
       * Discarding restores files from HEAD, so every claim the board makes is
       * grounded in content that may no longer say what the citation says —
       * and `markGraphStale` NAMES the paths rather than setting a bare
       * boolean, which is what lets the surfaces say which claims moved.
       */
      for (const p of result.discarded ?? []) markGraphStale(p);
      sendJson(res, 200, { ok: true, discarded: result.discarded ?? [] });
      return;
    }

    if (pathname === '/api/git/commit' && method === 'POST') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      if (!isJsonRequest(req)) {
        sendError(res, 415, 'expected content-type application/json');
        return;
      }
      let body: Unvalidated<PostGitCommitRequest>;
      try {
        body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
      } catch (e) {
        sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
        return;
      }
      const message = body.message;
      const paths = body.paths;
      if (typeof message !== 'string') {
        sendError(res, 400, 'body must include a string "message"');
        return;
      }
      if (paths !== undefined && !Array.isArray(paths)) {
        sendError(res, 400, '"paths" must be an array of strings when present');
        return;
      }
      const pathList = Array.isArray(paths) ? (paths as unknown[]) : undefined;
      if (pathList !== undefined && !pathList.every((p) => typeof p === 'string')) {
        sendError(res, 400, 'every entry in "paths" must be a string');
        return;
      }
      /*
       * ══ pre-commit HOOK — where a project's own gate lives ═══════════════
       *
       * CANON reports this repository's three gates as "enforced by prose". A
       * commit is the moment a rule most wants to speak, and a `pre-commit`
       * hook exiting 2 stops it with its own stderr as the reason.
       *
       * Same posture as `pre-write`: it runs only if the USER trusted this repo
       * in user-level config the repo cannot write. A commit hook that ran
       * unasked would be a stranger's code executing the first time you looked
       * at their project.
       */
      const commitHook = await runHooks('pre-commit', {
        repoRoot: activeRoot(),
        file: readHookFile(activeRoot()),
        trusted: isTrusted(activeRoot(), readHookTrust(userConfigDir)),
        payload: { message, paths: pathList ?? null },
      });
      if (!commitHook.allowed) {
        const blocked = commitHook.outcomes.find((o) => o.kind === 'blocked');
        sendError(
          res,
          403,
          `blocked by a pre-commit hook (${blocked?.command ?? 'hook'}): ${
            blocked && 'reason' in blocked ? blocked.reason : 'no reason given'
          }`,
        );
        return;
      }

      const result = await gitCommit(activeRoot(), message, pathList as string[] | undefined);
      if (!result.ok) {
        sendError(res, 400, result.error ?? 'commit failed');
        return;
      }
      const committed: PostGitCommitResponse = {
        ok: true,
        ...(result.commit ? { commit: result.commit } : {}),
      };
      sendJson(res, 200, committed);
      return;
    }

    /* ================== P12 — branch + worktree handoff ==================
     *
     * `gitWorkspace.ts` exported three functions and none of them created a
     * ref, so every branching decision left the app. These four routes are the
     * app doing the git: create a branch without moving the attached checkout,
     * hand a branch off to a second working tree beside the repo, list what
     * git knows, and remove a tree this server handed off.
     *
     * NO INBOUND FILESYSTEM PATH except the removal `?path=`, and that one is
     * gated twice (inside this repo's derived worktrees root, AND present in
     * git's own `worktree list`) before anything is deleted. `GitBranchResult`
     * and friends carry their own honest HTTP status, so a refusal reaches the
     * client as the reason git gave, never as a generic 500.
     */

    if (pathname === '/api/git/branch' && method === 'POST') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      if (!isJsonRequest(req)) {
        sendError(res, 415, 'expected content-type application/json');
        return;
      }
      let body: Unvalidated<PostGitBranchRequest>;
      try {
        body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
      } catch (e) {
        sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
        return;
      }
      if (typeof body.name !== 'string') {
        sendError(res, 400, 'body must include a string "name"');
        return;
      }
      if (body.from !== undefined && typeof body.from !== 'string') {
        sendError(res, 400, '"from" must be a string when present');
        return;
      }
      const made = await gitCreateBranch(activeRoot(), body.name, {
        ...(body.from !== undefined ? { from: body.from } : {}),
      });
      if (!made.ok || !made.branch) {
        sendError(res, made.status ?? 500, made.error ?? 'branch creation failed');
        return;
      }
      const branched: PostGitBranchResponse = {
        ok: true,
        branch: made.branch,
        ...(made.head ? { head: made.head } : {}),
      };
      sendJson(res, 200, branched);
      return;
    }

    if (pathname === '/api/git/worktrees' && method === 'GET') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      try {
        const worktrees: GetGitWorktreesResponse = { worktrees: await gitListWorktrees(activeRoot()) };
        sendJson(res, 200, worktrees);
      } catch (e) {
        if (e instanceof GitWorkspaceError) sendError(res, e.status, e.message);
        else sendError(res, 500, (e as Error).message);
      }
      return;
    }

    if (pathname === '/api/git/worktree' && method === 'POST') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      if (!isJsonRequest(req)) {
        sendError(res, 415, 'expected content-type application/json');
        return;
      }
      let body: Unvalidated<PostGitWorktreeRequest>;
      try {
        body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
      } catch (e) {
        sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
        return;
      }
      if (typeof body.branch !== 'string') {
        sendError(res, 400, 'body must include a string "branch"');
        return;
      }
      if (body.from !== undefined && typeof body.from !== 'string') {
        sendError(res, 400, '"from" must be a string when present');
        return;
      }
      const handoff = await gitHandoffWorktree(activeRoot(), body.branch, {
        ...(body.from !== undefined ? { from: body.from } : {}),
      });
      if (!handoff.ok || !handoff.path || !handoff.branch) {
        sendError(res, handoff.status ?? 500, handoff.error ?? 'worktree handoff failed');
        return;
      }
      const handed: PostGitWorktreeResponse = {
        ok: true,
        branch: handoff.branch,
        path: handoff.path,
        createdBranch: handoff.createdBranch === true,
      };
      sendJson(res, 200, handed);
      return;
    }

    if (pathname === '/api/git/worktree' && method === 'DELETE') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      const target = url.searchParams.get('path') ?? '';
      if (target === '') {
        sendError(res, 400, 'query parameter "path" is required');
        return;
      }
      const force = url.searchParams.get('force') === '1';
      try {
        const removed = await gitRemoveWorktree(activeRoot(), target, { force });
        if (!removed.ok || !removed.path) {
          sendError(res, removed.status ?? 500, removed.error ?? 'worktree removal failed');
          return;
        }
        const gone: DeleteGitWorktreeResponse = { ok: true, path: removed.path };
        sendJson(res, 200, gone);
      } catch (e) {
        if (e instanceof GitWorkspaceError) sendError(res, e.status, e.message);
        else sendError(res, 500, (e as Error).message);
      }
      return;
    }

    /* ============ P10 — SESSION CHECKPOINTS AND REWIND (the routes) =========
     *
     * `/rewind` for Sequence. Four routes, and the shape of the set is the
     * honesty requirement rather than a convenience:
     *
     *   POST /api/checkpoint          take one
     *   GET  /api/checkpoints         list them, plus what the session has written
     *   POST /api/checkpoint/plan     what a restore WOULD touch — touches nothing
     *   POST /api/checkpoint/restore  the same plan, and what it then did
     *
     * There is no route that restores without producing the statement first:
     * `applyRestore` takes a PLAN, not a request, so the "code, conversation, or
     * both" answer has to exist before anything moves. A plan whose snapshots
     * are missing comes back 409 WITH the plan attached, so the client can show
     * exactly what stopped it rather than a bare error string.
     */

    /*
     * ATTACHMENTS - what the user brought that is not in the repository.
     *
     * JSON, not multipart. The payload is text; multipart would add a parser
     * and a dependency to carry bytes this route can already carry, and the
     * only argument for it is a file picker that JSON serves just as well.
     * MAX_BODY_BYTES is the outer bound; the store applies its own cap and
     * DECLARES it rather than silently halving the user's evidence.
     */
    /*
     * REPLAY A TURN THAT OUTLIVED ITS CONNECTION.
     *
     * `?since=` is the same cursor `/api/program/runs/:id/events` uses, and it
     * is the reason that path survives a blip while this one did not. A client
     * that saw up to event N reconnects asking for N, and gets everything
     * after it - including the terminal event, if the turn finished while
     * nobody was listening.
     *
     * PLAIN JSON, not SSE. The turn is already over or already going; a client
     * reconnecting wants the backlog in one answer, and a second streaming
     * endpoint would need its own liveness handling to say nothing new.
     */
    if (pathname === '/api/ask/events' && method === 'GET') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      const runId = url.searchParams.get('runId') ?? '';
      if (!isAskTurnId(runId)) {
        sendError(res, 400, 'query parameter "runId" is required');
        return;
      }
      if (!askTurnExists(activeRoot(), runId)) {
        /* 404, not an empty 200: "this turn was never recorded" and "you have
           already seen everything" are different answers, and a client that
           cannot tell them apart will wait forever for the second half of a
           turn that does not exist. */
        sendError(res, 404, 'no such turn');
        return;
      }
      const sinceRaw = Number.parseInt(url.searchParams.get('since') ?? '0', 10);
      const since = Number.isFinite(sinceRaw) && sinceRaw > 0 ? sinceRaw : 0;
      const events = readAskTurnEvents(activeRoot(), runId, since);
      sendJson(res, 200, {
        runId,
        since,
        events,
        /* What the client should ask for next time. Carried rather than left
           to be derived, so a client never has to know the log is 1-based. */
        lastSeq: events.length > 0 ? events[events.length - 1]!.seq : since,
      });
      return;
    }

    if (pathname === '/api/attachment' && method === 'POST') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      if (!isJsonRequest(req)) {
        sendError(res, 415, 'expected content-type application/json');
        return;
      }
      let body: { name?: unknown; text?: unknown };
      try {
        body = JSON.parse(await readBody(req, MAX_BODY_BYTES)) as { name?: unknown; text?: unknown };
      } catch (e) {
        sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
        return;
      }
      if (typeof body.text !== 'string' || body.text === '') {
        sendError(res, 400, 'body must include a non-empty string "text"');
        return;
      }
      try {
        sendJson(res, 200, { attachment: putAttachment(activeRoot(), body.name, body.text) });
      } catch (e) {
        sendError(res, 500, `could not store the attachment: ${(e as Error).message}`);
      }
      return;
    }

    if (pathname === '/api/attachment' && method === 'GET') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      const id = url.searchParams.get('id') ?? '';
      const record = readAttachment(activeRoot(), id);
      const text = readAttachmentText(activeRoot(), id);
      if (!record || text === null) {
        /* 404 rather than an empty 200: a caller that cannot tell "no such
           attachment" from "an attachment containing nothing" will render the
           wrong one of those. */
        sendError(res, 404, 'no such attachment');
        return;
      }
      sendJson(res, 200, { attachment: record, text });
      return;
    }

    if (pathname === '/api/attachments' && method === 'GET') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      sendJson(res, 200, { attachments: listAttachments(activeRoot()) });
      return;
    }

    if (pathname === '/api/checkpoint' && method === 'POST') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      if (!isJsonRequest(req)) {
        sendError(res, 415, 'expected content-type application/json');
        return;
      }
      let body: Unvalidated<PostCheckpointRequest>;
      try {
        body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
      } catch (e) {
        sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
        return;
      }
      if (!isCheckpointSessionId(body.sessionId)) {
        sendError(res, 400, 'body must include a "sessionId" of [A-Za-z0-9_-]{1,64}');
        return;
      }
      if (body.label !== undefined && typeof body.label !== 'string') {
        sendError(res, 400, '"label" must be a string when present');
        return;
      }
      const extra = body.files;
      if (extra !== undefined && (!Array.isArray(extra) || !extra.every((f) => typeof f === 'string'))) {
        sendError(res, 400, '"files" must be an array of strings when present');
        return;
      }
      // Every declared path is jail-checked BEFORE it can widen the tracked set:
      // a checkpoint must never become a way to read a file the read routes
      // refuse. A single bad path fails the whole request.
      const declared: string[] = [];
      for (const rel of (extra as string[] | undefined) ?? []) {
        const abs = resolveInRepo(activeRoot(), rel);
        if (abs === null || isReservedResolved(abs)) {
          sendError(res, 403, `path escapes the repo root or is reserved: ${rel}`);
          return;
        }
        declared.push(path.relative(activeRoot(), abs).replace(/\\/g, '/'));
      }
      try {
        const checkpoint = captureCheckpoint(activeRoot(), body.sessionId, {
          ...(typeof body.label === 'string' ? { label: body.label } : {}),
          ...(declared.length > 0 ? { files: declared } : {}),
        });
        const taken: PostCheckpointResponse = { checkpoint };
        sendJson(res, 200, taken);
      } catch (e) {
        sendError(res, 500, `checkpoint failed: ${(e as Error).message}`);
      }
      return;
    }

    if (pathname === '/api/checkpoints' && method === 'GET') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      const sessionId = url.searchParams.get('sessionId') ?? '';
      if (!isCheckpointSessionId(sessionId)) {
        sendError(res, 400, 'query parameter "sessionId" is required');
        return;
      }
      const listed: GetCheckpointsResponse = {
        checkpoints: listCheckpoints(activeRoot(), sessionId),
        tracked: listTrackedFiles(activeRoot(), sessionId).map((t) => t.path),
      };
      sendJson(res, 200, listed);
      return;
    }

    if (
      (pathname === '/api/checkpoint/plan' || pathname === '/api/checkpoint/restore') &&
      method === 'POST'
    ) {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      if (!isJsonRequest(req)) {
        sendError(res, 415, 'expected content-type application/json');
        return;
      }
      let body: Unvalidated<PostCheckpointRestoreRequest>;
      try {
        body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
      } catch (e) {
        sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
        return;
      }
      if (!isCheckpointSessionId(body.sessionId)) {
        sendError(res, 400, 'body must include a "sessionId" of [A-Za-z0-9_-]{1,64}');
        return;
      }
      if (typeof body.seq !== 'number' || !Number.isInteger(body.seq) || body.seq < 1) {
        sendError(res, 400, 'body must include an integer "seq" of 1 or more');
        return;
      }
      const scope = body.scope ?? 'both';
      if (scope !== 'code' && scope !== 'conversation' && scope !== 'both') {
        sendError(res, 400, '"scope" must be code, conversation or both');
        return;
      }
      const plan = planRestore(activeRoot(), body.sessionId, body.seq, scope);

      if (pathname === '/api/checkpoint/plan') {
        // THE PURE HALF. Nothing on this path writes, so a UI may compute and
        // re-compute the statement as freely as it likes.
        if (!plan.ok && plan.unrecoverable.length === 0 && plan.writes.length === 0) {
          // A plan that failed because the checkpoint does not exist is a 404,
          // not a 200 with a sad object: the id the caller named is wrong.
          sendJson(res, 404, { error: plan.error ?? 'no such checkpoint', plan });
          return;
        }
        const planned: PostCheckpointPlanResponse = { plan };
        sendJson(res, 200, planned);
        return;
      }

      if (!plan.ok) {
        // The plan travels WITH the refusal: `unrecoverable` is the actionable
        // part and a bare `{error}` would throw it away.
        const refused: PostCheckpointRestoreResponse = { plan };
        sendJson(res, plan.unrecoverable.length > 0 ? 409 : 404, {
          ...refused,
          error: plan.error ?? 'restore refused',
        });
        return;
      }
      const applied = applyRestore(activeRoot(), plan);
      // A restore changes files on disk, so the graph the client holds is now
      // behind them — same honesty as PUT /api/file's `stale` marker.
      if (applied.ok && (applied.wrote.length > 0 || applied.deleted.length > 0)) {
        clearCachedGraph(activeRoot());
        markGraphStale(applied.wrote[0] ?? applied.deleted[0]);
      }
      const done: PostCheckpointRestoreResponse = { plan, applied };
      sendJson(res, applied.ok ? 200 : 500, done);
      return;
    }

    // ==================== Wave 5: MCP consume (allowlisted) ====================
    // GET/PUT /api/mcp — repo `.sequence/mcp.json` (Settings editor; file only).
    // GET /api/mcp/tools → { tools: [{ server, name, description? }], errors: [] }
    // POST /api/mcp/call { server, tool, args? } → { server, tool, content?, isError? }
    // Tools/call honor optional repo attach for env merge; config GET/PUT requires repo.

    if (pathname === '/api/mcp') {
      if (requireRepo(res)) return;
      if (requireOwner()) return;
      const rel = `.sequence/mcp.json`;
      if (method === 'GET') {
        const loaded = loadMcpConfigFromFile(activeRoot());
        const body: GetMcpConfigResponse = {
          path: rel,
          exists: loaded.exists,
          document: loaded.config,
          text: serializeMcpConfig(loaded.config),
          warnings: loaded.warnings,
        };
        sendJson(res, 200, body);
        return;
      }
      if (method === 'PUT') {
        if (!isJsonRequest(req)) {
          sendError(res, 415, 'expected content-type application/json');
          return;
        }
        let body: Unvalidated<PutMcpConfigRequest>;
        try {
          body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
        } catch (e) {
          sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
          return;
        }
        if (typeof body.text !== 'string') {
          sendError(res, 400, 'body must include a string "text" (the mcp.json contents)');
          return;
        }
        const { config, warnings } = parseMcpConfigDocument(body.text, rel);
        if (
          warnings.some((w) =>
            /not valid JSON|expected a JSON object|missing "servers"|"servers" must be an object/i.test(w),
          )
        ) {
          sendError(res, 400, warnings[0] ?? 'invalid mcp document');
          return;
        }
        writeMcpConfigDocument(activeRoot(), config);
        const written: PutMcpConfigResponse = {
          path: rel,
          document: config,
          text: serializeMcpConfig(config),
          warnings,
        };
        sendJson(res, 200, written);
        return;
      }
      sendError(res, 405, 'method not allowed');
      return;
    }

    if (pathname === '/api/mcp/tools' && method === 'GET') {
      if (requireOwner()) return;
      try {
        const result: GetMcpToolsResponse = await listMcpTools(repoRoot);
        sendJson(res, 200, result);
      } catch (e) {
        sendError(res, 500, `mcp list failed: ${(e as Error).message}`);
      }
      return;
    }

    if (pathname === '/api/mcp/call' && method === 'POST') {
      if (requireOwner()) return;
      if (!isJsonRequest(req)) {
        sendError(res, 415, 'expected content-type application/json');
        return;
      }
      let body: Unvalidated<PostMcpCallRequest>;
      try {
        body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
      } catch (e) {
        sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
        return;
      }
      if (typeof body.server !== 'string' || body.server.length === 0) {
        sendError(res, 400, 'body must include a string "server"');
        return;
      }
      if (typeof body.tool !== 'string' || body.tool.length === 0) {
        sendError(res, 400, 'body must include a string "tool"');
        return;
      }
      try {
        const result: PostMcpCallResponse = await callMcpTool(repoRoot, body.server, body.tool, body.args);
        sendJson(res, 200, result);
      } catch (e) {
        if (e instanceof UnknownMcpServerError) {
          sendError(res, 400, e.message);
          return;
        }
        if (e instanceof McpTransportError) {
          sendError(res, 502, `mcp call failed: ${e.message}`);
          return;
        }
        sendError(res, 500, `mcp call failed: ${(e as Error).message}`);
      }
      return;
    }

    // C2.5 — POST /api/net-fetch → scoped public URL fetch (Browser panel + tests).
    if (pathname === '/api/net-fetch' && method === 'POST') {
      if (requireOwner()) return;
      if (!isJsonRequest(req)) {
        sendError(res, 415, 'expected content-type application/json');
        return;
      }
      let body: Unvalidated<PostNetFetchRequest>;
      try {
        body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
      } catch (e) {
        sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
        return;
      }
      if (typeof body.url !== 'string' || body.url.trim().length === 0) {
        sendError(res, 400, 'body must include a non-empty string "url"');
        return;
      }
      const fetched = await netFetchUrl(body.url.trim());
      const response: PostNetFetchResponse = {
        url: fetched.url,
        ok: fetched.ok,
        status: fetched.status,
        title: fetched.title,
        text: fetched.text,
        error: fetched.error,
      };
      sendJson(res, 200, response);
      return;
    }

    // C2.3 — GET /api/plugins → readonly list from `.sequence/plugins.json`.
    // askWired: true when call_plugin is on the ask belt (readonly builtins).
    if (pathname === '/api/plugins' && method === 'GET') {
      if (requireOwner()) return;
      if (requireRepo(res)) return;
      const loaded = loadPluginManifestV0(repoRoot!);
      if (!loaded.ok) {
        const body: GetPluginsResponse = {
          ok: false,
          plugins: [],
          error: loaded.error,
          path: loaded.path,
          askWired: true,
        };
        sendJson(res, 200, body);
        return;
      }
      const body: GetPluginsResponse = {
        ok: true,
        plugins: loaded.manifest.plugins.map((p) => ({
          id: p.id,
          ...(p.title ? { title: p.title } : {}),
          mode: 'readonly' as const,
          tools: p.tools.map((t) => ({
            name: t.name,
            ...(t.description ? { description: t.description } : {}),
          })),
        })),
        path: loaded.path,
        askWired: true,
      };
      sendJson(res, 200, body);
      return;
    }

    // ---- any other /api/* is unknown ----
    if (pathname.startsWith('/api/')) {
      sendError(res, 404, `unknown endpoint: ${method} ${pathname}`);
      return;
    }

    // ---- static viewer ----
    if (method !== 'GET') {
      sendError(res, 405, 'method not allowed');
      return;
    }
    if (!webDist) {
      sendError(res, 404, 'web viewer not built (pass --web <dist-dir>)');
      return;
    }
    serveStatic(webDist, pathname, res);
  }

  /**
   * Load + revalidate the on-disk AI config; undefined when unset or corrupt.
   *
   * PRECEDENCE (v8 Phase B2): when a repo is attached, the PER-REPO
   * `.sequence/ai.json` is the ONLY source — today's behavior, byte-for-byte
   * (per-repo wins; no silent fall-through to the user-level file). When NO repo
   * is attached (the from-scratch design flow), the USER-LEVEL `~/.sequence/ai.json`
   * is used. Same key hygiene both ways: the raw key is only ever put on the wire
   * by provider.ts, and is redacted before any client sees it.
   */
  /**
   * The scan options, plus the connected model when there is one. Structural
   * copy of only the fields `llmLabels` needs — the key never travels further
   * than the request the labeller makes.
   */
  function withLabelModel(scan: ScanOptions | undefined): ScanOptions | undefined {
    const cfg = loadAiConfig();
    if (!cfg || !cfg.apiKey) return scan;
    return {
      ...(scan ?? {}),
      labelModel: {
        provider: cfg.provider,
        baseUrl: cfg.baseUrl,
        model: cfg.model,
        apiKey: cfg.apiKey,
      },
    };
  }

  function loadAiConfig(): AiConfig | undefined {
    let cfg: AiConfig | undefined;
    if (repoRoot !== null) {
      /*
       * AN UNTRUSTED REPOSITORY DOES NOT GET TO CHOOSE THE PROVIDER.
       *
       * `.sequence/ai.json` is repo-provided config and it WINS over the user's
       * own when valid, so a hostile repository could commit one whose `baseUrl`
       * is its own host and every question, file excerpt and snippet the ask
       * pipeline sends would go there. It cannot steal the user's key — the repo
       * supplies its own — which is exactly why this is easy to miss and worse
       * than it looks: nothing leaks a credential, the user's CODE simply leaves
       * the machine to an endpoint they never chose.
       *
       * The trust ruling says an untrusted repo's config is ignored, and this is
       * that file. `permissions.json` is gated the same way in
       * `loadPermissionPolicy` and for the same reason; that one grants power,
       * this one redirects traffic, and both are writable by whoever wrote the
       * repository.
       *
       * IGNORED, NOT REFUSED. Falling through to the user-level config and env
       * keeps the app working on an untrusted repo — local-first is
       * non-negotiable and a provider choice is not a reason to stop answering.
       *
       * IT IS SAID ON SCREEN BY THE TRUST STRIP, not by a warning invented here.
       * `GET /api/repo-trust` already reports what an untrusted repository is
       * being denied and `TrustStrip` renders it, so this limitation belongs in
       * that one list beside the instruction file and `run_command`. A second
       * warnings channel for one file would be a second place to keep in sync,
       * and the strip is where a reader is already looking for this answer.
       *
       * `isRepoTrusted`'s OWN default store, never `userConfigDir` — the
       * boundary has exactly one store, and a caller that redirected the config
       * read must not also redirect the trust read.
       */
      const raw = isRepoTrusted(repoRoot) ? readJson(activeRoot(), AI_FILE) : undefined;
      cfg = raw === undefined ? undefined : validateAiConfig(raw).config;
      // Per-repo ai.json wins when valid; missing/invalid falls through to the
      // user-level ~/.sequence/ai.json (OF-K01) before env.
      if (!cfg) {
        const userRaw = readUserJson(userConfigDir, AI_FILE);
        cfg = userRaw === undefined ? undefined : validateAiConfig(userRaw).config;
      }
    } else {
      const raw = readUserJson(userConfigDir, AI_FILE);
      cfg = raw === undefined ? undefined : validateAiConfig(raw).config;
    }
    // Env fallback when no on-disk ai.json: OPENROUTER_API_KEY / SEQUENCE_AI_KEY
    // (and related SEQUENCE_*/OPENROUTER_* vars — see readAiEnvPrefill). Key stays
    // server-side; redactAiConfig never returns it.
    if (!cfg) cfg = aiConfigFromEnv();
    // Route a default-mode config at the gateway seam: when a gateway URL was
    // actually configured (SEQUENCE_GATEWAY_URL on a real deploy, or the test
    // injection), point at it AND stamp it live — the provider's honest free-tier
    // gate keys on this runtime-only stamp, never on URL equality (so a deploy at
    // the placeholder's own hostname works; v18 review round 1). Without a
    // configured gateway the stamp stays absent and default mode refuses before
    // any fetch. api-key configs are never rewritten — the user's key + host are
    // untouched. The stamp is never persisted (the PUT path writes a fresh
    // validated object).
    if (cfg && (cfg.mode ?? 'api-key') === 'default') {
      if (deepSeekConfigured()) {
        // U6 fix — the FREE default routes STRAIGHT to DeepSeek, funded by the owner's
        // DEEPSEEK_API_KEY (a SERVER secret read only at wire time in provider.ts's
        // resolveEndpoint — NEVER placed in this config, so it can never reach
        // redactAiConfig or a client). gatewayLive:true passes the honest gate so a
        // keyless user's assistant works. Base/model come from env
        // (DEEPSEEK_BASE_URL/DEEPSEEK_MODEL) or the real DeepSeek defaults; the stored
        // placeholder model is overridden with the real DeepSeek model name.
        cfg = {
          ...cfg,
          provider: 'openai-compatible',
          baseUrl: deepSeekBaseUrl(),
          model: deepSeekModel(),
          gatewayLive: true,
        };
      } else if (gatewayBaseUrl) {
        // Existing SEQUENCE_GATEWAY_URL seam — unchanged (the hosted-gateway path).
        cfg = { ...cfg, baseUrl: gatewayBaseUrl, gatewayLive: true };
      } else {
        // The free tier is unservable here, so it does not outrank a supplied
        // key. One rule, shared with the CLI — see preferEnvOverUnservableDefault.
        cfg = preferEnvOverUnservableDefault(cfg, { defaultIsServable: false });
      }
      // With none of the three ⇒ no stamp ⇒ provider.ts refuses with the honest
      // FREE_TIER_NOT_LIVE_MSG before any fetch (behavior UNCHANGED when no key set).
    }
    return cfg;
  }

  /* ----------------------------- default-mode meter ----------------------------
   * The FREE metered default (v9 Phase 2). Usage lives USER-level in usage.json;
   * api-key mode is NEVER metered. {@link callProviderMetered} is the single wrapper
   * every default-mode request funnels through: it HARD-blocks only at the global
   * spend backstop, lets a soft-capped user through (a nudge, not a wall), and
   * increments usage ONLY on a successful call. It carries no secret. */

  function loadUsage(identity: string): MeterUsage {
    return usageStore.read(identity);
  }

  interface ProviderMeteredResult {
    text: string;
    usage?: { inputTokens: number; outputTokens: number; estimated: boolean };
    toolRequests?: ProviderToolRequest[];
    /** The provider layer's retry count for this call, passed through untouched for the run receipt. */
    retries?: number;
  }

  function usageFromProvider(
    prompt: string,
    text: string,
    providerUsage?: import('../llm/usageExtraction.js').ExtractedProviderUsage,
  ): ProviderMeteredResult['usage'] {
    if (providerUsage) {
      return {
        inputTokens: providerUsage.inputTokens,
        outputTokens: providerUsage.outputTokens,
        estimated: false,
      };
    }
    return {
      inputTokens: approxTokens(prompt),
      outputTokens: approxTokens(text),
      estimated: true,
    };
  }

  /**
   * Metered provider call that also returns token usage for the ask trace.
   */
  async function callProviderMeteredWithUsage(
    cfg: AiConfig,
    prompt: string,
    identity: string,
    /**
     * Item 1.3. When it fires before the provider answers, this call resolves
     * as an abort and `recordUse` below is never reached — the single place a
     * default-mode ask is charged, so this race IS the "not metered after Stop"
     * guarantee. Absent ⇒ every pre-1.3 caller behaves byte-identically.
     */
    signal?: AbortSignal,
    /**
     * Where the answer's tokens go as they arrive. Optional: every pre-existing
     * caller passes nothing and streams nothing, exactly as before.
     */
    onDelta?: (text: string) => void,
    /** B2.2 — openai-compatible native tools when the ask belt is non-empty. */
    tools?: ProviderStreamOptions['tools'],
    /** Prompt-caching hint from the ask pipeline (invariant-prefix chars). */
    cacheBreakpointChars?: number,
  ): Promise<ProviderMeteredResult> {
    throwIfAborted(signal);
    if ((cfg.mode ?? 'api-key') !== 'default') {
      const { text, providerUsage, toolRequests, retries } = await raceAbort(
        generateTextWithUsage(
          cfg,
          prompt,
          providerCallOptions(signal, onDelta, tools, cacheBreakpointChars),
        ),
        signal,
      );
      return {
        text,
        usage: usageFromProvider(prompt, text, providerUsage),
        ...(toolRequests?.length ? { toolRequests } : {}),
        ...(retries !== undefined ? { retries } : {}),
      };
    }
    const gate = await dailyGate.consume(identity);
    if (!gate.allowed) {
      throw gate.reason === 'store-unavailable'
        ? new ProviderError(FREE_TIER_LIMIT_UNAVAILABLE_MSG, { httpStatus: 503 })
        : new RateLimitError();
    }
    try {
      throwIfAborted(signal);
      const my = currentMonthYear();
      const usage = usageStore.read(identity);
      const decision = decide(usage, DEFAULT_METER_POLICY);
      if (!decision.allow) {
        throw new ProviderError(
          'the free default model is temporarily unavailable (monthly spend backstop reached) — add your own API key to keep going',
        );
      }
      const { text, providerUsage, toolRequests, retries } = await raceAbort(
        generateTextWithUsage(cfg, prompt, providerCallOptions(signal, onDelta, tools)),
        signal,
      );
      usageStore.write(identity, recordUse(usage, my));
      return {
        text,
        usage: usageFromProvider(prompt, text, providerUsage),
        ...(toolRequests?.length ? { toolRequests } : {}),
        ...(retries !== undefined ? { retries } : {}),
      };
    } catch (e) {
      // An aborted turn refunds the daily reservation for the same reason every
      // other failure does: a call the user did not get an answer from must not
      // consume their quota.
      await dailyGate.refund(identity);
      throw e;
    }
  }

  /**
   * The connector passed to the provider layer; meters default mode, passes api-key
   * straight through. `identity` (from {@link extractIdentity}) keys the meter per
   * user via the {@link UsageStore}, so a soft-capped user cannot read OR charge
   * another's usage — meter.ts stays identity-agnostic (usage in, decision out).
   */
  async function callProviderMetered(
    cfg: AiConfig,
    prompt: string,
    identity: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const { text } = await callProviderMeteredWithUsage(cfg, prompt, identity, signal);
    return text;
  }

  /**
   * The metered counterpart of {@link generateFiles} for the file-generation
   * funnel (/api/generate, /api/prompt-file). It closes the v12 metering GAP: those
   * routes call {@link generateAndApply} → generateFiles DIRECTLY, so default-mode
   * free-tier file generation was NOT counted. This wrapper applies the SAME meter
   * as {@link callProviderMetered} — backstop hard-block, then charge one call ONLY
   * on a successful gateway reply — while api-key mode passes straight through,
   * byte-identical and unmetered.
   */
  async function generateFilesMetered(
    cfg: AiConfig,
    prompt: string,
    identity: string,
    /** Item 1.3 — same rule as the ask funnel: a stopped generate is not charged. */
    signal?: AbortSignal,
  ): Promise<ProviderReply> {
    throwIfAborted(signal);
    if ((cfg.mode ?? 'api-key') !== 'default') {
      // api-key (or mode-less): unmetered pass-through — unchanged behaviour.
      return raceAbort(generateFiles(cfg, prompt), signal);
    }
    // Per-user DAILY free-tier cap: the first gate, an honest 429 over the cap.
    // Charged BEFORE any spend/network work — a single atomic charge-and-check, so
    // instances sharing one database enforce ONE cap instead of one cap each. Over
    // the cap (or with the durable counter unreachable) the DeepSeek/gateway is
    // never contacted and nothing is spent. api-key mode already returned above.
    const gate = await dailyGate.consume(identity);
    if (!gate.allowed) {
      // A durable counter that is CONFIGURED but failing denies rather than
      // silently falling back to a permissive in-memory count (see
      // createDurableDailyGate's failure posture) — honest 503, not a fake 429.
      throw gate.reason === 'store-unavailable'
        ? new ProviderError(FREE_TIER_LIMIT_UNAVAILABLE_MSG, { httpStatus: 503 })
        : new RateLimitError();
    }
    try {
      const my = currentMonthYear();
      const usage = usageStore.read(identity);
      const decision = decide(usage, DEFAULT_METER_POLICY);
      if (!decision.allow) {
        // The ONLY hard block: the global spend backstop. Surfaced as a ProviderError
        // so generateAndApply's existing 502 catch handles it; usage is NOT charged.
        throw new ProviderError(
          'the free default model is temporarily unavailable (monthly spend backstop reached) — add your own API key to keep going'
        );
      }
      throwIfAborted(signal);
      const reply = await raceAbort(generateFiles(cfg, prompt), signal);
      // Charge only a call that actually reached the gateway and returned a usable reply.
      usageStore.write(identity, recordUse(usage, my));
      return reply;
    } catch (e) {
      // Same refund rule as the ask funnel: a call that never returned costs nothing.
      await dailyGate.refund(identity);
      throw e;
    }
  }

  /**
   * Load + revalidate the on-disk LOCAL GitHub token config; undefined when unset
   * or corrupt. ALWAYS user-level (`~/.sequence/github.json`), regardless of attach
   * state — a GitHub PAT is a user credential, never per-repo memory, so it is
   * never read from (or written into) a scanned repo. Same key hygiene as
   * {@link loadAiConfig}: the raw token is only ever put on the wire by github.ts.
   */
  function loadGithubConfig(): GithubConfig | undefined {
    const raw = readUserJson(userConfigDir, GITHUB_FILE);
    return raw === undefined ? undefined : validateGithubConfig(raw).config;
  }

  /**
   * Canonical (realpath-resolved) locations of the reserved dirs, recomputed on
   * each call because `.sequence/` is created lazily on the first write. Each dir
   * contributes its LEXICAL path (`<root>/.sequence`) and, when it exists on
   * disk, its REALPATH too — so a target is caught whether it lands there
   * directly or the reserved dir itself is a symlink.
   *
   * The set:
   *   - `.sequence` — holds the plaintext BYO API key (ai.json) + per-repo spec/state.
   *   - `.git`      — repo internals (config, hooks, objects).
   *   - `.ssh`      — SSH private keys (id_rsa/id_ed25519) and authorized_keys.
   *   - `.aws`      — AWS access-key credentials.
   *   - `.gnupg`    — GnuPG private keyrings.
   * The last three are the common local-secret dirs (F1 defence-in-depth): even a
   * legitimately-attached directory that happens to CONTAIN one of them — or a
   * broadly-scoped attach that somehow slips past the layer-1 browse-root guard —
   * still cannot read (/api/file, /api/prompt-file) or write (generate path) them.
   * Matching is on the REALPATH (see {@link isReservedResolved}), so a symlink to
   * `.ssh` is caught too.
   */
  function reservedRoots(): string[] {
    const root = activeRoot();
    const roots: string[] = [];
    for (const name of ['.sequence', '.git', '.ssh', '.aws', '.gnupg']) {
      const lex = path.join(root, name);
      roots.push(lex);
      try {
        const real = fs.realpathSync(lex);
        if (real !== lex) roots.push(real);
      } catch {
        // reserved dir not present yet — its lexical path still guards new writes
      }
    }
    return roots;
  }

  /**
   * True if `abs` (already jail-resolved / contained) resolves — following any
   * in-repo symlinks — into a reserved dir (.sequence holds the plaintext API
   * key; .git holds repo internals). The check is on the REALPATH, not the
   * caller's LEXICAL input: a symlink named `docs` → `.sequence` has a benign
   * lexical top segment (`docs`) but canonicalises INTO `.sequence`, so the old
   * lexical top-segment match let `docs/ai.json` through and leaked the key.
   * Judging on the realpath also closes the case-insensitive-FS gap by
   * construction (`.SEQUENCE` canonicalises to the on-disk `.sequence`).
   */
  function isReservedResolved(abs: string): boolean {
    const canonical = realpathContained(abs);
    return reservedRoots().some((r) => canonical === r || canonical.startsWith(r + path.sep));
  }

  /**
   * ADR-009: the ONE narrow hole in the `.sequence` reservation — a decision
   * record is a user artifact, not platform state.
   *
   * Judged on the REALPATH, never the caller's lexical string. The lexical form
   * was a write-jail ESCAPE: a repo can commit a symlink `.sequence/decisions`
   * → `.git` (git stores symlinks, so a clone carries it), after which the
   * benign-looking relative path `.sequence/decisions/pre-commit` passed the
   * check while the write landed in `.git/hooks` — arbitrary code execution on
   * the user's next commit. Pointing it at `.sequence` instead clobbered the
   * plaintext API key. Canonicalising first makes both cases resolve OUT of the
   * allowed subtree and be refused.
   *
   * Also bounded to `.md`: a decision record is markdown. Without this the hole
   * is an arbitrary-filename write, which is what made the hook payload above
   * possible in the first place.
   */
  function isDecisionRecordPath(abs: string): boolean {
    const canonical = realpathContained(abs);
    const rel = path.relative(activeRoot(), canonical).replace(/\\/g, '/');
    return rel.startsWith('.sequence/decisions/') && rel.endsWith('.md');
  }

  /**
   * The WRITE side needs the same aliasing guard the read side has.
   *
   * It used to be a bare alias for {@link isDecisionRecordPath}, i.e. path-shape
   * only. `realpathSync` does not resolve HARD links, so a hard link at
   * `.sequence/decisions/leak.md` pointing at `.sequence/ai.json` looked like an
   * ordinary record and a single "Open in editor" OVERWROTE the user's stored API
   * key with markdown. Reading through that link was already refused; writing was
   * not. Require the same plain-unaliased-file property here — and allow a path
   * that does not exist yet, which is the normal case for a new record.
   */
  function isDecisionRecordWritePath(abs: string): boolean {
    if (!isDecisionRecordPath(abs)) return false;
    let st: fs.Stats;
    try {
      st = fs.lstatSync(realpathContained(abs));
    } catch {
      return true; // brand-new record — nothing to alias yet
    }
    return st.isFile() && st.nlink === 1;
  }

  /**
   * SeqDiagram ship (Phase A): a NARROW write hole for export auto-write —
   * `.sequence/diagrams/<slug>.seqd` only. Platform memory (ai.json, spec,
   * state) stays reserved; this is a user-shareable diagram artifact the
   * product writes when the owner opts in via Settings.
   *
   * Same discipline as {@link isDecisionRecordPath}: judged on the REALPATH,
   * bounded to `.seqd` under `diagrams/`, not an arbitrary `.sequence/` dump.
   */
  function isSeqDiagramPath(abs: string): boolean {
    const canonical = realpathContained(abs);
    const rel = path.relative(activeRoot(), canonical).replace(/\\/g, '/');
    return (
      (rel.startsWith('.sequence/diagrams/') || rel.startsWith('.sequence/workflows/')) &&
      rel.endsWith('.seqd')
    );
  }

  /** WRITE side — same aliasing guard as {@link isDecisionRecordWritePath}. */
  function isSeqDiagramWritePath(abs: string): boolean {
    if (!isSeqDiagramPath(abs)) return false;
    let st: fs.Stats;
    try {
      st = fs.lstatSync(realpathContained(abs));
    } catch {
      return true; // brand-new export — nothing to alias yet
    }
    return st.isFile() && st.nlink === 1;
  }

  /**
   * READ side — same aliasing guard as {@link isDecisionRecordReadPath}.
   * `.sequence/diagrams/<slug>.seqd` is a user-shareable artifact the product
   * writes via {@link isSeqDiagramWritePath}; refusing to read it back made
   * save-then-reopen a dead end.
   */
  function isSeqDiagramReadPath(abs: string): boolean {
    if (!isSeqDiagramPath(abs)) return false;
    let st: fs.Stats;
    try {
      st = fs.lstatSync(realpathContained(abs));
    } catch {
      return true;
    }
    return st.isFile() && st.nlink === 1;
  }

  /**
   * Chat plan artifacts — `.sequence/plans/<slug>.md` only. Same discipline as
   * decision records: judged on realpath, bounded to markdown under plans/.
   */
  function isPlanPath(abs: string): boolean {
    const canonical = realpathContained(abs);
    const rel = path.relative(activeRoot(), canonical).replace(/\\/g, '/');
    return rel.startsWith('.sequence/plans/') && rel.endsWith('.md');
  }

  function isPlanWritePath(abs: string): boolean {
    if (!isPlanPath(abs)) return false;
    let st: fs.Stats;
    try {
      st = fs.lstatSync(realpathContained(abs));
    } catch {
      return true;
    }
    return st.isFile() && st.nlink === 1;
  }

  function isPlanReadPath(abs: string): boolean {
    if (!isPlanPath(abs)) return false;
    let st: fs.Stats;
    try {
      st = fs.lstatSync(realpathContained(abs));
    } catch {
      return true;
    }
    return st.isFile() && st.nlink === 1;
  }

  /**
   * ADR-009 (read side). A decision record is a USER artifact, not platform
   * state: the write allowlist already lets one be created under
   * `.sequence/decisions/`, so refusing to read it back made "Open in editor"
   * write a file the editor could never reopen by path.
   *
   * Judged on the REALPATH, exactly like {@link isReservedResolved}: a symlink
   * planted at `.sequence/decisions/key.md` → `.sequence/ai.json` canonicalises
   * OUT of the allowlisted subtree and stays refused.
   *
   * A symlink is NOT the only aliasing primitive, though — `fs.realpathSync`
   * does not resolve HARD links, so a hard link at `.sequence/decisions/leak.md`
   * → `.sequence/ai.json` canonicalises to itself, sits inside the allowlist,
   * and would serve the plaintext key. A hard link to an existing file is the
   * only way a regular file inside this subtree can carry a link count above
   * one, so refusing `nlink > 1` closes that without affecting any record the
   * product itself writes. Anything unstattable is refused.
   */
  function isDecisionRecordReadPath(abs: string): boolean {
    if (!isDecisionRecordPath(abs)) return false;
    let st: fs.Stats;
    try {
      st = fs.lstatSync(realpathContained(abs));
    } catch {
      // Nothing there. The path IS allowlisted, so let the normal read handler
      // answer 404 "file not found" rather than 403 "reserved". That difference
      // is load-bearing for the client: "Open in editor" may only generate a
      // record when the server says it is genuinely ABSENT, so collapsing absent
      // into 403 would make creating the very first record impossible.
      return true;
    }
    // It exists: it must be a plain, unaliased file. `realpathSync` resolves
    // symlinks but NOT hard links, so a hard link to `.sequence/ai.json` would
    // otherwise sit inside the allowlist and serve the plaintext key.
    return st.isFile() && st.nlink === 1;
  }

  /**
   * G-E: the SECOND narrow hole in the `.sequence` reservation — a per-org
   * harness policy is a repo-COMMITTED source artifact (it ships in git; see the
   * `.gitignore` carve-out), so a user must be able to open the file the server
   * is enforcing. It is deliberately a PARALLEL derivation of the ADR-009
   * discipline rather than a shortcut through it:
   *
   *   - judged on the REALPATH, never the caller's lexical string. A repo can
   *     commit a symlink `.sequence/policies` → `.git` (git stores symlinks, so a
   *     clone carries it) and then `.sequence/policies/hook.json` would read out
   *     of `.git`; canonicalising first makes it resolve OUT of the allowed
   *     subtree and be refused. Pointed at `.sequence` itself it would serve the
   *     plaintext API key, which is the same refusal.
   *   - bounded to `.json`, exactly as the decision-record hole is bounded to
   *     `.md`. An arbitrary-filename hole under `.sequence` is how the ADR-009
   *     write escape became executable in the first place.
   *   - `realpathSync` does NOT resolve HARD links, so a hard link at
   *     `.sequence/policies/leak.json` → `.sequence/ai.json` canonicalises to
   *     itself, sits inside the allowlist and would serve the key. A hard link is
   *     the only way a regular file here carries `nlink > 1`, so requiring a
   *     plain unaliased file closes it. Anything unstattable is refused.
   *
   * READ ONLY. There is no policy WRITE hole: policies are authored in the user's
   * editor and committed like any other source, so the product never needs to
   * write one, and a write hole under `.sequence` is pure risk for no feature.
   */
  function isPolicyPath(abs: string): boolean {
    const canonical = realpathContained(abs);
    const rel = path.relative(activeRoot(), canonical).replace(/\\/g, '/');
    return rel.startsWith('.sequence/policies/') && rel.endsWith('.json');
  }

  function isPolicyReadPath(abs: string): boolean {
    if (!isPolicyPath(abs)) return false;
    let st: fs.Stats;
    try {
      st = fs.lstatSync(realpathContained(abs));
    } catch {
      // Absent: the path IS allowlisted, so let the read handler answer an honest
      // 404 "not found" rather than a misleading 403 "reserved".
      return true;
    }
    return st.isFile() && st.nlink === 1;
  }

  /**
   * The SINGLE choke point every file-READ endpoint funnels a caller-supplied
   * repo-relative path through: the jail (traversal / symlink escape) AND the
   * reserved-dir refusal (.sequence holds the plaintext API key; .git holds repo
   * internals). Returns the absolute on-disk path, or `null` when the path
   * escapes the repo or targets a reserved dir. Read handlers turn `null` into a
   * 403 — no per-handler copies of this rule.
   */
  function resolveReadablePath(rel: string): string | null {
    const abs = resolveInRepo(activeRoot(), rel);
    if (abs === null) return null;
    if (
      isReservedResolved(abs) &&
      !isDecisionRecordReadPath(abs) &&
      !isPolicyReadPath(abs) &&
      !isSeqDiagramReadPath(abs) &&
      !isPlanReadPath(abs)
    )
      return null;
    return abs;
  }

  /**
   * P3 Auto-edit / Full — write proposed files through the same jail +
   * pre-write hooks as PUT /api/file. Used by the ask pipeline when the
   * user opted into a writing mode.
   */
  async function applyAskProposedFiles(
    files: readonly { path: string; content: string }[],
    trackWrite?: (rel: string) => void,
  ): Promise<{
    written: string[];
    refused: { path: string; reason: string }[];
    blockedByHook?: string;
  }> {
    return applyAskFileWrites(files, {
      repoRoot: activeRoot(),
      ...(trackWrite ? { trackWrite } : {}),
      resolveWritable: (rel) => {
        const abs = resolveInRepo(activeRoot(), rel);
        if (abs === null) return null;
        if (isReservedResolved(abs)) return null;
        const allow = rejectOutsideEditAllowlist(rel.replace(/\\/g, '/'));
        if (!allow.ok) return null;
        return abs;
      },
      runPreWriteHook: async (rel) => {
        const hookOutcome = await runHooks('pre-write', {
          repoRoot: activeRoot(),
          file: readHookFile(activeRoot()),
          trusted: isTrusted(activeRoot(), readHookTrust(userConfigDir)),
          payload: { path: rel },
        });
        if (hookOutcome.allowed) return { allowed: true };
        const blocked = hookOutcome.outcomes.find((o) => o.kind === 'blocked');
        return {
          allowed: false,
          reason: `blocked by a pre-write hook (${blocked?.command ?? 'hook'}): ${
            blocked && 'reason' in blocked ? blocked.reason : 'no reason given'
          }`,
        };
      },
    });
  }

  /**
   * P10 for the agent's OWN writes (audit gap G1).
   *
   * `trackSessionWrite` had one production caller — PUT /api/file — so the two
   * modes where the agent writes without an Accept (Auto-edit / Full) produced
   * writes no checkpoint could undo, under Rewind copy promising a restore
   * point before a turn edits files. This closure is the missing half, and it
   * follows the Review-pane apply's rule word for word: the checkpoint is taken
   * BEFORE the first byte lands, "because a restore point captured after the
   * writes is a restore point to the state you are trying to escape."
   *
   * ONE INSTANCE PER REQUEST. The first-write latch is a variable in this
   * closure, never module state: two turns in flight on one session must each
   * take their own point, and a shared flag would leave the second turn with
   * the first turn's baseline.
   *
   * An id that fails `isCheckpointSessionId` — or no id at all, which is every
   * caller written before `PostAskRequest.sessionId` existed — tracks nothing
   * and creates no directory; the ask itself is never refused for it. A
   * capture or tracking failure is surfaced on stderr and the write proceeds:
   * the user opted into auto-writes, the edit is the request, and refusing it
   * because the safety net could not be hung would trade a real loss for a
   * hypothetical one (the same posture PUT /api/file takes).
   */
  function askTurnCheckpointTracker(
    rawSessionId: unknown,
    question: string,
  ): { trackWrite: ((rel: string) => void) | undefined; rollbackPoint: () => number | undefined } {
    if (!isCheckpointSessionId(rawSessionId)) {
      if (rawSessionId !== undefined) {
        process.stderr.write(
          'sequence: ask body carried a sessionId that is not a checkpoint session id — agent writes this turn will not be tracked\n',
        );
      }
      return { trackWrite: undefined, rollbackPoint: () => undefined };
    }
    const sessionId = rawSessionId;
    let seq: number | undefined;
    let captured = false;
    return {
      trackWrite: (rel) => {
        if (!captured) {
          // Latched BEFORE the attempt, not after success: a capture that threw
          // once (an oversized tracked file, say) would throw on every later
          // write this turn too, and retrying it per file buys nothing.
          captured = true;
          try {
            const label = question.trim().replace(/\s+/g, ' ').slice(0, 80);
            seq = captureCheckpoint(activeRoot(), sessionId, {
              label: `Before the agent's first write this turn: ${label}`,
            }).seq;
          } catch (e) {
            process.stderr.write(`sequence: checkpoint capture failed: ${(e as Error).message}\n`);
          }
        }
        // The SAME spelling PUT /api/file tracks under — repo-relative from the
        // resolved absolute path — not the model's (`./a//b`, mixed slashes),
        // so one file edited by both doors is one tracked file, not two.
        trackSessionWrite(activeRoot(), sessionId, path.relative(activeRoot(), path.resolve(activeRoot(), rel)));
      },
      rollbackPoint: () => seq,
    };
  }

  function programEditAllowlist(): string[] | undefined {
    return readProgramEditAllowlist(activeRoot());
  }

  function rejectOutsideEditAllowlist(
    relPosix: string,
  ): { ok: true } | { ok: false; reason: string } {
    const allowlist = programEditAllowlist();
    if (allowlist && !pathMatchesProgramEditAllowlist(relPosix, allowlist)) {
      return { ok: false, reason: 'path outside program.md Agent may edit allowlist' };
    }
    return { ok: true };
  }

  /**
   * Validate every model-supplied write path against the jail AND the reserved
   * dirs. A malicious/confused response must not escape the repo or clobber the
   * platform's own state — so we vet ALL paths first and refuse the WHOLE
   * request if any is bad (nothing is written on rejection).
   */
  function vetWritePaths(files: GeneratedFile[]): {
    safe: { abs: string; rel: string; content: string }[];
    rejected: { path: string; reason: string }[];
  } {
    const root = activeRoot();
    const safe: { abs: string; rel: string; content: string }[] = [];
    const rejected: { path: string; reason: string }[] = [];
    let total = 0;
    for (const f of files) {
      const abs = resolveInRepo(root, f.path);
      if (abs === null) {
        rejected.push({ path: f.path, reason: 'absolute, traversal, or symlink-escaping path' });
        continue;
      }
      if (isReservedResolved(abs)) {
        rejected.push({
          path: f.path,
          reason: 'writes into reserved dirs (.sequence/ or .git/ or .ssh/.aws/.gnupg) are refused',
        });
        continue;
      }
      const relPosix = path.relative(root, abs).replace(/\\/g, '/');
      const allowCheck = rejectOutsideEditAllowlist(relPosix);
      if (!allowCheck.ok) {
        rejected.push({ path: f.path, reason: allowCheck.reason });
        continue;
      }
      // A directory already sitting at the write path: writeFileSync would throw
      // EISDIR mid-loop, after earlier files had already landed — a half-applied
      // response and a 500 the user cannot act on. Refuse it here, where refusal
      // is still all-or-nothing and the reason is nameable.
      let existing: fs.Stats | undefined;
      try {
        existing = fs.statSync(abs);
      } catch {
        existing = undefined; // nothing there — a plain create
      }
      if (existing && !existing.isFile()) {
        rejected.push({ path: f.path, reason: 'a directory already exists at this path' });
        continue;
      }
      const bytes = Buffer.byteLength(f.content, 'utf8');
      if (bytes > MAX_WRITE_FILE_BYTES) {
        rejected.push({ path: f.path, reason: `file exceeds the ${MAX_WRITE_FILE_BYTES}-byte per-file cap` });
        continue;
      }
      total += bytes;
      if (total > MAX_WRITE_TOTAL_BYTES) {
        rejected.push({ path: f.path, reason: `response exceeds the ${MAX_WRITE_TOTAL_BYTES}-byte total-write cap` });
        continue;
      }
      safe.push({ abs, rel: path.relative(root, abs), content: f.content });
    }
    return { safe, rejected };
  }

  /**
   * Human consent to REPLACE content that already exists on disk. `all` is the
   * blanket "yes, replace everything in this request"; `paths` is the per-file
   * confirmation list (the shape the board's Accept gate already speaks —
   * packages/web/src/panels/multiFileApply.ts `wouldOverwrite` → Accept). Absent
   * ⇒ NO consent, which is the only safe default.
   */
  type OverwriteConsent = { all: boolean; paths: Set<string> };

  const NO_OVERWRITE_CONSENT: OverwriteConsent = { all: false, paths: new Set<string>() };

  /** Repo-relative, forward-slashed, no `./` prefix — the form every check compares in. */
  function toRelPosix(rel: string): string {
    return rel.replace(/\\/g, '/').replace(/^\.\//, '');
  }

  /**
   * Read the request's `overwrite` field. Deliberately STRICT: a consent flag we
   * half-understand is the one field that must never be guessed at, so anything
   * that is not `true`, `false`, or a list of paths is an honest 400 rather than
   * a silent "no consent" (which would look like a bug) or a silent "consent"
   * (which would lose data).
   */
  function parseOverwriteConsent(raw: unknown): { consent: OverwriteConsent } | { error: string } {
    if (raw === undefined || raw === null || raw === false) return { consent: NO_OVERWRITE_CONSENT };
    if (raw === true) return { consent: { all: true, paths: new Set<string>() } };
    if (Array.isArray(raw) && raw.every((p) => typeof p === 'string' && p.trim() !== '')) {
      return { consent: { all: false, paths: new Set(raw.map((p) => toRelPosix(p.trim()))) } };
    }
    return {
      error:
        'to replace files that already have content, confirm the replacement — send true, or the list of files to replace',
    };
  }

  /**
   * The no-silent-data-loss gate (vision §5). A model-authored write may only
   * REPLACE a file that already holds content when the human confirmed THAT file.
   * Returns the repo-relative paths it protected — empty means every write is
   * either a create or a confirmed replacement.
   *
   * Not a loss, so no friction:
   *  - the path does not exist yet (a create);
   *  - the file on disk is empty (zero bytes — there is nothing to lose);
   *  - the new bytes are IDENTICAL to the old ones (a no-op rewrite: this is what
   *    a re-generate of an unchanged scaffold does, and refusing it would be
   *    noise, not protection).
   *
   * `impliedPath` is the one file the human named in the request itself
   * (/api/prompt-file's "edit THIS file" target). Pointing at a file and asking
   * for it to be changed IS the consent for that file — but only for it; other
   * paths the model decides to touch are still protected.
   *
   * Fails CLOSED: an existing file we cannot read is reported as protected.
   */
  function findProtectedOverwrites(
    writes: { abs: string; rel: string; content: string }[],
    consent: OverwriteConsent,
    impliedPath?: string
  ): string[] {
    const implied = impliedPath === undefined ? undefined : toRelPosix(impliedPath);
    const protectedPaths: string[] = [];
    for (const w of writes) {
      const relPosix = toRelPosix(w.rel);
      let st: fs.Stats;
      try {
        st = fs.statSync(w.abs);
      } catch {
        continue; // nothing there — a create
      }
      if (!st.isFile() || st.size === 0) continue; // vetWritePaths refuses non-files; empty holds nothing
      const next = Buffer.from(w.content, 'utf8');
      if (st.size === next.byteLength) {
        try {
          if (fs.readFileSync(w.abs).equals(next)) continue; // byte-identical ⇒ no loss
        } catch {
          protectedPaths.push(relPosix); // unreadable ⇒ assume it holds something
          continue;
        }
      }
      if (consent.all || consent.paths.has(relPosix) || (implied !== undefined && relPosix === implied)) {
        continue; // the human confirmed this exact file
      }
      protectedPaths.push(relPosix);
    }
    return protectedPaths;
  }

  /** Honest refusal copy: says what was NOT done, and names every file it protected. */
  function overwriteRefusalMessage(paths: string[]): string {
    const shown = paths.slice(0, 8).join(', ');
    const more = paths.length > 8 ? `, and ${paths.length - 8} more` : '';
    const count = `${paths.length} file${paths.length === 1 ? '' : 's'}`;
    return `nothing was written — ${count} already ${paths.length === 1 ? 'has' : 'have'} content and would be replaced: ${shown}${more}. Confirm the replacement to write ${paths.length === 1 ? 'it' : 'them'}.`;
  }

  function graphSummary(g: ArchGraph): GraphSummary {
    const of = (kind: string) => g.nodes.filter((n) => n.kind === kind).length;
    return {
      nodes: g.nodes.length,
      edges: g.edges.length,
      services: of('service'),
      datastores: of('datastore'),
      topics: of('topic'),
    };
  }

  /**
   * The shared generate pipeline for /api/generate and /api/prompt-file: call
   * the provider, jail-check every returned path, refuse any UNCONFIRMED
   * overwrite of existing content, write the safe ones, rescan (updating the
   * canvas graph), then auto-diff against `specForDiff`. Returns an HTTP status
   * + JSON body; distinct stages get distinct codes.
   */
  async function generateAndApply(
    cfg: AiConfig,
    prompt: string,
    /** The metering identity: default-mode generation is charged to this user (v12 gap fix). */
    identity: string,
    specForDiff: ArchGraph | undefined,
    ddlSpec?: ArchGraph,
    /**
     * When set, this is a SCOPED generate: the rescanned graph is filtered to
     * this scope before the conformance diff, so out-of-scope services already
     * in the repo are not reported as drift. When undefined the diff runs
     * against the FULL rescan (unscoped behaviour, unchanged).
     */
    diffScopeSpec?: ArchGraph,
    /**
     * The human's answer to "may this replace files that already have content?".
     * OMITTED MEANS NO — a caller that forgets it gets the protective behaviour,
     * never the destructive one.
     */
    write: { consent: OverwriteConsent; impliedPath?: string } = { consent: NO_OVERWRITE_CONSENT },
    /** Item 1.3 — the caller's cancellation, threaded to the metered provider call. */
    signal?: AbortSignal
  ): Promise<{ status: number; body: unknown }> {
    let reply;
    try {
      // Route through the meter so default-mode file generation is counted; api-key
      // mode passes straight through, unmetered (v12 metering-gap closure).
      reply = await generateFilesMetered(cfg, prompt, identity, signal);
    } catch (e) {
      if (e instanceof ProviderError) {
        // 502: the upstream provider failed or returned an unusable body. The
        // body attached here is the provider's own response — never our key.
        const errBody: Record<string, unknown> = { error: e.message };
        if (e.body !== undefined) errBody.providerResponse = e.body;
        return { status: e.httpStatus ?? 502, body: errBody };
      }
      throw e;
    }
    const { safe, rejected } = vetWritePaths(reply.files);
    if (rejected.length > 0) {
      return {
        status: 422,
        body: { error: 'model returned unsafe file paths; nothing was written', rejected },
      };
    }
    // The deterministic DDL (db/schema.sql) is a SERVER-authored write, but it is
    // still a write over a path a user may have edited by hand — so it is staged
    // here, BEFORE anything lands, and vetted by the same overwrite gate as the
    // model's files. Staging it now is what keeps the refusal all-or-nothing: a
    // half-applied response (model files written, schema refused) would be exactly
    // the silent, unexplainable state this gate exists to prevent.
    const pending = [...safe];
    if (ddlSpec && hasDbTables(ddlSpec)) {
      const abs = resolveInRepo(activeRoot(), path.join('db', 'schema.sql'));
      if (abs !== null && !isReservedResolved(abs)) {
        pending.push({ abs, rel: path.relative(activeRoot(), abs), content: renderDDL(ddlSpec) });
      }
    }
    // vision.md §5 — no silent data loss. Every destination that already holds
    // content and was NOT confirmed by the human protects the WHOLE request: we
    // write nothing and name every file we protected, so the answer is actionable
    // rather than a mystery. Confirmed (or empty / absent / byte-identical)
    // destinations write exactly as before.
    const protectedPaths = findProtectedOverwrites(pending, write.consent, write.impliedPath);
    if (protectedPaths.length > 0) {
      return {
        status: 409,
        body: { error: overwriteRefusalMessage(protectedPaths), wouldOverwrite: protectedPaths },
      };
    }
    const written: string[] = [];
    for (const s of pending) {
      fs.mkdirSync(path.dirname(s.abs), { recursive: true });
      fs.writeFileSync(s.abs, s.content);
      written.push(s.rel);
    }
    // Auto-rescan (same path as POST /api/scan) so the canvas + diff see the
    // writes — and re-persist the cache with the new signature.
    const refreshed = await forceScan(activeRoot());
    setCurrentGraph(refreshed);
    const scan = graphSummary(refreshed);
    // Choose the diff baseline (head). For a scoped generate we filter the
    // whole-repo rescan down to the scope so conformance measures ONLY what was
    // generated; otherwise the full rescan is used. `diffScope` surfaces which
    // baseline was measured so the report/UI is honest about it.
    const diffHead = diffScopeSpec ? filterScanToScope(refreshed, diffScopeSpec) : refreshed;
    const diffScope: 'scoped' | 'full' = diffScopeSpec ? 'scoped' : 'full';
    const diff = specForDiff ? diffAgainstCurrent(specForDiff, diffHead) : null;
    return { status: 200, body: { written, scan, diff, diffScope, notes: reply.notes } };
  }

  // ---- v10 Phase 2: the repo-scoped terminal WebSocket (the FIRST + only WS) ----
  // Attached here so EVERY listen path (serveRepo, serveApp, tests, desktop) gets it.
  // cwd is the live `repoRoot` (read per-upgrade); `enabled` folds the option and the
  // env kill-switch; the guards (path→origin→enabled→requireRepo→cap) live in
  // attachTerminal. Localhost-only by the server's sole 127.0.0.1 bind.
  // v13: when auth is enabled, the terminal WS upgrade is a SENSITIVE surface —
  // require a valid signed session. Registered BEFORE attachTerminal so an
  // unauthorized upgrade is refused before any 101 handshake completes (attach-
  // Terminal's own handler then runs on the destroyed socket and completes no
  // handshake). With auth OFF this listener is never installed ⇒ local behaviour
  // is byte-identical. (On a public bind the terminal is force-disabled upstream
  // via resolveTerminalEnabled; this is defense-in-depth for a loopback+auth bind.)
  if (authConfig && authEnabled(authConfig)) {
    server.on('upgrade', (req, socket) => {
      let pathname: string;
      try {
        pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      } catch {
        return;
      }
      if (pathname !== TERMINAL_PATH) return;
      const sid = verifySession(req.headers.cookie, authConfig.sessionSecret)?.userId;
      // v13 Finding C: a valid session is necessary but NOT sufficient. When a
      // repo owner is recorded, only that owner may open a shell in it — otherwise
      // an authenticated NON-owner would get a shell (cwd = the owner's repo) on a
      // loopback+auth+SEQUENCE_ENABLE_TERMINAL bind. Refuse (close) any caller that
      // is unauthenticated or not the owner. (No owner recorded ⇒ session suffices,
      // matching the repo-scoped HTTP owner-check.)
      if (!sid || (repoOwner !== null && sid !== repoOwner)) {
        socket.end(
          'HTTP/1.1 401 Unauthorized\r\n' +
            'Connection: close\r\n' +
            'Sequence-Terminal-Error: authentication required\r\n' +
            'Content-Length: 0\r\n' +
            '\r\n'
        );
        socket.destroy();
      }
    });
  }

  attachTerminal(server, {
    getRoot: () => repoRoot,
    enabled: !process.env.SEQUENCE_DISABLE_TERMINAL && (opts.terminalEnabled ?? true),
  });

  server.on('close', () => {
    stopRepoWatch();
  });

  return server;
}

/**
 * A no-clobber destination directory under `parentDir`: `<parentDir>/<name>`, and
 * if that already exists, `<name>-2`, `<name>-3`, … until a free path is found.
 * `name` is already filesystem-safe (no separators / leading dots), so the join
 * cannot traverse. This is the disk-guard's no-overwrite half — an import never
 * clobbers an existing workspace.
 */
function uniqueDest(parentDir: string, name: string): string {
  let candidate = path.join(parentDir, name);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(parentDir, `${name}-${n++}`);
  }
  return candidate;
}

/**
 * Parse an optional `scope` request field into a clean list of node ids.
 * Returns `undefined` when the field is absent (no scoping), `{ error }` when it
 * is present but malformed, or `{ ids }` (possibly empty) otherwise.
 */
function parseScope(raw: unknown): { ids: string[]; error?: string } | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || !raw.every((x) => typeof x === 'string')) {
    return { ids: [], error: 'scope must be an array of node-id strings' };
  }
  return { ids: raw as string[] };
}

/** One-line human summary of a boundary edge for the UI warning. */
function summarizeEdge(graph: ArchGraph, e: { srcId: string; dstId: string; kind: string }): string {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const src = byId.get(e.srcId)?.label ?? e.srcId;
  const dst = byId.get(e.dstId)?.label ?? e.dstId;
  return `${src} → ${dst} (${e.kind})`;
}

/**
 * Filter a freshly-rescanned graph down to a scope, for a SCOPED generate's
 * conformance diff. Without this the whole-repo rescan is diffed against the
 * tiny scoped spec, so every out-of-scope service already living in the repo
 * (e.g. a `worker` that wasn't part of the selection) shows up as a spurious
 * "Not in spec" edge — contradicting "conformance measures the scope you
 * generated".
 *
 * The scope is defined by the service/datastore/topic LABELS present in the
 * scoped spec (the same lift labels score.ts/diff.ts key edges on). A scanned
 * node is kept when it lifts to one of those labels — which retains a matched
 * service AND all its file leaves, matched datastores, and matched topics — plus
 * the repo root(s). Edges are kept only when BOTH endpoints survive, so an
 * out-of-scope service's edges vanish while every in-scope edge (and thus any
 * genuine in-scope drift/mismatch) is preserved for the diff to catch.
 *
 * Pure and side-effect-free; does not mutate `scanned`.
 */
export function filterScanToScope(scanned: ArchGraph, scopedSpec: ArchGraph): ArchGraph {
  const specLift = buildLift(scopedSpec);
  const scopeLabels = new Set<string>();
  for (const n of scopedSpec.nodes) {
    const label = specLift(n.id);
    if (label) scopeLabels.add(label);
  }
  const scanLift = buildLift(scanned);
  const keep = new Set<string>();
  for (const n of scanned.nodes) {
    if (n.kind === 'repo') {
      keep.add(n.id);
      continue;
    }
    const label = scanLift(n.id);
    if (label && scopeLabels.has(label)) keep.add(n.id);
  }
  const nodes = scanned.nodes.filter((n) => keep.has(n.id));
  const edges = scanned.edges.filter((e) => keep.has(e.srcId) && keep.has(e.dstId));
  return { ...scanned, nodes, edges };
}

/**
 * Diff a posted spec (design mode, the base) against the current scanned graph
 * (the head). diffGraphs reads two file paths, so the two graphs are staged to
 * a throwaway temp dir; nothing under the repo is touched.
 */
function diffAgainstCurrent(
  spec: ArchGraph,
  current: ArchGraph
): { added: string[]; removed: string[]; mismatched: string[]; markdown: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-diff-'));
  try {
    const specPath = path.join(dir, 'spec.json');
    const headPath = path.join(dir, 'head.json');
    fs.writeFileSync(specPath, JSON.stringify(spec));
    fs.writeFileSync(headPath, JSON.stringify(current));
    return diffGraphs(specPath, headPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * CLI entry: scan `repoRoot` (when given), then bind the platform server on
 * 127.0.0.1:port. Localhost-only by explicit host — the platform never listens
 * on a public interface. `repoRoot` may be null/undefined to start in the
 * no-repo state (the home screen takes over; attach happens from the UI).
 */
export async function serveRepo(
  repoRoot: string | null | undefined,
  port: number,
  webDist?: string
): Promise<http.Server> {
  const opts: RepoServerOptions = { webDist };

  // v12 Phase 2 — OAuth + real identity, ENV-GATED. With no OAuth env set,
  // authEnabled is false ⇒ resolveIdentity stays unset ⇒ identity is 'local' and
  // every existing path is byte-identical. When the env IS present, sign-in lights
  // up and metering keys off the real per-user id from the signed session cookie.
  const authConfig = loadAuthConfig(process.env);
  const authOn = authEnabled(authConfig);
  if (authOn) {
    opts.authConfig = authConfig;
    opts.resolveIdentity = (req) => verifySession(req.headers.cookie, authConfig.sessionSecret)?.userId;
  }

  // v12 Phase 2 — point default mode at the REAL gateway (fixes the compile-time
  // constant gap). SEQUENCE_GATEWAY_TOKEN is read by provider.ts's gatewayAppToken()
  // straight from the env, so it needs no wiring here.
  const gatewayUrl = (process.env.SEQUENCE_GATEWAY_URL ?? '').trim();
  if (gatewayUrl !== '') opts.gatewayBaseUrl = gatewayUrl;

  // Bind host: loopback by default (local single-user). A hosted platform (e.g.
  // Render) routes to 0.0.0.0:$PORT, so SEQUENCE_BIND_HOST=0.0.0.0 exposes all
  // interfaces — but ONLY when auth is enabled. A non-loopback bind with NO auth is
  // HARD-REFUSED (assertSafeBind throws; we never listen), since the browse/file
  // endpoints would otherwise be publicly reachable with no request-level authz.
  const bindHost = (process.env.SEQUENCE_BIND_HOST ?? '127.0.0.1').trim() || '127.0.0.1';
  const loopbackBind = assertSafeBind(bindHost);
  // Terminal: computed OUTSIDE the auth block. A non-loopback bind forces it OFF
  // unconditionally; a loopback bind keeps today's behaviour (local default on;
  // hosted-on-loopback opt-in via SEQUENCE_ENABLE_TERMINAL=1).
  opts.terminalEnabled = resolveTerminalEnabled(loopbackBind, authOn, process.env);

  const server = await createRepoServer(repoRoot, opts);
  await new Promise<void>((resolve) => {
    server.listen(port, bindHost, () => resolve());
  });
  const addr = server.address();
  const boundPort = typeof addr === 'object' && addr ? addr.port : port;
  if (repoRoot != null) {
    console.log(`sequence: serving repo ${path.resolve(repoRoot)}`);
  } else {
    console.log('sequence: no repo attached yet — attach one from the home screen');
  }
  console.log(`  http://127.0.0.1:${boundPort}`);
  return server;
}
