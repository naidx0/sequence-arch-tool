import assert from 'node:assert';
import { test } from 'node:test';
import type { Program } from './program.js';
import {
  runProgram,
  type NodeExecutor,
  type ProgramExecutors,
  type RunEvent,
} from './scheduler.js';

/**
 * Unit lock for the pure SCHEDULER (v14 Phase 1). Every executor is a mock — no
 * network, no fs, no LLM — so these tests pin the deterministic walk semantics
 * (seq / parallel / branch / loop), honest status streaming, the outKey state
 * writes, the error truth (no fabricated `done`), and the anti-infinite-loop
 * budget guards.
 */

/** An executor that records call order and echoes a value into state via outKey. */
function recordingAgent(log: string[]): NodeExecutor {
  return async (node, _state, _ctx) => {
    log.push(node.id);
    return { ok: true, value: `v:${node.id}` };
  };
}

const failCommand: NodeExecutor = async () => ({ ok: false, error: 'nope' });
const okCommand: NodeExecutor = async (node) => ({ ok: true, value: `cmd:${node.id}` });

function execs(agent: NodeExecutor, command: NodeExecutor = okCommand): ProgramExecutors {
  return { agent, command };
}

// --- sequence ----------------------------------------------------------------

test('runs seq nodes in declared order and writes outKey into state', async () => {
  const log: string[] = [];
  const program: Program = {
    id: 'seq', name: 'seq',
    nodes: [
      { id: 's', title: 's', kind: 'start' },
      { id: 'a', title: 'a', kind: 'agent', agent: { prompt: 'p', outKey: 'ra' } },
      { id: 'b', title: 'b', kind: 'agent', agent: { prompt: 'p', outKey: 'rb' } },
      { id: 'e', title: 'e', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'a', kind: 'seq' },
      { id: '2', from: 'a', to: 'b', kind: 'seq' },
      { id: '3', from: 'b', to: 'e', kind: 'seq' },
    ],
  };
  const r = await runProgram(program, execs(recordingAgent(log)));
  assert.equal(r.status, 'completed');
  assert.deepEqual(log, ['a', 'b']);
  assert.equal(r.finalState.ra, 'v:a');
  assert.equal(r.finalState.rb, 'v:b');
  assert.equal(r.nodeResults['a'].status, 'done');
  assert.equal(r.nodeResults['e'].status, 'done');
});

// --- parallel concurrency + join --------------------------------------------

test('parallel node fans out concurrently (overlap) and joins before continuing', async () => {
  // Each branch bumps a shared active counter, awaits a tick, then decrements.
  // If they ran sequentially, maxConcurrent would be 1; concurrency ⇒ > 1.
  let active = 0;
  let maxConcurrent = 0;
  const order: string[] = [];
  const overlapping: NodeExecutor = async (node) => {
    active++;
    maxConcurrent = Math.max(maxConcurrent, active);
    await new Promise((res) => setTimeout(res, 5));
    active--;
    order.push(node.id);
    return { ok: true, value: node.id };
  };
  const program: Program = {
    id: 'par', name: 'par',
    nodes: [
      { id: 's', title: 's', kind: 'start' },
      { id: 'fan', title: 'fan', kind: 'parallel' },
      { id: 'p1', title: 'p1', kind: 'agent', agent: { prompt: 'p', outKey: 'k1' } },
      { id: 'p2', title: 'p2', kind: 'agent', agent: { prompt: 'p', outKey: 'k2' } },
      { id: 'p3', title: 'p3', kind: 'agent', agent: { prompt: 'p', outKey: 'k3' } },
      { id: 'join', title: 'join', kind: 'agent', agent: { prompt: 'p', outKey: 'joined' } },
      { id: 'e', title: 'e', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'fan', kind: 'seq' },
      { id: 'pa', from: 'fan', to: 'p1', kind: 'parallel' },
      { id: 'pb', from: 'fan', to: 'p2', kind: 'parallel' },
      { id: 'pc', from: 'fan', to: 'p3', kind: 'parallel' },
      { id: 'jn', from: 'fan', to: 'join', kind: 'seq' }, // the join continuation
      { id: 'end', from: 'join', to: 'e', kind: 'seq' },
    ],
  };
  const r = await runProgram(program, execs(overlapping));
  assert.equal(r.status, 'completed');
  assert.ok(maxConcurrent >= 2, `expected concurrent branches, maxConcurrent=${maxConcurrent}`);
  // Join ran ONCE, after the fan-out, and saw all three writes.
  assert.equal(r.finalState.k1, 'p1');
  assert.equal(r.finalState.k2, 'p2');
  assert.equal(r.finalState.k3, 'p3');
  assert.equal(r.finalState.joined, 'join');
  assert.equal(r.nodeResults['join'].status, 'done');
  // The join is the last executor to run.
  assert.equal(order[order.length - 1], 'join');
});

