import assert from 'node:assert';
import { test } from 'node:test';
import {
  evalPredicate,
  validateProgram,
  type Program,
  type ProgramState,
} from './program.js';

/**
 * Unit lock for the pure Programs MODEL (v14 Phase 1): the typed predicate
 * evaluator and the structural validator. All hand-built graphs — no scheduler,
 * no executors — so this pins the deterministic model math on its own.
 */

// --- evalPredicate totality --------------------------------------------------

test('evalPredicate: unknown key is falsy and never throws', () => {
  const s: ProgramState = {};
  assert.equal(evalPredicate({ left: 'missing', op: 'truthy' }, s), false);
  assert.equal(evalPredicate({ left: 'missing', op: 'falsy' }, s), true);
  assert.equal(evalPredicate({ left: 'missing', op: '==', right: 5 }, s), false);
  assert.equal(evalPredicate({ left: 'missing', op: '>', right: 0 }, s), false);
});

test('evalPredicate: truthy / falsy follow JS truthiness', () => {
  assert.equal(evalPredicate({ left: 'x', op: 'truthy' }, { x: 1 }), true);
  assert.equal(evalPredicate({ left: 'x', op: 'truthy' }, { x: 0 }), false);
  assert.equal(evalPredicate({ left: 'x', op: 'truthy' }, { x: '' }), false);
  assert.equal(evalPredicate({ left: 'x', op: 'falsy' }, { x: 0 }), true);
  assert.equal(evalPredicate({ left: 'x', op: 'falsy' }, { x: 'hi' }), false);
});

test('evalPredicate: equality and inequality', () => {
  assert.equal(evalPredicate({ left: 'v', op: '==', right: 'ok' }, { v: 'ok' }), true);
  assert.equal(evalPredicate({ left: 'v', op: '==', right: 'ok' }, { v: 'no' }), false);
  assert.equal(evalPredicate({ left: 'v', op: '!=', right: true }, { v: false }), true);
});

test('evalPredicate: numeric comparisons require two numbers', () => {
  assert.equal(evalPredicate({ left: 'n', op: '<', right: 5 }, { n: 3 }), true);
  assert.equal(evalPredicate({ left: 'n', op: '<=', right: 3 }, { n: 3 }), true);
  assert.equal(evalPredicate({ left: 'n', op: '>', right: 5 }, { n: 3 }), false);
  assert.equal(evalPredicate({ left: 'n', op: '>=', right: 3 }, { n: 3 }), true);
  // Non-numeric left → honestly false, not a throw.
  assert.equal(evalPredicate({ left: 'n', op: '<', right: 5 }, { n: 'x' }), false);
});

// --- validateProgram ---------------------------------------------------------

/** A minimal valid linear program: start → agent → end. */
function linear(): Program {
  return {
    id: 'p1',
    name: 'linear',
    nodes: [
      { id: 's', title: 'start', kind: 'start' },
      { id: 'a', title: 'do', kind: 'agent', agent: { prompt: 'hi', outKey: 'r' } },
      { id: 'e', title: 'end', kind: 'end' },
    ],
    edges: [
      { id: 'e1', from: 's', to: 'a', kind: 'seq' },
      { id: 'e2', from: 'a', to: 'e', kind: 'seq' },
    ],
  };
}

test('validateProgram: a well-formed linear program is ok', () => {
  const r = validateProgram(linear());
  assert.deepEqual(r, { ok: true, errors: [] });
});

test('validateProgram: catches duplicate node and edge ids', () => {
  const p = linear();
  p.nodes.push({ id: 'a', title: 'dupe', kind: 'end' });
  p.edges.push({ id: 'e1', from: 'a', to: 'e', kind: 'seq' });
  const r = validateProgram(p);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('duplicate node id: a')));
  assert.ok(r.errors.some((e) => e.includes('duplicate edge id: e1')));
});

test('validateProgram: catches dangling edges (unknown endpoints)', () => {
  const p = linear();
  p.edges.push({ id: 'e3', from: 'a', to: 'ghost', kind: 'seq' });
  const r = validateProgram(p);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('unknown to-node ghost')));
});

test('validateProgram: requires exactly one start', () => {
  const none: Program = { id: 'x', name: 'x', nodes: [{ id: 'e', title: 'e', kind: 'end' }], edges: [] };
  assert.ok(validateProgram(none).errors.some((e) => e.includes('no start node')));

  const two = linear();
  two.nodes.push({ id: 's2', title: 'start2', kind: 'start' });
  two.edges.push({ id: 'es2', from: 's2', to: 'a', kind: 'seq' });
  assert.ok(validateProgram(two).errors.some((e) => e.includes('2 start nodes')));
});

test('validateProgram: flags unreachable nodes', () => {
  const p = linear();
  p.nodes.push({ id: 'orphan', title: 'orphan', kind: 'end' });
  const r = validateProgram(p);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('orphan is not reachable')));
});

