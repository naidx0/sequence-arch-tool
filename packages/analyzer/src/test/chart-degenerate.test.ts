import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CHART_MIN_DISTINCT_Y,
  degenerateSeriesProblems,
  executeAskTool,
} from '../server/askTools.js';

/**
 * A CHART THAT PLOTS NOTHING IS REFUSED, AND THE REFUSAL NAMES THE FIX.
 *
 * THE REPORT, owner walking the installed app with MiniCPM5-2B, 2026-09-17:
 * asked for "a parabola, y = x²" the chart came back as A FLAT LINE AT ZERO,
 * labelled "y = x² curve".
 *
 * EVERY GUARD HELD, which is why this file exists. `validateChart` checks a
 * chart's SHAPE — the kind is known, ids are unique, and no item claims a
 * `nodeId` the scanned graph does not have. It was written for node-link
 * pictures, where `value` is optional decoration, so NOTHING anywhere read the
 * numbers. Eleven items with `value: 0` passed every check, the harness told
 * the model it had "drawn a parabola", and the reader got a straight line under
 * a title that claimed a curve.
 *
 * ONE CASE PER STOP, and each produces only its own: a flat series, a series
 * with too few distinct values, a series with no numbers at all, and x labels
 * out of order. The kinds that are NOT plotted series are here too — a bar
 * chart of one repeated count is an ordinary bar chart, and a rule that refused
 * it would have bought this fix at the price of every other picture.
 */

const ctx = {
  /* No repository: a chart about an idea needs none, and a nodeId would be refused. */
  resolveReadable: () => null,
  repoRoot: null,
  designMode: true,
  question: 'plot a parabola, y = x^2',
  canvasToolsEnabled: true,
};

function points(ys: readonly (number | undefined)[], xs?: readonly string[]): Array<{
  id: string;
  label: string;
  value?: number;
}> {
  return ys.map((y, i) => ({
    id: `p${i}`,
    label: xs ? xs[i]! : String(i - 5),
    ...(y === undefined ? {} : { value: y }),
  }));
}

/** The owner's own numbers: y = x² over x in [-5, 5], eleven points. */
const PARABOLA = [25, 16, 9, 4, 1, 0, 1, 4, 9, 16, 25];

/* --------------------------------- the unit ------------------------------- */

test('THE OWNER’S CHART: eleven points all at zero is not a parabola', () => {
  const problems = degenerateSeriesProblems({
    kind: 'line',
    items: points(new Array(11).fill(0)),
  });
  assert.equal(problems.length, 1, `expected one problem, got: ${problems.join(' | ')}`);
  assert.match(problems[0]!, /1 distinct y value/, 'the refusal must state what it counted');
  assert.match(problems[0]!, /all y = 0/, 'and the value they all share');
  /* THE FIX, NAMED. A refusal the model cannot act on buys a retry of the same
     mistake; these are the numbers for the question he actually typed. */
  assert.match(problems[0]!, /11 points with distinct y/);
  assert.match(problems[0]!, /25, 16, 9, 4, 1, 0, 1, 4, 9, 16, 25/);
});

test('the real parabola passes — the rule refuses flatness, not curves', () => {
  assert.deepEqual(degenerateSeriesProblems({ kind: 'line', items: points(PARABOLA) }), []);
});

test(`fewer than ${CHART_MIN_DISTINCT_Y} distinct y values is refused, ${CHART_MIN_DISTINCT_Y} is not`, () => {
  const two = degenerateSeriesProblems({ kind: 'line', items: points([0, 1, 0, 1, 0]) });
  assert.equal(two.length, 1, 'two distinct values is a square wave, not a plotted function');
  assert.match(two[0]!, /2 distinct y value/);
  assert.ok(!/all y =/.test(two[0]!), 'only a ONE-value series may be reported as all-equal');
  assert.deepEqual(
    degenerateSeriesProblems({ kind: 'line', items: points([0, 1, 2, 1, 0]) }),
    [],
    `${CHART_MIN_DISTINCT_Y} distinct values is a shape and must pass`,
  );
});

