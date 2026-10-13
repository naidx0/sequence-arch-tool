/* ══════════════════════════════════════════════════════════════════════════
   THE CONTEXT OF ONE CHAT, AS THE AGENT SAYS IT (0.1.8 C)
   packages/web2/src/agents/contextMeter.ts

   One function for every place that shows "context": the status bar, the
   composer chip and the Agents pane. Context is how full the agent's window is
   now: the `usage_update` (`used` of `size`) of the newest run in THIS chat.

   Never a sum (a Codex turn's usage adds up its requests, and every turn
   re-sends the whole window), never a guess from cumulative totals, never
   another chat's number. A run the agent gave no usage_update for is unknown
   (null), not a figure worked out from `processed`.
   ══════════════════════════════════════════════════════════════════════════ */

import type { AgentRun } from './agentRuns';

export interface ChatContext {
  /** Tokens the window holds now, clamped to `size`; null when the agent has not said. */
  used: number | null;
  /** The window, in tokens; null when unknown. */
  size: number | null;
  source: 'agent' | 'none';
}

const NONE: ChatContext = { used: null, size: null, source: 'none' };
const pos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * The run whose usage_update speaks for the chat: the newest by start. A newest run that is still running and has not
 * reported yet is passed over for the one before it (its last report is still the window as it stands); a finished run
 * with no report is not, because an older turn's window is not this one's.
 */
export function contextRun(runs: readonly AgentRun[], sessionId: string | null, agentRef?: string | null): AgentRun | null {
  if (!sessionId) return null;
  const mine = runs.map((r, i) => ({ r, i })).filter((x) => x.r.sessionId === sessionId && (!agentRef || x.r.agentRef === agentRef));
  mine.sort((a, b) => a.r.startedAt - b.r.startedAt || a.i - b.i);
  for (let k = mine.length - 1; k >= 0; k--) {
    const r = mine[k]!.r;
    if (r.usage) return r;
    if (r.status !== 'running') return r;
  }
  return null;
}

/** A run's own usage_update as a clamped context reading, or null when it has none. */
export function runContext(run: AgentRun | null, fallbackWindow?: number | null): ChatContext {
  const u = run?.usage;
  if (!u || !pos(u.used)) return NONE;
  const size = pos(u.size) ? u.size : pos(fallbackWindow) ? fallbackWindow : null;
  return { used: size ? Math.min(u.used, size) : u.used, size, source: 'agent' };
}

/**
 * The chat's context: the window of the chat's CURRENT agent (`agentRef`), in this chat. A window an earlier agent reported is
 * not the current one's, so after Claude -> Codex this is unknown until Codex reports, and back on Claude it is Claude's last.
 * The filter lives here so the status bar and the Agents pane cannot scope differently. No `agentRef`: every agent's runs.
 */
export function chatContext(runs: readonly AgentRun[], sessionId: string | null, agentRef?: string | null, fallbackWindow?: number | null): ChatContext {
  return runContext(contextRun(runs, sessionId, agentRef), fallbackWindow);
}
