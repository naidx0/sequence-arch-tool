/* ══════════════════════════════════════════════════════════════════════════
   THE TRACE OF A TURN: WHAT IT IS DOING, AND WHAT IT DID
   packages/web2/src/agents/agentTrace.ts

   The agents window shows a turn as a trace: a line that names the step in
   flight while the turn runs, and one line that names what the turn did
   once it is done. That is the shape of the AI Traces reference, read in
   Sequence's words and in Sequence's steps (reads, searches, edits,
   commands); the reference's own sources (Slack, Gmail) have no place here,
   and neither does its palette.

   This module is the part that can be wrong, so it is PURE: the same steps
   always give the same line. Every number in the line is counted from the
   steps behind it, and a step the agent never reported is not counted.
   ══════════════════════════════════════════════════════════════════════════ */

import { describeStep } from './agentSteps.js';
import type { AgentNode, AgentToolKind } from './agentTypes.js';

/** What one kind of step is called in a sentence about the turn. */
interface KindWords {
  kind: AgentToolKind;
  /** The verb, already in the past: "searched", "read". */
  verb: string;
  /** What is counted: "time", "file", "command". */
  noun: string;
  /** The plural of the noun: "times", "files", "commands". */
  plural: string;
}

/* The order the words read in: what the agent looked for, what it read, what
   it changed, what it ran. A kind with no step is not in the line at all. */
const KINDS: readonly KindWords[] = [
  { kind: 'search', verb: 'searched', noun: 'time', plural: 'times' },
  { kind: 'read', verb: 'read', noun: 'file', plural: 'files' },
  { kind: 'edit', verb: 'edited', noun: 'file', plural: 'files' },
  { kind: 'delete', verb: 'deleted', noun: 'file', plural: 'files' },
  { kind: 'move', verb: 'moved', noun: 'file', plural: 'files' },
  { kind: 'execute', verb: 'ran', noun: 'command', plural: 'commands' },
  { kind: 'fetch', verb: 'fetched', noun: 'page', plural: 'pages' },
  { kind: 'other', verb: 'made', noun: 'other call', plural: 'other calls' },
];

/** A thinking step is not work; it is the agent deciding. It is not counted. */
const COUNTED: ReadonlySet<string> = new Set(KINDS.map((k) => k.kind));

/**
 * What a turn's steps add up to: "searched 2 times, read 1 file, ran 1
 * command". Null when there is nothing to say (no steps at all).
 */
export function traceSummary(steps: readonly AgentNode[]): string | null {
  const counts = new Map<AgentToolKind, number>();
  for (const s of steps) {
    const kind = s.stepKind ?? 'other';
    if (!COUNTED.has(kind)) continue;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const k of KINDS) {
    const n = counts.get(k.kind);
    if (!n) continue;
    parts.push(`${k.verb} ${n} ${n === 1 ? k.noun : k.plural}`);
  }
  return parts.length ? parts.join(', ') : null;
}

/** What the trace's status line says. */
export type TraceStatusKind = 'working' | 'step' | 'done';

export interface TraceStatus {
  kind: TraceStatusKind;
  text: string;
}

/**
 * The trace's status line.
 *
 * While the turn runs it names the step in flight (the last one still
 * running), or says the agent is working when no step is open yet. Once the
 * turn is done it names what the turn did, counted from its own steps.
 */
export function traceStatus(steps: readonly AgentNode[], running: boolean): TraceStatus | null {
  if (running) {
    const live = [...steps].reverse().find((s) => s.status === 'running');
    if (live) return { kind: 'step', text: describeStep(live) };
    return { kind: 'working', text: 'Working on it' };
  }
  const summary = traceSummary(steps);
  return summary ? { kind: 'done', text: summary } : null;
}
