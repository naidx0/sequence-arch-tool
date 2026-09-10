import assert from 'node:assert/strict';
import test from 'node:test';

import { validateChart } from '@sequence/schema';

import { buildPlot, derivePlotCheckIn, evaluate, parseExpression } from '../server/mathKind.js';
import { gradeCheckIn } from '../server/checkIn.js';

/**
 * THE MATH KIND, and the three counts it is judged by.
 *
 * Reported the way the queue matcher was: **parsed / refused / wrong**. The
 * third is the one that matters. A refusal is honest — the product draws
 * nothing and says why. A WRONG parse plots a confident curve of a function
 * nobody wrote, and the reader has no way to tell.
 *
 * That is not hypothetical: the first version of this grammar put unary minus
 * inside the power rule, so `-x^2` parsed as `(-x)^2` and evaluated to +4 at
 * x = 2. It parsed. It plotted. It was wrong, and only counting `wrong`
 * separately from `refused` found it.
 */
const CASES: [string, number, number][] = [
  ['x^2', 3, 9],
  ['x^2 - 3x + 2', 2, 0],
  ['2x + 1', 4, 9],
  ['-x^2', 2, -4],
  ['-(x^2)', 2, -4],
  ['sin(x)', 0, 0],
  ['cos(x)', 0, 1],
  ['exp(x)', 0, 1],
  ['sqrt(x)', 9, 3],
  ['abs(x)', -3, 3],
  ['log(x)', 1, 0],
  ['3x^2 - 2x + 7', 1, 8],
  ['(x+1)(x-1)', 3, 8],
  ['x/2 + 1', 4, 3],
  ['2^x', 3, 8],
  ['x^2^3', 2, 256],
  ['2sin(x)', 0, 0],
  ['x*x', 5, 25],
  ['1/x', 2, 0.5],
  ['-2x', 3, -6],
  ['2^-1', 0, 0.5],
];

test('the grammar: parsed, and none of them wrong', () => {
  const wrong: string[] = [];
  const refused: string[] = [];
  for (const [src, at, want] of CASES) {
    const node = parseExpression(src);
    if (node === undefined) {
      refused.push(src);
      continue;
    }
    if (Math.abs(evaluate(node, at) - want) > 1e-9) wrong.push(src);
  }
  assert.deepStrictEqual(wrong, [], 'a wrong parse plots a confident lie');
  assert.deepStrictEqual(refused, [], 'these are all expressions a learner types');
});

test('what is not an expression is refused, not guessed at', () => {
  /* The half that keeps the kind honest. A parser that accepts prose produces a
     plot of something nobody asked for, which is the failure the whole
     lesson-kinds contract is written against. */
  for (const notAnExpression of [
    'teach me about polynomials',
    'hash table',
    'x + ',
    'sin x',
    'y == x',
    'x & 1',
    'foo(x)',
  ]) {
    assert.strictEqual(
      parseExpression(notAnExpression),
      undefined,
      `${notAnExpression} is not an expression`,
    );
  }
});

test('unary minus binds looser than the exponent', () => {
  /* The bug that made `wrong` a category. Kept as its own case because
     precedence errors are silent: everything still parses. */
  assert.strictEqual(evaluate(parseExpression('-x^2')!, 2), -4);
  assert.strictEqual(evaluate(parseExpression('(-x)^2')!, 2), 4);
});

test('a plot passes the SAME validator a model chart must pass', () => {
  /*
   * It did not, at first: 41 points against `validateChart`'s 40-item cap. The
   * cap was not raised to fit the plot — the plot was made to fit the cap,
   * because a validator the product can talk its way around is not a validator.
   */
  const plot = buildPlot('A quadratic. Take y = x^2 - 3x + 2. It opens upward.')!;
  assert.ok(plot, 'an expression stated mid-sentence is found');
  assert.strictEqual(plot.source, 'x^2 - 3x + 2');
  assert.strictEqual(validateChart(plot.chart).ok, true);
});

test('every plotted point is exactly the value of its own label', () => {
  /*
   * The reader has to be able to check the picture by hand. At 39 points the
   * step was 0.263… and the labels were rounded to two places, so recomputing
   * y from the x on the screen disagreed with the plotted y by up to 0.044.
   * Small, invisible, and exactly the kind of quiet inconsistency this product
   * exists not to have.
   */
  const plot = buildPlot('y = x^2 - 3x + 2')!;
  for (const item of plot.chart.items) {
    const x = Number(item.label);
    assert.strictEqual(item.value, x * x - 3 * x + 2, `f(${item.label}) must be exact`);
  }
});

