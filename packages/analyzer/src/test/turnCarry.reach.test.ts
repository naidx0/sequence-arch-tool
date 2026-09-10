/*
 * THE CARRY IS EMPTY ON A FIRST-TIER ASK — as a gate, not as a reading.
 *
 * Stage one measured the carry on the teach bench and found no movement. The
 * reason was assumed to be sizing, and stage four was queued to redesign what
 * it carries. Reading the three write gates together first says something
 * cheaper and worse: on an ENGINEER'S ask NONE OF THE ORIGINAL THREE SLOTS can
 * be written.
 *
 * UPDATED 2026-09-06, when the fourth slot shipped. This file's prose used to
 * say the carry "cannot be written at all" on an engineer's ask, and that
 * stopped being true the moment `referents` existed — a gate whose subject
 * moved underneath it while every assertion stayed green. The three original
 * slots are still unreachable there and the cases below still say so; the
 * fourth is reachable, and it is asserted rather than described, so the same
 * drift cannot happen twice.
 *
 * A claim like that read off the source rots the moment a gate moves. These
 * cases exist so it cannot: if someone makes excerpts reachable on an ask turn
 * — which is the fix — the first case FAILS and says so, and whoever changes it
 * updates the finding deliberately instead of leaving a stale page behind.
 *
 * The other two slots (`chart`, `concept`) are asserted by the source-shape
 * case at the bottom, because their gates are expressions inside a 4,000-line
 * function with no seam to call. That case is weaker on purpose and says which
 * kind of evidence it is.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';

import { excerptsReachable, pathsNamedIn } from '../server/turnCarry.js';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
/* dist/server and src/server are siblings, so this resolves whether the test
   runs compiled or from source. */
const PIPELINE = fs.readFileSync(path.join(HERE, '..', '..', 'src', 'server', 'askPipeline.ts'), 'utf8');
const TOOLS = fs.readFileSync(path.join(HERE, '..', '..', 'src', 'server', 'askTools.ts'), 'utf8');

/* The three turns of the 2026-09-06 seat read, verbatim. */
const SEAT_TURNS = [
  'Which files depend on scan.ts, and what breaks if it changes?',
  'Of those, which one would I have to change first?',
  'Show me how that file uses what scan.ts returns.',
];

test('no turn of the engineer seat read can put an excerpt in the carry', () => {
  for (const question of SEAT_TURNS) {
    assert.equal(
      excerptsReachable({ askIntent: 'ask', autoWrites: true, question }),
      false,
      `an ask-intent turn reached an excerpt: ${question}`,
    );
  }
});

test('it is the INTENT that blocks it, not the wording — the same questions with a slashed path still cannot', () => {
  /*
   * Distinguishes the two reasons an engineer gets nothing. Even spelled with a
   * full path, an ask turn is refused, so "write better questions" is not the
   * fix and nobody should try it.
   */
  const spelled = 'Which files depend on packages/analyzer/src/scan.ts?';
  assert.equal(pathsNamedIn(spelled).length, 1, 'the path should be recognised');
  assert.equal(excerptsReachable({ askIntent: 'ask', autoWrites: true, question: spelled }), false);
  assert.equal(excerptsReachable({ askIntent: 'edit', autoWrites: true, question: spelled }), true);
});

test('a bare name is rejected even on an edit turn, which is why scan.ts read four wrong files', () => {
  assert.deepEqual(pathsNamedIn('what breaks if scan.ts changes?'), []);
  assert.equal(
    excerptsReachable({ askIntent: 'edit', autoWrites: true, question: 'fix scan.ts' }),
    false,
  );
});

test('auto-write permission is required, so a read-only edit turn carries nothing either', () => {
  const q = 'fix packages/analyzer/src/scan.ts';
  assert.equal(excerptsReachable({ askIntent: 'edit', autoWrites: false, question: q }), false);
});

