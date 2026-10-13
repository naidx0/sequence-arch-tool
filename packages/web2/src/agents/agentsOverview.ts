/* ══════════════════════════════════════════════════════════════════════════
   THE AGENTS SURFACE'S DATA (round 11)
   packages/web2/src/agents/agentsOverview.ts

   Every chat's runs and the subagents they started, folded from the run store
   the page already holds (agentRuns). Nothing here is measured again: a turn
   the agent gave no usage for has `output: null` and the surface draws "—",
   never an estimate. PURE: runs and chats in, a tree out.
   ══════════════════════════════════════════════════════════════════════════ */

import { tokenTotalsBySession, type AgentRun, type RunTool } from './agentRuns';
import { splitSubagent } from './subagents';
import { chatContext, runContext } from './contextMeter';

export type OverviewStatus = 'running' | 'done' | 'failed';

export interface OverviewSubagent {
  toolId: string;
  name: string;
  description: string;
  status: OverviewStatus;
  startedAt: number;
  endedAt: number | null;
  steps: number;
}

export interface OverviewRun {
  id: string;
  label: string;
  agent: string | null;
  status: OverviewStatus;
  startedAt: number;
  endedAt: number | null;
  /** Tokens this turn generated (output), or null when the agent did not say. */
  output: number | null;
  /** The window the agent said it held this turn (its usage_update, clamped to the window), or null when it said nothing. */
  context: number | null;
  /** Input plus output this turn processed (cache reads included), or null when unknown. */
  processed: number | null;
  subagents: OverviewSubagent[];
}

export interface OverviewChat {
  sessionId: string;
  title: string;
  status: OverviewStatus;
  startedAt: number;
  endedAt: number | null;
  /** Tokens the chat generated (output), or null when no turn reported any. */
  output: number | null;
  /** The window fill the agent reported for the chat's newest turn (contextMeter.ts), or null. Never a sum or a total. */
  context: number | null;
  /** Input plus output processed across all turns (cache reads counted every turn), or null. */
  processed: number | null;
  /** Turns that reported usage. */
  reported: number;
  runs: OverviewRun[];
}

export interface AgentsOverview {
  chats: OverviewChat[];
  /** Tokens generated (output) across every chat that reported, or null when none did. */
  totalOutput: number | null;
  /** The open chat's context (the same reading as the status bar), or null when it has none or no chat is open. */
  context: number | null;
  /** Input plus output processed across every chat and turn (cache reads counted every turn), or null. */
  totalProcessed: number | null;
  /** Turns that reported usage, across every chat. */
  reportedTurns: number;
  spanStart: number;
  spanEnd: number;
}

/** A start time the clock can trust: a real, positive instant. A zero or missing one is "unknown", never "the epoch". */
export const knownStart = (t: number | null | undefined): t is number => typeof t === 'number' && Number.isFinite(t) && t > 0;

/** The duration to draw, in ms, or null when the start is unknown, the end is before it, or no time passed. Never a time since 1970. */
export function spanMs(start: number | null | undefined, end: number | null | undefined, now: number): number | null {
  if (!knownStart(start)) return null;
  const to = end ?? now;
  if (!Number.isFinite(to) || to < start) return null;
  /* No time passed is no time to draw: "0ms" says nothing a person can use. */
  return to - start > 0 ? to - start : null;
}

export interface ChatTitleLike {
  id: string;
  title?: string | null;
}

interface TurnUsageNums { output: number; context: number | null; processed: number }

/**
 * One turn's honest numbers. Context is what the agent says the window holds now (`usage.used`, from usage_update), clamped to the
 * window (contextMeter.ts), and nothing else: a turn with no usage_update has an unknown context (null). `processed` is the turn's
 * SUM over its requests (Codex) with cache reads counted every turn, so it is a bill-like total, never a context figure. A turn that
 * reported only `tokens` has no context either (Claude's inputTokens leaves cache reads out).
 */
function runUsage(r: AgentRun): TurnUsageNums | null {
  const used = runContext(r).used;
  const u = r.turnUsage;
  if (u) {
    const processed = u.total || u.input + u.output;
    return { output: u.output, context: used, processed };
  }
  if (r.tokens && r.tokens.scope === 'turn') return { output: r.tokens.outputTokens, context: used, processed: r.tokens.inputTokens + r.tokens.outputTokens };
  return null;
}

