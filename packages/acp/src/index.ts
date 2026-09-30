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
  defaultPermissionPolicy,
  type AcpAgentClient,
  type AcpAgentLaunch,
  type AcpClientConfig,
  type AcpPromptOptions,
  type AcpPromptResult,
  type PermissionDecision,
} from './client.js';

export { createAcpExecutor, type AcpExecutorDeps } from './executor.js';
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
