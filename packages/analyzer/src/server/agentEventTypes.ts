/* The agent-event wire shape, server side — the ONE place it is written down.
 * Spec: docs/research/overhaul-formats-v2.md §3.4 (overhaul ba996a28).
 * Mirrored by packages/web2/src/agents/agentTypes.ts. Kept isolated so the
 * schema can be swapped in one file per side. */

export type AgentEventKind = 'session_start' | 'tool_start' | 'tool_end' | 'subagent_start' | 'subagent_stop' | 'stop';
export type AgentToolKind = 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'fetch' | 'think' | 'other';

/** Where one touched path sits on the board (beyond the spec: the board needs it resolved). */
export interface BoardHit {
  /** Repo-relative, forward slashes. */
  path: string;
  fileNodeId: string | null;
  moduleId: string | null;
  /** The service / datastore / topic the file sits in. */
  serviceId: string | null;
  serviceLabel: string | null;
  /** Edges whose evidence file is this path. */
  touchedEdgeIds: string[];
  /** Those edges lifted to board level, `${srcTop}>${dstTop}`, cross-component only. */
  liftedEdges: string[];
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
  /** Repo-relative, from tool_input.file_path / ACP locations / Codex fileChange. */
  paths: string[];
  status: 'running' | 'done' | 'failed';
  /* ── additive, beyond the spec ── */
  /** Pairs a tool_start with its tool_end (Claude's tool_use_id). */
  toolUseId?: string;
  /** A short human line: the command's description, the agent type, ... */
  title?: string;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  /** One per path, resolved against the graph the server holds. */
  board?: BoardHit[];
  /** A failed step's own words (the tool's error, the turn's failure), cut to 300 chars. */
  error?: string;
  /** A finished step's first output line, cut to 160 chars, when the source passed one. */
  result?: string;
  /** On `stop`: the tokens the agent reported for the turn. */
  usage?: AgentEventUsage;
  /** Tokens for the step or turn: usage.total when the source gave a usage. */
  tokens?: number;
}

/** Round 9 (ask 30): what an agent reported spending on one turn. */
export interface AgentEventUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  thought: number;
  total: number;
}