function clip(text: string, max = 48): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** The overview, newest-active chat first. `now` closes the span of work still running. */
export interface OverviewScope {
  /** The agent each chat is on now (the runs state's `agents`); a chat missing here is on the agent of its newest run. */
  agents?: Readonly<Record<string, string>>;
  /** The open chat: the header's context is this chat's, or unknown. */
  activeSessionId?: string | null;
}

export function buildAgentsOverview(runs: readonly AgentRun[], chats: readonly ChatTitleLike[], now: number, scope: OverviewScope = {}): AgentsOverview {
  const sums = tokenTotalsBySession(runs);
  const titles = new Map(chats.map((c) => [c.id, (c.title ?? '').trim()]));
  const bySession = new Map<string, AgentRun[]>();
  for (const r of runs) {
    if (!r.sessionId) continue;
    const list = bySession.get(r.sessionId) ?? [];
    list.push(r);
    bySession.set(r.sessionId, list);
  }
  const out: OverviewChat[] = [];
  for (const [sessionId, list] of bySession) {
    const sorted = [...list].sort((a, b) => a.startedAt - b.startedAt);
    const orows: OverviewRun[] = sorted.map((r, i) => {
      const tools = r.items.filter((it): it is RunTool => it.kind === 'tool');
      const subagents: OverviewSubagent[] = tools
        .filter((t) => !!t.subagent)
        .map((t) => ({
          toolId: t.id,
          ...splitSubagent(t.subagent),
          status: t.status,
          startedAt: t.startedAt,
          endedAt: t.endedAt,
          steps: tools.filter((k) => k.parentId === t.id).length,
        }));
      const usage = runUsage(r);
      return {
        id: r.id,
        label: clip(r.prompt) || `Turn ${i + 1}`,
        agent: r.agentRef,
        status: r.status,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        output: usage?.output ?? null,
        context: usage?.context ?? null,
        processed: usage?.processed ?? null,
        subagents,
      };
    });
    const running = orows.some((r) => r.status === 'running' || r.subagents.some((s) => s.status === 'running'));
    const failed = !running && orows[orows.length - 1]?.status === 'failed';
    const sum = sums[sessionId];
    const known = orows.filter((r) => r.processed !== null);
    out.push({
      sessionId,
      title: titles.get(sessionId) || orows[0]?.label || 'Chat',
      status: running ? 'running' : failed ? 'failed' : 'done',
      startedAt: orows.find((r) => knownStart(r.startedAt))?.startedAt ?? 0,
      endedAt: running ? null : Math.max(...orows.map((r) => r.endedAt ?? r.startedAt)),
      output: sum ? sum.outputTokens : known.length ? known.reduce((n, r) => n + (r.output ?? 0), 0) : null,
      context: chatContext(sorted, sessionId, scope.agents?.[sessionId] ?? sorted[sorted.length - 1]?.agentRef ?? null).used,
      processed: sum ? sum.inputTokens + sum.outputTokens : known.length ? known.reduce((n, r) => n + (r.processed ?? 0), 0) : null,
      reported: known.length,
      runs: orows,
    });
  }
  out.sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || (b.endedAt ?? now) - (a.endedAt ?? now));
  const reporting = out.filter((c) => c.processed !== null);
  return {
    chats: out,
    totalOutput: reporting.length ? reporting.reduce((n, c) => n + (c.output ?? 0), 0) : null,
    context: scope.activeSessionId ? (out.find((c) => c.sessionId === scope.activeSessionId)?.context ?? null) : null,
    totalProcessed: reporting.length ? reporting.reduce((n, c) => n + (c.processed ?? 0), 0) : null,
    reportedTurns: out.reduce((n, c) => n + c.reported, 0),
    spanStart: out.length ? Math.min(...out.map((c) => c.startedAt)) : now,
    spanEnd: out.length ? Math.max(now, ...out.map((c) => c.endedAt ?? now)) : now,
  };
}
