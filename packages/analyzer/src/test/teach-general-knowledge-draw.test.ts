import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { scanRepo } from '../scan.js';
import { buildTeachContext, newLesson } from '../server/lessonState.js';
import {
  TEACH_MODE_INSTRUCTIONS,
  renderTeachModeInstructions,
} from '../server/askPipeline.js';

/**
 * WHEN THE SUBJECT IS NOT IN THE REPOSITORY, STOP DEMANDING IT BE.
 *
 * THE REPORTED SHAPE (§12): asked *"what is machine learning"* against this
 * repository with teach on, the shipped default answered
 *
 *   "ML is defined in mod:analyzer/3 within svc:analyzer, a module of 11 .ts
 *    files under packages/analyzer/src/llm/ …"
 *
 * — the LLM client, not machine learning. That is a fabricated repository fact,
 * and it is the failure Max would be shown by a stranger.
 *
 * ── THE CAUSE IS AN INSTRUCTION THAT CANNOT BE OBEYED HONESTLY ───────────
 *
 * The belt says, unconditionally: *"Ground the concept in THIS repository: name
 * the real node/file (exact label) the concept lives in."* For a subject the
 * scan does not contain there is no honest way to obey that, and the model
 * obeyed it anyway by inventing a location. **This is not the model ignoring the
 * contract — it is the model following it into a fabrication.**
 *
 * So the fix is not a louder clause and not a new gate. It is that a turn whose
 * queue came back empty must be told the truth about its own situation: the
 * subject is not here, do not claim it is, and draw it from general knowledge
 * instead — which `propose_chart` already permits, because
 * `executeProposeChart` states that "a chart about an idea (softmax, a doctrine)
 * carries no nodeIds and passes; a chart that claims THIS system is checked
 * against it." **The general-knowledge draw needs no new canvas hook: a chart
 * with no nodeIds is already legal and already renders, and it cites no module,
 * so it cannot carry a fabricated repository fact.**
 *
 * ── WHY THIS IS A CONDITION AND NOT A REWORDING ──────────────────────────
 *
 * Four instruction failures in this tree were fixed by finding the clause
 * present and something else wrong. Here the clause is present, unconditional,
 * and WRONG FOR THIS TURN — it is a true instruction applied to a case it does
 * not fit. The change is the condition, not the words.
 */

function repoWithout(subject: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `seq-gk-${subject}-`));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'shopfront', version: '1.0.0', type: 'module' }),
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

/** The belt exactly as a turn for `ask` would render it. */
async function beltFor(repoRoot: string, ask: string): Promise<string> {
  const graph = await scanRepo(repoRoot, {});
  const lesson = newLesson('t1', ask, graph);
  const ctx = buildTeachContext({ lesson, graph });
  return renderTeachModeInstructions(ctx as never);
}

test('THE REPORTED SHAPE: a subject not in the scan is told so, and told to draw it anyway', async () => {
  const root = repoWithout('ml');
  try {
    const belt = await beltFor(path.join(root, 'repo'), 'what is machine learning');
    /*
     * WORDING CORRECTED 2026-09-10, on a measurement rather than a preference.
     *
     * This asserted the belt tells the turn its subject "is not in this
     * repository". Run over the 13 registered bank asks, the flag behind that
     * sentence fires on FOUR whose subjects ARE here — harness-03/05/06/08,
     * i.e. `verifyGate.ts`, `askTools.ts` twice and `explain/explain.ts` —
     * because `buildQueue` matches filenames and those subjects are named by
     * concept. The sentence was false on 4 of 13, and a test pinning a false
     * claim is what keeps it.
     *
     * What is true in every case is what the SCAN did: it matched no file.
     */
    assert.match(
      belt,
      /scan matched no file/i,
      `the turn must be told what the scan actually found:\n${belt.slice(0, 400)}`,
    );
    assert.match(
      belt,
      /general knowledge/i,
      'and told it may draw from general knowledge instead',
    );
    assert.match(
      belt,
      /propose_chart/,
      'naming the tool that draws without claiming the repository',
    );
    assert.match(
      belt,
      /no nodeIds|without nodeIds|omit nodeId/i,
      'and the one rule that keeps such a chart honest',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('it must also COUNTERMAND the repo-grounding demand, or the turn gets both orders', async () => {
  /*
   * The half a bare addition would miss. `TEACH_MODE_INSTRUCTIONS` still carries
   * "Ground the concept in THIS repository", and two of this tree's four
   * instruction failures were a clause contradicted by another line of the same
   * prompt. Adding "draw from general knowledge" without retiring the grounding
   * demand for this turn reproduces exactly that.
   */
  assert.match(
    TEACH_MODE_INSTRUCTIONS,
    /Ground the concept in THIS repository/,
    'the demand this slot has to override is still in the belt',
  );
  const root = repoWithout('ml');
  try {
    const belt = await beltFor(path.join(root, 'repo'), 'what is machine learning');
    assert.match(
      belt,
      /do not (?:claim|say|assert)[^.]*\b(?:in|from) this repository|overrides/i,
      `the slot must retire the grounding demand for this turn:\n${belt.slice(0, 600)}`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('THE CONTROL: a subject the scan DOES have gets none of it', async () => {
  /*
   * Without this the change could licence a general-knowledge diagram on every
   * lesson, which is the "model improvising boxes" the whole feature exists
   * against. A concept in the graph must still be grounded in the graph.
   */
  const root = repoWithout('gw');
  try {
    const belt = await beltFor(path.join(root, 'repo'), 'teach me gateway.js');
    assert.doesNotMatch(belt, /general knowledge/i, 'a real subject is never drawn from memory');
    assert.doesNotMatch(belt, /scan matched no file/i, 'and is never told the scan found nothing');
    assert.match(belt, /THIS TURN'S CONCEPT is exactly one/, 'it gets the concept slot instead');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('no graph at all is NOT this case — that path already had its own answer', async () => {
  /*
   * `buildConceptChart` draws nothing without a graph and the plot builders
   * already cover it. This slot is for the case nobody had: a repository IS
   * attached and the subject is simply not in it.
   */
  const belt = renderTeachModeInstructions(undefined);
  assert.doesNotMatch(belt, /scan matched no file/i);
  assert.strictEqual(belt, TEACH_MODE_INSTRUCTIONS, 'the no-context belt is unchanged');
});