// --- branch ------------------------------------------------------------------

test('branch follows true vs false based on state predicate', async () => {
  const build = (seed: number): Program => ({
    id: 'br', name: 'br',
    state: { shape: { n: 'number' }, initial: { n: seed } },
    nodes: [
      { id: 's', title: 's', kind: 'start' },
      { id: 'br', title: 'br', kind: 'branch', branch: { condition: { left: 'n', op: '>', right: 0 } } },
      { id: 'yes', title: 'yes', kind: 'agent', agent: { prompt: 'p', outKey: 'took' } },
      { id: 'no', title: 'no', kind: 'agent', agent: { prompt: 'p', outKey: 'took' } },
      { id: 'e', title: 'e', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'br', kind: 'seq' },
      { id: 't', from: 'br', to: 'yes', kind: 'branch-true' },
      { id: 'f', from: 'br', to: 'no', kind: 'branch-false' },
      { id: 'ey', from: 'yes', to: 'e', kind: 'seq' },
      { id: 'en', from: 'no', to: 'e', kind: 'seq' },
    ],
  });
  const log1: string[] = [];
  const r1 = await runProgram(build(1), execs(recordingAgent(log1)));
  assert.deepEqual(log1, ['yes']);
  assert.equal(r1.finalState.took, 'v:yes');

  const log2: string[] = [];
  const r2 = await runProgram(build(-1), execs(recordingAgent(log2)));
  assert.deepEqual(log2, ['no']);
  assert.equal(r2.finalState.took, 'v:no');
});

// --- loop --------------------------------------------------------------------

test('loop repeats until the predicate flips, then exits', async () => {
  // Body increments a counter; the loop runs WHILE counter < 3.
  const counter: NodeExecutor = async (_node, state) => {
    const n = (state.count as number) ?? 0;
    return { ok: true, value: n + 1 };
  };
  const program: Program = {
    id: 'loop', name: 'loop',
    state: { shape: { count: 'number' }, initial: { count: 0 } },
    nodes: [
      { id: 's', title: 's', kind: 'start' },
      { id: 'lp', title: 'lp', kind: 'loop', loop: { condition: { left: 'count', op: '<', right: 3 }, maxIterations: 10 } },
      { id: 'body', title: 'body', kind: 'agent', agent: { prompt: 'p', outKey: 'count' } },
      { id: 'e', title: 'e', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'lp', kind: 'seq' },
      { id: 'b', from: 'lp', to: 'body', kind: 'loop-body' },
      { id: 'bk', from: 'body', to: 'lp', kind: 'loop-back' },
      { id: 'x', from: 'lp', to: 'e', kind: 'seq' },
    ],
  };
  const r = await runProgram(program, execs(counter));
  assert.equal(r.status, 'completed');
  assert.equal(r.finalState.count, 3); // stopped exactly when predicate flipped
  assert.equal(r.nodeResults['e'].status, 'done');
});

