import assert from 'node:assert';
import { test } from 'node:test';

import {
  ASK_ROUNDS_CEILING,
  MAX_ASK_TOOL_ROUNDS,
  clampAskRounds,
} from '../server/askTools.js';

/**
 * A PER-REQUEST ROUND CAP — CANON's P7, "the round cap is still low".
 *
 * A hard question stopped at eight rounds with an apology and no way to say
 * keep going; a throwaway question got the same eight.
 *
 * AN OVERRIDE IS NOT A LICENCE. Every round is a metered provider call, so an
 * unbounded "keep going" is an unbounded bill authored by whoever typed the
 * number. Every test below is about that boundary.
 */

test('absent means the default', () => {
  assert.strictEqual(clampAskRounds(undefined), MAX_ASK_TOOL_ROUNDS);
  assert.strictEqual(clampAskRounds(null), MAX_ASK_TOOL_ROUNDS);
});

test('a real number raises the cap', () => {
  assert.strictEqual(clampAskRounds(16), 16);
});

test('THE CEILING HOLDS — a big number cannot buy unbounded calls', () => {
  /*
   * The whole point. Past this a caller is no longer raising a limit, they are
   * removing one, and the bill is real money.
   */
  assert.strictEqual(clampAskRounds(1_000_000), ASK_ROUNDS_CEILING);
  assert.strictEqual(clampAskRounds(Infinity), MAX_ASK_TOOL_ROUNDS);
});

test('the ceiling is a multiple of the default, not an arbitrary number', () => {
  /* Enough that a genuinely hard question can finish; small enough that a
     mistake is a recoverable amount of money. */
  assert.strictEqual(ASK_ROUNDS_CEILING, MAX_ASK_TOOL_ROUNDS * 4);
});

test('below one falls back to the default rather than disabling tools', () => {
  /*
   * Zero rounds means the model may never use a tool, which is a different
   * feature and not this one. A caller sending 0 or -3 meant something else.
   */
  for (const bad of [0, -1, -99]) {
    assert.strictEqual(clampAskRounds(bad), MAX_ASK_TOOL_ROUNDS, String(bad));
  }
});

test('a fractional request is floored, not rounded up', () => {
  /* 8.9 rounds is 8 rounds. Rounding up would spend a call the caller did not
     ask for. */
  assert.strictEqual(clampAskRounds(8.9), 8);
});

test('MALFORMED INPUT DOES NOT FAIL THE QUESTION', () => {
  /*
   * A bad `maxRounds` on the wire is a client bug. Throwing would turn a small
   * client bug into no answer at all, which is a much worse outcome than
   * quietly using the default.
   */
  for (const bad of ['12', {}, [], NaN, true]) {
    assert.strictEqual(clampAskRounds(bad as never), MAX_ASK_TOOL_ROUNDS);
  }
});
