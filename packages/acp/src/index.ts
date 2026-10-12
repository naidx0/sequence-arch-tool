/* ══════════════════════════════════════════════════════════════════════════
   THE ACP LANE — a product, and the record of why that was checked
   packages/acp/src/index.ts

   A 2026-08-22 competitive survey reported this package as "BUILT AND
   UNREACHABLE — no session/load, no MCP forwarding, no production caller" and
   asked whether the lane is a product or dead weight.

   THE "NO PRODUCTION CALLER" HALF IS FALSE, and it is checkable:

     · `analyzer/src/programRun.ts:172` builds `createAcpExecutor` and uses it
       as the executor for `agent` nodes,
     · `analyzer/src/server/acpSessionCache.ts` caches live `AcpAgentClient`s,
     · `analyzer/src/server/agentsStore.ts` maps an agent id to a launch config
       for `AcpClient`,
     · `analyzer/src/server/repoServer.ts` imports from it directly.

   So this is how an `agent` node in a program drives the user's own local
   coding agent. That is a shipped path, not dead weight, and the lane stays.

   THE OTHER HALF IS TRUE AND IS DELIBERATELY NOT BUILT. `session/load` and MCP
   forwarding are ACP protocol breadth, and CANON is explicit that "par with
   Claude Code's surface is a company, not a rebuild". CANON also names the
   strategic bet in the other direction — Sequence as "the MCP server Codex and
   Claude Code consume", which `packages/mcp` already serves with 15 tools.

   Recorded here rather than in a plan document because the next person to ask
   this question will be reading this file.

   UPDATE (S2a, build spec Part 5 row 13): the MCP half is REVERSED. The bet
   above ("the MCP server Codex and Claude Code consume") only pays if the
   agents Sequence starts can reach that server, and with `mcpServers: []`
   they could not. Every session now carries Sequence's own board server
   (promptContent.ts: ACP `mcpServers`, codex's per-thread
   `mcp_servers.sequence.*` override), never by writing the user's config.
   What stays unbuilt is forwarding the USER's other MCP servers: their own
   CLI config already gives them those.

   UPDATE (S1, build spec Part 5 row 10): session resume IS now built, because
   a chat that forgets its agent after ten idle minutes or an app restart is a
   correctness gap, not protocol breadth. `resumeSession` uses session/resume
   or session/load (behind the load-replay gate) and codex thread/resume.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * `@sequence/acp` — the core ACP engine (v16 Wave 1).
 *
 * A thin, honest ACP *client* we control (built on the Apache-2.0
 * `@agentclientprotocol/sdk`) that drives a LOCAL coding-agent subprocess over
 * the ACP wire protocol, plus the `NodeExecutor` that lets a Program `agent`
 * node with `runtime: 'acp'` run a real, abortable, session-reused agent turn
 * through the existing scheduler seam.
 *
 * No web/server/CLI wiring lives here — that is a later wave. This package is
 * verified end-to-end against a conformant mock stdio ACP agent fixture.
 */

export {
  AcpClient,
  ResumeUnavailableError,
  AgentExitedError,
  defaultPermissionPolicy,
  type AcpAgentClient,
  type AcpAgentLaunch,
  type AcpClientConfig,
  type AcpPromptOptions,
  type AcpPromptResult,
  type AgentTurnHooks,
  type AgentCapabilities,
  type AgentCommand,
  type AgentModel,
  type AgentSkill,
  type AgentTurnConfig,
  type PermissionDecision,
} from './client.js';

export { createAcpExecutor, type AcpExecutorDeps } from './executor.js';
export {
  TURN_IDLE_MS,
  TurnWatchdog,
  isAcpProgress,
  isCodexProgress,
  systemWatchdogClock,
  type TurnWatchdogOptions,
  type WatchdogClock,
  type WatchdogState,
} from './turnWatchdog.js';
export { AgentTurnError, TurnHungError, recoveryFor, recoveryOf, causeOf, resetTimeInMessage, type FailureCause, type Recovery, type RecoveryKind } from './recovery.js';
export { commandPrefix, matchesPrefix, unwrapShell } from './arity.js';
export { createRespawnGate, type RespawnGate, type RespawnGateOptions, type RespawnVerdict } from './respawnGate.js';
export { CODEX_TRANSLATED, codexUpdate, type RateLimits, type RateLimitWindow } from './codexUpdates.js';
export { CodexAppServerClient, agentSpawnEnv, createAgentClient, forgetCodexModels } from './codexAppServer.js';
export {
  codexQuestionRequestOf,
  codexQuestionResponse,
  codexQuestionsOf,
  isQuestionAnswers,
  type AgentQuestion,
  type AgentQuestionAnswers,
  type AgentQuestionOption,
  type AgentQuestionRequest,
} from './questions.js';
export { codexSteer, canSteer, steerRefusal, type SteerOutcome } from './steer.js';
export { acpMcpServers, acpPromptBlocks, codexInputItems, codexMcpConfig, type AgentMcpServer, type PromptAttachment, type PromptCaps } from './promptContent.js';
export {
  AGENT_MODES,
  PLAN_MODE_INSTRUCTIONS,
  READ_ONLY_KINDS,
  allowsTool,
  mayMutate,
  planOutcome,
  refusalFor,
} from './planMode.js';
export type { AgentMode, PlanOutcome } from './planMode.js';
export {
  AccessModeRefusedError,
  BYPASS_UNAVAILABLE_HINT,
  agentErrorReason,
  agentKindOf,
  claudeOptionsFor,
  cliArgsFor,
  codexOptionsFor,
  codexDeveloperInstructionsFor,
  codexThreadInstructionsFor,
  DRAW_INSTRUCTION,
  PLAN_ASK_INSTRUCTION,
  planRefuses,
  PLAN_REFUSAL,
  sessionModeIdsFor,
} from './accessMode.js';
export type { AgentKind, ClaudeCodeOptions, CodexOptions } from './accessMode.js';
export {
  ANSWER_QUIET_AFTER_COST_MS,
  ANSWER_QUIET_MS,
  QUIET_AFTER_MS,
  TurnAnswerDetector,
  TurnLog,
  TurnStatusTracker,
  tickStatus,
  type StatusClock,
  type TurnLogEntry,
  type TurnLogRecord,
  type TurnPhase,
  type TurnStatus,
} from './turnStatus.js';
export { TurnUsageMeter, addUsage, emptyUsage, usageFromPrompt, type TurnUsage } from './turnUsage.js';
