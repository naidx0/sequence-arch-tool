import type {
  GetProgramRunResponse,
  ProgramRunEvent,
  ProgramRunStatus,
  ProgramRunSummary,
} from '@sequence/api-types';
import type { Program, RunCheckpoint } from '@sequence/schema';

/* ══════════════════════════════════════════════════════════════════════════
   P9 — THE ACTIVITY LANE'S FIXTURES
   packages/web2/src/activity/fixtures.ts

   THESE ARE WIRE SHAPES, NOT INVENTED ONES. Every value below is typed as the
   thing `GET /api/program/runs` and `GET /api/program/runs/:runId` actually
   answer with (`@sequence/api-types`), so a field the engine drops, renames or
   makes optional is a compile error in this file rather than a fixture that
   quietly outlives the route it was copied from. The status list is the
   engine's own union, so a seventh status cannot be tested for here without
   existing there.

   WHAT THEY DO NOT PROVE, stated so nobody reads more into a green tick than it
   carries: that the engine is reachable, that the route is mounted, or that the
   bundle ships this surface at all. That is `e2e/`'s job over a real browser
   and a real server. What a fixture proves is the mapping — given exactly this
   answer, exactly these rows, and nothing else.
   ══════════════════════════════════════════════════════════════════════════ */

export function summary(over: Partial<ProgramRunSummary> = {}): ProgramRunSummary {
  return {
    runId: 'run-mn0p1q-0123abcd',
    programId: 'prog-sweep',
    programName: 'Nightly sweep',
    status: 'running',
    startedAt: 1_700_000_000_000,
    lastEventSeq: 4,
    steps: 2,
    nodesTotal: 3,
    nodesDone: 1,
    nodesError: 0,
    ...over,
  };
}

/** One summary per status the engine can report, in a stable order. */
export function oneOfEach(): ProgramRunSummary[] {
  const statuses: readonly ProgramRunStatus[] = [
    'running',
    'paused',
    'interrupted',
    'completed',
    'completed-with-violations',
    'failed',
    'stopped',
  ];
  return statuses.map((status, i) =>
    summary({
      runId: `run-${status}-0000000${i}`,
      programId: `prog-${status}`,
      programName: `Program ${status}`,
      status,
      ...(status === 'failed' ? { error: 'the executor refused: no model configured' } : {}),
      /* The engine puts the checker's OWN joined violation string here; a run
         in this state always carries at least one, because the state is
         derived from having one. */
      ...(status === 'completed-with-violations'
        ? { violations: ['ungrounded node id: svc:invented'] }
        : {}),
    }),
  );
}

/**
 * The scheduler's durable snapshot, as the record carries it.
 *
 * Present on the default `detail()` because the fixture's own log says `n1` is
 * done, and the scheduler writes a checkpoint after every node that reaches a
 * terminal status. A fixture whose log records a finished node and whose record
 * carries no checkpoint is a shape the engine cannot produce.
 */
export function checkpoint(over: Partial<RunCheckpoint> = {}): RunCheckpoint {
  return {
    version: 1,
    programId: 'prog-sweep',
    status: 'running',
    state: {},
    nodeResults: { n1: { status: 'done' } },
    steps: 2,
    notes: [],
    completedNodeIds: ['n1'],
    updatedAt: 1_700_000_003_000,
    ...over,
  };
}

export function program(): Program {
  return {
    id: 'prog-sweep',
    name: 'Nightly sweep',
    nodes: [
      { id: 'n1', title: 'Start', kind: 'start' },
      { id: 'n2', title: 'Ask the agent', kind: 'agent', agent: { prompt: 'go' } },
      { id: 'n3', title: 'Check the claims', kind: 'checker' },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', kind: 'seq' },
      { id: 'e2', from: 'n2', to: 'n3', kind: 'seq' },
    ],
  };
}

/**
 * A run's whole answer: the record as submitted plus its committed log.
 *
 * The log deliberately says nothing at all about `n3` — that is the case the
 * detail panel must draw as an absence rather than as "Queued", and a fixture
 * that mentioned every node could not exercise it.
 */
export function detail(over: Partial<GetProgramRunResponse['run']> = {}): GetProgramRunResponse {
  const events: ProgramRunEvent[] = [
    { seq: 1, at: 1_700_000_000_000, type: 'run:started', runId: 'run-mn0p1q-0123abcd', programId: 'prog-sweep', nodeIds: ['n1', 'n2', 'n3'] },
    { seq: 2, at: 1_700_000_001_000, type: 'node:status', nodeId: 'n1', status: 'done' },
    { seq: 3, at: 1_700_000_002_000, type: 'node:status', nodeId: 'n2', status: 'queued' },
    { seq: 4, at: 1_700_000_003_000, type: 'node:status', nodeId: 'n2', status: 'running' },
  ];
  return {
    run: {
      ...summary(),
      program: program(),
      state: {},
      nodeResults: { n1: { status: 'done' } },
      notes: [],
      checkpoint: checkpoint(),
      ...over,
    },
    events,
  };
}
