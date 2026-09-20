import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createProgramRunner } from '../server/programRunner.js';
import type { FileNumstat } from '../server/runChangeStats.js';

/**
 * A RUN RECORDS HOW MUCH OF THE TREE IT MOVED.
 *
 * The activity view could not tell a run that touched forty files from one
 * that touched one without opening each; the number existed two clicks away in
 * Review and never reached the place triage happens.
 *
 * These exercise the RUNNER, not the git helper: the snapshot is injected, so
 * what is under test is the window — opened at start, closed at finish, with
 * the overlap declared on both sides when two runs share a tree.
 */

function tmpRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-changewin-'));
  fs.mkdirSync(path.join(dir, '.sequence'), { recursive: true });
  return dir;
}

/**
 * Wait for a run to leave the live set.
 *
 * `settled` is internal; `isLive` is the signal the interface actually
 * exposes, and it flips exactly when the finish path — including the change
 * measurement — has completed.
 */
async function done(r: { isLive(id: string): boolean }, runId: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (!r.isLive(runId)) return;
    await new Promise((res) => setTimeout(res, 10));
  }
  throw new Error(`run ${runId} never finished`);
}

const PROGRAM = {
  id: 'p',
  name: 'p',
  nodes: [{ id: 'n1', kind: 'agent', title: 'one' }],
  edges: [],
} as never;

/** A snapshot source that answers a different tree on each successive call. */
function snapshots(...frames: FileNumstat[][]) {
  let i = 0;
  const calls: number[] = [];
  return {
    calls,
    fn: async (_root: string): Promise<FileNumstat[] | null> => {
      const frame = frames[Math.min(i, frames.length - 1)] ?? [];
      calls.push(i);
      i += 1;
      return frame;
    },
  };
}

function runnerWith(snapshotTree: (root: string) => Promise<FileNumstat[] | null>) {
  return createProgramRunner({
    now: () => Date.now(),
    snapshotTree,
    makeExecutors: () => ({
      executors: { agent: async () => ({ ok: true, output: {} }) },
    }),
  } as never);
}

test('a run records the DIFFERENCE its window made, not the tree it found', async () => {
  const repo = tmpRepo();
  const s = snapshots(
    /* at start: someone else's edit is already sitting there */
    [{ path: 'already-dirty.ts', added: 40, removed: 10 }],
    /* at finish: that edit, plus this run's three lines */
    [
      { path: 'already-dirty.ts', added: 40, removed: 10 },
      { path: 'the-run-wrote-this.ts', added: 3, removed: 0 },
    ],
  );
  const r = runnerWith(s.fn);
  const started = r.start({ repoRoot: repo, program: PROGRAM, identity: 'test' });
  await done(r, started.runId);

  const record = r.list(repo).find((x) => x.runId === started.runId);
  assert.ok(record, 'the run should be listed');
  assert.deepStrictEqual(record.changed, { files: 1, added: 3, removed: 0, uncountedFiles: 0 });
});

test('a run with no snapshot source records NOTHING, which is not zero', async () => {
  /*
   * Absent and zero are different claims. A host that cannot measure must
   * leave the field off so every surface draws nothing, rather than reporting
   * "no files changed" — a measurement nobody took.
   */
  const repo = tmpRepo();
  const r = createProgramRunner({
    now: () => Date.now(),
    makeExecutors: () => ({ executors: { agent: async () => ({ ok: true, output: {} }) } }),
  } as never);
  const started = r.start({ repoRoot: repo, program: PROGRAM, identity: 'test' });
  await done(r, started.runId);

  const record = r.list(repo).find((x) => x.runId === started.runId);
  assert.strictEqual(record?.changed, undefined);
});

test('a snapshot that throws does not fail the run', async () => {
  const repo = tmpRepo();
  const r = runnerWith(async () => {
    throw new Error('git is not installed');
  });
  const started = r.start({ repoRoot: repo, program: PROGRAM, identity: 'test' });
  await done(r, started.runId);

  const record = r.list(repo).find((x) => x.runId === started.runId);
  /* The run's own outcome is untouched, and the statistic is simply absent. */
  assert.strictEqual(record?.status, 'completed');
  assert.strictEqual(record?.changed, undefined);
});

test('TWO RUNS SHARING A TREE BOTH DECLARE IT — including the one already going', async () => {
  /*
   * One working tree cannot be attributed two ways; the information is not
   * there to recover. So it is declared rather than guessed — and on BOTH
   * sides, because the run already in flight is polluted by the newcomer just
   * as much as the newcomer is polluted by it. Flagging only the second run
   * would leave the first one's number looking clean while it is not.
   */
  const repo = tmpRepo();
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = () => resolve();
  });

  const r = createProgramRunner({
    now: () => Date.now(),
    snapshotTree: async () => [],
    makeExecutors: () => ({
      executors: {
        agent: async () => {
          await held;
          return { ok: true, output: {} };
        },
      },
    }),
  } as never);

  const first = r.start({ repoRoot: repo, program: PROGRAM, identity: 'test' });
  const second = r.start({ repoRoot: repo, program: PROGRAM, identity: 'test' });
  release();
  await done(r, first.runId);
  await done(r, second.runId);

  const runs = r.list(repo);
  const a = runs.find((x) => x.runId === first.runId);
  const b = runs.find((x) => x.runId === second.runId);
  assert.strictEqual(a?.changed?.overlapping, true, 'the run already going must be flagged too');
  assert.strictEqual(b?.changed?.overlapping, true, 'the newcomer must be flagged');
});

test('a single run does NOT claim its numbers are shared', async () => {
  const repo = tmpRepo();
  const r = runnerWith(async () => []);
  const started = r.start({ repoRoot: repo, program: PROGRAM, identity: 'test' });
  await done(r, started.runId);

  const record = r.list(repo).find((x) => x.runId === started.runId);
  assert.strictEqual(record?.changed?.overlapping, undefined);
});