test('validateProgram: branch needs both true and false targets', () => {
  const p: Program = {
    id: 'b', name: 'b',
    nodes: [
      { id: 's', title: 's', kind: 'start' },
      { id: 'br', title: 'br', kind: 'branch', branch: { condition: { left: 'x', op: 'truthy' } } },
      { id: 't', title: 't', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'br', kind: 'seq' },
      { id: '2', from: 'br', to: 't', kind: 'branch-true' },
    ],
  };
  const r = validateProgram(p);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('no branch-false edge')));
});

test('validateProgram: loop needs a body, a back edge, and maxIterations > 0', () => {
  const p: Program = {
    id: 'l', name: 'l',
    nodes: [
      { id: 's', title: 's', kind: 'start' },
      { id: 'lp', title: 'lp', kind: 'loop', loop: { condition: { left: 'go', op: 'truthy' }, maxIterations: 0 } },
      { id: 'body', title: 'body', kind: 'agent', agent: { prompt: 'p' } },
      { id: 'e', title: 'e', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'lp', kind: 'seq' },
      { id: '2', from: 'lp', to: 'e', kind: 'seq' },
      // no loop-body, no loop-back
    ],
  };
  const r = validateProgram(p);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('maxIterations > 0')));
  assert.ok(r.errors.some((e) => e.includes('no loop-body edge')));
  assert.ok(r.errors.some((e) => e.includes('no loop-back edge')));
  // But note the 'body' node is unreachable here too — reachability still fires.
  assert.ok(r.errors.some((e) => e.includes('body is not reachable')));
});

test('validateProgram: a well-formed loop (body + back edge) is ok', () => {
  const p: Program = {
    id: 'l2', name: 'l2',
    nodes: [
      { id: 's', title: 's', kind: 'start' },
      { id: 'lp', title: 'lp', kind: 'loop', loop: { condition: { left: 'go', op: 'truthy' }, maxIterations: 3 } },
      { id: 'body', title: 'body', kind: 'agent', agent: { prompt: 'p', outKey: 'go' } },
      { id: 'e', title: 'e', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'lp', kind: 'seq' },
      { id: '2', from: 'lp', to: 'body', kind: 'loop-body' },
      { id: '3', from: 'body', to: 'lp', kind: 'loop-back' },
      { id: '4', from: 'lp', to: 'e', kind: 'seq' },
    ],
  };
  assert.deepEqual(validateProgram(p), { ok: true, errors: [] });
});

test('validateProgram: an illegal cycle NOT via loop-back is rejected', () => {
  const p: Program = {
    id: 'c', name: 'c',
    nodes: [
      { id: 's', title: 's', kind: 'start' },
      { id: 'a', title: 'a', kind: 'agent', agent: { prompt: 'p' } },
      { id: 'b', title: 'b', kind: 'agent', agent: { prompt: 'p' } },
    ],
    edges: [
      { id: '1', from: 's', to: 'a', kind: 'seq' },
      { id: '2', from: 'a', to: 'b', kind: 'seq' },
      { id: '3', from: 'b', to: 'a', kind: 'seq' }, // seq cycle — illegal
    ],
  };
  const r = validateProgram(p);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('illegal cycle')));
});

test('validateProgram: gate retry via branch-false loop-back is legal', () => {
  const p: Program = {
    id: 'gate-retry',
    name: 'gate-retry',
    nodes: [
      { id: 's', title: 'Task', kind: 'start' },
      { id: 'planner', title: 'Planner', kind: 'agent', agent: { prompt: 'plan' } },
      { id: 'gate', title: 'Plan approved?', kind: 'branch', branch: { condition: { left: 'ok', op: 'truthy' } } },
      { id: 'out', title: 'Output', kind: 'agent', agent: { prompt: 'out' } },
      { id: 'e', title: 'End', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'planner', kind: 'seq' },
      { id: '2', from: 'planner', to: 'gate', kind: 'seq' },
      { id: '3', from: 'gate', to: 'out', kind: 'branch-true' },
      { id: '4', from: 'gate', to: 'planner', kind: 'branch-false', label: 'No: revise plan' },
      { id: '5', from: 'out', to: 'e', kind: 'seq' },
    ],
  };
  assert.deepEqual(validateProgram(p), { ok: true, errors: [] });
});

test('validateProgram: missing kind-specific fields are caught', () => {
  const p: Program = {
    id: 'k', name: 'k',
    nodes: [
      { id: 's', title: 's', kind: 'start' },
      { id: 'a', title: 'a', kind: 'agent' }, // no agent.prompt
      { id: 'c', title: 'c', kind: 'command' }, // no command.command
    ],
    edges: [
      { id: '1', from: 's', to: 'a', kind: 'seq' },
      { id: '2', from: 'a', to: 'c', kind: 'seq' },
    ],
  };
  const r = validateProgram(p);
  assert.ok(r.errors.some((e) => e.includes('agent node a is missing agent.prompt')));
  assert.ok(r.errors.some((e) => e.includes('command node c is missing command.command')));
});