test('the caption says FAITHFUL, and does not say grounded', () => {
  /*
   * The whole reason the contract distinguishes the kinds. A plot is faithful
   * to an expression the model chose; it is not checked against anything that
   * exists independently of the model, and a caption that borrowed the code
   * chart's authority would spend the one thing this product has.
   */
  const plot = buildPlot('y = x^2')!;
  assert.match(plot.chart.caption ?? '', /faithful to the expression/);
  assert.doesNotMatch(plot.chart.caption ?? '', /scanned graph/);
});

test('the check-in is a prediction about the picture', () => {
  const plot = buildPlot('y = x^2 - 3x + 2')!;
  const question = derivePlotCheckIn(plot);
  const graded = gradeCheckIn(`A quadratic opens upward. ${question}`);
  assert.strictEqual(graded.endsWithCheck, true);
  assert.strictEqual(graded.shape, 'prediction');
  /* It names the curve on the screen, and asks the learner to read it. */
  assert.match(question, /crosses zero/);
});

test('nothing plottable, nothing drawn', () => {
  for (const prose of [
    'Teach me about polynomials.',
    'A hash table maps keys to buckets.',
    'Take y = foo(x) + 1.',
  ]) {
    assert.strictEqual(buildPlot(prose), undefined, `${prose} must draw nothing`);
  }
});

/* ═══ the product's own example ══════════════════════════════════════════ */

import { buildExamplePlot, exampleFor } from '../server/mathKind.js';

/**
 * THE KIND MUST NOT REST ON THE MODEL'S HABIT.
 *
 * As first built it fired only on an expression the model stated, and **zero of
 * the twenty subject asks name one** — they are prose questions. So the whole
 * kind depended on whether a 4B-class model happens to write `y = x^2 - 3x + 2`,
 * which is the prompt-side dependence every belt arm of this night failed to
 * remove.
 *
 * Eight rows, decided by the twenty asks. **Eight map, twelve refuse.**
 */
test('a topic with a curve gets one, and a topic without gets nothing', () => {
  const has = [
    'Teach me about polynomials.',
    'Teach me why a derivative is a limit.',
    'Teach me what a logarithm actually does.',
    'Teach me how to complete the square, step by step.',
    'Teach me what makes a function continuous.',
    'Teach me why dividing by zero is undefined.',
    'Teach me what gradient descent is, from scratch.',
    'Teach me what a loss function is for.',
  ];
  const hasNot = [
    'Teach me the difference between mean and median.',
    'Teach me what overfitting means and how you spot it.',
    'Teach me the difference between precision and recall.',
    'Teach me what a hash table is and why it is fast.',
    'Teach me what a race condition is.',
    'Teach me why immutability makes concurrency easier.',
  ];
  for (const ask of has) assert.ok(buildExamplePlot(ask), `${ask} has a curve`);
  for (const ask of hasNot) {
    assert.strictEqual(
      buildExamplePlot(ask),
      undefined,
      `${ask} has no curve, and drawing one would invent a picture for a subject that has none`,
    );
  }
});

test('the example is captioned as the PRODUCT’s choice, never as the learner’s', () => {
  /*
   * This is the whole reason a table of eight rows is not fabrication: it is a
   * textbook choosing which parabola to draw. What WOULD be fabrication is
   * presenting it as though the learner or the model had named it — so the
   * caption says who chose it, and says the reader did not.
   */
  const plot = buildExamplePlot('Teach me about polynomials.')!;
  assert.match(plot.chart.caption ?? '', /chosen by Sequence/);
  assert.match(plot.chart.caption ?? '', /you did not ask for this particular one/);
  assert.match(plot.chart.caption ?? '', /faithful to/);
  assert.doesNotMatch(plot.chart.caption ?? '', /scanned graph/);
});

test('continuity is taught by its failure, not by a corner', () => {
  /*
   * This row was `abs(x)`, labelled "a function with a corner" — and abs(x) IS
   * continuous everywhere. A learner asking what makes a function continuous
   * could read the corner as the thing that breaks it, which is the opposite of
   * the lesson. Caught by reading the eight mappings rather than by a test
   * failing.
   */
  assert.strictEqual(exampleFor('Teach me what makes a function continuous.')?.expression, '1/x');
});

test('the product example still passes the validator and its own arithmetic', () => {
  const plot = buildExamplePlot('Teach me how to complete the square, step by step.')!;
  assert.strictEqual(validateChart(plot.chart).ok, true);
  for (const item of plot.chart.items) {
    const x = Number(item.label);
    assert.strictEqual(item.value, x * x - 3 * x + 2);
  }
});

test('a stated expression still wins over the product example', () => {
  /* Two promises, two captions, and no path where one is quietly served as the
     other: when the model names its own expression, that is what is drawn. */
  const stated = buildPlot('Consider y = x^3 - 3x, which has two turning points.')!;
  assert.strictEqual(stated.source, 'x^3 - 3x');
  assert.doesNotMatch(stated.chart.caption ?? '', /chosen by Sequence/);
});
