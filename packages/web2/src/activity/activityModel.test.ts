import { describe, expect, it } from 'vitest';
import type { ProgramRunEvent, ProgramRunStatus, ProgramRunSummary } from '@sequence/api-types';
import type { NodeStatus } from '@sequence/schema';

import {
  changedLabel,
  ACTIVITY_BUCKETS,
  NODE_STATES,
  NODE_STATUSES,
  RUN_STATES,
  RUN_STATUSES,
  bucketOf,
  countByBucket,
  filterRuns,
  needsYou,
  nodeStatesFrom,
  programLabel,
  progressOf,
  spanLabel,
  spanMs,
} from './activityModel';

/* ══════════════════════════════════════════════════════════════════════════
   P9 — THE ARITHMETIC'S LOCKS
   packages/web2/src/activity/activityModel.test.ts

   Tier 1: no DOM, no clock, no network. Every assertion below is about a
   decision the surface must not be free to make differently in two places.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * THE ENGINE'S OWN STATUS LIST, WRITTEN OUT.
 *
 * A test that iterated `RUN_STATUSES` would be asking the implementation what
 * the answer is and then agreeing with it — the shape of vacuous green this
 * package has already paid for twice. This literal is transcribed from
 * `ProgramRunStatus` in `packages/api-types/src/programs.ts`, and the two
 * assertions immediately below are what keep the transcription honest in both
 * directions: a status added to the engine and not here fails the first, a
 * status invented here and not in the engine fails the type annotation.
 */
const ENGINE_STATUSES: readonly ProgramRunStatus[] = [
  'running',
  'completed',
  'completed-with-violations',
  'failed',
  'stopped',
  'paused',
  'interrupted',
];

function run(over: Partial<ProgramRunSummary> = {}): ProgramRunSummary {
  return {
    runId: 'run-abc-00000000',
    programId: 'prog',
    programName: 'A program',
    status: 'running',
    startedAt: 1_000,
    lastEventSeq: 0,
    steps: 0,
    nodesTotal: 3,
    nodesDone: 0,
    nodesError: 0,
    ...over,
  };
}

describe('the state register is total over what the engine can report', () => {
  it('maps every status the engine declares, and invents none', () => {
    expect([...RUN_STATUSES].sort()).toEqual([...ENGINE_STATUSES].sort());
  });

  it('gives every state a word, so no state is a colour alone', () => {
    // Sheet 12.5: "Every state is written out as a word as well as drawn as a
    // dot, and the word carries the hue too: no state in this product is
    // communicated by colour alone."
    for (const status of ENGINE_STATUSES) {
      const state = RUN_STATES[status];
      expect(state.word.trim().length, `${status} has no word`).toBeGreaterThan(0);
      expect(state.meaning.trim().length, `${status} says nothing about itself`).toBeGreaterThan(0);
    }
  });

  it('gives no two states the same word', () => {
    // Two states sharing a word is colour becoming the only difference between
    // them, which is the rule above defeated by a synonym.
    const words = ENGINE_STATUSES.map((s) => RUN_STATES[s].word);
    expect(new Set(words).size).toBe(words.length);
  });

  it('spends a red only where something ran and failed', () => {
    /*
     * §12.6: "Red means the check ran and the answer was no. Painting a missing
     * prerequisite red teaches the reader to distrust every other red on the
     * screen, which is the only defence the product has."
     *
     * TWO statuses satisfy that sentence, and they satisfy it in its two
     * halves. `failed` is where a node's executor errored. `completed-with-
     * violations` is the literal reading of the sheet's own words: the run's
     * grounded checker RAN and its answer was no. Painting the second one green
     * — which is what the engine's `completed` made this surface do — is the
     * inverse failure, and the more expensive one.
     *
     * `stopped` was halted by a budget or a Stop and `interrupted` lost its
     * driver. Neither failed at anything, and neither may wear the failure
     * tone.
     */
    const red = ENGINE_STATUSES.filter((s) => RUN_STATES[s].tone === 'failed');
    expect(red).toEqual(['completed-with-violations', 'failed']);
  });

  it('never renders a run whose own checks said no as a success', () => {
    /*
     * THE MEASURED LIE, LOCKED. A real `review-loop` run came back
     * `status: 'completed'`, `nodesError: 0`, with `checkerOk: 'no'` and
     * `violations: 'ungrounded node id: …'` in its own final state. The row
     * said "Done", in `--st-done`. Whatever else this register does, the word
     * and the tone for that outcome must never be the ones a clean run gets.
     */
    const clean = RUN_STATES.completed;
    const rejected = RUN_STATES['completed-with-violations'];
    expect(rejected.word).not.toBe(clean.word);
    expect(rejected.tone).not.toBe(clean.tone);
    expect(rejected.tone).toBe('failed');
  });

  it('animates exactly one state, and it is the one that is still moving', () => {
    const live = ENGINE_STATUSES.filter((s) => RUN_STATES[s].live);
    expect(live).toEqual(['running']);
  });

  it('offers cancellation only while the engine says a supervisor is still running', () => {
    const cancellable = ENGINE_STATUSES.filter((s) => RUN_STATES[s].cancellable);
    expect(cancellable).toEqual(['running']);
  });
});

