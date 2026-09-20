/**
 * THE MECHANISM B READING, MADE TO FIRE BEFORE ANY CARD IS SPENT.
 *
 * Every check added on the night of 2026-09-06 that was not made to fail turned
 * out to have a hole — an overwrite guard that killed the arms it protected, an
 * artefact gate that demanded a field the product only sets on findings, a
 * source-shape assertion that missed an inline assignment. These cases exist so
 * the reading of a two-hour run is not the first thing to exercise itself.
 *
 * The reading is registered in docs/research/carry-redesign-registration.md.
 * It is implemented in tools/bench/lib/seat-grade.mjs and is not re-decided
 * here.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DISCRIMINATING,
  PROSE_EXPLAINED,
  attribute,
  namedIn,
  readTurnTwo,
} from '../bench/lib/seat-grade.mjs';

test('the three and the five are disjoint, and the three are what the carry alone can supply', () => {
  assert.equal(DISCRIMINATING.length, 3);
  assert.equal(PROSE_EXPLAINED.length, 5);
  for (const d of DISCRIMINATING) assert.ok(!PROSE_EXPLAINED.includes(d));
});

test('PASS — naming one of the three is the only thing that passes', () => {
  const r = readTurnTwo(
    "You'd change packages/analyzer/src/functions/repoFunctionGraph.ts first, since it consumes the shape directly.",
  );
  assert.equal(r.verdict, 'PASS');
  assert.deepEqual(r.discriminating, ['packages/analyzer/src/functions/repoFunctionGraph.ts']);
});

test('PASS — a bare distinctive basename counts, because that is how a model writes', () => {
  assert.equal(readTurnTwo('Start with grade.ts.').verdict, 'PASS');
  assert.equal(readTurnTwo('designDrawBaseline.ts is the one to change first.').verdict, 'PASS');
});

test('INCONCLUSIVE — naming only the five is not a partial pass', () => {
  /*
   * Turn 1 said these aloud and prior prose is carried independently of any
   * carry slot. Reported as "turn 2 named an item from turn 1's list" this
   * would be true and worthless, which is the most dangerous shape a result
   * takes in this programme.
   */
  const r = readTurnTwo('The first change is cli.ts, then doctor.ts and index.ts follow.');
  assert.equal(r.verdict, 'INCONCLUSIVE');
  assert.equal(r.discriminating.length, 0);
  assert.ok(r.proseOnly.length >= 2);
});

test('NULL — naming none of the carried items', () => {
  const r = readTurnTwo('You should edit packages/analyzer/src/scan.ts itself.');
  assert.equal(r.verdict, 'NULL');
});

test('the seat read that produced this measurement still reads NULL', () => {
  /*
   * The 2026-09-06 transcript, verbatim. It is the pre-change behaviour and the
   * reason stage four exists: asked which dependent to change first, it pointed
   * back at the subject of turn 1. If this ever stops reading NULL, the fixture
   * has been edited to suit the result.
   */
  const seatTurnTwo =
    "The first change you'd make is to edit the scan-logic file itself: " +
    'packages/analyzer/src/scan.ts. All 84 dependent files will automatically reflect the new ' +
    'behavior without requiring separate edits.';
  assert.equal(readTurnTwo(seatTurnTwo).verdict, 'NULL');
});

test('a basename must not match inside a longer name', () => {
  /* `grade.ts` inside `upgrade.ts` would manufacture a pass out of nothing. */
  assert.deepEqual(namedIn('see upgrade.ts for the migration', DISCRIMINATING), []);
  assert.equal(readTurnTwo('see upgrade.ts for the migration').verdict, 'NULL');
});

test('ATTRIBUTION — a turn that ran NO tool and named one of the three: the carry supplied it', () => {
  const r = attribute({
    text: 'Change repoFunctionGraph.ts first.',
    carried: DISCRIMINATING,
    toolsRan: [],
  });
  assert.deepEqual(r.fromCarryOnly, ['packages/analyzer/src/functions/repoFunctionGraph.ts']);
  assert.equal(r.refusedBecause, null);
});

test('ATTRIBUTION — ANY tool this turn refuses attribution, however unrelated', () => {
  /*
   * Deliberately blunt. `tool:done` carries a label, not the tool's output, so
   * we cannot see what a tool returned — and "that read_file was probably
   * unrelated" is how a flattering attribution gets made. The blunt rule can
   * only understate the carry's contribution, never overstate it.
   */
  const r = attribute({
    text: 'Change repoFunctionGraph.ts first.',
    carried: DISCRIMINATING,
    toolsRan: ['read_file'],
  });
  assert.deepEqual(r.fromCarryOnly, []);
  assert.match(r.refusedBecause, /read_file/);
  assert.equal(r.named.length, 1, 'what it named is still recorded, only the attribution is refused');
});

test('ATTRIBUTION — the observed seat turn 2 ran no tools and named nothing carried', () => {
  /*
   * The 2026-09-06 transcript: turn 2 read zero files AND named none of the
   * eight. So the pre-change behaviour attributes nothing, which is the floor
   * this measurement has to beat.
   */
  const r = attribute({
    text: "The first change is packages/analyzer/src/scan.ts itself.",
    carried: [...DISCRIMINATING, ...PROSE_EXPLAINED],
    toolsRan: [],
  });
  assert.deepEqual(r.named, []);
  assert.deepEqual(r.fromCarryOnly, []);
});

test('ATTRIBUTION — a prose-explained name is NEVER attributed to the carry', () => {
  /*
   * The first treatment arm named cli.ts, diagramCli.ts and doctor.ts with no
   * tool call, and the rule reported three items the carry alone could have
   * supplied. False: turn 1 SPOKE those three and prior prose is carried
   * independently of any slot. The verdict said INCONCLUSIVE while the
   * attribution beneath it said the opposite.
   */
  const r = attribute({
    text: 'Start with cli.ts, then doctor.ts.',
    carried: [...DISCRIMINATING, ...PROSE_EXPLAINED],
    toolsRan: [],
  });
  assert.deepEqual(r.fromCarryOnly, [], 'prose-explained names are not attributable');
  assert.equal(r.alsoInPriorProse.length, 2, 'but they are still recorded');
});

test('ATTRIBUTION — a discriminating name with no tools IS attributed, alongside prose ones', () => {
  const r = attribute({
    text: 'Start with cli.ts, but grade.ts is the real first change.',
    carried: [...DISCRIMINATING, ...PROSE_EXPLAINED],
    toolsRan: [],
  });
  assert.deepEqual(r.fromCarryOnly, ['packages/analyzer/src/eval/grade.ts']);
  assert.deepEqual(r.alsoInPriorProse, ['packages/analyzer/src/cli.ts']);
});
