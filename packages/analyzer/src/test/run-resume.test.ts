import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createProgramRunner } from '../server/programRunner.js';

/**
 * RESUMING A PAUSED RUN.
 *
 * `pause` set `pauseRequested` and NOTHING ANYWHERE CLEARED IT, so a paused run
 * was paused permanently — while `runProgram` had supported resuming from a
 * checkpoint since Harness W4, and the checkpoint was already being persisted
 * after every node. The primitive was complete and every layer above it was
 * missing.
 *
 * Worse, a notification told the user the run "can be resumed". That sentence
 * was harmless while nothing fired the notification; wiring it turned a dormant
 * false claim into one a person reads.
 */

function tmpRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-resume-'));
  fs.mkdirSync(path.join(dir, '.sequence'), { recursive: true });
  return dir;
}

function runner() {
  return createProgramRunner({ now: () => Date.now() } as never);
}

test('resuming a run that was never recorded is NOT FOUND', () => {
  const outcome = runner().resume(tmpRepo(), 'run-abc123-0000ffff');
  assert.strictEqual(outcome.found, false);
});

test('A FINISHED RUN IS NOT RESUMED', () => {
  /*
   * Restarting a finished, failed or cancelled run would re-execute work the
   * record says is over, and "resume" would quietly mean "run again" — a
   * different act with a different bill.
   */
  const repo = tmpRepo();
  const runsDir = path.join(repo, '.sequence', 'program-runs', 'run-done01-0000aaaa');
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(
    path.join(runsDir, 'run.json'),
    JSON.stringify({
      runId: 'run-done01-0000aaaa',
      programId: 'p',
      programName: 'p',
      status: 'completed',
      startedAt: 1,
      lastEventSeq: 0,
      steps: 1,
      nodesTotal: 1,
      nodesDone: 1,
      nodesError: 0,
      program: { id: 'p', name: 'p', nodes: [], edges: [] },
      state: {},
      nodeResults: {},
      notes: [],
    }),
  );

  const outcome = runner().resume(repo, 'run-done01-0000aaaa');
  assert.strictEqual(outcome.found, true);
  assert.strictEqual(outcome.cancelled, false, 'a completed run must not restart');
});

test('A PAUSED RUN WITH NO CHECKPOINT IS NOT RESUMED EITHER', () => {
  /*
   * Paused before the first node reached a terminal status, so there is
   * nothing to resume FROM. Saying so beats silently starting the whole
   * program over and calling it a resume.
   */
  const repo = tmpRepo();
  const runsDir = path.join(repo, '.sequence', 'program-runs', 'run-early1-0000bbbb');
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(
    path.join(runsDir, 'run.json'),
    JSON.stringify({
      runId: 'run-early1-0000bbbb',
      programId: 'p',
      programName: 'p',
      status: 'paused',
      startedAt: 1,
      lastEventSeq: 0,
      steps: 0,
      nodesTotal: 1,
      nodesDone: 0,
      nodesError: 0,
      program: { id: 'p', name: 'p', nodes: [], edges: [] },
      state: {},
      nodeResults: {},
      notes: [],
    }),
  );

  const outcome = runner().resume(repo, 'run-early1-0000bbbb');
  assert.strictEqual(outcome.found, true);
  assert.strictEqual(outcome.cancelled, false);
  assert.strictEqual(outcome.status, 'paused');
});
