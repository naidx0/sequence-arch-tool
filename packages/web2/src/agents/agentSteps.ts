/* ══════════════════════════════════════════════════════════════════════════
   WHAT A STEP DID, IN PLAIN WORDS — and where a turn stalled (round 9, asks 28-30)
   packages/web2/src/agents/agentSteps.ts

   Jaden: the tree was "green, green, green with no output". A step now reads
   as a sentence ("Ran npm test", "Could not read a.ts"), carries its duration,
   and says why it failed. A step that has run too long, or a turn that has
   gone quiet, is marked STALLED with how long, so a silent hang is never a
   row of calm dots. Pure: the same nodes and clock always give the same words.
   ══════════════════════════════════════════════════════════════════════════ */

import { cutLeft, readableToolTitle, splitToolTitle } from '../chat/commandLabel';
import { childrenOf, formatElapsed } from './agentStream.js';
import type { AgentNode, TokenUsage } from './agentTypes.js';

/** A running tool with no result after this long is marked stalled. */
export const STALL_MS = 45_000;
/** A command (a build, the tests) may legitimately run longer. */
export const STALL_COMMAND_MS = 180_000;
/** A running turn with no step open and nothing new for this long is marked stalled. */
export const QUIET_MS = 30_000;

const shortPath = (p: string): string => {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : p;
};

/** The thing a step acted on: its first board path, else the title past its verb. */
function targetOf(n: AgentNode): string {
  const first = n.locations[0]?.path;
  if (first && n.stepKind !== 'execute') return shortPath(first);
  const split = splitToolTitle(n.title, n.stepKind);
  let target = split.target.replace(/^(?:Bash|Shell|Task|Run)\s*:\s*/i, '').trim();
  if (n.stepKind === 'execute') target = readableToolTitle(target, 'execute').replace(/^`|`$/g, '').trim();
  return target || (n.toolKind ?? 'step');
}

/** "Ran npm test", "Reading a.ts", "Could not edit b.ts": the step as a sentence. */
export function describeStep(n: AgentNode): string {
  if (n.kind === 'subagent') return `Sub-agent ${n.title}`;
  if (n.kind === 'turn') return n.title;
  const what = n.stepKind ?? 'other';
  /* Cut from the LEFT: the end of a command or path is what tells two rows apart. */
  const target = cutLeft(targetOf(n), 72);
  const failed = n.status === 'failed';
  const running = n.status === 'running' || n.status === 'pending';
  switch (what) {
    case 'read':
      return failed ? `Could not read ${target}` : running ? `Reading ${target}` : `Read ${target}`;
    case 'edit':
      return failed ? `Could not edit ${target}` : running ? `Editing ${target}` : `Edited ${target}`;
    case 'delete':
      return failed ? `Could not delete ${target}` : running ? `Deleting ${target}` : `Deleted ${target}`;
    case 'move':
      return failed ? `Could not move ${target}` : running ? `Moving ${target}` : `Moved ${target}`;
    case 'search':
      return failed ? `Search failed: ${target}` : running ? `Searching for ${target}` : `Searched for ${target}`;
    case 'execute':
      return failed ? `Command failed: ${target}` : running ? `Running ${target}` : `Ran ${target}`;
    case 'fetch':
      return failed ? `Could not fetch ${target}` : running ? `Fetching ${target}` : `Fetched ${target}`;
    case 'think':
      return running ? 'Thinking' : 'Thought it through';
    default:
      return failed ? `${target} failed` : running ? `Working: ${target}` : target;
  }
}

/** Every tool call under a node (through turns and sub-agents). */
export function stepsUnder(nodes: ReadonlyMap<string, AgentNode>, id: string): AgentNode[] {
  const out: AgentNode[] = [];
  const walk = (at: string): void => {
    for (const c of childrenOf(nodes, at)) {
      if (c.kind === 'tool_call') out.push(c);
      else walk(c.id);
    }
  };
  walk(id);
  return out;
}

/** The latest moment anything under (and including) a node happened. */
function lastActivity(nodes: ReadonlyMap<string, AgentNode>, n: AgentNode): number {
  let at = Math.max(n.startedAt, n.endedAt ?? 0);
  for (const s of stepsUnder(nodes, n.id)) at = Math.max(at, s.startedAt, s.endedAt ?? 0);
  return at;
}

export interface Stall {
  /** How long it has gone without a result or a sign of life. */
  ms: number;
  /** The words for the row. */
  text: string;
}

/**
 * Whether a node has stalled at `now`. A running tool past its limit; a
 * running turn with no tool open and nothing new for QUIET_MS (the agent is
 * waiting on its model or its bridge). Null for anything finished.
 */
export function stallOf(nodes: ReadonlyMap<string, AgentNode>, n: AgentNode, now: number): Stall | null {
  if (n.status !== 'running') return null;
  if (n.kind === 'tool_call') {
    const age = now - n.startedAt;
    const limit = n.stepKind === 'execute' ? STALL_COMMAND_MS : STALL_MS;
    return age > limit ? { ms: age, text: `Stalled: no result after ${formatElapsed(age)}` } : null;
  }
  if (n.kind === 'turn') {
    const open = stepsUnder(nodes, n.id).some((s) => s.status === 'running');
    if (open) return null;
    const quiet = now - lastActivity(nodes, n);
    return quiet > QUIET_MS ? { ms: quiet, text: `Stalled: nothing for ${formatElapsed(quiet)}, the agent may be waiting on the model` } : null;
  }
  return null;
}

/** Compact counts: 840, 1.4k, 12k, 1.2M. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/** "1.0k in, 400 out, 700 cached": only the parts the agent reported. */
export function usageText(u: TokenUsage): string {
  const parts: string[] = [];
  if (u.input) parts.push(`${formatTokens(u.input)} in`);
  if (u.output) parts.push(`${formatTokens(u.output)} out`);
  if (u.cacheRead || u.cacheWrite) parts.push(`${formatTokens(u.cacheRead + u.cacheWrite)} cached`);
  return parts.length ? parts.join(', ') : `${formatTokens(u.total)} tokens`;
}

export function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    thought: a.thought + b.thought,
    total: a.total + b.total,
  };
}

/** The sum of a list of turns' usage, or null when none reported any. */
export function sumUsage(list: readonly (TokenUsage | null | undefined)[]): TokenUsage | null {
  let sum: TokenUsage | null = null;
  for (const u of list) if (u) sum = sum ? addTokenUsage(sum, u) : u;
  return sum;
}

/** Counts a collapsed row shows so a hidden failure is never hidden: steps, failed, still running. */
export function rollup(nodes: ReadonlyMap<string, AgentNode>, id: string): { steps: number; failed: number; running: number } {
  const steps = stepsUnder(nodes, id);
  return { steps: steps.length, failed: steps.filter((s) => s.status === 'failed').length, running: steps.filter((s) => s.status === 'running').length };
}
