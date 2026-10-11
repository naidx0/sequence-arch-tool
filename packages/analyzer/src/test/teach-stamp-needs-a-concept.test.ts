import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { scanRepo } from '../scan.js';
import { buildDigest } from '../explain/explain.js';
import { buildQueue } from '../server/lessonState.js';
import {
  TEACH_MODE_STEP_ID,
  runAskPipeline,
  type AskPipelineInput,
  type AskStreamEvent,
} from '../server/askPipeline.js';

/**
 * ONE STEP EVENT, TWO CLAIMS — and only one of them is true on a turn with no
 * lesson in it.
 *
 * THE REPORTED SHAPE, captured from the running app (§12 of
 * `docs/research/teach-mode-driven-end-to-end.md`). Asked *"what is machine
 * learning"* against this repository with teach mode on, the shipped default
 * answered:
 *
 *   "ML is defined in mod:analyzer/3 within svc:analyzer, a module of 11 .ts
 *    files under packages/analyzer/src/llm/ …"
 *
 * That is the LLM client, not machine learning. The turn carried the work row
 * **"Taught this as a lesson"** while the canvas beside it read "the last answer
 * drew nothing here", and the footer read "answered from 0 of 2,939 edges".
 *
 * ── WHAT IS ACTUALLY WRONG, WHICH IS NOT WHAT IT LOOKS LIKE ──────────────
 *
 * The obvious repair is to stop emitting {@link TEACH_MODE_STEP_ID} when the
 * lesson queue is empty. **That was tried here and it is wrong.** The event
 * carries TWO claims:
 *
 *   1. "this turn ran in teach mode"  — TRUE, and it must stay visible. The
 *      event exists because the mode can engage without the user touching the
 *      toggle, and `ask-tool-loop.test.ts` pins exactly that: a silent mode
 *      switch is a surface asserting something the user did not choose.
 *      Suppressing it on a conceptless turn reintroduces that defect.
 *   2. "a lesson was taught"          — FALSE when no concept was built. This
 *      claim lives in the VERB, not in the event.
 *
 * The verb is `NAMED_STEP_ROW['teach-mode'].verb` in
 * `packages/web2/src/state/store.ts`. The entry directly beneath it already
 * states the rule that settles this, for `auto-approve`:
 *
 *   "The verb describes the MODE, not a count. The row is emitted whenever the
 *    mode is active, including on a turn where nothing needed converting, and a
 *    verb claiming approvals that did not happen would be the surface asserting
 *    something the engine never supplied."
 *
 * By that rule "Taught this as a lesson" is the wrong verb: it names an outcome,
 * not the mode. **That file belongs to CODEFORGE DESIGN and is not edited here.**
 * The fix is one line and needs no new data from this side, because a verb about
 * the mode needs nothing but the mode.
 *
 * ── AND THE SIGNAL THE OBVIOUS GATE WOULD HAVE USED IS UNUSABLE ──────────
 *
 * The footer prints "answered from 0 of N edges", which reads like the marker
 * for this exact failure. Measured on two banks before wiring anything:
 *
 *   gate                  refuses real lessons   catches the fabrication
 *   edgesSeen === 0             12 / 13                  8 / 8
 *   concept absent               4 / 13                  8 / 8
 *
 * `edgesSeen` counts edge rows surviving into the rendered digest, which is zero
 * for almost every scoped ask on this repository — the normal case, not a fault.
 * Gating on it would have refused twelve of the thirteen registered bank
 * lessons. A number that reads like a measurement of the ANSWER is measuring the
 * PROMPT.
 *
 * So this file pins both halves: the announcement survives, and the conceptless
 * case is recorded as the one whose verb overclaims.
 */

function repoFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-stamp-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'stamp', version: '1.0.0', type: 'module' }),
  );
  fs.writeFileSync(
    path.join(repo, 'src', 'gateway.js'),
    "import { route } from './router.js';\nexport function handle(r) {\n  return route(r);\n}\n",
  );
  fs.writeFileSync(
    path.join(repo, 'src', 'router.js'),
    'export function route(r) {\n  return r;\n}\n',
  );
  return root;
}

const ANSWER =
  'The gateway is the front door of this system and hands each request to the router. ' +
  'Make sense so far?';

async function runTeach(repo: string, teachContext: unknown): Promise<AskStreamEvent[]> {
  const graph = await scanRepo(repo, {});
  const events: AskStreamEvent[] = [];
  const input = {
    question: 'what is machine learning',
    intents: [],
    scopeLines: [],
    surface: undefined,
    deictic: false,
    design: undefined,
    designMode: false,
    askMode: 'research',
    graph,
    digest: buildDigest(graph),
    cfg: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' },
    resolveReadable: (p: string) => path.resolve(repo, p),
    repoRoot: repo,
    callProvider: async () => ({ text: ANSWER, toolRequests: [] }),
    teach: true,
    ...(teachContext === undefined ? {} : { teachContext }),
  } as unknown as AskPipelineInput;
  await runAskPipeline(input, (e) => events.push(e));
  return events;
}

const stamps = (events: AskStreamEvent[], type: 'step:start' | 'step:done'): number =>
  events.filter(
    (e) =>
      (e as { type?: string; id?: string }).type === type &&
      (e as { id?: string }).id === TEACH_MODE_STEP_ID,
  ).length;

test('THE ANNOUNCEMENT SURVIVES: a conceptless teach turn still says it ran in teach mode', async () => {
  /*
   * The property that made the obvious repair wrong. A mode the user did not
   * choose has to be legible whether or not it found anything to teach, so this
   * row must land even here — the fix for the overclaim is the verb, not this.
   */
  const root = repoFixture();
  try {
    const events = await runTeach(path.join(root, 'repo'), { known: '' });
    assert.strictEqual(stamps(events, 'step:start'), 1, 'the mode announces itself');
    assert.strictEqual(stamps(events, 'step:done'), 1, 'and the row lands rather than hanging open');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('and it survives on a real lesson too — the row is about the mode, not the outcome', async () => {
  const root = repoFixture();
  try {
    const events = await runTeach(path.join(root, 'repo'), {
      concept: { title: 'gateway.js', nodeId: 'file:src/gateway.js' },
    });
    assert.strictEqual(stamps(events, 'step:start'), 1);
    assert.strictEqual(stamps(events, 'step:done'), 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('THE OVERCLAIM, pinned: the reported ask builds no concept, so no lesson was structured', async () => {
  /*
   * The half that is true and checkable from this side: for the owner's literal
   * question there is nothing to teach. Any verb asserting a lesson happened is
   * asserting something the engine never supplied — CANON's standing defect,
   * and the same rule `auto-approve` is already written against.
   *
   * If this ever goes green-to-red because the queue starts returning concepts
   * for an out-of-repo subject, that is a REGRESSION in the opposite direction:
   * the product would then be inventing a subject rather than merely mislabelling
   * a turn.
   */
  const root = repoFixture();
  try {
    const graph = await scanRepo(path.join(root, 'repo'), {});
    assert.strictEqual(
      buildQueue(graph, 'what is machine learning').length,
      0,
      'the literal question builds no lesson on a repository without the subject',
    );
    assert.ok(
      buildQueue(graph, 'teach me gateway.js').length > 0,
      'and a subject the scan can find still does — the control',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
