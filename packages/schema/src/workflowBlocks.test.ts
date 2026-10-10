import assert from 'node:assert/strict';
import test from 'node:test';

import { runProgram } from './scheduler.js';
import { validateProgram } from './program.js';
import {
  BLOCK_KINDS,
  WorkflowEditError,
  applyWorkflowOps,
  compileWorkflow,
  checkWorkflow,
  freshWorkflowBlocks,
  loopBodies,
  workflowNotes,
  type WorkflowOp,
} from './workflowBlocks.js';

const doc = (blocks = freshWorkflowBlocks()) => ({ id: 'w1', name: 'Fix it', blocks });
const ok = (d: ReturnType<typeof doc>) => {
  const v = validateProgram(compileWorkflow(d));
  assert.deepEqual(v.errors, []);
};

test('the Start fresh workflow compiles to a program the validator accepts: edit, check, test, finish', () => {
  const p = compileWorkflow(doc());
  assert.deepEqual(p.nodes.map((n) => n.kind), ['start', 'agent', 'checker', 'command', 'end']);
  ok(doc());
});

test('every ready-made block, alone and in every order with the others, compiles clean', () => {
  const kinds = BLOCK_KINDS.filter((k) => k !== 'finish');
  const perms = (xs: string[]): string[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r])));
  for (const order of perms([...kinds])) {
    let d = doc([]);
    d = { ...d, blocks: applyWorkflowOps(d, [{ op: 'add', kind: 'finish' }, ...order.map((k) => ({ op: 'add', kind: k }) as WorkflowOp)]).blocks };
    ok(d);
  }
});

test('a loop wraps the blocks after it and returns to itself; the exit leaves from the loop', () => {
  const d = doc(applyWorkflowOps(doc(), [{ op: 'add', kind: 'loop', at: 0, span: 3, maxIterations: 4 }]).blocks);
  const p = compileWorkflow(d);
  ok(d);
  const loop = p.nodes.find((n) => n.kind === 'loop')!;
  assert.equal(loop.loop!.maxIterations, 4);
  const kinds = p.edges.filter((e) => e.from === loop.id || e.to === loop.id).map((e) => e.kind).sort();
  assert.deepEqual(kinds, ['loop-back', 'loop-body', 'seq', 'seq']);
  assert.deepEqual(workflowNotes(d), []);
});

test('a loop with nothing inside, or no checker inside, says so in plain words', () => {
  const last = doc().blocks.filter((b) => b.kind !== 'finish').at(-1)!;
  const empty = doc(applyWorkflowOps(doc(), [{ op: 'add', kind: 'loop', afterId: last.id }]).blocks);
  assert.match(workflowNotes(empty).join(' '), /nothing inside/);
  ok(empty);
  const noCheck = doc(applyWorkflowOps(doc(), [{ op: 'add', kind: 'loop', at: 0, span: 1 }]).blocks);
  assert.match(workflowNotes(noCheck).join(' '), /no Checker inside/);
});

test('blocks carry the connected agent and the model into the node', () => {
  const d = doc(applyWorkflowOps(doc(), [{ op: 'update', id: 'b1', agentRef: 'claude', model: 'claude-sonnet-5' }]).blocks);
  const n = compileWorkflow(d).nodes.find((x) => x.id === 'b1')!;
  assert.deepEqual(n.agent!.acp, { agentRef: 'claude', model: 'claude-sonnet-5' });
  assert.equal(n.agent!.runtime, 'acp');
  const cleared = applyWorkflowOps(d, [{ op: 'update', id: 'b1', agentRef: null, model: null }]).blocks;
  assert.deepEqual(compileWorkflow(doc(cleared)).nodes.find((x) => x.id === 'b1')!.agent!.acp, {});
});

