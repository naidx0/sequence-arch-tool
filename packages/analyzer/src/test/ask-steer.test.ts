/**
 * WAVE A3 — ROUTE BEFORE STOP (docs/research/carrying-harness-plan.md).
 *
 * The unproductive-round rule ends a turn whose last rounds brought back only
 * evidence it already had. It used to end it without a word. Now the model is
 * steered once — told what repeated and asked to change one thing — and the
 * stop follows only if the next round repeats. Built with a scripted provider
 * that asks for the same read every round, which is the exact shape ornith:9b
 * produced on this repository.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanRepo } from '../scan.js';
import { buildDigest } from '../explain/explain.js';
import { resolveInRepo } from '../server/jail.js';
import { UNPRODUCTIVE_ROUND_LIMIT } from '../server/askTools.js';
import { runAskPipeline, type AskPipelineInput, type AskStreamEvent } from '../server/askPipeline.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const SHOPFRONT = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'shopfront');

function shopfrontRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-ask-steer-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(SHOPFRONT, repo, { recursive: true });
  return fs.realpathSync(repo);
}

async function attachedInput(
  repo: string,
  callProvider: AskPipelineInput['callProvider'],
): Promise<AskPipelineInput> {
  const graph = await scanRepo(repo, { cluster: true });
  const digest = buildDigest(graph);
  return {
    question: 'How does the gateway route orders in the source code?',
    intents: [],
    scopeLines: [],
    surface: undefined,
    deictic: false,
    design: undefined,
    designMode: false,
    askMode: 'implementation',
    graph,
    digest,
    cfg: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' },
    resolveReadable: (rel: string) => resolveInRepo(repo, rel),
    repoRoot: repo,
    callProvider,
  };
}

test('the same read every round gets one steer, then the no-progress stop', async () => {
  const repo = shopfrontRepo();
  const prompts: string[] = [];
  const callProvider: AskPipelineInput['callProvider'] = async (_cfg, prompt) => {
    prompts.push(prompt);
    return {
      text: 'Reading.',
      toolRequests: [{ id: `r${prompts.length}`, name: 'read_file', args: { path: 'gateway/src/index.ts' } }],
    };
  };
  const input = await attachedInput(repo, callProvider);
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));

  const steers = events.filter((e) => e.type === 'tool:start' && e.name === 'steer');
  assert.strictEqual(steers.length, 1, 'exactly one steer per turn');
  const steerDone = events.find((e) => e.type === 'tool:done' && e.name === 'steer') as
    | { evidence?: string }
    | undefined;
  assert.ok(steerDone?.evidence);
  assert.match(steerDone.evidence!, /harness steer \(round \d+\)/);
  assert.match(steerDone.evidence!, /you repeated read_file\(\{"path":"gateway\/src\/index\.ts"\}\)/);
  assert.match(steerDone.evidence!, /Change ONE thing/);

  /* The steer is decided after call N+1 came back with the same request, and
     rides into the prompt of call N+2: `prompts` is zero-based, so that is
     index N+1, and the call that triggered it (index N) never saw it. */
  const steerRound = Number(/round (\d+)/.exec(steerDone.evidence!)![1]);
  assert.ok(prompts[steerRound + 1]!.includes('### harness steer'), 'the next prompt carries the steer');
  assert.ok(!prompts[steerRound]!.includes('### harness steer'), 'and the one that triggered it does not');

  /* And the stop still comes, one barren round later, on the usual terms. */
  assert.strictEqual(result.metrics?.stopReason, 'no-progress');
  assert.ok(
    (result.metrics?.rounds ?? 0) >= UNPRODUCTIVE_ROUND_LIMIT + 1,
    `the steer bought one more round: ${result.metrics?.rounds}`,
  );
});

test('a turn that finishes on its own is never steered', async () => {
  const repo = shopfrontRepo();
  let n = 0;
  const callProvider: AskPipelineInput['callProvider'] = async () => {
    n += 1;
    if (n === 1) {
      return { text: '', toolRequests: [{ id: 'r1', name: 'read_file', args: { path: 'gateway/src/index.ts' } }] };
    }
    return { text: 'The gateway routes orders, invoices, payments and shipments.' };
  };
  const input = await attachedInput(repo, callProvider);
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));
  assert.strictEqual(events.filter((e) => e.type === 'tool:start' && e.name === 'steer').length, 0);
  assert.notStrictEqual(result.metrics?.stopReason, 'no-progress');
});