test('loop respects maxIterations (never infinite) even if predicate stays true', async () => {
  let calls = 0;
  const alwaysGo: NodeExecutor = async () => {
    calls++;
    return { ok: true, value: true }; // predicate 'go' truthy stays true forever
  };
  const program: Program = {
    id: 'cap', name: 'cap',
    state: { shape: { go: 'boolean' }, initial: { go: true } },
    nodes: [
      { id: 's', title: 's', kind: 'start' },
      { id: 'lp', title: 'lp', kind: 'loop', loop: { condition: { left: 'go', op: 'truthy' }, maxIterations: 4 } },
      { id: 'body', title: 'body', kind: 'agent', agent: { prompt: 'p', outKey: 'go' } },
      { id: 'e', title: 'e', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'lp', kind: 'seq' },
      { id: 'b', from: 'lp', to: 'body', kind: 'loop-body' },
      { id: 'bk', from: 'body', to: 'lp', kind: 'loop-back' },
      { id: 'x', from: 'lp', to: 'e', kind: 'seq' },
    ],
  };
  const r = await runProgram(program, execs(alwaysGo));
  assert.equal(r.status, 'completed'); // exits loudly via the cap, not a hang
  assert.equal(calls, 4); // exactly maxIterations
  assert.equal(r.nodeResults['e'].status, 'done');
});

// --- error truth -------------------------------------------------------------

test('a rejecting executor → node error, run failed, NO fabricated done', async () => {
  const events: RunEvent[] = [];
  const throwing: NodeExecutor = async () => {
    throw new Error('boom');
  };
  const program: Program = {
    id: 'err', name: 'err',
    nodes: [
      { id: 's', title: 's', kind: 'start' },
      { id: 'a', title: 'a', kind: 'agent', agent: { prompt: 'p', outKey: 'r' } },
      { id: 'e', title: 'e', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'a', kind: 'seq' },
      { id: '2', from: 'a', to: 'e', kind: 'seq' },
    ],
  };
  const r = await runProgram(program, execs(throwing), { onEvent: (e) => events.push(e) });
  assert.equal(r.status, 'failed');
  assert.equal(r.nodeResults['a'].status, 'error');
  assert.equal(r.nodeResults['a'].error, 'boom');
  assert.equal(r.finalState.r, undefined); // nothing written on failure
  assert.equal(r.nodeResults['e'], undefined); // downstream never ran
  // Honest stream: node 'a' emitted running then error, NEVER done.
  const aEvents = events.filter((e) => e.nodeId === 'a').map((e) => e.status);
  assert.deepEqual(aEvents, ['queued', 'running', 'error']);
  assert.ok(!events.some((e) => e.nodeId === 'a' && e.status === 'done'));
});

test('an ok:false result is an honest error too (no throw needed)', async () => {
  const program: Program = {
    id: 'cf', name: 'cf',
    nodes: [
      { id: 's', title: 's', kind: 'start' },
      { id: 'c', title: 'c', kind: 'command', command: { command: 'exit 1', outKey: 'r' } },
      { id: 'e', title: 'e', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'c', kind: 'seq' },
      { id: '2', from: 'c', to: 'e', kind: 'seq' },
    ],
  };
  const r = await runProgram(program, execs(recordingAgent([]), failCommand));
  assert.equal(r.status, 'failed');
  assert.equal(r.nodeResults['c'].status, 'error');
  assert.equal(r.nodeResults['c'].error, 'nope');
});

test('continue-siblings lets concurrent branches finish despite one error', async () => {
  const done: string[] = [];
  const mixed: NodeExecutor = async (node) => {
    if (node.id === 'bad') return { ok: false, error: 'x' };
    await new Promise((res) => setTimeout(res, 2));
    done.push(node.id);
    return { ok: true, value: node.id };
  };
  const program: Program = {
    id: 'sib', name: 'sib',
    nodes: [
      { id: 's', title: 's', kind: 'start' },
      { id: 'fan', title: 'fan', kind: 'parallel' },
      { id: 'good1', title: 'g1', kind: 'agent', agent: { prompt: 'p', outKey: 'a' } },
      { id: 'good2', title: 'g2', kind: 'agent', agent: { prompt: 'p', outKey: 'b' } },
      { id: 'bad', title: 'bad', kind: 'agent', agent: { prompt: 'p', outKey: 'c' } },
      { id: 'e', title: 'e', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'fan', kind: 'seq' },
      { id: 'pa', from: 'fan', to: 'good1', kind: 'parallel' },
      { id: 'pb', from: 'fan', to: 'good2', kind: 'parallel' },
      { id: 'pc', from: 'fan', to: 'bad', kind: 'parallel' },
      { id: 'jn', from: 'fan', to: 'e', kind: 'seq' },
    ],
  };
  const r = await runProgram(program, execs(mixed), { onError: 'continue-siblings' });
  assert.equal(r.status, 'failed'); // an error happened
  assert.equal(r.nodeResults['bad'].status, 'error');
  // Siblings still completed.
  assert.deepEqual(done.sort(), ['good1', 'good2']);
  assert.equal(r.nodeResults['good1'].status, 'done');
  assert.equal(r.nodeResults['good2'].status, 'done');
});

