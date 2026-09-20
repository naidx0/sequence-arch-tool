/**
 * ENDS WITH A CHECK, not merely with a question mark.
 *
 * Every check-in number reported on 2026-09-05 — 22 of 47, 12, 18, 19 — was a
 * trailing `?`. Measured against the contract's taxonomy, 15 of the 31 questions
 * those turns produced were CLARIFYING, the one shape the belt bans outright. So
 * the metric was satisfied by the forbidden shape and every comparison built on
 * it was measuring something else.
 *
 * The planted cases below are verbatim from that run.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  gradeCheckIn,
  TEACH_CLOSING_COMPREHENSION_EXAMPLE,
  TEACH_CLOSING_PREDICTION_EXAMPLE,
} from '../server/checkIn.js';

test('PLANTED RED: "would you like me to show…" is NOT a check-in', () => {
  /* ml-02, verbatim. The old metric scored this; the contract bans it. */
  const v = gradeCheckIn(
    'The counts table holds every pair. Would you like me to show you the actual file contents or explain any specific part in more detail?',
  );
  assert.equal(v.endsWithQuestion, true, 'it IS a question — the old metric was not lying, it was answering a different question');
  assert.equal(v.endsWithCheck, false);
  assert.equal(v.shape, 'clarifying');
});

test('PLANTED GREEN: a comprehension question IS a check-in', () => {
  /* ml-04, verbatim but for the stripped label. */
  const v = gradeCheckIn(
    'The dot marks both ends. Do you understand why the dot appears at both the start and end of name sequences in this code?',
  );
  assert.equal(v.endsWithCheck, true);
  assert.equal(v.shape, 'comprehension');
});

test('a prediction is a check-in', () => {
  const v = gradeCheckIn('The gateway is the front door. Which service do you think it calls first?');
  assert.equal(v.endsWithCheck, true);
  assert.equal(v.shape, 'prediction');
});

test('clarifying WINS over a prediction-shaped phrase in the same sentence', () => {
  /*
   * ml-10, verbatim: "Would you like me to show how the softmax probabilities are
   * used in the model's prediction…". A keyword matcher sees "prediction"; the
   * learner sees an offer. The contract bans it on what the ANSWER would do, and
   * what the learner replies to is the offer.
   */
  const v = gradeCheckIn(
    "Softmax turns logits into probabilities. Would you like me to show how the softmax probabilities are used in the model's prediction step?",
  );
  assert.equal(v.shape, 'clarifying');
  assert.equal(v.endsWithCheck, false);
});

test('a parroted label is stripped before classifying, and reported', () => {
  /* ml-04 as it actually arrived: the contract's own vocabulary as visible prose. */
  const v = gradeCheckIn('The dot marks both ends. Check-in: Do you understand why the dot appears at both ends?');
  assert.equal(v.endsWithCheck, true, 'the question underneath is a real check');
  assert.equal(v.parrotedLabel, true, 'and the label is still a defect worth counting');
});

test('a turn that ends in prose ends with nothing', () => {
  const v = gradeCheckIn('The counts table holds every pair, and sampling reads it row by row.');
  assert.equal(v.endsWithQuestion, false);
  assert.equal(v.endsWithCheck, false);
  assert.equal(v.shape, 'none');
});

test('a question mark inside a code fence is not a question to the learner', () => {
  const v = gradeCheckIn('Here is the check:\n```py\nif x == "?":\n    pass\n```');
  assert.equal(v.endsWithQuestion, false);
});

test('an unrecognised question is NOT counted as a check — the floor is deliberate', () => {
  /*
   * 14 of the 31 measured questions match none of the shapes. Counting them
   * would mean grading a turn on a matcher's silence; not counting them costs a
   * real check a point, which is the direction that cannot flatter the contract.
   */
  const v = gradeCheckIn('The scan walks imports first. Ready for the next part?');
  assert.equal(v.endsWithQuestion, true);
  assert.equal(v.endsWithCheck, false);
  assert.equal(v.shape, 'unclassified');
});

test('"is there anything else you\'d like to know" is an offer, not a check', () => {
  /*
   * ml-01 t2, verbatim, and the question this whole lane has been quoting as the
   * archetypal menu — it scored W=0 and G=0 because there is nothing in the
   * material to be right about. The first version of CLARIFYING matched "would
   * you like" and missed it, so the classifier called the clearest offer in the
   * set a comprehension failure.
   */
  const v = gradeCheckIn(
    'The gateway calls payments over HTTP. Is there anything else you would like to know about how these files interact?',
  );
  assert.equal(v.shape, 'clarifying');
  assert.equal(v.endsWithCheck, false);
});

