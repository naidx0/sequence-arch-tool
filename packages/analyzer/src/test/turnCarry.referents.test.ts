/*
 * THE FOURTH SLOT — the previous answer's referents.
 *
 * The seat read of 2026-09-06 asked "which files depend on scan.ts", got a
 * `who_calls` list, then asked "of those, which one would I have to change
 * first?" — and the follow-up turn had never been handed the list. These cases
 * lock the slot that fixes it, and the ones that matter most are the honesty
 * cases: the block must say how many of how many, and must say the contents
 * were not read, because a list of eight names out of 84 is exactly the
 * material a model will speak past.
 *
 * Registered before the run: docs/research/carry-redesign-registration.md.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { carryReferentsEnabled } from '../server/askPipeline.js';
import { EMPTY_CARRY, MAX_REFERENTS, extendCarry, renderCarry } from '../server/turnCarry.js';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
/* dist/test and src/server are siblings under the package root. */
const PIPELINE = fs.readFileSync(path.join(HERE, '..', '..', 'src', 'server', 'askPipeline.ts'), 'utf8');

const whoCalls = (items: string[], total = items.length) => ({
  tool: 'who_calls',
  subject: 'packages/analyzer/src/scan.ts',
  items,
  total,
});

test('the list a turn answered from is carried to the next turn', () => {
  const carry = extendCarry(EMPTY_CARRY, 1, { referents: whoCalls(['cli.ts', 'doctor.ts']) });
  const block = renderCarry(carry).join('\n');
  assert.match(block, /cli\.ts/);
  assert.match(block, /doctor\.ts/);
  assert.match(block, /who_calls/);
});

test('the block names the pronoun the follow-up will use', () => {
  /* Turn 2 said "of those". If the block does not connect the list to that
     word, it is a list the model has no reason to treat as the antecedent. */
  const block = renderCarry(
    extendCarry(EMPTY_CARRY, 1, { referents: whoCalls(['cli.ts']) }),
  ).join('\n');
  assert.match(block, /those/i);
});

test('HONESTY: eight of eighty-four is rendered as eight of eighty-four', () => {
  const many = Array.from({ length: 40 }, (_, i) => `dep${i}.ts`);
  const carry = extendCarry(EMPTY_CARRY, 1, { referents: whoCalls(many, 84) });
  assert.equal(carry.referents?.items.length, MAX_REFERENTS);
  const block = renderCarry(carry).join('\n');
  assert.match(block, /8 of 84/, 'the denominator must travel with the number');
  assert.doesNotMatch(block, /dep9\.ts/, 'an item past the cap must not appear');
});

test('HONESTY: the block says the contents were not read', () => {
  /* The registered fabrication risk: a name without the bytes is exactly what
     a model invents around. */
  const block = renderCarry(
    extendCarry(EMPTY_CARRY, 1, { referents: whoCalls(['cli.ts']) }),
  ).join('\n');
  assert.match(block, /contents were not read/i);
});

test('a later list REPLACES the earlier one, so "those" is never ambiguous', () => {
  let carry = extendCarry(EMPTY_CARRY, 1, { referents: whoCalls(['old.ts']) });
  carry = extendCarry(carry, 2, { referents: whoCalls(['new.ts']) });
  const block = renderCarry(carry).join('\n');
  assert.match(block, /new\.ts/);
  assert.doesNotMatch(block, /old\.ts/);
  assert.equal(carry.referents?.turn, 2);
});

test('a turn that produces no list keeps the previous one', () => {
  /* The follow-up may be two turns downstream — turn 2 answered, turn 3 asked
     "show me how that file uses what scan.ts returns". */
  let carry = extendCarry(EMPTY_CARRY, 1, { referents: whoCalls(['cli.ts']) });
  carry = extendCarry(carry, 2, {});
  assert.equal(carry.referents?.items[0], 'cli.ts');
  assert.equal(carry.referents?.turn, 1, 'the turn number must stay the turn it was produced on');
});

test('an empty carry still renders nothing, so a fresh conversation promises nothing', () => {
  assert.deepEqual(renderCarry(EMPTY_CARRY), []);
  assert.deepEqual(renderCarry(extendCarry(EMPTY_CARRY, 1, {})), []);
});

test('the cap is 8 and is stated in the source, not chosen after a run', () => {
  assert.equal(MAX_REFERENTS, 8);
});

test('the FLAG is what gates it, and it is default-off', () => {
  /*
   * The control arm's entire validity rests on this: control and treatment are
   * the same build, and SEQUENCE_ASK_CARRY_REFERENTS is the only difference. A
   * flag that was on by default, or that the pipeline ignored, would make the
   * two arms identical and the result meaningless.
   */
  const before = process.env.SEQUENCE_ASK_CARRY_REFERENTS;
  try {
    delete process.env.SEQUENCE_ASK_CARRY_REFERENTS;
    assert.equal(carryReferentsEnabled(), false, 'default OFF, so the control arm is the default');
    process.env.SEQUENCE_ASK_CARRY_REFERENTS = '0';
    assert.equal(carryReferentsEnabled(), false, 'only "1" turns it on');
    process.env.SEQUENCE_ASK_CARRY_REFERENTS = '1';
    assert.equal(carryReferentsEnabled(), true);
  } finally {
    if (before === undefined) delete process.env.SEQUENCE_ASK_CARRY_REFERENTS;
    else process.env.SEQUENCE_ASK_CARRY_REFERENTS = before;
  }
});

test('SOURCE SHAPE (weaker evidence, stated as such): carryOut consults the flag', () => {
  /*
   * The flag being readable is not the same as the pipeline reading it. There
   * is no seam to call here without running a provider, so this reads the
   * pipeline's text and says which kind of evidence it is.
   */
  assert.match(
    PIPELINE,
    /carryReferentsEnabled\(\) && referentsThisTurn !== undefined/,
    'carryOut must gate the referents on the flag',
  );
  assert.match(
    PIPELINE,
    /if \(result\.referents !== undefined\) sink\.referentsThisTurn\.value = result\.referents;/,
    'the single tool sink must record referents',
  );
});
