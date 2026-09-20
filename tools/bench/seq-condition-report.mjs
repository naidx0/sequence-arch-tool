#!/usr/bin/env node
/**
 * THE SEQUENCE CONDITION'S FOUR METRICS, computed once for every arm.
 *
 *   node tools/bench/seq-condition-report.mjs out/seq-old-1.json out/seq-new-1.json ...
 *
 * Registered in `docs/research/sequence-condition-prediction.md`. One function
 * over every report, so the old arm and the new arm cannot be measured by two
 * computations that ought to agree — the shape that has produced a false result
 * twice in this repository.
 *
 * ── THE STATISTIC REWARDED FAILURE, AND BOTH READINGS ARE KEPT ────────────
 *
 * `conceptGiven` counts turns HOLDING a concept, and a turn holds one partly
 * because the previous turn failed: a stub produces nothing, so its concept is
 * never consumed and the next turn inherits it. Measured over the four arms,
 * pooled across 60 turn-pairs: a one-entry queue survived a stub turn 4 of 4
 * times and a real turn 7 of 20. The old arms stubbed 9 and 5 times, the new 3
 * and 4 — and the new arms scored LOWER on concepts given, by failing less.
 *
 * So the corrected statistic counts only turns that produced a lesson. A stub is
 * excluded from numerator AND denominator and reported in its own column, where
 * it is a result rather than a hidden multiplier.
 *
 * The uncorrected fields stay. The four arms were registered and read under
 * them, and deleting the reading a prediction was judged by would leave the
 * record unable to show why the judgement changed.
 */
import fs from 'node:fs';
import path from 'node:path';

export function metrics(report) {
  const cs = report.results ?? [];
  const turns = cs.flatMap((c) => c.turns ?? []);
  const n = turns.length;
  const cov = turns.map((t) => t.coverage).filter(Boolean);
  /*
   * "No-node refusal" as the registration means it: a turn that was GIVEN a
   * concept and shipped no picture. `buildConceptChart` returns nothing for a
   * node with no neighbours, so this is the count more edges should reduce.
   */
  const conceptGiven = turns.filter((t) => t.conceptGiven).length;
  const conceptNoVisual = turns.filter((t) => t.conceptGiven && !t.visual).length;
  /*
   * A TURN THAT PRODUCED A LESSON. Not a stub, and not an error — both are turns
   * where the pipeline did not deliver prose, and neither says anything about
   * whether a lesson that DID happen was grounded or drawn.
   */
  const lessonTurns = turns.filter((t) => !t.stub && !t.error);
  return {
    conversations: cs.length,
    turns: n,
    edgesTotal: cov[0]?.edgesTotal ?? null,
    visualAll: turns.filter((t) => t.visual).length,
    /* The substantive denominator: turns that had a concept to draw. */
    visualSubstantive: turns.filter((t) => t.conceptGiven && t.visual).length,
    conceptGiven,
    conceptNoVisual,
    checkIn: turns.filter((t) => t.endsWithCheck).length,
    /* ── the corrected statistic: stubs out of both halves ── */
    stubs: turns.filter((t) => t.stub).length,
    lessonTurns: lessonTurns.length,
    conceptGivenL: lessonTurns.filter((t) => t.conceptGiven).length,
    visualSubstantiveL: lessonTurns.filter((t) => t.conceptGiven && t.visual).length,
    checkInL: lessonTurns.filter((t) => t.endsWithCheck).length,
    edgesSeenMean: cov.length === 0 ? null : Math.round(cov.reduce((a, c) => a + (c.edgesSeen ?? 0), 0) / cov.length),
    turnsSeeingNoEdges: cov.filter((c) => (c.edgesSeen ?? 0) === 0).length,
    errored: cs.filter((c) => c.errored).length,
  };
}

if (process.argv.length > 2) {
  const rows = process.argv.slice(2).map((f) => ({ file: path.basename(f), ...metrics(JSON.parse(fs.readFileSync(f, 'utf8'))) }));
  /* Corrected columns first — they are the reading to act on — then the
     uncorrected ones the prediction was registered under. */
  const cols = ['file', 'edgesTotal', 'stubs', 'lessonTurns', 'conceptGivenL', 'visualSubstantiveL', 'checkInL',
    'turns', 'visualAll', 'visualSubstantive', 'conceptGiven', 'conceptNoVisual', 'checkIn', 'edgesSeenMean', 'turnsSeeingNoEdges', 'errored'];
  console.log(cols.join('\t'));
  for (const r of rows) console.log(cols.map((c) => r[c]).join('\t'));
}