// --- budget guard ------------------------------------------------------------

test('maxSteps budget forces a loud stop (never a hang)', async () => {
  const program: Program = {
    id: 'budget', name: 'budget',
    state: { shape: { go: 'boolean' }, initial: { go: true } },
    nodes: [
      { id: 's', title: 's', kind: 'start' },
      { id: 'lp', title: 'lp', kind: 'loop', loop: { condition: { left: 'go', op: 'truthy' }, maxIterations: 1000 } },
      { id: 'body', title: 'body', kind: 'agent', agent: { prompt: 'p' } },
      { id: 'e', title: 'e', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'lp', kind: 'seq' },
      { id: 'b', from: 'lp', to: 'body', kind: 'loop-body' },
      { id: 'bk', from: 'body', to: 'lp', kind: 'loop-back' },
      { id: 'x', from: 'lp', to: 'e', kind: 'seq' },
    ],
  };
  const r = await runProgram(program, execs(async () => ({ ok: true, value: true })), { maxSteps: 6 });
  assert.equal(r.status, 'stopped');
  assert.ok(r.steps <= 7, `steps=${r.steps}`);
  assert.equal(r.nodeResults['e'], undefined); // never reached the end
});

test('shouldStop (W2 token/$ hook) forces a loud stop', async () => {
  const program: Program = {
    id: 'tok', name: 'tok',
    state: { shape: { go: 'boolean' }, initial: { go: true } },
    nodes: [
      { id: 's', title: 's', kind: 'start' },
      { id: 'lp', title: 'lp', kind: 'loop', loop: { condition: { left: 'go', op: 'truthy' }, maxIterations: 100 } },
      { id: 'body', title: 'body', kind: 'agent', agent: { prompt: 'p' } },
      { id: 'e', title: 'e', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'lp', kind: 'seq' },
      { id: 'b', from: 'lp', to: 'body', kind: 'loop-body' },
      { id: 'bk', from: 'body', to: 'lp', kind: 'loop-back' },
      { id: 'x', from: 'lp', to: 'e', kind: 'seq' },
    ],
  };
  let n = 0;
  const r = await runProgram(program, execs(async () => ({ ok: true, value: true })), {
    shouldStop: () => {
      n += 1;
      return n > 3;
    },
  });
  assert.equal(r.status, 'stopped');
  assert.equal(r.nodeResults['e'], undefined);
});

// --- Finding A: real abort stops launching new node work ---------------------

test('abort during a parallel probe → downstream summarize executor is NEVER invoked', async () => {
  // [start → A(parallel probes p1..p3) → B(summarize)]. We abort mid-probe; the
  // summarize node's executor must never be called (no new metered spend).
  const controller = new AbortController();
  const calls: string[] = [];
  let summarizeCalls = 0;
  const exec: NodeExecutor = async (node) => {
    calls.push(node.id);
    if (node.id === 'summarize') summarizeCalls++;
    if (node.id.startsWith('p')) {
      // A probe: abort the run WHILE it's in flight, then never resolve here in a
      // way that races the summarize — resolve after firing abort.
      controller.abort();
      return { ok: true, value: node.id };
    }
    return { ok: true, value: node.id };
  };
  const program: Program = {
    id: 'abrt', name: 'abrt',
    nodes: [
      { id: 's', title: 's', kind: 'start' },
      { id: 'fan', title: 'fan', kind: 'parallel' },
      { id: 'p1', title: 'p1', kind: 'agent', agent: { prompt: 'p', outKey: 'a' } },
      { id: 'p2', title: 'p2', kind: 'agent', agent: { prompt: 'p', outKey: 'b' } },
      { id: 'p3', title: 'p3', kind: 'agent', agent: { prompt: 'p', outKey: 'c' } },
      { id: 'summarize', title: 'summarize', kind: 'agent', agent: { prompt: 'p', outKey: 'sum' } },
      { id: 'e', title: 'e', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'fan', kind: 'seq' },
      { id: 'pa', from: 'fan', to: 'p1', kind: 'parallel' },
      { id: 'pb', from: 'fan', to: 'p2', kind: 'parallel' },
      { id: 'pc', from: 'fan', to: 'p3', kind: 'parallel' },
      { id: 'jn', from: 'fan', to: 'summarize', kind: 'seq' },
      { id: 'end', from: 'summarize', to: 'e', kind: 'seq' },
    ],
  };
  const r = await runProgram(program, execs(exec), { signal: controller.signal });
  assert.equal(r.status, 'stopped');
  assert.equal(summarizeCalls, 0, 'summarize executor must never run after abort');
  assert.equal(r.nodeResults['summarize'], undefined);
  assert.equal(r.nodeResults['e'], undefined); // end never reached
});

