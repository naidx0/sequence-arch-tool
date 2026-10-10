import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { NodeExecutor, Program } from '@sequence/schema';
import {
  DEFAULT_RUN_MAX_STEPS,
  createProgramRunner,
  type ProgramRunner,
} from '../server/programRunner.js';

/**
 * PICKING A HALTED RUN BACK UP.
 *
 * Three defects, one seam. Each is asserted against a run that really executed
 * and really halted — never against a hand-written record — because the whole
 * class of failure here is a checkpoint that exists on disk and a layer above
 * it that will not read one.
 *
 *  1. `resume` accepted `paused` and nothing else. `scheduler.ts` states the
 *     contract as "paused = user/soft halt, resumable; stopped = budget/abort
 *     (also resumable)", and `reconcile()`'s `interrupted` is a record whose
 *     driver went away with its checkpoint intact. So a run halted at minute 55
 *     by a ten-minute budget had every completed node on disk and no way back.
 *  2. `resume` hard-coded the module's DEFAULT budgets, and the run's own were
 *     never persisted. A run started with `maxSteps: 900` and halted at step
 *     500 came back with `maxSteps: 200`, tripped the guard before its first
 *     node, and landed `stopped` on a budget it never asked for.
 *  3. `retryNodeIds` was implemented and unit-tested in the scheduler and
 *     reachable from NOWHERE — no runner method, no route, no control. So one
 *     transient provider error threw away every node before it.
 */

function tempRepo(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-resume-')));
}

/** A straight [start → a → b → end] chain of agent nodes. */
function chain(): Program {
  return {
    id: 'p-chain',
    name: 'chain',
    state: { shape: { ra: 'string', rb: 'string' } },
    nodes: [
      { id: 'start', title: 'Start', kind: 'start' },
      { id: 'a', title: 'A', kind: 'agent', agent: { prompt: 'a', outKey: 'ra' } },
      { id: 'b', title: 'B', kind: 'agent', agent: { prompt: 'b', outKey: 'rb' } },
      { id: 'end', title: 'End', kind: 'end' },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'a', kind: 'seq' },
      { id: 'e2', from: 'a', to: 'b', kind: 'seq' },
      { id: 'e3', from: 'b', to: 'end', kind: 'seq' },
    ],
  };
}

async function settle(runner: ProgramRunner, runId: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!runner.isLive(runId)) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail(`run ${runId} never settled`);
}

/**
 * A runner whose agent executor answers per node, and can be told to fail one
 * node the FIRST time it is asked — which is the provider-429 shape.
 */
function runnerWith(behaviour: (nodeId: string, call: number) => { ok: boolean; value?: string }): {
  runner: ProgramRunner;
  ran: string[];
} {
  const ran: string[] = [];
  const counts = new Map<string, number>();
  const agent: NodeExecutor = async (node) => {
    const n = (counts.get(node.id) ?? 0) + 1;
    counts.set(node.id, n);
    ran.push(node.id);
    const answer = behaviour(node.id, n);
    return answer.ok
      ? { ok: true, value: answer.value ?? `${node.id}-ok` }
      : { ok: false, error: `provider said 429 for ${node.id}` };
  };
  const command: NodeExecutor = async () => ({ ok: false, error: 'no command executor here' });
  const runner = createProgramRunner({ makeExecutors: () => ({ executors: { agent, command } }) });
  return { runner, ran };
}

test('a run stopped by its own step budget can be resumed from its checkpoint', async () => {
  const repo = tempRepo();
  const { runner, ran } = runnerWith(() => ({ ok: true }));

  /* maxSteps 3 lets start · a · b execute and trips the guard before `end`, so
     the scheduler halts `stopped` with a complete checkpoint — the exact shape
     a wall-clock budget produces, without a test that has to wait ten minutes
     for one. */
  const started = runner.start({
    repoRoot: repo,
    program: chain(),
    identity: 'local',
    maxSteps: 3,
  });
  await settle(runner, started.runId);

  const halted = runner.read(repo, started.runId)!.run;
  assert.strictEqual(halted.status, 'stopped');
  assert.ok(halted.checkpoint, 'the halted run wrote a checkpoint');
  assert.deepStrictEqual(ran, ['a', 'b'], 'both agent nodes really executed before the halt');

  /* THE DEFECT: `if (stored.status !== 'paused') return …` refused this. */
  const outcome = runner.resume(repo, started.runId);
  assert.strictEqual(outcome.cancelled, true, `resume was refused: ${outcome.reason ?? ''}`);
  assert.strictEqual(outcome.status, 'running');
  await settle(runner, started.runId);

  const after = runner.read(repo, started.runId)!.run;
  /* It still stops — `maxSteps: 3` is the budget it asked for and the step
     count carries forward — but the point is that it was PICKED UP: the record
     is live again and no completed node was re-executed. */
  assert.deepStrictEqual(ran, ['a', 'b'], 'no completed node was paid for twice');
  assert.notStrictEqual(after.finishedAt, halted.finishedAt, 'the run really ran again');
});