// --- parallel kind is recognized by the validator (regression lock) ----------

test('validateProgram: a parallel node is a recognized kind (no "unknown kind" error)', () => {
  const program: Program = {
    id: 'p',
    name: 'parallel-kind',
    nodes: [
      { id: 'start', kind: 'start', title: 'start' },
      { id: 'fan', kind: 'parallel', title: 'fan' },
      { id: 'a', kind: 'agent', title: 'a', agent: { prompt: 'x' } },
      { id: 'b', kind: 'agent', title: 'b', agent: { prompt: 'y' } },
      { id: 'end', kind: 'end', title: 'end' },
    ],
    edges: [
      { id: 'e0', kind: 'seq', from: 'start', to: 'fan' },
      { id: 'e1', kind: 'parallel', from: 'fan', to: 'a' },
      { id: 'e2', kind: 'parallel', from: 'fan', to: 'b' },
      { id: 'e3', kind: 'seq', from: 'a', to: 'end' },
      { id: 'e4', kind: 'seq', from: 'b', to: 'end' },
    ],
  };
  const res = validateProgram(program);
  assert.ok(
    !res.errors.some((e) => e.includes('unknown kind')),
    `parallel must be recognized; got: ${JSON.stringify(res.errors)}`,
  );
});

// --- v16: agent runtime + acp bag --------------------------------------------

test('validateProgram: a gateway agent node is unchanged (lock)', () => {
  // The FROZEN shape from v14: prompt/model/intent/outKey, no runtime. It must
  // validate exactly as before — this locks byte-compatibility for existing
  // gateway programs against the v16 additions.
  const p: Program = {
    id: 'g',
    name: 'gateway-lock',
    nodes: [
      { id: 's', title: 'start', kind: 'start' },
      {
        id: 'a',
        title: 'ask',
        kind: 'agent',
        agent: { prompt: 'hi', intent: 'ask', outKey: 'r' },
      },
      { id: 'e', title: 'end', kind: 'end' },
    ],
    edges: [
      { id: 'e1', from: 's', to: 'a', kind: 'seq' },
      { id: 'e2', from: 'a', to: 'e', kind: 'seq' },
    ],
  };
  assert.deepEqual(validateProgram(p), { ok: true, errors: [] });
  // An absent runtime is semantically 'gateway'.
  assert.strictEqual(p.nodes[1].agent?.runtime, undefined);
});

/** A linear program whose single agent node runs on the ACP runtime. */
function acpLinear(acp?: { agentRef?: unknown; shareSession?: unknown }): Program {
  return {
    id: 'acp',
    name: 'acp-linear',
    nodes: [
      { id: 's', title: 'start', kind: 'start' },
      {
        id: 'a',
        title: 'agent',
        kind: 'agent',
        agent: {
          prompt: 'do the thing',
          runtime: 'acp',
          ...(acp !== undefined ? { acp: acp as { agentRef?: string; shareSession?: boolean } } : {}),
        },
      },
      { id: 'e', title: 'end', kind: 'end' },
    ],
    edges: [
      { id: 'e1', from: 's', to: 'a', kind: 'seq' },
      { id: 'e2', from: 'a', to: 'e', kind: 'seq' },
    ],
  };
}

test('validateProgram: a well-formed acp agent node validates', () => {
  assert.deepEqual(validateProgram(acpLinear()), { ok: true, errors: [] });
  assert.deepEqual(
    validateProgram(acpLinear({ agentRef: 'claude', shareSession: false })),
    { ok: true, errors: [] },
  );
});

test('validateProgram: acp still requires a prompt', () => {
  const p = acpLinear();
  // Blank the prompt on the acp node.
  p.nodes[1].agent = { prompt: '', runtime: 'acp' };
  const r = validateProgram(p);
  assert.ok(r.errors.some((e) => e.includes('missing agent.prompt')), JSON.stringify(r.errors));
});

test('validateProgram: an invalid runtime value is rejected', () => {
  const p = acpLinear();
  (p.nodes[1].agent as { runtime: unknown }).runtime = 'local';
  const r = validateProgram(p);
  assert.ok(r.errors.some((e) => e.includes('invalid runtime')), JSON.stringify(r.errors));
});

test('validateProgram: a malformed acp bag is rejected', () => {
  const badRef = validateProgram(acpLinear({ agentRef: 42 }));
  assert.ok(badRef.errors.some((e) => e.includes('agentRef must be a string')), JSON.stringify(badRef.errors));
  const badShare = validateProgram(acpLinear({ shareSession: 'yes' }));
  assert.ok(
    badShare.errors.some((e) => e.includes('shareSession must be a boolean')),
    JSON.stringify(badShare.errors),
  );
});