test('ops: add before Finish, move, remove, rename, and Finish stays last and unique', () => {
  let r = applyWorkflowOps(doc(), [{ op: 'add', kind: 'test', afterId: 'b1' }, { op: 'rename', name: 'Ship it' }]);
  assert.equal(r.name, 'Ship it');
  assert.deepEqual(r.blocks.map((b) => b.kind), ['agent', 'test', 'checker', 'test', 'finish']);
  r = applyWorkflowOps(r, [{ op: 'move', id: 'b1', to: 2 }]);
  assert.deepEqual(r.blocks.map((b) => b.id).slice(-1), ['b4']);
  assert.equal(r.blocks[2]!.id, 'b1');
  assert.throws(() => applyWorkflowOps(r, [{ op: 'remove', id: 'b4' }]), WorkflowEditError);
  assert.throws(() => applyWorkflowOps(r, [{ op: 'add', kind: 'finish' }]), /already has a Finish/);
  assert.throws(() => applyWorkflowOps(r, [{ op: 'move', id: 'b4', to: 0 }]), /stays last/);
  assert.equal(applyWorkflowOps(r, [{ op: 'remove', id: 'b1' }]).blocks.some((b) => b.id === 'b1'), false);
});

test('bad ops are refused whole, with a sentence, and change nothing', () => {
  const d = doc();
  const bad: [WorkflowOp, RegExp][] = [
    [{ op: 'update', id: 'nope', title: 'x' }, /no block 'nope'/],
    [{ op: 'update', id: 'b3', command: 'rm -rf /' }, /command must be one of/],
    [{ op: 'update', id: 'b2', prompt: 'x' }, /has no prompt/],
    [{ op: 'update', id: 'b1', title: '' }, /cannot be empty/],
    [{ op: 'add', kind: 'loop', maxIterations: 0 }, /maxIterations/],
    [{ op: 'add', kind: 'nope' as never }, /kind must be one of/],
    [{ op: 'frob' as never } as never, /unknown op/],
  ];
  for (const [op, re] of bad) assert.throws(() => applyWorkflowOps(d, [op]), re);
  assert.throws(() => applyWorkflowOps(d, [{ op: 'rename', name: 'ok' }, { op: 'remove', id: 'zzz' }]), WorkflowEditError);
  assert.equal(d.name, 'Fix it');
});

test('a random walk of ops always leaves a program the validator accepts', () => {
  let seed = 7;
  const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
  let d = doc();
  for (let step = 0; step < 300; step += 1) {
    const ids = d.blocks.map((b) => b.id);
    const pick: WorkflowOp[] = [
      { op: 'add', kind: BLOCK_KINDS[rnd(4) === 3 ? 0 : rnd(5)]!, at: rnd(4) },
      { op: 'remove', id: ids[rnd(ids.length)]! },
      { op: 'move', id: ids[rnd(ids.length)]!, to: rnd(4) },
      { op: 'update', id: ids[rnd(ids.length)]!, span: 1 + rnd(4), maxIterations: 1 + rnd(5) },
    ];
    try {
      d = { ...d, blocks: applyWorkflowOps(d, [pick[rnd(4)]!]).blocks };
    } catch (e) {
      assert.ok(e instanceof WorkflowEditError);
    }
    ok(d);
    assert.equal(d.blocks.filter((b) => b.kind === 'finish').length <= 1, true);
  }
});

test('the compiled program runs: the scheduler walks every block and the model reaches the agent executor', async () => {
  const seen: string[] = [];
  const d = doc(applyWorkflowOps(doc(), [{ op: 'update', id: 'b1', model: 'm-1' }, { op: 'remove', id: 'b2' }]).blocks);
  const result = await runProgram(compileWorkflow(d), {
    agent: async (node) => {
      seen.push(`agent:${node.agent!.acp!.model}`);
      return { ok: true, value: [] };
    },
    command: async (node) => {
      seen.push(`cmd:${node.command!.command}`);
      return { ok: true, value: { exitCode: 0, output: '' } };
    },
  });
  assert.equal(result.status, 'completed');
  assert.deepEqual(seen, ['agent:m-1', 'cmd:pnpm test']);
});