test('the pre-read CALLS the gate rather than restating it', () => {
  /*
   * The fourth law: a rule in two handlers is one rule until measured. This
   * fails if someone re-inlines the condition and leaves the exported one
   * behind as a decoration that agrees with nothing.
   */
  assert.match(PIPELINE, /excerptsReachable\(\{/, 'askPipeline should call excerptsReachable');
  assert.match(PIPELINE, /for \(const rel of pathsNamedIn\(input\.question\)\)/);
  assert.doesNotMatch(
    PIPELINE,
    /askIntent === 'edit' &&\s*permissionAutoWrites\(input\.permission\) &&\s*input\.repoRoot/,
    'the pre-read gate was re-inlined; the exported gate is now a second copy',
  );
});

test('the FOURTH slot IS reachable on a first-tier ask — the whole point of it', () => {
  /*
   * The complement of every case above, and the one that keeps this file honest
   * now that the carry is not uniformly empty on an ask. `who_calls` is an ask
   * tool, not a teach tool, and it sets referents unconditionally on success —
   * so an engineer's turn CAN fill the carry, through this slot and only this
   * slot.
   *
   * This goes red if someone gates referents behind teach or edit intent, which
   * would silently restore the emptiness the fourth slot exists to end.
   */
  assert.match(
    TOOLS,
    /referents: \{\s*tool: 'who_calls'/,
    'who_calls must set referents',
  );
  const whoCallsAt = TOOLS.indexOf("tool: 'who_calls'");
  assert.ok(whoCallsAt > 0);
  assert.doesNotMatch(
    TOOLS.slice(Math.max(0, whoCallsAt - 1200), whoCallsAt),
    /input\.teach === true|askIntent === 'edit'/,
    'the referents must not be gated on teach or edit intent',
  );
  /* And the pipeline must fold them in on any turn, not only a teach one. */
  const at = PIPELINE.indexOf('carryReferentsEnabled() && referentsThisTurn !== undefined');
  assert.ok(at > 0, 'carryOut must consult the referents flag');
  assert.doesNotMatch(
    PIPELINE.slice(at, at + 260),
    /input\.teach|teachContext/,
    'the referents fold must not be conditioned on teach',
  );
});

test('SOURCE SHAPE (weaker evidence, stated as such): the other two slots are teach-only', () => {
  /*
   * Not a behavioural gate — it reads the pipeline's text, because neither
   * gate has a seam. It is here because a silent change to either one would
   * otherwise make the finding wrong with nothing failing.
   */
  /*
   * ANCHORED ON THE ASSIGNMENT, NOT ON THE LINE.
   *
   * This used to match /^\s*lastChartThisTurn = /gm, and a mutation proved the
   * hole: `if (cond) lastChartThisTurn = derived;` does not start a line with
   * the name, so the gate stayed green while a second assignment existed. It
   * would have caught the obvious version and missed the sneaky one, which is
   * the wrong way round.
   *
   * The negative lookahead keeps `=== undefined` and `!== undefined` out; every
   * other mention in this file is a read.
   */
  /*
   * TWO ASSIGNMENTS SINCE 2026-09-10, AND THE COUNT ALONE STOPPED BEING THE
   * CHECK.
   *
   * This asserted exactly one. The general-knowledge draw added a second, for
   * the case where a repository is attached and the subject is not in it, and
   * bumping 1 to 2 would have kept the number and thrown away the property —
   * the property being that the chart slot is reachable only from teach.
   *
   * So EVERY assignment is now checked against the gate, rather than counted.
   * A third one appearing outside teach fails here exactly as a second one used
   * to, and a third one inside teach passes because it is not a defect.
   */
  /*
   * COMMENTS STRIPPED FIRST, and that is what makes the window mean anything.
   *
   * The check looks back a fixed distance for the gate. With comments in, a
   * long explanation above an assignment pushes its own gate out of range and
   * the test fails on prose — which happened here on the first attempt. Worse,
   * the reverse is also true: a comment mentioning `input.teach === true` would
   * SATISFY it. Stripping block and line comments makes the distance a distance
   * in CODE, so neither a long comment nor a quoted one can decide the result.
   */
  const CODE = PIPELINE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  const chartAssignments = [...CODE.matchAll(/lastChartThisTurn\s*=(?!=)/g)];
  assert.equal(
    chartAssignments.length,
    2,
    'the number of chart-slot assignments changed; check each is still teach-gated below',
  );
  for (const m of chartAssignments) {
    const before = CODE.slice(Math.max(0, m.index - 1200), m.index);
    assert.match(
      before,
      /input\.teach === true/,
      `a chart assignment at ${m.index} is not inside the teach gate`,
    );
  }
  /* And the new one is reachable only through the subject-absent branch. */
  const gk = CODE.indexOf('subjectNotInRepo === true');
  assert.ok(gk > 0, 'the general-knowledge branch is gone');
  assert.ok(
    CODE.indexOf('lastChartThisTurn = gk') > gk,
    'the general-knowledge chart assignment escaped its branch',
  );

  const teachContextSites = PIPELINE.match(/input\.teachContext\?\.concept\?\.title/g) ?? [];
  assert.equal(teachContextSites.length, 1, 'the concept slot gate moved');
});
