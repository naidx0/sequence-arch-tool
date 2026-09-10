/**
 * A TEACH TURN'S BUDGET IS THE TEACH BUDGET, whatever the learner typed.
 *
 * `resolveAskRoundCap` clamped to two rounds whenever the QUESTION read as
 * drawish, and never looked at `teach`. So a teach turn — which must ground its
 * concept in the repository, name the real file, cite file:line AND ship a
 * visual — was given the budget built for a design-mode draw with no repository
 * to read: one round to ask, one to land the diagram.
 *
 * Practical ML's walk hit it on turn 4, and the ask below is that turn verbatim.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DESIGN_DRAW_ASK_TOOL_ROUNDS,
  MAX_ASK_TOOL_ROUNDS,
  resolveAskRoundCap,
} from '../server/askTools.js';

/** Practical ML's turn 4, typed after a lesson on what a slot in lessonState.ts holds. */
const THE_ASK = 'Now show me on the board how a slot moves from queue to turn';

test('THE RED CASE: a drawish TEACH ask gets the teach budget, not two rounds', () => {
  const asTeach = resolveAskRoundCap({
    question: THE_ASK,
    designMode: false,
    repoRoot: '/repo',
    teach: true,
  });
  assert.equal(asTeach, MAX_ASK_TOOL_ROUNDS, 'a teach turn needs rounds to read AND to draw');
  assert.notEqual(asTeach, DESIGN_DRAW_ASK_TOOL_ROUNDS);
});

test('the same ask outside teach mode still takes the design-draw short path', () => {
  /* The two-round path is not wrong — it is right for what it was built for, and
     removing it everywhere would undo the fix that stopped seven-minute draws. */
  const notTeach = resolveAskRoundCap({
    question: THE_ASK,
    designMode: false,
    repoRoot: '/repo',
  });
  assert.equal(notTeach, DESIGN_DRAW_ASK_TOOL_ROUNDS);
});

test('the budget no longer depends on how the learner phrased it', () => {
  /*
   * The teach contract says EVERY concept ships a visual, so every teach turn
   * draws. Only the drawishly-phrased ones were clamped, so the same lesson got
   * eight rounds or two on wording alone.
   */
  const drawish = resolveAskRoundCap({ question: THE_ASK, designMode: false, repoRoot: '/repo', teach: true });
  const plain = resolveAskRoundCap({
    question: 'Teach me how a slot moves from queue to turn',
    designMode: false,
    repoRoot: '/repo',
    teach: true,
  });
  assert.equal(drawish, plain, 'two phrasings of one lesson must get one budget');
});

test('an explicit maxRounds still wins, in both directions', () => {
  /* This removes an automatic clamp; it does not override a decision someone
     made. A caller asking for two rounds gets two. */
  assert.equal(
    resolveAskRoundCap({ question: THE_ASK, designMode: false, repoRoot: '/repo', teach: true, maxRounds: 2 }),
    2,
  );
  assert.equal(
    resolveAskRoundCap({ question: THE_ASK, designMode: false, repoRoot: '/repo', teach: true, maxRounds: 12 }),
    12,
  );
});
