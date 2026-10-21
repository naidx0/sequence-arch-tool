/**
   TOKEN USAGE MAP / Settings > General
   packages/analyzer/src/server/tokenUsage.ts

   The tokens the person's own agents reported, per calendar day, for the
   contribution-style map. Read from the stored turns (agentChatStore), never
   estimated: a turn the agent did not report is not counted, so the total is a
   floor and says so in the UI.

     aggregateTokenUsage   pure: stored turns -> totals and per-day buckets
                           (local days; the person's clock, not UTC)
     readTokenUsage        the repo's next runner: live turns plus the
                           overflow archive, across every session

   Compaction turns are counted: they are real provider calls and cost real
   tokens, even though they are not messages in the chat.
   ------------------------------------------------ */

import { readAgentRuns, readArchivePage } from './agentChatStore.js';
import { readSessionIndex } from './sessionsStore.js';

export interface TokenUsageDay {
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  total: number;
  input: number;
  output: number;
  turns: number;
}

export interface TokenUsageReport {
  /** Every reported token in the history. */
  total: number;
  input: number;
  output: number;
  /** Turns that reported usage. */
  turns: number;
  /** Days with usage, oldest first. Days with no usage are absent. */
  days: TokenUsageDay[];
  /** The first day with usage, or null when nothing has been reported yet. */
  since: string | null;
}

interface UsageLike {
  input?: unknown;
  output?: unknown;
  total?: unknown;
}

interface RunLike {
  startedAt?: unknown;
  usage?: unknown;
}

function count(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0;
}

function localDay(ms: number): string {
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * One turn's reported usage, or null when it reported none. `total` is the
 * provider's own sum when it gave one; otherwise input plus output (the two
 * every provider reports), never cache reads on their own.
 */
function turnTokens(raw: unknown): { input: number; output: number; total: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as UsageLike;
  const input = count(u.input);
  const output = count(u.output);
  const total = count(u.total);
  if (total === 0 && input === 0 && output === 0) return null;
  return { input, output, total: total || input + output };
}

/** Totals and per-day buckets from stored turns. Pure: the gate for the map. */
export function aggregateTokenUsage(runs: readonly RunLike[]): TokenUsageReport {
  const days = new Map<string, TokenUsageDay>();
  let total = 0;
  let input = 0;
  let output = 0;
  let turns = 0;
  for (const run of runs) {
    const startedAt = typeof run.startedAt === 'number' && Number.isFinite(run.startedAt) ? run.startedAt : null;
    if (startedAt === null) continue;
    const t = turnTokens(run.usage);
    if (!t) continue;
    turns += 1;
    total += t.total;
    input += t.input;
    output += t.output;
    const date = localDay(startedAt);
    const day = days.get(date);
    if (day) {
      day.total += t.total;
      day.input += t.input;
      day.output += t.output;
      day.turns += 1;
    } else {
      days.set(date, { date, total: t.total, input: t.input, output: t.output, turns: 1 });
    }
  }
  const sorted = [...days.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { total, input, output, turns, days: sorted, since: sorted.length ? sorted[0].date : null };
}

/**
 * The repo's whole reported history: each session's live turns and the archive
 * that holds its oldest ones. A missing or damaged file reads as no turns,
 * like every other reader here.
 */
export function readTokenUsage(repoRoot: string): TokenUsageReport {
  const index = readSessionIndex(repoRoot);
  const runs: RunLike[] = [];
  for (const session of index?.sessions ?? []) {
    runs.push(...readAgentRuns(repoRoot, session.id));
    for (let offset = 0; ; ) {
      const page = readArchivePage(repoRoot, session.id, offset);
      runs.push(...page.runs);
      if (page.remaining <= 0 || page.runs.length === 0) break;
      offset += page.runs.length;
    }
  }
  return aggregateTokenUsage(runs);
}