describe('the four buckets answer "which of my runs needs me"', () => {
  it('puts each status in the bucket its own doc comment describes', () => {
    expect(bucketOf('running')).toBe('running');
    // `paused = shouldPause (resumable)` — stopped at a gate, resumable by a
    // person. --spills is "stalled, and waiting on you".
    expect(bucketOf('paused')).toBe('waiting');
    // `interrupted`: "the process that was driving this run went away". Nothing
    // is advancing it and nothing will until someone acts.
    expect(bucketOf('interrupted')).toBe('blocked');
    // Three terminal statuses, one answer to the reader: this one is over.
    expect(bucketOf('completed')).toBe('finished');
    expect(bucketOf('failed')).toBe('finished');
    expect(bucketOf('stopped')).toBe('finished');
  });

  it('offers a filter for every bucket a status can land in', () => {
    const offered = new Set(ACTIVITY_BUCKETS.map((b) => b.id));
    for (const status of ENGINE_STATUSES) {
      expect(offered.has(bucketOf(status)), `no filter for ${bucketOf(status)}`).toBe(true);
    }
    expect(offered.has('all')).toBe(true);
  });

  it('offers no filter that no status can ever reach', () => {
    // A bucket nothing maps to is a tab that can only ever say zero — a control
    // with no subject, which is the shape of the F3 defect.
    const reachable = new Set<string>(ENGINE_STATUSES.map(bucketOf));
    reachable.add('all');
    for (const bucket of ACTIVITY_BUCKETS) {
      expect(reachable.has(bucket.id), `${bucket.id} is a filter nothing can fill`).toBe(true);
    }
  });

  it('counts only what is in the list it was given', () => {
    const runs = [
      run({ runId: 'a', status: 'running' }),
      run({ runId: 'b', status: 'paused' }),
      run({ runId: 'c', status: 'interrupted' }),
      run({ runId: 'd', status: 'completed' }),
      run({ runId: 'e', status: 'failed' }),
      run({ runId: 'f', status: 'stopped' }),
    ];
    expect(countByBucket(runs)).toEqual({
      all: 6,
      running: 1,
      waiting: 1,
      blocked: 1,
      finished: 3,
    });
    expect(countByBucket([])).toEqual({ all: 0, running: 0, waiting: 0, blocked: 0, finished: 0 });
  });

  it('counts as needing you only the runs that are not moving on their own', () => {
    const runs = [
      run({ status: 'running' }),
      run({ status: 'running' }),
      run({ status: 'paused' }),
      run({ status: 'interrupted' }),
      run({ status: 'completed' }),
    ];
    // Two of the five. A running run needs nobody; counting it would make this
    // number permanently non-zero and therefore permanently ignorable.
    expect(needsYou(runs)).toBe(2);
  });

  it('filters to exactly the runs in a bucket, and to all of them for "all"', () => {
    const runs = [
      run({ runId: 'a', status: 'running' }),
      run({ runId: 'b', status: 'paused' }),
      run({ runId: 'c', status: 'failed' }),
    ];
    expect(filterRuns(runs, 'waiting').map((r) => r.runId)).toEqual(['b']);
    expect(filterRuns(runs, 'finished').map((r) => r.runId)).toEqual(['c']);
    expect(filterRuns(runs, 'blocked')).toEqual([]);
    expect(filterRuns(runs, 'all').map((r) => r.runId)).toEqual(['a', 'b', 'c']);
  });
});