test('abort mid-await abandons the in-flight executor and ends stopped (no hang)', async () => {
  const controller = new AbortController();
  const program: Program = {
    id: 'ab2', name: 'ab2',
    nodes: [
      { id: 's', title: 's', kind: 'start' },
      { id: 'a', title: 'a', kind: 'command', command: { command: 'sleep', outKey: 'r' } },
      { id: 'b', title: 'b', kind: 'agent', agent: { prompt: 'p', outKey: 'r2' } },
      { id: 'e', title: 'e', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'a', kind: 'seq' },
      { id: '2', from: 'a', to: 'b', kind: 'seq' },
      { id: '3', from: 'b', to: 'e', kind: 'seq' },
    ],
  };
  let bCalls = 0;
  const never: NodeExecutor = () => new Promise(() => {}); // command that never resolves
  const bAgent: NodeExecutor = async () => { bCalls++; return { ok: true, value: 1 }; };
  // Fire abort shortly after the run starts awaiting the wedged command.
  setTimeout(() => controller.abort(), 10);
  const r = await runProgram(program, execs(bAgent, never), { signal: controller.signal });
  assert.equal(r.status, 'stopped');
  assert.equal(r.nodeResults['a'].status, 'error'); // honestly not completed
  assert.equal(bCalls, 0); // downstream never ran
  assert.equal(r.finalState.r, undefined);
});

// --- Finding B: executor-await timeout race (no forever-await) ----------------

test('a never-resolving executor + a small timeoutMs → run ends stopped, node honest', async () => {
  const program: Program = {
    id: 'wedge', name: 'wedge',
    nodes: [
      { id: 's', title: 's', kind: 'start' },
      { id: 'c', title: 'c', kind: 'command', command: { command: 'hangs', outKey: 'r' } },
      { id: 'e', title: 'e', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'c', kind: 'seq' },
      { id: '2', from: 'c', to: 'e', kind: 'seq' },
    ],
  };
  const never: NodeExecutor = () => new Promise(() => {}); // whenDelivered never resolves
  const r = await runProgram(program, execs(recordingAgent([]), never), { timeoutMs: 25 });
  assert.equal(r.status, 'stopped'); // NOT a hang
  assert.equal(r.nodeResults['c'].status, 'error'); // recorded honestly
  assert.equal(r.nodeResults['e'], undefined);
});

// --- Finding C: single-execution (no reconvergence double-run) ----------------

