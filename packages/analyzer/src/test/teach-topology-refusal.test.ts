/**
 * A REFUSAL THAT DOES NOT NAME THE RIGHT TOOL GETS THE WRONG ONE CALLED AGAIN.
 *
 * Practical ML's stream-json replay, 2026-09-05, turn 4 — "Now show me on the
 * board how a lesson slot moves from the queue to the turn." The capture's last
 * four lines:
 *
 *   tool:start propose_topology
 *   tool:done  propose_topology  "Refused — TEACH MODE reads and changes nothing…"
 *   tool:start propose_topology
 *   tool:done  propose_topology  "Refused — TEACH MODE reads and changes nothing…"
 *
 * The model asked for the board, was refused, and asked the same way again. Zero
 * visuals across four turns, and this is why: not the budget, not a model that
 * never reached for a picture.
 *
 * THE REFUSAL IS RIGHT AND STAYS. `propose_topology` proposes a CHANGE to the
 * architecture — a dashed service to accept or deny — and teach mode changes
 * nothing. What was wrong is that it said "explain the change you would have
 * made instead", which is the correct sentence for `edit_file` and useless to a
 * model that was not trying to change anything, and it never named the tool that
 * draws.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { mutatingToolRefusal } from '../server/askPipeline.js';

test('PLANTED: a teach turn refused propose_topology is told to call propose_chart', () => {
  const r = mutatingToolRefusal('propose_topology', true);
  assert.match(r, /propose_chart/, 'the tool that draws must be named');
  assert.match(r, /do not retry propose_topology/i, 'and the refused one must be closed off');
});

test('the refusal still says WHY, so the model can tell the two tools apart', () => {
  const r = mutatingToolRefusal('propose_topology', true);
  assert.match(r, /proposes a CHANGE/, 'a picture of the architecture is not a change to it');
});

test('an actual edit tool keeps the explain-instead guidance', () => {
  /* For `edit_file` the original sentence is right: there IS a change, and
     describing it is what a lesson should do with it. */
  const r = mutatingToolRefusal('edit_file', true);
  assert.match(r, /Explain the change you would have made/);
  assert.doesNotMatch(r, /propose_chart/, 'nothing here wanted to draw');
});

test('plan mode is unchanged by any of this', () => {
  const r = mutatingToolRefusal('propose_topology', false);
  assert.match(r, /PLAN MODE/);
  assert.doesNotMatch(r, /propose_chart/);
});
