/* ══════════════════════════════════════════════════════════════════════════
   WHAT THE AGENT IN A CHAT IS DOING, AS ONE PLAIN VALUE (S2b)
   packages/web2/src/agents/agentActivity.ts

   The composer's strip (todos, subagents), the chat header (context used,
   cost, limits) and the board's agent overlay all read the same thing, so it
   is derived once, here, from the run store's state. Pure.

   For the board (canvas/**, the views builder): call
   `agentActivity(agentRuns.get(), sessionId)` under
   `useSyncExternalStore(agentRuns.subscribe, agentRuns.get)`; `todos` are
   chat/TodoList's own items, `subagents` what is running beside the agent.
   ══════════════════════════════════════════════════════════════════════════ */

import type { TodoItem } from '../state/types';
import type { AgentRun, AgentRunsState, RunLimits } from './agentRuns';

export interface AgentActivity {
  agentRef: string;
  /** The chat's latest run with this agent. */
  latest: AgentRun | null;
  running: boolean;
  /** The agent's todo list (ACP plan entries, codex turn/plan/updated), as TodoList draws it. */
  todos: TodoItem[];
  /** Subagents the agent started (Claude's Task tool), with whether each still runs. */
  subagents: { id: string; label: string; running: boolean }[];
  usage: AgentRun['usage'] | null;
  limits: RunLimits | null;
  /**
   * What the agent is doing right now, in words, while its run is running
   * (null otherwise). A running tool is named by its kind only ("Running a
   * command"): its own row names the command, and a screen never names the
   * same tool twice.
   */
  doing: string | null;
}

const KIND_DOING: Record<string, string> = {
  execute: 'Running a command',
  edit: 'Editing files',
  delete: 'Deleting files',
  move: 'Moving files',
  read: 'Reading',
  search: 'Searching',
  fetch: 'Fetching',
  think: 'Thinking',
};

/** The latest run's current action, or null when it is not running. */
export function agentDoing(run: AgentRun | null): string | null {
  if (!run || run.status !== 'running') return null;
  if (run.approvals.some((a) => a.decision === null)) return 'Waiting for you';
  const last = run.items[run.items.length - 1];
  if (!last) return 'Starting';
  if (last.kind === 'thought') return last.endedAt === null ? 'Thinking' : 'Working';
  if (last.kind === 'message') return 'Writing';
  if (last.kind === 'tool' && last.status === 'running') return last.subagent ? 'Running a subagent' : (KIND_DOING[last.toolKind ?? ''] ?? 'Using a tool');
  return 'Working';
}

const TODO_STATUS: Record<string, TodoItem['status']> = { completed: 'done', in_progress: 'active', pending: 'pending' };

export function agentActivity(state: AgentRunsState, sessionId: string | null): AgentActivity | null {
  const agentRef = sessionId ? state.agents?.[sessionId] : undefined;
  if (!agentRef) return null;
  const mine = state.runs.filter((r) => r.sessionId === sessionId && r.agentRef === agentRef);
  const latest = mine[mine.length - 1] ?? null;
  const plan = latest?.items.find((i) => i.kind === 'plan');
  const todos: TodoItem[] =
    plan && plan.kind === 'plan' ? plan.entries.map((e, i) => ({ id: `todo-${i}`, title: e.content, status: TODO_STATUS[e.status] ?? 'pending' })) : [];
  const subagents = (latest?.items ?? [])
    .filter((i) => i.kind === 'tool' && !!i.subagent)
    .map((i) => (i.kind === 'tool' ? { id: i.id, label: i.subagent!, running: i.status === 'running' } : null))
    .filter((x): x is { id: string; label: string; running: boolean } => x !== null);
  /* Usage and limits are the conversation's: the latest run that reported them. */
  const usage = [...mine].reverse().find((r) => r.usage)?.usage ?? null;
  const limits = [...mine].reverse().find((r) => r.limits)?.limits ?? null;
  return { agentRef, latest, running: latest?.status === 'running', todos, subagents, usage, limits, doing: agentDoing(latest) };
}

/** "25% ctx · $0.04": context used of the window, and the cost when the agent states one. */
export function usageChip(usage: AgentRun['usage'] | null): string | null {
  if (!usage || usage.size <= 0) return null;
  const pct = Math.round((usage.used / usage.size) * 100);
  const cost = usage.cost ? `, ${usage.cost.currency === 'USD' ? '$' : `${usage.cost.currency} `}${usage.cost.amount.toFixed(2)}` : '';
  return `${pct}% ctx${cost}`;
}

/** The rate-limit windows in words, for the chip's title. */
export function limitsText(limits: RunLimits | null): string | null {
  if (!limits) return null;
  const win = (w: RunLimits['primary'], name: string) => {
    if (!w) return null;
    const span = w.windowMins === null ? '' : w.windowMins >= 1440 ? ` of the ${Math.round(w.windowMins / 1440)}-day window` : ` of the ${Math.round(w.windowMins / 60)}-hour window`;
    const reset = w.resetsAt ? `, resets ${new Date(w.resetsAt * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : '';
    return `${name}: ${w.usedPercent}% used${span}${reset}`;
  };
  const parts = [win(limits.primary, 'Limit'), win(limits.secondary, 'Second limit')].filter(Boolean);
  return parts.length ? `${limits.plan ? `${limits.plan} plan. ` : ''}${parts.join('. ')}` : null;
}
