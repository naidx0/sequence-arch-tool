/**
 * THE SKIPPER BENCH'S PURE HALF, tested without a GPU.
 *
 * The bench asks whether a comprehension question required having followed the
 * lesson. Its model calls need the card; its extraction, typing and decision
 * number do not, and those are where a bench usually goes wrong — the prior
 * teach bench spent two rounds measuring a vocabulary instead of a contract.
 */
import test from 'node:test';
import assert from 'node:assert';
import {
  classifyQuestion,
  discrimination,
  parrotMarkers,
  scoreQuestions,
  scorableRows,
  extractQuestions,
  summarize,
  verdictFor,
} from '../bench/skipperModel.mjs';

test('the closing pulse-check is not a comprehension question', () => {
  /* "Does this make sense so far?" is a pacing beat. Counting it would put the
     turn's least discriminating sentence into every denominator. */
  const turn =
    'The gateway is the front door. So what do you think happens when it stops responding? ' +
    'Nothing behind it is reachable. Does that make sense so far?';
  const qs = extractQuestions(turn);
  assert.equal(qs.length, 1);
  assert.match(qs[0], /what do you think happens/);
});

test('a question mark inside a code fence is not a question put to the learner', () => {
  const turn = 'Here it is:\n```ts\nconst x = a ? b : c;\n```\nWhich service does it call next?';
  assert.deepStrictEqual(extractQuestions(turn).length, 1);
});

test('question types are conservative — an unmatched shape is `other`, never forced', () => {
  assert.equal(classifyQuestion('Which service do you think it calls next?'), 'prediction');
  assert.equal(classifyQuestion('What happens when that queue backs up?'), 'what-breaks-if');
  assert.equal(classifyQuestion('Why does the scanner do this ahead of time?'), 'why');
  /* A wrong bucket is worse than an honest one: the types exist to be counted
     separately, and a forced fit corrupts the count it feeds. */
  assert.equal(classifyQuestion('Ready to move on?'), 'other');
});

test('a NEGATIVE discrimination is meaningful, not noise', () => {
  /* D < 0 says the explanation actively misled — the walked reader did WORSE
     than the skipper. That is a worse defect than a question anyone can answer,
     and rounding it to zero would hide the only case worth an alarm. */
  assert.equal(discrimination(0.2, 0.8), -0.6);
  assert.equal(discrimination(1, 0), 1);
});

test('PULSE-CHECK is decided before defect, and that order is the design', () => {
  /*
   * A question everyone answers from general knowledge is not redeemed by the
   * walked condition also answering it. Testing `defect` first would score a
   * question that tested nothing (W=1, G=1, P=1) as... still a defect here, but
   * a question with W=1, G=0.1, P=0.9 would come out GOOD — a high D over a
   * question the learner already knew. Pulse-check first refuses that.
   */
  assert.equal(verdictFor({ correctW: 1, correctG: 0.1, correctP: 0.9 }), 'pulse-check');
  assert.equal(verdictFor({ correctW: 1, correctG: 0.1, correctP: 0.2 }), 'good');
  /* W=0.6 and G=0.5: both conditions answered it, so it is a real question that
     tests nothing — `too-easy`, the class the split now names. */
  assert.equal(verdictFor({ correctW: 0.6, correctG: 0.5, correctP: 0 }), 'too-easy');
});

test('the summary carries its DENOMINATOR and the thresholds it used', () => {
  /*
   * A share without them is a claim rather than a measurement, and the 0.2 / 0.8
   * thresholds are stated conventions rather than derived values — so a later
   * reader comparing two runs must be able to see they were the same conventions.
   */
  const s = summarize([
    { correctW: 1, correctG: 0, correctP: 0 },
    { correctW: 0.5, correctG: 0.5, correctP: 0 },
    { correctW: 1, correctG: 1, correctP: 1 },
  ]);
  assert.equal(s.questions, 3);
  assert.equal(s.good, 1);
  assert.equal(s.defect, 1);
  assert.equal(s.pulseCheck, 1);
  assert.equal(s.goodShare, 0.3333);
  assert.deepStrictEqual(s.thresholds, { defectAtOrBelow: 0.2, pulseAtOrAbove: 0.8, menuAtOrBelow: 0 });
});

test('an empty run reports NO share rather than a zero', () => {
  /* 0/0 is not 0%. A bench that prints 0% for "nothing ran" is the shape of
     every false measurement this repo has catalogued. */
  assert.equal(summarize([]).goodShare, null);
});

