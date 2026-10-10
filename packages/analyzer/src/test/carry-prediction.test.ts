import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildTeachContext, carryPrediction } from '../server/lessonState.js';
import type { LessonShape } from '../server/lessonState.js';

/**
 * REPAIR A — the prediction must ride the lesson from turn N to turn N+1.
 *
 * Designed in `docs/research/design-instruments-after-the-window.md` §A. The
 * measured cost of not doing it: seven next-picture questions across two card
 * runs, **zero reveals**, and a registered band with no denominator at all.
 */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const lessonOf = (taught: string[], queue: string[]): LessonShape => ({
  version: 1,
  sessionId: 's1',
  subject: { ask: 'teach me', nodeIds: [] },
  queue: queue.map((t) => ({ title: t })),
  taught: taught.map((t, i) => ({ title: t, turn: i })),
});

const PREDICTION = { question: 'Which of a, b or c would break?', expect: 'a.ts', arrow: 'a.ts → b.ts' };

/* ── case 1: a question asked on turn N is readable on turn N+1 ──────────── */

test('case 1: a prediction asked on one turn reaches the next turn through the context', () => {
  /*
   * The whole two-turn contract in one assertion. `buildTeachContext` is what the
   * pipeline reads on the following turn (`input.teachContext?.open`), so
   * carrying it into the lesson and finding it in the context IS the reveal path
   * — everything after this is the pipeline appending a sentence.
   */
  const afterTurn0 = carryPrediction(lessonOf(['a.ts'], ['b.ts']), PREDICTION, 1);
  assert.deepStrictEqual(afterTurn0.open, { ...PREDICTION, askedAt: 1 });

  const ctx = buildTeachContext({ lesson: afterTurn0 });
  assert.deepStrictEqual(
    ctx.open,
    { ...PREDICTION, askedAt: 1 },
    'the next turn reads the prediction the last one left open',
  );
});

/* ── case 2: the reveal names the arrow the QUESTION was built from ──────── */

test('case 2: the carried arrow is the one asked about, not one re-derived later', () => {
  /*
   * Re-deriving next turn would answer about whatever concept is current then,
   * which need not be the one the learner was asked about — a true sentence in
   * the wrong place. The carried value is the asked value, and the lesson moving
   * on does not touch it.
   */
  const carried = carryPrediction(lessonOf(['a.ts'], ['b.ts', 'c.ts']), PREDICTION, 1);
  /* The lesson advances; the open prediction still names the original arrow. */
  const later: LessonShape = { ...carried, taught: [...carried.taught, { title: 'b.ts', turn: 1 }] };
  assert.strictEqual(buildTeachContext({ lesson: later }).open !== undefined, true);
  assert.strictEqual((buildTeachContext({ lesson: later }).open as { arrow: string }).arrow, 'a.ts → b.ts');
});

/* ── case 3: a last turn's question has nowhere to land, and that is fine ── */

test('case 3: a prediction on the final turn produces no reveal and no error', () => {
  const carried = carryPrediction(lessonOf(['a.ts'], []), PREDICTION, 1);
  assert.ok(carried.open !== undefined, 'it is still carried — the lesson does not know it is last');
  /* Nothing reads it, because there is no next turn. No throw, no reveal. */
  assert.doesNotThrow(() => buildTeachContext({ lesson: carried }));
});

/* ── case 4: a turn that asked nothing CLEARS it ─────────────────────────── */

test('case 4: a turn that asks nothing clears the open prediction', () => {
  /*
   * Without this the reveal arrives a turn late and answers a question the
   * learner was never asked — the failure mode is a confident sentence about a
   * prediction nobody made.
   */
  const carried = carryPrediction(lessonOf(['a.ts'], ['b.ts']), PREDICTION, 1);
  const cleared = carryPrediction(carried, undefined, 2);
  assert.strictEqual(cleared.open, undefined);
  assert.strictEqual(buildTeachContext({ lesson: cleared }).open, undefined);
});

/* ── case 5: one rule, two callers ───────────────────────────────────────── */

test('case 5: the bench and the product share the carrier — neither re-implements it', () => {
  /*
   * A rule that lives in two places is one rule until it is measured, and this
   * repository has been bitten by that shape four times now. The bench had no
   * copy at all, which is why it produced zero reveals; the fix is to call the
   * product's function, not to write a second one.
   */
  const bench = fs.readFileSync(path.join(REPO, '..', '..', 'tools', 'bench', 'teach-eval.mjs'), 'utf8');
  assert.match(bench, /carryPrediction\(/, 'the bench carries the prediction');
  assert.ok(
    !/open:\s*\{\s*\.\.\.\s*openPrediction/.test(bench),
    'and does not hand-roll the carry',
  );
  const turn = fs.readFileSync(path.join(REPO, 'src', 'server', 'teachTurn.ts'), 'utf8');
  assert.match(turn, /carryPrediction\(advanced/, 'the product uses the same function');
  assert.ok(
    !/open:\s*\{\s*\.\.\.openPrediction,\s*askedAt/.test(turn),
    'the inline copy in finish() is gone',
  );
});