/* ═══ the belt's own example, copied back ═════════════════════════════════ */

/**
 * MEASURED, from the two 20-conversation runs behind
 * docs/research/redirect-visual-result.md: of 13 closing checks, THREE read
 * "Which component do you think X talks to next?" -- the contract's template
 * variable emitted literally. A question with a placeholder in it asks the
 * learner nothing, and every other rule in the grader passed it.
 *
 * The strings below are the measured ones, not convenient inventions.
 */
test('a closing question with the belt placeholder left in is not a check', () => {
  const g = gradeCheckIn(
    'The bigram table counts pairs at bigram_counts.py:14. ' +
      'Which component do you think X talks to next?',
  );
  assert.strictEqual(g.endsWithQuestion, true, 'it is still a question');
  assert.strictEqual(g.endsWithCheck, false, 'but it checks nothing');
  assert.strictEqual(g.parrotedExample, true);
  /* Reported as unclassified rather than as `prediction`: anything tallying
     shapes -- including the report of these very runs -- counts a `prediction`
     as a check, and this is not one. */
  assert.strictEqual(g.shape, 'unclassified');
});

test('the contract prediction example copied whole is not a check either', () => {
  const g = gradeCheckIn(`The gateway routes requests. ${TEACH_CLOSING_PREDICTION_EXAMPLE}`);
  assert.strictEqual(g.endsWithCheck, false);
  assert.strictEqual(g.parrotedExample, true);
});

test('the comprehension example is NOT flagged — it is generic by design', () => {
  /*
   * Deliberate asymmetry, and the reason is a measurement risk rather than a
   * taste: "does this make sense so far?" is the intended output, and flagging
   * it would shift the comprehension-vs-prediction balance that the registered
   * mid-length arm exists to measure. A fix that quietly moves the thing a
   * pending experiment is measuring is how the [4, 12] baseline was lost.
   */
  const g = gradeCheckIn(`The gateway routes requests. ${TEACH_CLOSING_COMPREHENSION_EXAMPLE}`);
  assert.strictEqual(g.endsWithCheck, true);
  assert.strictEqual(g.shape, 'comprehension');
  assert.notStrictEqual(g.parrotedExample, true);
});

test('a REAL prediction naming a real component still counts', () => {
  /* The measured good case from the same runs -- the fix must not cost this. */
  const g = gradeCheckIn(
    'The loop trains on pairs. ' +
      'Which component do you think processes the softmax probabilities next in the training loop?',
  );
  assert.strictEqual(g.endsWithCheck, true);
  assert.strictEqual(g.shape, 'prediction');
  assert.notStrictEqual(g.parrotedExample, true);
});

test('X as a genuine name is not mistaken for the placeholder', () => {
  /*
   * THE FALSE POSITIVE THAT WOULD MATTER. makemore -- a fixture this bench
   * actually teaches from -- names its tensors `X` and `Y`, so a lesson may say
   * `X` legitimately. The detector requires a structural noun, then the bare
   * letter, then a verb it is the subject of; neither of these matches.
   */
  const asObject = gradeCheckIn('We build the matrix. Which component of X is largest?');
  assert.notStrictEqual(asObject.parrotedExample, true);
  const asSubject = gradeCheckIn('We build it. What do you think X holds after the loop?');
  assert.strictEqual(asSubject.endsWithCheck, true, 'a real question about a tensor named X');
  assert.notStrictEqual(asSubject.parrotedExample, true);
});

test('the belt and the grader cannot drift: the contract quotes the shared constants', async () => {
  /*
   * The point of exporting the examples. Two hand-kept copies disagree the
   * first time either is touched, and the disagreement is invisible -- the belt
   * would ask for one thing while the grader bounced another.
   */
  const { TEACH_MODE_INSTRUCTIONS } = await import('../server/askPipeline.js');
  assert.ok(TEACH_MODE_INSTRUCTIONS.includes(TEACH_CLOSING_COMPREHENSION_EXAMPLE));
  assert.ok(TEACH_MODE_INSTRUCTIONS.includes(TEACH_CLOSING_PREDICTION_EXAMPLE));
  /* And the contract must not hand the model a copyable placeholder sentence:
     a negative example is copy-bait exactly like a positive one. */
  assert.ok(
    !/which component do you think X talks to next/i.test(TEACH_MODE_INSTRUCTIONS),
    'the contract must not contain the placeholder sentence, even as a counter-example',
  );
});

/* ═══ the closing beat must be a CHECK, not a question mark ═══════════════ */