test('parrotMarkers: the contract example copied whole is flagged, a real question is not', () => {
  /*
   * Built from what the run actually produced on 2026-09-04, not from a shape
   * that was convenient to test. `askPipeline.ts:986` offers
   * `("which component do you think X talks to next? ...")` as an ILLUSTRATION;
   * granite42-hermes emitted it verbatim, placeholder and category label
   * included. A user would be asked what `X` talks to.
   */
  assert.deepStrictEqual(parrotMarkers('Check-in: Which component do you think X talks to next?'), [
    'placeholder-x',
    'category-label',
  ]);
  assert.deepStrictEqual(
    parrotMarkers('Comprehension question: Which file contains the function that trains the net?'),
    ['category-label'],
  );
  // Instantiated properly — the same sentence with a real component in it.
  assert.deepStrictEqual(parrotMarkers('Which component do you think the gateway talks to next?'), []);
  assert.deepStrictEqual(
    parrotMarkers('Which step of the counting process would you like to understand in more detail?'),
    [],
  );
});

test('parrotMarkers: a hyphenated X is prose, not the placeholder', () => {
  /* `\bX\b` fired on "X-ray" because a hyphen IS a word boundary. The
     placeholder is followed by whitespace; a false positive here would accuse
     the model of parroting a sentence it wrote itself. */
  assert.deepStrictEqual(parrotMarkers('What do you think X-ray parsing does?'), []);
});

/* ------------------------------------------------ the scoring half, W and G -- */

test('THE PLANTED CASE: a question the graph alone answers scores as non-discriminating', async () => {
  /*
   * RED WITHOUT THE SCORING HALF — until it existed, `verdictFor` and
   * `discrimination` were pure functions waiting on numbers nobody computed, and
   * the bench printed `summarize([])` while saying it needed a GPU. It did not
   * need a GPU; it needed inputs.
   *
   * The stub model answers from the question alone, ignoring which condition it
   * is in — exactly the behaviour of a question whose answer is in the graph. W
   * and G both score, the gap is zero, and the verdict must be `defect`. A bench
   * that called this `good` would be flattering the lesson for teaching nothing.
   */
  const deps = {
    answer: async () => 'the counts table',
    judge: async ({ answer, reference }) => reference.includes(answer),
  };
  const rows = [
    { question: 'Which structure holds the pair counts?', lesson: 'x', graph: 'y', reference: 'it is the counts table' },
  ];
  const scored = await scoreQuestions(rows, deps, { attempts: 1 });
  assert.equal(scored[0].correctW, 1);
  assert.equal(scored[0].correctG, 1);
  assert.equal(discrimination(scored[0].correctW, scored[0].correctG), 0);
  assert.equal(verdictFor(scored[0]), 'too-easy', 'both conditions answered it, so it is answerable and tests nothing');
});

test('a question only the walked condition answers scores as good', () => {
  /* The other side of the same coin, and the reason the bench exists: a real
     comprehension check is one the skipper cannot answer from the code alone. */
  assert.equal(verdictFor({ correctW: 1, correctG: 0 }), 'good');
  assert.equal(discrimination(1, 0), 1);
});

test('a question its own turn never answered is UNSCORABLE, not wrong', async () => {
  /*
   * The reference is the lesson's own answer — the contract requires a turn to
   * answer what it asks. With no reference there is nothing to grade against,
   * and grading against a guess would manufacture a number. "We could not grade
   * 9 of 31" and "there were 22 questions" are different statements.
   */
  const deps = { answer: async () => 'anything', judge: async () => true };
  const scored = await scoreQuestions([{ question: 'q?', reference: '' }], deps, { attempts: 1 });
  assert.equal(scored[0].correctW, undefined);
  assert.match(scored[0].unscorable, /no reference/);
});

test('scorableRows keeps an unanswerable question rather than dropping it', () => {
  const report = {
    results: [
      { id: 'c1', repo: 'makemore', turns: [{ turn: 0, text: 'the lesson body', questions: ['Which file?'] }] },
      { id: 'c2', repo: 'makemore', turns: [{ turn: 0, text: '', questions: ['Another?'] }] },
    ],
  };
  const rows = scorableRows(report, { makemore: 'GRAPH' });
  assert.equal(rows.length, 2, 'both questions survive; one will be marked unscorable when scored');
  assert.equal(rows[0].graph, 'GRAPH');
  assert.equal(rows[0].reference, 'the lesson body');
  assert.equal(rows[1].reference, '');
});