test('a diamond (parallel → X,Y that both reconverge on Z BEFORE the join) runs Z exactly once', async () => {
  // Z is a shared seq-descendant of BOTH parallel branches, sitting BEFORE the
  // join. Because a branch stops only at the join (not at Z), the OLD scheduler
  // walked X→Z and Y→Z and ran Z twice (double metered spend). The visited-set
  // makes Z run exactly once.
  const runs: Record<string, number> = {};
  const counting: NodeExecutor = async (node) => {
    runs[node.id] = (runs[node.id] ?? 0) + 1;
    return { ok: true, value: node.id };
  };
  const program: Program = {
    id: 'diamond', name: 'diamond',
    nodes: [
      { id: 's', title: 's', kind: 'start' },
      { id: 'fan', title: 'fan', kind: 'parallel' },
      { id: 'x', title: 'x', kind: 'agent', agent: { prompt: 'p', outKey: 'x' } },
      { id: 'y', title: 'y', kind: 'agent', agent: { prompt: 'p', outKey: 'y' } },
      { id: 'z', title: 'z', kind: 'agent', agent: { prompt: 'p', outKey: 'z' } }, // shared descendant
      { id: 'join', title: 'join', kind: 'agent', agent: { prompt: 'p', outKey: 'j' } },
      { id: 'e', title: 'e', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'fan', kind: 'seq' },
      { id: 'pa', from: 'fan', to: 'x', kind: 'parallel' },
      { id: 'pb', from: 'fan', to: 'y', kind: 'parallel' },
      { id: 'xz', from: 'x', to: 'z', kind: 'seq' }, // both branches reconverge at Z…
      { id: 'yz', from: 'y', to: 'z', kind: 'seq' },
      { id: 'zj', from: 'z', to: 'join', kind: 'seq' }, // …then flow to the join
      { id: 'jn', from: 'fan', to: 'join', kind: 'seq' }, // the parallel's own join continuation
      { id: 'je', from: 'join', to: 'e', kind: 'seq' },
    ],
  };
  const r = await runProgram(program, execs(counting));
  assert.equal(r.status, 'completed');
  assert.equal(runs['z'], 1, `Z ran ${runs['z']} times (expected exactly 1)`);
  assert.equal(runs['x'], 1);
  assert.equal(runs['y'], 1);
  assert.equal(runs['join'], 1, `join ran ${runs['join']} times (expected exactly 1)`);
});

test('parallel with no seq join reconverging at end → end executes exactly once', async () => {
  const runs: Record<string, number> = {};
  const counting: NodeExecutor = async (node) => {
    runs[node.id] = (runs[node.id] ?? 0) + 1;
    return { ok: true, value: node.id };
  };
  const program: Program = {
    id: 'noJoin', name: 'noJoin',
    nodes: [
      { id: 's', title: 's', kind: 'start' },
      { id: 'fan', title: 'fan', kind: 'parallel' }, // NO seq edge out of fan
      { id: 'x', title: 'x', kind: 'agent', agent: { prompt: 'p', outKey: 'x' } },
      { id: 'y', title: 'y', kind: 'agent', agent: { prompt: 'p', outKey: 'y' } },
      { id: 'e', title: 'e', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'fan', kind: 'seq' },
      { id: 'pa', from: 'fan', to: 'x', kind: 'parallel' },
      { id: 'pb', from: 'fan', to: 'y', kind: 'parallel' },
      { id: 'xe', from: 'x', to: 'e', kind: 'seq' }, // both reconverge at end
      { id: 'ye', from: 'y', to: 'e', kind: 'seq' },
    ],
  };
  const events: RunEvent[] = [];
  const r = await runProgram(program, execs(counting), { onEvent: (e) => events.push(e) });
  assert.equal(r.status, 'completed');
  const endDone = events.filter((e) => e.nodeId === 'e' && e.status === 'done').length;
  assert.equal(endDone, 1, `end emitted 'done' ${endDone} times (expected exactly 1)`);
});

test('single-execution does NOT break loop re-entry — a loop body still repeats each iteration', async () => {
  // The visited-set is epoch-keyed per loop iteration, so the body node runs once
  // PER ITERATION (not once total). Body increments count; loop runs while < 3.
  let bodyRuns = 0;
  const counter: NodeExecutor = async (_node, state) => {
    bodyRuns++;
    const n = (state.count as number) ?? 0;
    return { ok: true, value: n + 1 };
  };
  const program: Program = {
    id: 'loopRepeat', name: 'loopRepeat',
    state: { shape: { count: 'number' }, initial: { count: 0 } },
    nodes: [
      { id: 's', title: 's', kind: 'start' },
      { id: 'lp', title: 'lp', kind: 'loop', loop: { condition: { left: 'count', op: '<', right: 3 }, maxIterations: 10 } },
      { id: 'body', title: 'body', kind: 'agent', agent: { prompt: 'p', outKey: 'count' } },
      { id: 'e', title: 'e', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'lp', kind: 'seq' },
      { id: 'b', from: 'lp', to: 'body', kind: 'loop-body' },
      { id: 'bk', from: 'body', to: 'lp', kind: 'loop-back' },
      { id: 'x', from: 'lp', to: 'e', kind: 'seq' },
    ],
  };
  const r = await runProgram(program, execs(counter));
  assert.equal(r.status, 'completed');
  assert.equal(bodyRuns, 3, 'the loop body must still repeat across iterations');
  assert.equal(r.finalState.count, 3);
});