test('resume honours the budgets the run was started with, not the module defaults', async () => {
  const repo = tempRepo();
  const { runner } = runnerWith(() => ({ ok: true }));

  const started = runner.start({
    repoRoot: repo,
    program: chain(),
    identity: 'local',
    maxSteps: 3,
    timeoutMs: 45 * 60 * 1000,
  });
  await settle(runner, started.runId);

  const halted = runner.read(repo, started.runId)!.run;
  /* THE DEFECT, HALF ONE: the budgets were never written down, so `resume` had
     nothing to read and substituted `DEFAULT_RUN_MAX_STEPS`. */
  assert.strictEqual(halted.maxSteps, 3, 'the clamped step budget is on the record');
  assert.strictEqual(halted.timeoutMs, 45 * 60 * 1000, 'the clamped wall clock is on the record');
  assert.notStrictEqual(halted.maxSteps, DEFAULT_RUN_MAX_STEPS);

  runner.resume(repo, started.runId);
  await settle(runner, started.runId);
  const after = runner.read(repo, started.runId)!.run;
  assert.strictEqual(after.maxSteps, 3, 'the resumed segment kept the run’s own step budget');
  assert.strictEqual(after.timeoutMs, 45 * 60 * 1000);
});

test('a resumed run does not carry the previous segment’s terminal fields', async () => {
  const repo = tempRepo();
  const { runner } = runnerWith(() => ({ ok: true }));
  const started = runner.start({ repoRoot: repo, program: chain(), identity: 'local', maxSteps: 3 });
  await settle(runner, started.runId);
  const halted = runner.read(repo, started.runId)!.run;
  assert.ok(typeof halted.finishedAt === 'number');

  runner.resume(repo, started.runId);
  /* Read WHILE it is live: a record that says `running` and still carries the
     previous segment's `finishedAt` freezes every elapsed figure on every
     surface at the moment the run stopped last time. */
  const live = runner.read(repo, started.runId)!.run;
  assert.strictEqual(live.status, 'running');
  assert.strictEqual(live.finishedAt, undefined);
  await settle(runner, started.runId);
});

test('resume refuses a completed run, and says why', async () => {
  const repo = tempRepo();
  const { runner } = runnerWith(() => ({ ok: true }));
  const started = runner.start({ repoRoot: repo, program: chain(), identity: 'local' });
  await settle(runner, started.runId);
  assert.strictEqual(runner.read(repo, started.runId)!.run.status, 'completed');

  const outcome = runner.resume(repo, started.runId);
  assert.strictEqual(outcome.found, true);
  assert.strictEqual(outcome.cancelled, false, 'a finished run is not restarted by "resume"');
  assert.strictEqual(outcome.status, 'completed');
  assert.match(String(outcome.reason), /cannot be picked up/);
});

test('retry re-runs one failed node and keeps every completed node’s work', async () => {
  const repo = tempRepo();
  /* `b` fails the first time it is asked and succeeds the second — one
     transient provider error at the far end of a long run. */
  const { runner, ran } = runnerWith((nodeId, call) => ({ ok: !(nodeId === 'b' && call === 1) }));

  const started = runner.start({ repoRoot: repo, program: chain(), identity: 'local' });
  await settle(runner, started.runId);

  const failed = runner.read(repo, started.runId)!.run;
  assert.strictEqual(failed.status, 'failed');
  assert.strictEqual(failed.nodeResults.a.status, 'done');
  assert.strictEqual(failed.nodeResults.b.status, 'error');
  assert.ok(failed.checkpoint);

  /* THE DEFECT: `retryNodeIds` was implemented in the scheduler, unit-tested in
     `durableRun.test.ts`, and callable from nowhere at all. */
  const outcome = runner.retry(repo, started.runId, ['b']);
  assert.strictEqual(outcome.cancelled, true, `retry was refused: ${outcome.reason ?? ''}`);
  await settle(runner, started.runId);

  const after = runner.read(repo, started.runId)!.run;
  assert.strictEqual(after.status, 'completed');
  assert.strictEqual(after.nodeResults.b.status, 'done');
  assert.strictEqual(after.state.rb, 'b-ok');
  // `a` ran ONCE across both segments: the whole point is not paying twice.
  assert.strictEqual(ran.filter((id) => id === 'a').length, 1);
  assert.strictEqual(ran.filter((id) => id === 'b').length, 2);
  // And `a`'s answer survived the restart rather than being recomputed.
  assert.strictEqual(after.state.ra, 'a-ok');
});

test('retry refuses a node id the run’s program never declared', async () => {
  const repo = tempRepo();
  const { runner } = runnerWith((nodeId, call) => ({ ok: !(nodeId === 'b' && call === 1) }));
  const started = runner.start({ repoRoot: repo, program: chain(), identity: 'local' });
  await settle(runner, started.runId);

  const outcome = runner.retry(repo, started.runId, ['nope']);
  assert.strictEqual(outcome.cancelled, false);
  assert.match(String(outcome.reason), /declares no node 'nope'/);

  const empty = runner.retry(repo, started.runId, []);
  assert.strictEqual(empty.cancelled, false);
  assert.match(String(empty.reason), /at least one node id/);
});
