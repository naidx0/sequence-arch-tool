import assert from 'node:assert';
import { test } from 'node:test';

import { runProgram } from '@sequence/schema';
import type { Program } from '@sequence/schema';

/**
 * "WAITING ON YOU" WAS ALWAYS 0, AND THIS IS THE PRODUCER IT NEVER HAD.
 *
 * `activityModel.ts` documented the zero honestly rather than faking the count:
 * "`programRunner.ts` does not pass `shouldPause` to `runProgram`, and `paused`
 * is the only status `runProgram` produces from it. So today the Waiting on you
 * bucket counts zero on every real list."
 *
 * It was recorded as depending on lifecycle hooks — exit-code-2 blocking being
 * the mechanism by which a run would need a human. Hooks now exist, and in
 * building them the simpler truth surfaced: the one reading of that bucket which
 * invents NO policy is a run the person paused. Pausing your own run is
 * unambiguous, and it needs no decision about what else might.
 *
 * PAUSE IS NOT CANCEL, and that distinction is the whole feature. Cancel aborts
 * mid-node and the run is over. Pause lets the node in flight finish and halts
 * before the next — which is what makes `paused` resumable from the checkpoint
 * the scheduler already writes.
 */

/** The real `Program` shape: nodes and EDGES, with start and end. */
function twoNodes(): Program {
  return {
    id: 'p1',
    name: 'two steps',
    nodes: [
      { id: 's', title: 's', kind: 'start' },
      { id: 'a', title: 'a', kind: 'agent', agent: { prompt: 'first', outKey: 'ra' } },
      { id: 'b', title: 'b', kind: 'agent', agent: { prompt: 'second', outKey: 'rb' } },
      { id: 'e', title: 'e', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'a', kind: 'seq' },
      { id: '2', from: 'a', to: 'b', kind: 'seq' },
      { id: '3', from: 'b', to: 'e', kind: 'seq' },
    ],
  } as unknown as Program;
}

/** Executors that record which agent nodes actually ran. */
function recorder() {
  const ran: string[] = [];
  return {
    ran,
    executors: {
      agent: async (node: { id: string }) => {
        ran.push(node.id);
        return { ok: true, value: `v:${node.id}` };
      },
      command: async (node: { id: string }) => ({ ok: true, value: `cmd:${node.id}` }),
    } as never,
  };
}

test('nothing pauses when shouldPause never says so — the status quo', async () => {
  const r = recorder();
  const result = await runProgram(twoNodes(), r.executors, { shouldPause: () => false });
  assert.strictEqual(result.status, 'completed');
  assert.deepStrictEqual(r.ran, ['a', 'b']);
});

test('a pause halts the run at a node BOUNDARY, resumably', async () => {
  const r = recorder();
  let asked = false;
  const result = await runProgram(twoNodes(), r.executors, {
    /* Requested after the first node has run — the shape of a person clicking
       pause while something is in flight. */
    shouldPause: () => {
      if (r.ran.length >= 1) asked = true;
      return asked;
    },
  });

  assert.strictEqual(result.status, 'paused');
  /*
   * The node in flight FINISHED. That is the difference from cancel, which
   * aborts mid-node: a run halted between nodes has a checkpoint to come back
   * to, and one halted inside one does not.
   */
  assert.deepStrictEqual(r.ran, ['a']);
});

test('paused is not stopped — a bucket a run can leave', async () => {
  const r = recorder();
  const result = await runProgram(twoNodes(), r.executors, { shouldPause: () => true });
  /*
   * `stopped` is a budget, a timeout or a Stop: over, and not coming back.
   * `paused` is resumable, and a surface that folded them together would tell
   * a reader their run is finished when it is waiting for them.
   */
  assert.strictEqual(result.status, 'paused');
  assert.notStrictEqual(result.status, 'stopped');
});

test('a pause before anything runs still pauses, and runs nothing', async () => {
  const r = recorder();
  const result = await runProgram(twoNodes(), r.executors, { shouldPause: () => true });
  assert.strictEqual(result.status, 'paused');
  /* The guard is checked BEFORE each node body, so a pause that arrives first
     costs nothing rather than one node. */
  assert.deepStrictEqual(r.ran, []);
});

test('an abort still wins over a pause — Stop means stop', async () => {
  const r = recorder();
  const controller = new AbortController();
  controller.abort();
  const result = await runProgram(twoNodes(), r.executors, {
    shouldPause: () => true,
    signal: controller.signal,
  });
  /*
   * Both guards are true. `aborted` is checked first, and it must be: a user
   * who pressed Stop and then Pause meant Stop, and reporting `paused` would
   * leave a dead run sitting in a bucket promising it can be resumed.
   */
  assert.strictEqual(result.status, 'stopped');
});