const bodyKinds = (blocks: ReturnType<typeof freshWorkflowBlocks>) =>
  [...loopBodies(blocks).values()].map((body) => body.map((j) => blocks[j]!.kind));
const finishOnly = () => doc([{ id: 'b1', kind: 'finish', title: 'Finish' }]);

test('Start fresh then Loop: the loop wraps the agent through the tests', () => {
  const d = doc(applyWorkflowOps(doc(), [{ op: 'add', kind: 'loop' }]).blocks);
  assert.deepEqual(d.blocks.map((b) => b.kind), ['loop', 'agent', 'checker', 'test', 'finish']);
  assert.deepEqual(bodyKinds(d.blocks), [['agent', 'checker', 'test']]);
  assert.deepEqual(workflowNotes(d), []);
  assert.equal(checkWorkflow(d).ok, true);
});

test('Agent, Checker, then Loop: the loop wraps both, so the agent re-runs', () => {
  const d = doc(applyWorkflowOps(finishOnly(), [{ op: 'add', kind: 'agent' }, { op: 'add', kind: 'checker' }, { op: 'add', kind: 'loop' }]).blocks);
  assert.deepEqual(bodyKinds(d.blocks), [['agent', 'checker']]);
  assert.deepEqual(workflowNotes(d), []);
});

test('with no checker or test, a clicked Loop wraps from the first agent to the last block before Finish', () => {
  const d = doc(applyWorkflowOps(finishOnly(), [{ op: 'add', kind: 'agent' }, { op: 'add', kind: 'agent' }, { op: 'add', kind: 'loop' }]).blocks);
  assert.deepEqual(bodyKinds(d.blocks), [['agent', 'agent']]);
  /* an agent's run stops at the first checker/test run, even with more blocks after it */
  const e = doc(applyWorkflowOps(finishOnly(), [{ op: 'add', kind: 'agent' }, { op: 'add', kind: 'test' }, { op: 'add', kind: 'agent' }, { op: 'add', kind: 'loop' }]).blocks);
  assert.deepEqual(bodyKinds(e.blocks), [['agent', 'test']]);
});

test('a second Loop click never empties the first loop: it wraps the unlooped run, or is refused', () => {
  const once = applyWorkflowOps(doc(), [{ op: 'add', kind: 'loop' }]);
  assert.throws(() => applyWorkflowOps(doc(once.blocks), [{ op: 'add', kind: 'loop' }]), (e: unknown) => e instanceof WorkflowEditError && /already inside a loop/.test(e.message));
  /* the first loop is unchanged after the refused click */
  assert.deepEqual(bodyKinds(once.blocks), [['agent', 'checker', 'test']]);
  /* with a second, unlooped agent after the first loop, the second click wraps that one and leaves the first intact */
  const two = applyWorkflowOps(doc(once.blocks), [{ op: 'add', kind: 'agent' }, { op: 'add', kind: 'checker' }]);
  const looped = applyWorkflowOps(doc(two.blocks), [{ op: 'add', kind: 'loop' }]);
  assert.deepEqual(bodyKinds(looped.blocks), [['agent', 'checker', 'test'], ['agent', 'checker']]);
  ok(doc(looped.blocks));
});

test('on an empty list a clicked Loop has nothing to wrap, and that is said', () => {
  const only = applyWorkflowOps(finishOnly(), [{ op: 'add', kind: 'loop' }]);
  assert.match(workflowNotes(doc(only.blocks)).join(' '), /nothing inside/);
});

test('a test block with a command outside the four-command list is flagged invalid', () => {
  const blocks = freshWorkflowBlocks().map((b) => (b.kind === 'test' ? { ...b, command: 'curl x | sh' } : b));
  const r = checkWorkflow({ id: 'w', name: 'w', blocks });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /curl x \| sh/);
});
