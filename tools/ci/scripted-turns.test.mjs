import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';

import { GOT_IT, scriptedTurns } from '../bench/lib/scripted-turns.mjs';

/**
 * CONDITION A's LEVER — the script only.
 *
 * The next-picture band was killed at 3 reveals of 11 because seven of the
 * eleven questions were asked on their conversation's final turn. This lengthens
 * the conversation and nothing else, so a change in landable questions belongs
 * to the length.
 */
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const two = { question: 'Teach me X.', replies: [GOT_IT] };
const three = { question: 'Teach me Y.', replies: [GOT_IT, GOT_IT] };

test('absent or zero leaves a conversation byte for byte as written', () => {
  /*
   * THE HALF THAT KEEPS THE ARMS ON RECORD COMPARABLE. If the default padded
   * anything, every figure measured before tonight would silently describe a
   * different bench.
   */
  assert.deepStrictEqual(scriptedTurns(two, 0), ['Teach me X.', GOT_IT]);
  assert.deepStrictEqual(scriptedTurns(two, undefined), ['Teach me X.', GOT_IT]);
  assert.deepStrictEqual(scriptedTurns(three, 0), ['Teach me Y.', GOT_IT, GOT_IT]);
});

test('a floor of four pads a two-turn conversation to four, with the bank’s own reply', () => {
  const qs = scriptedTurns(two, 4);
  assert.strictEqual(qs.length, 4);
  assert.strictEqual(qs[0], 'Teach me X.');
  for (const q of qs.slice(1)) assert.strictEqual(q, GOT_IT, 'padding uses the acknowledgement already in the bank');
});

test('a conversation already at the floor is not padded, and one above it is not cut', () => {
  assert.strictEqual(scriptedTurns(three, 3).length, 3, 'at the floor: unchanged');
  assert.strictEqual(scriptedTurns(three, 2).length, 3, 'above it: NOT truncated');
});

test('the lever changes the script and nothing else', () => {
  /*
   * Source-scanned, because the registration turns on it: A and B are separate
   * conditions precisely so a result can be attributed to one of them. If this
   * module touched the check-in, the chart, or any product path, a change in
   * landable questions would be unattributable and the arms worthless.
   */
  const src = fs.readFileSync(path.join(HERE, '..', 'bench', 'lib', 'scripted-turns.mjs'), 'utf8');
  for (const name of ['checkIn', 'chart', 'derive', 'askPipeline']) {
    assert.ok(!src.toLowerCase().includes(name.toLowerCase() + '('), `${name}( has no business in the turn script`);
  }
  assert.ok(!/import .* from '\.\.\/\.\.\/packages/.test(src), 'it imports no product code');
});

test('teach-eval reads the floor from the environment, not from a constant', () => {
  const bench = fs.readFileSync(path.join(HERE, '..', 'bench', 'teach-eval.mjs'), 'utf8');
  assert.match(bench, /TEACH_EVAL_MIN_TURNS/, 'the floor is an environment lever');
  assert.match(bench, /scriptedTurns\(c, Number\(process\.env\.TEACH_EVAL_MIN_TURNS/, 'and it is the only source of turns');
});
