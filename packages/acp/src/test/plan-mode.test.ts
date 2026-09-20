import assert from 'node:assert';
import { test } from 'node:test';

import {
  AGENT_MODES,
  PLAN_MODE_INSTRUCTIONS,
  READ_ONLY_KINDS,
  allowsTool,
  mayMutate,
  planOutcome,
  refusalFor,
} from '../planMode.js';

/**
 * PLAN MODE — owner walk 2026-08-22: "There should be a plan mode. Planning
 * mode is really important, and we need in-depth instructions for that."
 *
 * The property that makes this shippable today: plan mode is STRICTLY WEAKER
 * than the default this product already enforces, so it asks the enforcement
 * layer for nothing new. `autoEdit` and `full` are drawn refused precisely
 * because they would ask for something that does not exist.
 */

const MUTATING = ['edit', 'delete', 'move', 'execute', 'other'];

test('plan mode allows every read-only kind', () => {
  for (const kind of READ_ONLY_KINDS) {
    assert.strictEqual(allowsTool('plan', kind), true, kind);
  }
});

test('plan mode refuses EVERY mutating kind', () => {
  for (const kind of MUTATING) {
    assert.strictEqual(allowsTool('plan', kind), false, kind);
  }
});

test('plan mode is not weaker than the read-only set it inherits', () => {
  /*
   * The load-bearing claim. If plan mode allowed anything outside this list it
   * would need enforcement that does not exist, and the mode would be a label
   * rather than a guarantee.
   */
  for (const kind of [...MUTATING, 'anything-else', '']) {
    if (READ_ONLY_KINDS.includes(kind)) continue;
    assert.strictEqual(allowsTool('plan', kind), false, kind);
  }
});

test('an unknown tool kind is refused, not allowed by default', () => {
  /* A kind this build has never heard of is the one most likely to be new and
     mutating. Defaulting to allow would make every protocol upgrade a silent
     permission grant. */
  assert.strictEqual(allowsTool('plan', 'some_future_kind'), false);
  assert.strictEqual(allowsTool('plan', undefined), false);
});

test('the ladder is ordered weakest first', () => {
  /* A surface that renders these in declaration order must show the
     always-safe option at the top. */
  assert.deepStrictEqual([...AGENT_MODES], ['plan', 'propose', 'autoEdit', 'full']);
});

test('only autoEdit and full may mutate', () => {
  assert.strictEqual(mayMutate('plan'), false);
  assert.strictEqual(mayMutate('propose'), false);
  assert.strictEqual(mayMutate('autoEdit'), true);
  assert.strictEqual(mayMutate('full'), true);
});

test('autoEdit writes files but does not execute', () => {
  assert.strictEqual(allowsTool('autoEdit', 'edit'), true);
  assert.strictEqual(allowsTool('autoEdit', 'execute'), false);
});

test('full access allows everything, including kinds it has not heard of', () => {
  for (const kind of [...READ_ONLY_KINDS, ...MUTATING, 'some_future_kind']) {
    assert.strictEqual(allowsTool('full', kind), true, kind);
  }
});

test('A REFUSAL IS NEVER SILENT, and it names the mode', () => {
  /*
   * The failure this prevents: a denied write that says nothing looks exactly
   * like an agent that chose not to write. The reader cannot tell whether the
   * mode is protecting them or the model had nothing to say.
   */
  const why = refusalFor('plan', 'edit');
  assert.ok(why, 'a refused tool must produce a reason');
  assert.match(why, /plan mode/i);
  assert.match(why, /read-only/i);
  /* And it says nothing was changed, which is the fact the reader most needs
     and the one they cannot verify from where they are sitting. */
  assert.match(why, /nothing has been changed/i);
  /* And where to go, so the refusal is a door rather than a wall. */
  assert.match(why, /propose/i);
});

test('an ALLOWED tool produces no refusal', () => {
  for (const kind of READ_ONLY_KINDS) {
    assert.strictEqual(refusalFor('plan', kind), null, kind);
  }
});

test('the refusal names the tool that was refused', () => {
  /* "A step was refused" sends the reader looking. Naming it does not. */
  assert.match(refusalFor('plan', 'execute')!, /execute/);
});

test('each mode refuses in its own words', () => {
  const reasons = new Set(
    (['plan', 'propose', 'autoEdit'] as const).map((m) => refusalFor(m, 'execute')),
  );
  /* Three modes refusing with one sentence would tell the reader the product
     has one refusal, and they would stop reading it. */
  assert.strictEqual(reasons.size, 3);
});

test('the instructions forbid editing, and say the tools are already refused', () => {
  assert.match(PLAN_MODE_INSTRUCTIONS, /PLAN MODE/);
  /* Saying so means the agent stops trying rather than accumulating refusals
     it then has to explain. */
  assert.match(PLAN_MODE_INSTRUCTIONS, /refused, so do not attempt/i);
});

test('the instructions carry every clause that makes a plan checkable', () => {
  /*
   * Each of these exists because of a failure worth naming, and a future edit
   * that quietly drops one should fail here rather than in six months' worth
   * of worse plans.
   */
  assert.match(PLAN_MODE_INSTRUCTIONS, /SURVEY BEFORE YOU PROPOSE/);
  assert.match(PLAN_MODE_INSTRUCTIONS, /NAME THE FILES/);
  assert.match(PLAN_MODE_INSTRUCTIONS, /SAY WHAT YOU ARE UNSURE OF/);
  assert.match(PLAN_MODE_INSTRUCTIONS, /ORDER THE WORK/);
  assert.match(PLAN_MODE_INSTRUCTIONS, /VERIFIED/);
  assert.match(PLAN_MODE_INSTRUCTIONS, /DO NOT PAD/);
});

test('the instructions are versioned here, not assembled at the call site', () => {
  /* One constant, so an improvement to how this product plans is a diff with a
     test rather than a habit each caller has to remember. */
  assert.strictEqual(typeof PLAN_MODE_INSTRUCTIONS, 'string');
  assert.ok(PLAN_MODE_INSTRUCTIONS.length > 600);
});

test('a plan is never self-accepted', () => {
  /* Accepting is the reader's act. An agent that could accept its own plan
     would make the mode decorative. */
  assert.strictEqual(planOutcome('do the thing').accepted, false);
});
