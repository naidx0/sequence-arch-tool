import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ArchGraph, NodeExecutor, Program } from '@sequence/schema';
import { buildReviewLoopProgram } from '@sequence/schema';
import {
  createProgramRunner,
  extractJsonValue,
  type ProgramRunner,
} from '../server/programRunner.js';

/**
 * THE TWO LIES A REAL RUN TOLD, LOCKED.
 *
 * `POST /api/program/run` was launched against the builtin `review-loop` on a
 * real repository and the resulting record was read back off disk. It said:
 *
 *     run.status    = "completed"        run.nodesError = 0
 *     state.checkerOk = "no"             state.violations = "ungrounded node id: …"
 *     run:note      = "loop exited at its maxIterations cap (3) with the
 *                      predicate still true"
 *
 * and the value stored under `claimedNodeIds` — a slot the program declares as
 * `json` — was a ~600-character English paragraph with a fenced array buried in
 * the middle of it, which the grounded checker then reported, correctly and
 * uselessly, as ONE ungrounded node id.
 *
 * Both halves are asserted here against the SAME program the run used, driven
 * through the SAME `createProgramRunner`, with the only non-determinism — the
 * model's answer — injected. Nothing below is satisfiable by a runner that
 * records a status and does nothing:
 *
 *  - the first test's executor returns exactly the shape the measured model
 *    returned (prose, a fenced array, a sign-off), so a runner that passes the
 *    string through fails the state assertion and a runner that keeps calling
 *    the outcome `completed` fails the status assertion;
 *  - the second test proves the extraction did not simply invent an empty
 *    array to make the checker happy: the ids it recovers are the ones the
 *    executor actually named, and a genuinely unreadable answer is the node's
 *    honest error rather than a silent pass-through.
 */

function tempRepo(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-runner-honesty-')));
}

/** A tiny real graph, so `checker` nodes have something grounded to check. */
function graph(): ArchGraph {
  return {
    nodes: [
      { id: 'svc:api', kind: 'service', name: 'api', files: [] },
      { id: 'svc:web', kind: 'service', name: 'web', files: [] },
    ],
    edges: [],
  } as unknown as ArchGraph;
}

/** A runner whose agent executor answers with whatever `reply` produces. */
function runnerWith(reply: (call: number) => string): { runner: ProgramRunner; calls: () => number } {
  let calls = 0;
  const agent: NodeExecutor = async () => {
    calls += 1;
    return { ok: true, value: reply(calls) };
  };
  const command: NodeExecutor = async () => ({ ok: false, error: 'no command executor in this test' });
  const runner = createProgramRunner({
    makeExecutors: () => ({ executors: { agent, command } }),
    groundedGraph: () => graph(),
  });
  return { runner, calls: () => calls };
}

/** Wait until the run leaves `running`, or fail loudly. */
async function settle(runner: ProgramRunner, repo: string, runId: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!runner.isLive(runId)) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail(`run ${runId} never settled`);
}

/* The measured answer, in the measured shape: a preface, a fenced JSON array of
   ids that are NOT in the graph, and a sign-off. */
const MEASURED_PROSE = [
  'Here is an example of proposed claimedNodeIds for your change. I looked at the',
  'attached architecture and these are the nodes I believe are touched:',
  '',
  '```json',
  '["node123", "node456"]',
  '```',
  '',
  'Let me know if you have any other questions!',
].join('\n');

test('a run whose grounded checker said no is never recorded as completed', async () => {
  const repo = tempRepo();
  const { runner } = runnerWith(() => MEASURED_PROSE);

  const started = runner.start({
    repoRoot: repo,
    program: buildReviewLoopProgram(),
    identity: 'local',
  });
  await settle(runner, repo, started.runId);

  const read = runner.read(repo, started.runId);
  assert.ok(read, 'the run is readable after it settled');
  const run = read.run;

  // The checker really did run and really did reject — this is the premise, and
  // asserting the status without it would let a broken checker green the test.
  assert.strictEqual(run.state.checkerOk, 'no', 'the grounded checker rejected the claims');
  assert.match(String(run.state.violations), /ungrounded node id/);

  // THE LIE. This was `completed`, with `nodesError: 0`, on exactly this record.
  assert.strictEqual(run.status, 'completed-with-violations');
  assert.notStrictEqual(run.status, 'completed');

  // And the reasons travel with it, in the words of whatever produced them.
  assert.ok(run.violations && run.violations.length > 0, 'the record carries the reasons');
  assert.ok(
    run.violations.some((v) => /ungrounded node id/.test(v)),
    "the checker's own violation string is one of them",
  );
  assert.ok(
    run.violations.some((v) => /maxIterations cap/.test(v)),
    "the scheduler's own loop-cap note is one of them",
  );

  // The durable log says the same thing, so a client that only tails the stream
  // is not told a different story from one that fetches the record.
  const finished = read.events.find((e) => e.type === 'run:finished');
  assert.ok(finished && finished.type === 'run:finished');
  assert.strictEqual(finished.status, 'completed-with-violations');
  assert.ok(finished.violations && finished.violations.length > 0);
});

