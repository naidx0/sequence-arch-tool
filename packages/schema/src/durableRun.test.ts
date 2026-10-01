/**
 * Unit lock for harness W4 (durable pause/resume/retry) + W1 checker node +
 * W5 review-loop template.
 */

import assert from 'node:assert';
import { test } from 'node:test';
import type { ArchGraph } from './index.js';
import type { Program } from './program.js';
import { validateProgram } from './program.js';
import {
  runProgram,
  type NodeExecutor,
  type ProgramExecutors,
  type RunCheckpoint,
} from './scheduler.js';
import { buildReviewLoopProgram, REVIEW_LOOP_MAX_ITERATIONS } from './programs/reviewLoop.js';

const okCommand: NodeExecutor = async (node) => ({ ok: true, value: `cmd:${node.id}` });

function execs(agent: NodeExecutor, command: NodeExecutor = okCommand): ProgramExecutors {
  return { agent, command };
}

const fixtureGraph: ArchGraph = {
  version: 1,
  scannedAt: '',
  repoRoot: '/r',
  repoName: 'r',
  warnings: [],
  nodes: [
    { id: 'repo', kind: 'repo', label: 'r' },
    { id: 'svc:api', kind: 'service', label: 'api', parentId: 'repo' },
    { id: 'svc:db', kind: 'datastore', label: 'db', parentId: 'repo' },
  ],
  edges: [],
};

function seqProgram(): Program {
  return {
    id: 'seq-w4',
    name: 'seq-w4',
    nodes: [
      { id: 's', title: 's', kind: 'start' },
      { id: 'a', title: 'a', kind: 'agent', agent: { prompt: 'p', outKey: 'ra' } },
      { id: 'b', title: 'b', kind: 'agent', agent: { prompt: 'p', outKey: 'rb' } },
      { id: 'c', title: 'c', kind: 'agent', agent: { prompt: 'p', outKey: 'rc' } },
      { id: 'e', title: 'e', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'a', kind: 'seq' },
      { id: '2', from: 'a', to: 'b', kind: 'seq' },
      { id: '3', from: 'b', to: 'c', kind: 'seq' },
      { id: '4', from: 'c', to: 'e', kind: 'seq' },
    ],
  };
}

test('W4: shouldPause yields paused + checkpoint; resume skips done nodes', async () => {
  const log: string[] = [];
  const agent: NodeExecutor = async (node) => {
    log.push(node.id);
    return { ok: true, value: `v:${node.id}` };
  };
  let pauseAfterA = false;
  const r1 = await runProgram(seqProgram(), execs(agent), {
    shouldPause: () => pauseAfterA,
    onCheckpoint: (cp) => {
      if (cp.completedNodeIds.includes('a') && !cp.completedNodeIds.includes('b')) {
        pauseAfterA = true;
      }
    },
  });
  assert.equal(r1.status, 'paused');
  assert.ok(r1.checkpoint.completedNodeIds.includes('a'));
  assert.ok(!r1.checkpoint.completedNodeIds.includes('b'));
  assert.deepEqual(log, ['a']);

  const r2 = await runProgram(seqProgram(), execs(agent), {
    resume: { checkpoint: r1.checkpoint },
  });
  assert.equal(r2.status, 'completed');
  assert.deepEqual(log, ['a', 'b', 'c']);
  assert.equal(r2.finalState.ra, 'v:a');
  assert.equal(r2.finalState.rb, 'v:b');
  assert.equal(r2.finalState.rc, 'v:c');
  assert.equal(r2.checkpoint.status, 'completed');
});

test('W4: partial failure + retry re-runs only the failed node', async () => {
  const log: string[] = [];
  let failB = true;
  const agent: NodeExecutor = async (node) => {
    log.push(node.id);
    if (node.id === 'b' && failB) return { ok: false, error: 'b-flaky' };
    return { ok: true, value: `v:${node.id}` };
  };
  const r1 = await runProgram(seqProgram(), execs(agent), {
    onError: 'stop-run',
  });
  assert.equal(r1.status, 'failed');
  assert.equal(r1.nodeResults['b']?.status, 'error');
  assert.ok(r1.checkpoint.completedNodeIds.includes('a'));
  assert.ok(!r1.checkpoint.completedNodeIds.includes('b'));

  failB = false;
  const r2 = await runProgram(seqProgram(), execs(agent), {
    resume: { checkpoint: r1.checkpoint, retryNodeIds: ['b'] },
  });
  assert.equal(r2.status, 'completed');
  // a skipped (not re-logged); b retried; c ran
  assert.deepEqual(log, ['a', 'b', 'b', 'c']);
  assert.equal(r2.finalState.rb, 'v:b');
});

