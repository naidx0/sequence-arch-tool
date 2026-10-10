/* ══════════════════════════════════════════════════════════════════════════
   THE AGENT-EVENT WIRE SHAPE, client side — the ONE place it is written down
   packages/web2/src/agents/agentTypes.ts

   `AgentEvent` mirrors packages/analyzer/src/server/agentEventTypes.ts (spec:
   docs/research/overhaul-formats-v2.md §3.4). `AgentNode` is the client's own
   tree, folded from events in agentTree.ts. Kept isolated so the schema can be
   swapped in one file per side.
   ══════════════════════════════════════════════════════════════════════════ */

export type AgentEventKind = 'session_start' | 'tool_start' | 'tool_end' | 'subagent_start' | 'subagent_stop' | 'stop';
export type AgentToolKind = 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'fetch' | 'think' | 'other';

/** Where one touched path sits on the board. */
export interface BoardHit {
  path: string;
  fileNodeId: string | null;
  moduleId: string | null;
  serviceId: string | null;
  serviceLabel: string | null;
  touchedEdgeIds: string[];
  /** Board-level edge keys, `${srcTop}>${dstTop}`. */
  liftedEdges: string[];
}

/** Round 9 (ask 30): what an agent reported spending on a turn. */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  thought: number;
  total: number;
}

export interface AgentEvent {
  id: string;
  at: number;
  source: 'claude-hook' | 'acp' | 'codex';
  sessionId: string;
  agentId?: string;
  parentAgentId?: string;
  kind: AgentEventKind;
  tool?: string;
  toolKind?: AgentToolKind;
  paths: string[];
  status: 'running' | 'done' | 'failed';
  toolUseId?: string;
  title?: string;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  board?: BoardHit[];
  /** Tokens for the step, when a source reports them. */
  tokens?: number;
  /** Round 9: a failed step's own words, or the failure that ended a turn. */
  error?: string;
  /** Round 9: a finished step's first output line, when the source passed one. */
  result?: string;
  /** Round 9: on `stop`, the tokens the agent reported for the turn. */
  usage?: TokenUsage;
}

export type AgentNodeKind = 'session' | 'turn' | 'subagent' | 'tool_call';
export type AgentNodeStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface AgentNode {
  id: string;
  sessionId: string;
  parentId: string | null;
  rootId: string;
  kind: AgentNodeKind;
  status: AgentNodeStatus;
  title: string;
  /** A tool call's tool name (Edit, Bash…); a subagent's type. */
  toolKind: string | null;
  /** The event's coarse kind (edit, read, execute…), for colouring bars. */
  stepKind: AgentToolKind | null;
  locations: BoardHit[];
  startedAt: number;
  endedAt: number | null;
  tokens?: number;
  /** Round 9: why a step or turn failed, in the tool's or agent's words. */
  error?: string;
  /** Round 9: what a finished step printed (first line). */
  result?: string;
  /** Round 9: a turn's reported token usage. */
  usage?: TokenUsage;
}