test('a fenced JSON answer is extracted into a json-typed state slot, not stored as prose', async () => {
  const repo = tempRepo();
  const { runner } = runnerWith(() => MEASURED_PROSE);

  const started = runner.start({
    repoRoot: repo,
    program: buildReviewLoopProgram(),
    identity: 'local',
  });
  await settle(runner, repo, started.runId);
  const run = runner.read(repo, started.runId)!.run;

  /*
   * THE MEASURED DEFECT: `claimedNodeIds` held the whole paragraph. The checker
   * then reported the paragraph as one id, which is why the violation string in
   * the real record was 600 characters long.
   */
  assert.ok(Array.isArray(run.state.claimedNodeIds), 'the json slot holds a JSON value');
  assert.deepStrictEqual(run.state.claimedNodeIds, ['node123', 'node456']);

  // NOT an empty array. Extraction that could not find the value must never
  // substitute one, and the proof is that the ids recovered are the executor's.
  assert.notDeepStrictEqual(run.state.claimedNodeIds, []);

  // The checker still works and still says no — these are invented ids. The
  // gap was never the checker; it was that nothing acted on its verdict.
  assert.strictEqual(run.state.checkerOk, 'no');
  assert.match(String(run.state.violations), /node123/);
});

test('an answer with no JSON in it at all is the node’s honest error, not a silent pass-through', async () => {
  const repo = tempRepo();
  const { runner } = runnerWith(() => 'I am not able to help with that request.');

  const started = runner.start({
    repoRoot: repo,
    program: buildReviewLoopProgram(),
    identity: 'local',
  });
  await settle(runner, repo, started.runId);
  const run = runner.read(repo, started.runId)!.run;

  assert.strictEqual(run.status, 'failed', 'the run fails loudly rather than carrying prose forward');
  assert.strictEqual(run.nodeResults.propose?.status, 'error');
  assert.match(String(run.nodeResults.propose?.error), /declares as json/);
  // The reader is shown what actually came back, not only that it was wrong.
  assert.match(String(run.nodeResults.propose?.error), /not able to help/);
  // And nothing was written into the typed slot.
  assert.deepStrictEqual(run.state.claimedNodeIds, []);
});

test('a clean JSON answer is stored exactly as the model produced it', async () => {
  const repo = tempRepo();
  const { runner } = runnerWith(() => '["svc:api", "svc:web"]');

  const started = runner.start({
    repoRoot: repo,
    program: buildReviewLoopProgram(),
    identity: 'local',
  });
  await settle(runner, repo, started.runId);
  const run = runner.read(repo, started.runId)!.run;

  assert.deepStrictEqual(run.state.claimedNodeIds, ['svc:api', 'svc:web']);
  // Both ids ARE in the graph, so the checker passes and the loop exits
  // naturally — no violations, and `completed` keeps its meaning.
  assert.strictEqual(run.state.checkerOk, 'yes');
  assert.strictEqual(run.status, 'completed');
  assert.strictEqual(run.violations, undefined);
});

test('extractJsonValue: the shapes a weak model actually emits', () => {
  // Clean JSON is returned unchanged and is tried before anything is cut out.
  assert.deepStrictEqual(extractJsonValue('["a","b"]'), { ok: true, value: ['a', 'b'] });
  assert.deepStrictEqual(extractJsonValue('  {"k": 1}  '), { ok: true, value: { k: 1 } });

  // A fenced block, with and without a language tag.
  assert.deepStrictEqual(extractJsonValue('sure:\n```json\n["a"]\n```\nhope that helps'), {
    ok: true,
    value: ['a'],
  });
  assert.deepStrictEqual(extractJsonValue('```\n{"k":2}\n```'), { ok: true, value: { k: 2 } });

  // A bare value inside prose, with a decoy bracket in front of it.
  assert.deepStrictEqual(extractJsonValue('as noted [see below], the ids are ["x","y"] — done'), {
    ok: true,
    value: ['x', 'y'],
  });

  // The one repair: a trailing comma.
  assert.deepStrictEqual(extractJsonValue('```json\n["a", "b",]\n```'), {
    ok: true,
    value: ['a', 'b'],
  });

  // A comma inside a string is NOT a trailing comma and must survive.
  assert.deepStrictEqual(extractJsonValue('["a,", "b"]'), { ok: true, value: ['a,', 'b'] });

  // And an answer with no JSON in it is a refusal carrying a reason, never a
  // fabricated empty value.
  const none = extractJsonValue('I cannot do that.');
  assert.strictEqual(none.ok, false);
  assert.ok(none.ok === false && none.reason.length > 0);
});
