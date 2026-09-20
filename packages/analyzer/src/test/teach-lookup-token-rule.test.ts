import assert from 'node:assert';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanRepo } from '../scan.js';
import { buildQueue, buildTeachContext, newLesson } from '../server/lessonState.js';

/**
 * THE EVERY-TOKEN RULE, AND THE TWO ASKS IT CANNOT TELL APART.
 *
 * The general-knowledge draw fires when a graph is attached and the lesson queue
 * is empty. Measured over the 13 registered bank asks it fires on FOUR whose
 * subjects are in this tree — `harness-03/05/06/08` — so the obvious next move
 * is to relax the lookup until those four are found.
 *
 * **This file exists because that move is not available, and the reason is
 * structural rather than a matter of tuning.**
 *
 * ── THE FOUR SPLIT INTO TWO DIFFERENT FAULTS ─────────────────────────────
 *
 * Traced against the graph, with the file each subject actually lives in:
 *
 *   harness-03  verifyGate.ts  tokens [verify, gate]  ask supplies verify
 *   harness-06  askTools.ts    tokens [ask, tool]     ask supplies tool
 *   harness-05  askTools.ts    tokens [ask, tool]     ask supplies NOTHING
 *   harness-08  explain.ts     token  [explain]       ask supplies NOTHING
 *
 * The first two share a word with their file and are blocked only by `askNames`
 * requiring EVERY token. **The last two share no word at all**: harness-05 is
 * about `MAX_ASK_TOOL_ROUNDS` and harness-08 about `buildDigest`, which are
 * SYMBOLS INSIDE those files. The graph indexes files by name, so no
 * filename-based lookup can ever retrieve them — that is an indexing gap, not a
 * rule that needs loosening.
 *
 * ── AND THE RELAXATION BREAKS MORE THAN IT FIXES ─────────────────────────
 *
 * Measured by applying "at least one token instead of every token" to the whole
 * graph:
 *
 *   reaches 4 of 4 missed lessons — but at the head of the queue it returns
 *     `learningLoop.ts` for harness-05 (the round budget) and `teachTurn.ts`
 *     for harness-08 (the architecture digest). The right files are not even in
 *     the first four. A wrong concept is worse than no concept: the turn teaches
 *     a file nobody asked about, confidently.
 *   breaks 1 of 3 absent subjects — "machine learning" matches `learningLoop.ts`
 *     on the token `learning`, so the queue is no longer empty, the draw stops
 *     firing, and 12 of 12 drawn becomes 8 of 12.
 *   and every ask opening "Teach me" matches `teachTurn.ts` on `teach`.
 *
 * The two cases below are the proof that no filename rule separates them: they
 * are the SAME SHAPE — a two-token filename where the ask supplies exactly one.
 * Anything that reaches the first reaches the second.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..');

const IN_REPO_MISSED = 'Teach me the verify contract: what it demands and when.';
const ABSENT = 'what is machine learning';

test('THE PAIR: an in-repo miss and an absent subject are the same shape to the lookup', async () => {
  /*
   * `verifyGate.ts` is [verify, gate] and the ask says "verify".
   * `learningLoop.ts` is [learning, loop] and the ask says "learning".
   * One token of two, both times. That is the whole difficulty.
   */
  const graph = await scanRepo(REPO, { cluster: true });
  assert.strictEqual(
    buildQueue(graph, IN_REPO_MISSED).length,
    0,
    'harness-03 is currently missed — if this is non-zero the lookup changed, and the case below must be re-checked in the same change',
  );
  assert.strictEqual(
    buildQueue(graph, ABSENT).length,
    0,
    'and the absent subject is empty for the SAME reason; a relaxation that fills the first fills this one too',
  );
});

test('the absent subject still takes the general-knowledge branch, which is what 12 of 12 rests on', async () => {
  const graph = await scanRepo(REPO, { cluster: true });
  const lesson = newLesson('t', ABSENT, graph);
  const ctx = buildTeachContext({ lesson, graph }) as { subjectNotInRepo?: true };
  assert.strictEqual(
    ctx.subjectNotInRepo,
    true,
    'the draw stopped firing for "what is machine learning" — 12 of 12 drawn is gone',
  );
});

test('a subject the lookup CAN reach is still reached — the rule is not simply broken', async () => {
  /*
   * The control. The every-token rule is doing real work, not failing at
   * everything: an ask that names its file is found, and that is the behaviour
   * any change here has to preserve alongside the two cases above.
   */
  const graph = await scanRepo(REPO, { cluster: true });
  const queue = buildQueue(graph, 'teach me askPipeline.ts');
  assert.ok(queue.length > 0, 'a named file is still found');
  assert.match(String(queue[0]?.title ?? ''), /askPipeline/, 'and it is the file that was named');
});

test('harness-05 and harness-08 share NO word with their file — unreachable by any name rule', async () => {
  /*
   * The half that is not a tuning problem. Their subjects are symbols inside the
   * file (`MAX_ASK_TOOL_ROUNDS`, `buildDigest`), and the graph indexes files by
   * name. Recorded as a test so a future "just relax the matcher" reads this
   * first: relaxing cannot reach these at all, because there is no shared word
   * to relax towards.
   */
  const graph = await scanRepo(REPO, { cluster: true });
  for (const ask of [
    'Teach me what the round budget is and how the loop spends it.',
    'Teach me what the architecture digest is and how it is budgeted.',
  ]) {
    assert.strictEqual(buildQueue(graph, ask).length, 0, `${ask} — still no concept`);
  }
  /* And the files they are about are real, so this is retrieval and not absence. */
  const bases = new Set(
    (graph.nodes ?? []).map((n) => String(n.path ?? n.id).split(/[\\/]/).pop() ?? ''),
  );
  assert.ok(bases.has('askTools.ts'), 'the round budget lives in a file the graph holds');
  assert.ok(bases.has('explain.ts'), 'so does the architecture digest');
});