test('attempts are a denominator, not a decoration', async () => {
  /* correctW is a PROPORTION over k attempts. A stub that succeeds every other
     call must produce 0.5, not 1 — otherwise k is theatre. */
  let n = 0;
  const deps = { answer: async () => 'a', judge: async () => (n++ % 2 === 0) };
  const scored = await scoreQuestions([{ question: 'q?', reference: 'r' }], deps, { attempts: 2 });
  assert.ok(scored[0].correctW >= 0 && scored[0].correctW <= 1);
  assert.equal(scored[0].correctW + scored[0].correctG, 1, 'four judge calls, two true — split across W and G');
});

test('pulseCheck is NULL when the prior-only condition never ran', () => {
  /*
   * The first scored run printed `pulseCheck: 0`, which reads as "no question was
   * answerable from prior knowledge" and meant "the condition was never run".
   * Zero and not-measured are different claims and only one of them was true.
   */
  const notRun = summarize([{ correctW: 1, correctG: 0 }, { correctW: 0, correctG: 0 }]);
  assert.equal(notRun.pulseCheck, null, 'not measured is not zero');
  assert.equal(notRun.questions, 2, 'the rest of the summary is unaffected');

  const wasRun = summarize([{ correctW: 1, correctG: 1, correctP: 0.1 }]);
  assert.equal(wasRun.pulseCheck, 0, 'once measured, a real zero is reportable');
});

test('PLANTED: a menu is not the same failure as a too-easy question', () => {
  /*
   * Both were `defect` in the first scored run, which hid the more interesting
   * one. "Is there anything else you'd like to know?" scores W=0 AND G=0 —
   * nobody can answer it, because it is not a question about the material. A
   * question the graph answers without the walk scores G=1 and is a real question
   * that simply tests nothing.
   */
  assert.equal(verdictFor({ correctW: 0, correctG: 0 }, { shape: 'clarifying' }), 'menu');
  assert.equal(verdictFor({ correctW: 1, correctG: 1 }), 'too-easy');
  assert.equal(verdictFor({ correctW: 1, correctG: 0 }), 'good');
});

test('a partly-answered question is too-easy, not a menu', () => {
  /* The menu class is "nobody could answer at all". Anything answerable, even
     once, is a real question — and its problem is what it asks. */
  assert.equal(verdictFor({ correctW: 0, correctG: 0.5 }), 'too-easy');
  assert.equal(verdictFor({ correctW: 0.5, correctG: 0.5 }), 'too-easy');
});

test('summarize reports both failure classes and keeps defect as their sum', () => {
  const s = summarize([
    { correctW: 1, correctG: 0 },
    { correctW: 0, correctG: 0, shape: 'clarifying' },
    { correctW: 1, correctG: 1 },
  ]);
  assert.equal(s.good, 1);
  assert.equal(s.menu, 1);
  assert.equal(s.tooEasy, 1);
  assert.equal(s.defect, 2, 'the old field still reads correctly as the sum');
  assert.equal(s.thresholds.menuAtOrBelow, 0, 'the convention travels with the number');
});

test('PLANTED: a menu has no referent; an unanswered question has one', () => {
  /*
   * W=0 and G=0 alone does not make a menu — it also describes "both answers were
   * wrong". Measured on the first scored run, 21 questions scored 0 and 0 but
   * only 12 were clarifying-shaped; calling the other 9 menus would have been an
   * over-claim dressed as a taxonomy.
   */
  const material = 'The walk opens bigram_counts.py first and builds the counts table.';
  assert.equal(
    verdictFor(
      { correctW: 0, correctG: 0 },
      { question: "Is there anything else you'd like to know?", material, shape: 'clarifying' },
    ),
    'menu',
    'an offer, not a question about the material — nothing to be right about',
  );
  assert.equal(
    verdictFor(
      { correctW: 0, correctG: 0 },
      { question: 'Which file does the walk open first?', material, shape: 'comprehension' },
    ),
    'unanswered',
    'points at the material and simply went unanswered — a different failure',
  );
});

test('with no shape supplied, the honest verdict is unanswered, not menu', () => {
  /* "Nobody answered it" is what the scores show. `menu` is a claim about the
     QUESTION, and it needs the classifier to make — word overlap cannot: "is
     there anything else you'd like to know about how these FILES INTERACT?"
     shares `files` and `interact` with any lesson about files interacting. */
  assert.equal(verdictFor({ correctW: 0, correctG: 0 }), 'unanswered');
});
