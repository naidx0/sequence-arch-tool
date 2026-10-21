import { loopBodies, type Program, type WorkflowBlock } from '@sequence/schema';

/* A premade workflow or loop, flattened to what a mini flow draws: its steps in order, and where a loop returns. */
export type PreviewKind = 'agent' | 'deepen' | 'test' | 'checker' | 'loop' | 'finish' | 'step';

export interface PreviewStep {
  id: string;
  kind: PreviewKind;
  title: string;
  /** A loop marker only: the most repeats. */
  max?: number;
}

export interface PreviewFlow {
  steps: PreviewStep[];
  /** Real steps, not counting loop markers or Finish. */
  count: number;
}

const flowOf = (steps: PreviewStep[]): PreviewFlow => ({ steps, count: steps.filter((s) => s.kind !== 'loop' && s.kind !== 'finish').length });

/** Blocks in order. A loop block becomes a return marker right after the last block it repeats. */
export function flowFromBlocks(blocks: readonly WorkflowBlock[]): PreviewFlow {
  const bodies = loopBodies(blocks);
  const markerAfter = new Map<number, WorkflowBlock>();
  for (const [i, body] of bodies) if (body.length > 0) markerAfter.set(Math.max(...body), blocks[i]!);
  const steps: PreviewStep[] = [];
  blocks.forEach((b, i) => {
    if (b.kind !== 'loop') steps.push({ id: b.id, kind: b.kind, title: b.title });
    const m = markerAfter.get(i);
    if (m) steps.push({ id: m.id, kind: 'loop', title: m.title, max: m.maxIterations ?? 3 });
  });
  return flowOf(steps);
}

const KIND: Record<string, PreviewKind> = { agent: 'agent', checker: 'checker', command: 'test', end: 'finish' };

/** A program (a built-in workflow): its nodes in declared order, the loop node drawn as a return after the node that loops back to it. */
export function flowFromProgram(program: Program): PreviewFlow {
  const steps: PreviewStep[] = [];
  const back = new Map<string, string>();
  for (const e of program.edges) if (e.kind === 'loop-back') back.set(e.from, e.to);
  for (const n of program.nodes) {
    if (n.kind === 'start' || n.kind === 'loop') continue;
    steps.push({ id: n.id, kind: KIND[n.kind] ?? 'step', title: n.title });
    const loopId = back.get(n.id);
    const loop = loopId ? program.nodes.find((x) => x.id === loopId) : undefined;
    if (loop) steps.push({ id: loop.id, kind: 'loop', title: loop.title, max: loop.loop?.maxIterations });
  }
  return flowOf(steps);
}