// --- loud loop cap (nit) -----------------------------------------------------

test('a loop that exits by hitting maxIterations (predicate still true) emits a loud loop-cap note', async () => {
  const notes: unknown[] = [];
  const program: Program = {
    id: 'loud', name: 'loud',
    state: { shape: { go: 'boolean' }, initial: { go: true } },
    nodes: [
      { id: 's', title: 's', kind: 'start' },
      { id: 'lp', title: 'lp', kind: 'loop', loop: { condition: { left: 'go', op: 'truthy' }, maxIterations: 3 } },
      { id: 'body', title: 'body', kind: 'agent', agent: { prompt: 'p', outKey: 'go' } },
      { id: 'e', title: 'e', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'lp', kind: 'seq' },
      { id: 'b', from: 'lp', to: 'body', kind: 'loop-body' },
      { id: 'bk', from: 'body', to: 'lp', kind: 'loop-back' },
      { id: 'x', from: 'lp', to: 'e', kind: 'seq' },
    ],
  };
  const r = await runProgram(program, execs(async () => ({ ok: true, value: true })), {
    onNote: (n) => notes.push(n),
  });
  assert.equal(r.status, 'completed');
  assert.equal(r.notes.length, 1);
  assert.equal(r.notes[0].kind, 'loop-cap-reached');
  assert.equal(r.notes[0].nodeId, 'lp');
  assert.equal(notes.length, 1); // also streamed via onNote
});

test('a loop that exits naturally (predicate flips false) emits NO loop-cap note', async () => {
  const counter: NodeExecutor = async (_node, state) => {
    const n = (state.count as number) ?? 0;
    return { ok: true, value: n + 1 };
  };
  const program: Program = {
    id: 'natural', name: 'natural',
    state: { shape: { count: 'number' }, initial: { count: 0 } },
    nodes: [
      { id: 's', title: 's', kind: 'start' },
      { id: 'lp', title: 'lp', kind: 'loop', loop: { condition: { left: 'count', op: '<', right: 2 }, maxIterations: 10 } },
      { id: 'body', title: 'body', kind: 'agent', agent: { prompt: 'p', outKey: 'count' } },
      { id: 'e', title: 'e', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'lp', kind: 'seq' },
      { id: 'b', from: 'lp', to: 'body', kind: 'loop-body' },
      { id: 'bk', from: 'body', to: 'lp', kind: 'loop-back' },
      { id: 'x', from: 'lp', to: 'e', kind: 'seq' },
    ],
  };
  const r = await runProgram(program, execs(counter));
  assert.equal(r.status, 'completed');
  assert.equal(r.notes.length, 0, 'a natural predicate-false exit is not a loud cap');
});

// --- honest status stream ----------------------------------------------------

test('status stream is queued→running→done in order for a happy node', async () => {
  const events: RunEvent[] = [];
  const program: Program = {
    id: 'ev', name: 'ev',
    nodes: [
      { id: 's', title: 's', kind: 'start' },
      { id: 'a', title: 'a', kind: 'agent', agent: { prompt: 'p' } },
      { id: 'e', title: 'e', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'a', kind: 'seq' },
      { id: '2', from: 'a', to: 'e', kind: 'seq' },
    ],
  };
  await runProgram(program, execs(recordingAgent([])), { onEvent: (e) => events.push(e) });
  const a = events.filter((e) => e.nodeId === 'a').map((e) => e.status);
  assert.deepEqual(a, ['queued', 'running', 'done']);
});

// --- end-to-end: Slate's deep-research shape ---------------------------------