/**
 * MEASURED GAP, from the same two runs: 24 of 94 turns close on a CLARIFYING
 * offer, and the product bounced NONE of them. Its clarifying rule keys on our
 * own tool vocabulary — chart kinds, formats, diagram dialects — which is a
 * deliberately closed class and caught 0 of 24, because "would you like me to
 * show how the counting works?" needs no vocabulary of ours.
 *
 * The closing rule itself only ever tested for a trailing "?".
 */
const teachGrade = async (text: string): Promise<string[]> => {
  const { gradeTeachTurn } = await import('../server/askPipeline.js');
  return gradeTeachTurn(text, null, undefined, true);
};
const closingProblem = (problems: string[]): string | undefined =>
  problems.find((p) => /OFFERING the learner|not with a CHECK|does not END with/.test(p));

test('a turn closing on an OFFER is bounced, though it ends with a question mark', async () => {
  /* Verbatim from the runs. */
  const problems = await teachGrade(
    'The bigram table counts pairs at bigram_counts.py:14. ' +
      'Would you like me to show how the counting works with a specific example from the data?',
  );
  const bounce = closingProblem(problems);
  assert.ok(bounce, 'the closing beat must be bounced');
  assert.match(bounce, /OFFERING the learner/);
  /* It must not be bounced for the WRONG reason: it does end with a question. */
  assert.doesNotMatch(bounce, /does not END with/);
});

test('a real comprehension or prediction close is left alone', async () => {
  for (const close of [
    'Does this make sense so far?',
    'Which component do you think processes the counts next?',
  ]) {
    const problems = await teachGrade(`The table counts pairs at bigram_counts.py:14. ${close}`);
    assert.strictEqual(
      closingProblem(problems),
      undefined,
      `a real check must not be bounced: ${close}`,
    );
  }
});

test('an offer MID-lesson is still allowed — only the closing beat is judged', async () => {
  /*
   * The contract's own words: "Shall we look at why the scanner does this ahead
   * of time?" offers the next step of a lesson already underway and is fine.
   * Narrowing this rule to the CLOSING beat is what keeps that true, and it is
   * the difference between enforcing the contract and rewriting it.
   */
  const problems = await teachGrade(
    'The scanner walks the tree at scan.ts:12. Shall we look at why it does that ahead of ' +
      'time? It does, because the joiner needs every file first. ' +
      'Which component do you think the joiner reads next?',
  );
  assert.strictEqual(closingProblem(problems), undefined);
});

test('a turn ending in prose is still bounced by the ORIGINAL rule, not the new one', async () => {
  /* The two failures stay distinguishable: no question at all is a different
     defect from a question of the wrong shape, and a model can only act on the
     difference if the message says which happened. */
  const problems = await teachGrade('The scanner walks the tree at scan.ts:12. That is all.');
  const bounce = closingProblem(problems);
  assert.ok(bounce);
  assert.match(bounce, /does not END with/);
});

/* ═══ what counts as a picture drawn in the answer ═══════════════════════ */

/**
 * `drewInProse` was extracted from inside `gradeTeachTurn` because a SECOND
 * copy of it had already been written — the visual-absence probe in tools/bench
 * guessed the glyph set, admitted prose arrows, and reported four ASCII
 * "diagrams" that were an arrow inside an explanation and a weight-update
 * formula. The product's rule was right; the copy outside it was looser.
 *
 * The cases below are the ones that actually fooled the loose copy, taken from
 * the runs rather than imagined.
 */
test('a prose arrow and a maths formula are NOT diagrams', async () => {
  const { drewInProse } = await import('../server/askPipeline.js');
  assert.strictEqual(drewInProse("it maps 'A' \u2192 1 and '.' \u2192 0"), false);
  assert.strictEqual(drewInProse('W \u2190 W - lr \u00d7 dNLL/dW'), false);
  /* The reason the glyph set must stay narrow: every lesson here shows code,
     and every JS snippet has `=>`. Admitting it disables the bounce exactly
     when a lesson is at its most code-heavy. */
  assert.strictEqual(drewInProse('const f = () => 1;'), false);
  assert.strictEqual(drewInProse('flow: a --> b'), false);
});

test('a box-drawing sketch and a seqd fence ARE diagrams', async () => {
  const { drewInProse } = await import('../server/askPipeline.js');
  assert.strictEqual(drewInProse('client \u2500\u2500\u25ba gateway'), true);
  assert.strictEqual(drewInProse('```seqd\nnodes: a, b\n```'), true);
  /* mermaid deliberately does NOT count: only ```seqd is lifted onto the board,
     so a wall of `graph TD` is read rather than seen. */
  assert.strictEqual(drewInProse('```mermaid\ngraph TD\nA-->B\n```'), false);
});