describe('a figure is drawn only where the engine supplied one', () => {
  it('refuses a fraction for a program that declares no node', () => {
    // "0 of 0" is F1 in miniature: a count printed where the truth is that
    // there is nothing to count.
    expect(progressOf(run({ nodesTotal: 0 }))).toBeNull();
    expect(progressOf(run({ nodesTotal: Number.NaN }))).toBeNull();
  });

  it('carries the engine’s own numerator and denominator, unaltered', () => {
    expect(progressOf(run({ nodesTotal: 7, nodesDone: 3, nodesError: 1 }))).toEqual({
      total: 7,
      done: 3,
      error: 1,
    });
  });

  it('refuses a program name the engine sent empty rather than substituting the id', () => {
    expect(programLabel(run({ programName: '   ' }))).toBeNull();
    expect(programLabel(run({ programName: 'Nightly sweep' }))).toBe('Nightly sweep');
  });

  it('measures a finished run to its own finishedAt, so its elapsed stops moving', () => {
    const finished = run({ startedAt: 1_000, finishedAt: 5_000, status: 'completed' });
    expect(spanMs(finished, 9_000_000)).toBe(4_000);
    // A live run measures to now, because that is what "still true" means.
    expect(spanMs(run({ startedAt: 1_000 }), 4_000)).toBe(3_000);
    // A clock that has gone backwards produces no negative duration.
    expect(spanMs(run({ startedAt: 8_000 }), 1_000)).toBe(0);
  });

  it('writes a duration as one coarse token', () => {
    expect(spanLabel(0)).toBe('0s');
    expect(spanLabel(59_000)).toBe('59s');
    expect(spanLabel(60_000)).toBe('1m');
    expect(spanLabel(60 * 60_000)).toBe('1h');
    expect(spanLabel(48 * 60 * 60_000)).toBe('2d');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ONE RUN, OPENED — the per-step register and the fold over its log.
   ══════════════════════════════════════════════════════════════════════════ */

/** Transcribed from `NodeStatus` in packages/schema/src/scheduler.ts. */
const SCHEDULER_NODE_STATUSES: readonly NodeStatus[] = ['queued', 'running', 'done', 'error'];

function evt(seq: number, nodeId: string, status: NodeStatus): ProgramRunEvent {
  return { seq, at: seq * 1_000, type: 'node:status', nodeId, status };
}

describe('a step’s state is read off the run’s own log', () => {
  it('maps every node status the scheduler emits, and invents none', () => {
    expect([...NODE_STATUSES].sort()).toEqual([...SCHEDULER_NODE_STATUSES].sort());
    for (const status of SCHEDULER_NODE_STATUSES) {
      expect(NODE_STATES[status].word.trim().length).toBeGreaterThan(0);
    }
  });

  it('spends no hue on queued, because "not started" is not a claim', () => {
    // §12.7: --st-neutral is "an alias of --ink-3, not a hue at all".
    expect(NODE_STATES.queued.tone).toBe('neutral');
  });

  it('takes the LAST status a node reached, decided by seq and not by array order', () => {
    /*
     * A fold that took the first event would draw a finished node as queued
     * forever, and one that trusted array order would be at the mercy of
     * however a caller concatenated a replay onto a live tail. `seq` is
     * 1-based and gap-free by construction; it is the only ordering there is.
     */
    const shuffled = [evt(3, 'n1', 'done'), evt(1, 'n1', 'queued'), evt(2, 'n1', 'running')];
    expect(nodeStatesFrom(shuffled)).toEqual({ n1: 'done' });
  });

  it('says nothing at all about a node the log never mentions', () => {
    // The absence is the caller's to draw. Defaulting to 'queued' here would be
    // this module speaking on the scheduler's behalf.
    const events = [evt(1, 'n1', 'done')];
    expect(nodeStatesFrom(events)).toEqual({ n1: 'done' });
    expect(nodeStatesFrom(events).n2).toBeUndefined();
    expect(nodeStatesFrom([])).toEqual({});
  });

  it('reads only node events, and folds nothing out of a run-level one', () => {
    const events: ProgramRunEvent[] = [
      { seq: 1, at: 1, type: 'run:started', runId: 'run-a-00000000', programId: 'p', nodeIds: ['n1', 'n2'] },
      evt(2, 'n1', 'running'),
      { seq: 3, at: 3, type: 'run:finished', status: 'stopped', steps: 1, state: {} },
    ];
    /* `run:started` NAMES every node id — and naming a node is not saying
       anything about its state. A fold that seeded from `nodeIds` would report
       every step of a run as queued the moment it started. */
    expect(nodeStatesFrom(events)).toEqual({ n1: 'running' });
  });
});


describe('how much a run changed', () => {
  const stats = (over: Partial<NonNullable<ProgramRunSummary['changed']>> = {}) => ({
    files: 1,
    added: 0,
    removed: 0,
    uncountedFiles: 0,
    ...over,
  });

  it('draws NOTHING when the engine did not measure', () => {
    /* A run still going, or a repo git could not read. Rendering "no files
       changed" here would present a guess as a measurement. */
    expect(changedLabel(run())).toBeNull();
  });

  it('tells measured-zero apart from not-measured', () => {
    expect(changedLabel(run({ changed: stats({ files: 0 }) }))).toBe('no files changed');
  });

  it('reads the way a person would say it', () => {
    expect(changedLabel(run({ changed: stats({ files: 3, added: 40, removed: 12 }) }))).toBe('3 files +40 -12');
    expect(changedLabel(run({ changed: stats({ files: 1, added: 2 }) }))).toBe('1 file +2');
  });

  it('says a file was not counted rather than implying it changed nothing', () => {
    expect(changedLabel(run({ changed: stats({ files: 2, added: 1, uncountedFiles: 1 }) }))).toBe(
      '2 files +1 1 not counted',
    );
  });

  it('THE CAVEAT TRAVELS WITH THE NUMBER, not in a tooltip', () => {
    expect(changedLabel(run({ changed: stats({ files: 5, added: 10, overlapping: true }) }))).toBe(
      '5 files +10 (shared with another run)',
    );
  });

  it('agrees with the engine, which computes the same sentence', () => {
    /* Two copies of this rule exist - one in the analyzer for CLI/NDJSON
       output, one here for the row - and they must not drift. This is the
       assertion that fails when one of them changes alone. */
    expect(changedLabel(run({ changed: stats({ files: 2, added: 3, removed: 4 }) }))).toBe('2 files +3 -4');
  });
});