test('e2e: parallel-probe → evaluate → loop-until-sufficient converges honestly', async () => {
  // A deep-research-shaped program: a loop whose body fans out N probes in
  // parallel (each a mock AI call that adds a "finding"), then an evaluator
  // scores sufficiency into state. The loop repeats WHILE not sufficient, capped.
  // Convergence: each round adds findings; the evaluator marks sufficient once
  // findings >= 6.
  const events: RunEvent[] = [];
  let rounds = 0;

  // Each probe writes its OWN state key (distinct outKeys) so the concurrent
  // fan-out writes never race; the evaluator reads all three.
  const probeK: NodeExecutor = async () => ({ ok: true, value: 1 });

  const evaluator: NodeExecutor = async (_node, state) => {
    rounds++;
    const found = ((state.f1 as number) ?? 0) + ((state.f2 as number) ?? 0) + ((state.f3 as number) ?? 0);
    const total = found * rounds; // each round the probes fire again, accumulating
    const sufficient = total >= 6;
    return { ok: true, value: sufficient };
  };

  const dispatcher: NodeExecutor = async (node, state, ctx) => {
    if (node.id === 'eval') return evaluator(node, state, ctx);
    return probeK(node, state, ctx);
  };

  const program: Program = {
    id: 'research', name: 'deep-research',
    state: { shape: { sufficient: 'boolean', f1: 'number', f2: 'number', f3: 'number' }, initial: { sufficient: false } },
    nodes: [
      { id: 's', title: 'start', kind: 'start' },
      { id: 'lp', title: 'research loop', kind: 'loop', loop: { condition: { left: 'sufficient', op: 'falsy' }, maxIterations: 5 } },
      { id: 'fan', title: 'probe fan-out', kind: 'parallel' },
      { id: 'probe1', title: 'probe 1', kind: 'agent', agent: { prompt: 'search a', outKey: 'f1' } },
      { id: 'probe2', title: 'probe 2', kind: 'agent', agent: { prompt: 'search b', outKey: 'f2' } },
      { id: 'probe3', title: 'probe 3', kind: 'agent', agent: { prompt: 'search c', outKey: 'f3' } },
      { id: 'eval', title: 'evaluate sufficiency', kind: 'agent', agent: { prompt: 'enough?', outKey: 'sufficient' } },
      { id: 'e', title: 'report', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'lp', kind: 'seq' },
      { id: 'body', from: 'lp', to: 'fan', kind: 'loop-body' },
      { id: 'pa', from: 'fan', to: 'probe1', kind: 'parallel' },
      { id: 'pb', from: 'fan', to: 'probe2', kind: 'parallel' },
      { id: 'pc', from: 'fan', to: 'probe3', kind: 'parallel' },
      { id: 'jn', from: 'fan', to: 'eval', kind: 'seq' }, // join → evaluator
      { id: 'bk', from: 'eval', to: 'lp', kind: 'loop-back' },
      { id: 'x', from: 'lp', to: 'e', kind: 'seq' },
    ],
  };

  const r = await runProgram(program, execs(dispatcher), { onEvent: (e) => events.push(e) });

  assert.equal(r.status, 'completed');
  assert.equal(r.finalState.sufficient, true); // converged
  assert.ok(rounds >= 2 && rounds <= 5, `converged in ${rounds} rounds (bounded)`);
  assert.equal(r.nodeResults['e'].status, 'done');

  // Event-stream honesty: every node that reports 'done' emitted 'running' first,
  // and no node reports both 'done' and 'error'.
  const byNode = new Map<string, string[]>();
  for (const e of events) {
    const arr = byNode.get(e.nodeId) ?? [];
    arr.push(e.status);
    byNode.set(e.nodeId, arr);
  }
  for (const [nodeId, statuses] of byNode) {
    if (statuses.includes('done')) {
      assert.ok(statuses.indexOf('running') < statuses.lastIndexOf('done'),
        `${nodeId}: running must precede done`);
    }
    assert.ok(!(statuses.includes('done') && statuses.includes('error')),
      `${nodeId}: never both done and error`);
  }
  // The probes ran multiple times (once per round) — honest re-emission.
  const probe1Runs = (byNode.get('probe1') ?? []).filter((s) => s === 'running').length;
  assert.ok(probe1Runs >= 2, `probe1 ran ${probe1Runs} times across rounds`);
});
