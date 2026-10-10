import type { AgentRun, RunTokenCounts } from '../agents/agentRuns';
import * as runtime from '../agents/agentRuns';

export type TokenCounts = RunTokenCounts;
export type PresentedRun = AgentRun;

/** Totals across turns, never the context occupancy. Cache is a separate reported count. */
export function sessionTokens(runs: readonly PresentedRun[], sessionId: string | null, restored?: Readonly<Record<string, TokenCounts>>) {
  if (!sessionId) return null;
  const totals = restored?.[sessionId] ?? runtime.tokenTotalsBySession(runs)[sessionId];
  if (!totals) return null;
  const mine = runs.filter(r => r.sessionId === sessionId);
  const cache = totals.cachedReadTokens === null || totals.cachedWriteTokens === null ? null : totals.cachedReadTokens + totals.cachedWriteTokens;
  return { input: totals.inputTokens, output: totals.outputTokens, cache, measured: mine.filter(r => r.tokens).length, turns: mine.length };
}