test('a point with no numeric value is its OWN stop — a blank y is not a zero', () => {
  const problems = degenerateSeriesProblems({
    kind: 'line',
    items: points([1, undefined, 9, 16, 25, undefined, 1, 4, 9, 16, 25]),
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /2 of 11 point\(s\) with no finite numeric/);
  /* Distinct enough to clear the flatness rule, so this case can only have come
     from the missing-value branch. */
  assert.ok(!/distinct y value/.test(problems[0]!));
});

test('x labels out of order are their own stop — the series is otherwise a real curve', () => {
  const problems = degenerateSeriesProblems({
    kind: 'line',
    items: points([0, 4, 1, 9, 16], ['0', '2', '1', '3', '4']),
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /not strictly monotonic/);
  assert.match(problems[0]!, /sort the points by x/);
});

test('a DESCENDING x axis is monotonic and passes — order, not direction', () => {
  assert.deepEqual(
    degenerateSeriesProblems({
      kind: 'line',
      items: points([25, 16, 9, 4, 1], ['5', '4', '3', '2', '1']),
    }),
    [],
  );
});

test('non-numeric x labels are a categorical line chart and get no ordering rule', () => {
  assert.deepEqual(
    degenerateSeriesProblems({
      kind: 'line',
      items: points([3, 9, 4], ['Mar', 'Jan', 'Feb']),
    }),
    [],
    'months have no numeric order this check could read',
  );
});

test('the rule is PER SERIES: one good series does not cover for a flat one', () => {
  const items = [
    ...PARABOLA.map((y, i) => ({ id: `a${i}`, label: String(i - 5), value: y, group: 'x^2' })),
    ...new Array(11).fill(0).map((_, i) => ({
      id: `b${i}`,
      label: String(i - 5),
      value: 0,
      group: 'baseline',
    })),
  ];
  const problems = degenerateSeriesProblems({ kind: 'line', items });
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /series "baseline"/);
  assert.ok(!/x\^2/.test(problems[0]!), 'the series that is a curve must not be named');
});

test('scatter is held to the same contract as line', () => {
  assert.equal(
    degenerateSeriesProblems({ kind: 'scatter', items: points(new Array(8).fill(3)) }).length,
    1,
  );
});

test('the kinds that are NOT plotted series are untouched', () => {
  /* A bar chart of three equal counts, a donut of one slice, a data-flow whose
     items carry no numbers at all: every one of these is an ordinary picture and
     the rule must not reach them. */
  for (const kind of ['bar', 'donut', 'heat-map', 'data-flow', 'system-architecture']) {
    assert.deepEqual(
      degenerateSeriesProblems({ kind, items: points([7, 7, 7]) }),
      [],
      `${kind} is not a plotted series`,
    );
    assert.deepEqual(
      degenerateSeriesProblems({ kind, items: points([undefined, undefined]) }),
      [],
      `${kind} items need no value`,
    );
  }
});

test('an empty chart is left to validateChart — this rule counts numbers, not items', () => {
  assert.deepEqual(degenerateSeriesProblems({ kind: 'line', items: [] }), []);
});

/* ------------------------------ through the tool -------------------------- */

test('propose_chart REFUSES the flat parabola, and the model is told how to fix it', async () => {
  const result = await executeAskTool(
    'propose_chart',
    {
      chart: {
        version: 1,
        kind: 'line',
        title: 'y = x² curve',
        items: points(new Array(11).fill(0)),
        axes: { x: 'x', y: 'y' },
      },
    },
    ctx,
  );
  assert.equal(result.ok, false, 'a flat line under a parabola title must not be accepted');
  const evidence = String(result.evidence);
  assert.match(evidence, /^refused: propose_chart/);
  assert.match(evidence, /11 points with distinct y/);
  assert.equal(result.chart, undefined, 'a refused chart must not reach the canvas');
});

test('propose_chart ACCEPTS the real parabola — the same call with the real numbers', async () => {
  const result = await executeAskTool(
    'propose_chart',
    {
      chart: {
        version: 1,
        kind: 'line',
        title: 'y = x² curve',
        items: points(PARABOLA),
        axes: { x: 'x', y: 'y' },
      },
    },
    ctx,
  );
  assert.equal(result.ok, true, `the real parabola was refused: ${String(result.evidence)}`);
  assert.equal(result.chart?.items.length, 11);
});
