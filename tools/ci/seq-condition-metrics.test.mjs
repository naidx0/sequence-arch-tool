import assert from 'node:assert/strict';
import test from 'node:test';

import { metrics } from '../bench/seq-condition-report.mjs';

/**
 * THE CORRECTED STATISTIC — planted cases.
 *
 * The defect these lock down is not an off-by-one. `conceptGiven` counts turns
 * HOLDING a concept, and a turn holds one partly because the previous turn
 * failed: a stub produces nothing, so its concept is never consumed and the next
 * turn inherits it. Measured over the four sequence-condition arms, pooled
 * across 60 turn-pairs, a one-entry queue survived a stub turn 4 of 4 times and
 * a real turn 7 of 20.
 *
 * So a run that improves by stubbing less SCORES LOWER, which is what happened:
 * the old arms stubbed 9 and 5 times against the new arms' 3 and 4, and the new
 * arms were read as having fallen. The first case below is that exact shape,
 * built small enough to see.
 */
const turn = (over = {}) => ({
  turn: 0,
  stub: false,
  visual: false,
  conceptGiven: null,
  endsWithCheck: false,
  coverage: { edgesTotal: 100, edgesSeen: 0 },
  ...over,
});

const report = (turns) => ({ results: [{ id: 'c1', turns: turns.map((t, i) => ({ ...t, turn: i })) }] });

/*
 * TWO RUNS OF THE SAME LESSON.
 *
 * `worse` fails its first turn, so its one concept is never consumed and the
 * next two turns inherit it. `better` never fails, drains its queue, and its
 * third turn has nothing left to be given.
 *
 * `better` is the run anyone would rather ship.
 */
const worse = report([
  turn({ stub: true, conceptGiven: 'jail.ts', visual: true }),
  turn({ conceptGiven: 'jail.ts', visual: true }),
  turn({ conceptGiven: 'jail.ts', visual: true }),
]);
const better = report([
  turn({ conceptGiven: 'jail.ts', visual: true }),
  turn({ conceptGiven: 'jail.ts', visual: true }),
  turn({ conceptGiven: null, visual: false }),
]);

test('the uncorrected statistic prefers the run that failed — the defect, stated', () => {
  const w = metrics(worse);
  const b = metrics(better);
  assert.strictEqual(w.conceptGiven, 3);
  assert.strictEqual(b.conceptGiven, 2);
  assert.ok(
    w.conceptGiven > b.conceptGiven,
    'the run with a stub scores HIGHER on concepts given — this is the bug, asserted so it cannot be quietly re-introduced',
  );
  assert.ok(w.visualSubstantive > b.visualSubstantive, 'and higher on visual-substantive with it');
});

test('the corrected statistic does not prefer it — stubs leave both halves', () => {
  const w = metrics(worse);
  const b = metrics(better);
  /* The stub is out of the denominator... */
  assert.strictEqual(w.lessonTurns, 2, 'the stub turn is not a lesson turn');
  assert.strictEqual(b.lessonTurns, 3);
  /* ...and out of the numerator, so the failing run no longer wins. */
  assert.strictEqual(w.conceptGivenL, 2);
  assert.strictEqual(b.conceptGivenL, 2);
  assert.ok(
    w.conceptGivenL <= b.conceptGivenL,
    'the failing run must not score higher under the corrected statistic',
  );
  assert.strictEqual(w.visualSubstantiveL, 2);
  assert.strictEqual(b.visualSubstantiveL, 2);
});

test('a stub is reported in its own column, as a result rather than a hidden multiplier', () => {
  assert.strictEqual(metrics(worse).stubs, 1);
  assert.strictEqual(metrics(better).stubs, 0);
});

test('an errored turn is excluded too — it produced no lesson either', () => {
  /*
   * Same reasoning as the stub: a turn that errored says nothing about whether a
   * lesson that DID happen was grounded or drawn, and leaving it in the
   * denominator would punish a run for a timeout the guard reported honestly.
   */
  const m = metrics(report([turn({ error: 'timeout', conceptGiven: 'x' }), turn({ conceptGiven: 'x', visual: true })]));
  assert.strictEqual(m.lessonTurns, 1);
  assert.strictEqual(m.conceptGivenL, 1);
});

test('both readings are kept — the record must show why the judgement changed', () => {
  /*
   * The four arms were registered and read under the uncorrected fields. Deleting
   * them would leave the record unable to explain why a refuted prediction was
   * re-read, which is the half of a correction that is worth more than the new
   * number.
   */
  const m = metrics(worse);
  for (const k of ['conceptGiven', 'visualSubstantive', 'checkIn', 'turns']) {
    assert.ok(k in m, `the uncorrected field ${k} must survive the correction`);
  }
  for (const k of ['conceptGivenL', 'visualSubstantiveL', 'checkInL', 'lessonTurns', 'stubs']) {
    assert.ok(k in m, `the corrected field ${k} must be present`);
  }
});
