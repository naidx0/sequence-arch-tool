import type { ProgramRunEvent, ProgramRunStatus } from '@sequence/api-types';
import type { Program } from '@sequence/schema';

/* A run's blocks and where it is, folded from the program and its committed event log (the same events the run detail reads). */
export type LiveBlockState = 'pending' | 'running' | 'done' | 'failed';
export type LiveStatus = ProgramRunStatus | 'pending';

export interface LiveBlock {
  id: string;
  title: string;
  kind: string;
  state: LiveBlockState;
}

export interface LiveLoop {
  blocks: LiveBlock[];
  /** The block running now; else the next one still to run while the run is going; else -1. */
  activeIndex: number;
  /** Which pass of the loop the run is on (1 for the first), 0 when the program has no loop or it has not started. */
  iteration: number;
  /** The loop's cap, when there is one. */
  maxIterations: number | null;
  status: LiveStatus;
}

export const EMPTY_LIVE: LiveLoop = { blocks: [], activeIndex: -1, iteration: 0, maxIterations: null, status: 'pending' };

const TERMINAL: readonly LiveStatus[] = ['completed', 'completed-with-violations', 'failed', 'stopped', 'interrupted'];
export const isTerminal = (s: LiveStatus): boolean => TERMINAL.includes(s);

export function liveFromRun(program: Program, events: readonly ProgramRunEvent[], status: LiveStatus): LiveLoop {
  const last: Record<string, string> = {};
  const runs: Record<string, number> = {};
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    if (e.type !== 'node:status') continue;
    last[e.nodeId] = e.status;
    if (e.status === 'running') runs[e.nodeId] = (runs[e.nodeId] ?? 0) + 1;
  }
  const blocks: LiveBlock[] = program.nodes
    .filter((n) => n.kind !== 'start')
    .map((n) => {
      const s = last[n.id];
      const state: LiveBlockState = s === 'running' ? 'running' : s === 'done' ? 'done' : s === 'error' ? 'failed' : 'pending';
      return { id: n.id, title: n.title, kind: n.kind, state };
    });
  let activeIndex = blocks.findIndex((b) => b.state === 'running');
  if (activeIndex < 0 && !isTerminal(status)) activeIndex = blocks.findIndex((b) => b.state === 'pending');
  const loop = program.nodes.find((n) => n.kind === 'loop');
  let iteration = 0;
  let maxIterations: number | null = null;
  if (loop) {
    maxIterations = loop.loop?.maxIterations ?? null;
    const body = program.edges.find((e) => e.from === loop.id && e.kind === 'loop-body');
    iteration = runs[body?.to ?? loop.id] ?? 0;
  }
  return { blocks, activeIndex, iteration, maxIterations, status };
}