test('W4: checkpoint serializes round-trip for soft restart', async () => {
  const agent: NodeExecutor = async (node) => ({ ok: true, value: node.id });
  let paused: RunCheckpoint | undefined;
  let hit = 0;
  await runProgram(seqProgram(), execs(agent), {
    shouldPause: () => hit >= 1,
    onCheckpoint: (cp) => {
      if (cp.completedNodeIds.includes('a')) {
        hit = 1;
        paused = cp;
      }
    },
  });
  assert.ok(paused);
  const raw = JSON.stringify(paused);
  const restored = JSON.parse(raw) as RunCheckpoint;
  assert.equal(restored.version, 1);
  assert.equal(restored.programId, 'seq-w4');
  const r = await runProgram(seqProgram(), execs(agent), {
    resume: { checkpoint: restored },
  });
  assert.equal(r.status, 'completed');
});

test('checker node: grounded pass writes checkerOk=yes', async () => {
  const program: Program = {
    id: 'chk',
    name: 'chk',
    state: { shape: { claimedNodeIds: 'json', checkerOk: 'string' }, initial: { claimedNodeIds: ['svc:api'] } },
    nodes: [
      { id: 's', title: 's', kind: 'start' },
      {
        id: 'k',
        title: 'k',
        kind: 'checker',
        checker: { claimedKey: 'claimedNodeIds', outKey: 'checkerOk', violationsKey: 'violations' },
      },
      { id: 'e', title: 'e', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'k', kind: 'seq' },
      { id: '2', from: 'k', to: 'e', kind: 'seq' },
    ],
  };
  const r = await runProgram(program, execs(async () => ({ ok: true })), {
    groundedGraph: fixtureGraph,
  });
  assert.equal(r.status, 'completed');
  assert.equal(r.finalState.checkerOk, 'yes');
});

test('checker node: ungrounded ids write checkerOk=no + violations', async () => {
  const program: Program = {
    id: 'chk-fail',
    name: 'chk-fail',
    state: {
      shape: { claimedNodeIds: 'json', checkerOk: 'string', violations: 'string' },
      initial: { claimedNodeIds: ['svc:ghost'] },
    },
    nodes: [
      { id: 's', title: 's', kind: 'start' },
      {
        id: 'k',
        title: 'k',
        kind: 'checker',
        checker: { claimedKey: 'claimedNodeIds', outKey: 'checkerOk', violationsKey: 'violations' },
      },
      { id: 'e', title: 'e', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'k', kind: 'seq' },
      { id: '2', from: 'k', to: 'e', kind: 'seq' },
    ],
  };
  const r = await runProgram(program, execs(async () => ({ ok: true })), {
    groundedGraph: fixtureGraph,
  });
  assert.equal(r.status, 'completed');
  assert.equal(r.finalState.checkerOk, 'no');
  assert.match(String(r.finalState.violations), /svc:ghost/);
});

test('W5 review-loop template: validateProgram clean + passes when agent grounds', async () => {
  const program = buildReviewLoopProgram();
  const v = validateProgram(program);
  assert.equal(v.ok, true, v.errors.join('; '));
  assert.equal(program.nodes.find((n) => n.id === 'verify')?.loop?.maxIterations, REVIEW_LOOP_MAX_ITERATIONS);

  let attempt = 0;
  const agent: NodeExecutor = async () => {
    attempt += 1;
    // First proposal ungrounded; second grounded — checker re-loop.
    if (attempt === 1) return { ok: true, value: ['svc:ghost'] };
    return { ok: true, value: ['svc:api'] };
  };
  const r = await runProgram(program, execs(agent), { groundedGraph: fixtureGraph });
  assert.equal(r.status, 'completed');
  assert.equal(r.finalState.checkerOk, 'yes');
  assert.equal(attempt, 2);
  assert.ok(r.nodeResults['check']?.status === 'done');
});

test('W5 review-loop: ungrounded forever hits loop cap loudly', async () => {
  const program = buildReviewLoopProgram();
  const agent: NodeExecutor = async () => ({ ok: true, value: ['svc:ghost'] });
  const r = await runProgram(program, execs(agent), { groundedGraph: fixtureGraph });
  assert.equal(r.status, 'completed');
  assert.equal(r.finalState.checkerOk, 'no');
  assert.ok(r.notes.some((n) => n.kind === 'loop-cap-reached' && n.nodeId === 'verify'));
});
