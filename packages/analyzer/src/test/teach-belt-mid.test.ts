import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHART_BULLET_EVERY_CONCEPT_NEEDLE,
  CHART_BULLET_PURPOSE_NEEDLE,
  TEACH_MODE_INSTRUCTIONS,
  TEACH_MODE_INSTRUCTIONS_MID,
  TEACH_MODE_INSTRUCTIONS_SHORT,
} from '../server/askPipeline.js';

/**
 * THE MID BELT, and the one property that makes the arm interpretable: it is
 * the SHORT belt plus both chart bullets and nothing else.
 *
 * The bullets are lifted from the live full belt rather than copied, because
 * "verbatim" written by hand stays verbatim only until someone edits one copy.
 * These tests are the guard for that — the mid belt degrades silently by design
 * (it is used only when a caller asks for it, today only the bench) rather than
 * throwing on a live request path, so the gate has to be what catches drift.
 */
test('the mid belt carries BOTH chart bullets, byte-identical to the full belt', () => {
  const mid = TEACH_MODE_INSTRUCTIONS_MID();
  for (const needle of [CHART_BULLET_PURPOSE_NEEDLE, CHART_BULLET_EVERY_CONCEPT_NEEDLE]) {
    const fromFull = TEACH_MODE_INSTRUCTIONS.split('\n').find((l) => l.includes(needle));
    assert.ok(fromFull, `the full belt no longer contains ${needle} — the arm's premise is gone`);
    assert.ok(mid.includes(fromFull), `the mid belt must carry ${needle} verbatim`);
  }
});

test('the mid belt is SHORT plus the bullets — not a third contract', () => {
  const mid = TEACH_MODE_INSTRUCTIONS_MID();
  /* Every rule of the short belt survives, so the only difference measured by
     the arm is the two bullets. */
  for (const rule of [
    'ONE concept this turn',
    'END with one short check-in question',
    'Ground every claim in this repository',
  ]) {
    assert.ok(mid.includes(rule), `the short belt's "${rule}" must survive`);
  }
  assert.ok(
    mid.length > TEACH_MODE_INSTRUCTIONS_SHORT.length,
    'mid is longer than short — it adds the bullets',
  );
  assert.ok(
    mid.length < TEACH_MODE_INSTRUCTIONS.length / 2,
    'and it is nowhere near the full belt, or it is not a mid-length arm',
  );
});

/*
 * THE LADDER TESTS WERE REMOVED WITH THE LADDER.
 *
 * A one-complaint-at-a-time bounce lived here and came out after two runs a
 * side refuted it against its own registered condition -- stubs 22-24 -> 31-34,
 * median words halved (docs/research/mid-belt-arm-result.md). Deleting the
 * tests with the behaviour is correct: a test for code that is gone is a test
 * that passes forever and describes nothing. The measurement is the record.
 */

/* ═══ the length control ══════════════════════════════════════════════════ */

/**
 * The padded belt exists to separate the two explanations the arm result left
 * standing: the cause is inside the ~6,000 characters the mid belt drops, or it
 * is length itself. It moves ONLY the character count, so its whole validity
 * rests on the padding being unactionable — one imperative sentence in there and
 * the arm is measuring content again, which is the thing it exists to rule out.
 */
test('the padded belt is the mid belt at the FULL belt length, exactly', async () => {
  const { TEACH_MODE_INSTRUCTIONS_PAD } = await import('../server/askPipeline.js');
  const pad = TEACH_MODE_INSTRUCTIONS_PAD();
  assert.strictEqual(
    pad.length,
    TEACH_MODE_INSTRUCTIONS.length,
    'the control differs from the full belt in nothing but content',
  );
  assert.ok(
    pad.startsWith(TEACH_MODE_INSTRUCTIONS_MID()),
    'and it is the mid belt with text after it, not a third contract',
  );
});

test('the padding is INERT — no rule, no tool, nothing to obey', async () => {
  const { TEACH_MODE_INSTRUCTIONS_PAD } = await import('../server/askPipeline.js');
  const padding = TEACH_MODE_INSTRUCTIONS_PAD().slice(TEACH_MODE_INSTRUCTIONS_MID().length);
  assert.ok(padding.length > 5_000, 'there is real bulk to test with');
  /* A tool name would be an instruction by implication: a model that sees
     `propose_chart` in the prompt has been told something, whatever the
     surrounding sentence says. */
  assert.doesNotMatch(padding, /propose_|canvas\.|read_file|edit_file|run_command/);
  /* A bulleted line is this contract's own grammar for a rule. */
  assert.doesNotMatch(padding, /^- /m);
  /* And nothing from the domain, so it cannot read as background material about
     the lesson either. */
  assert.doesNotMatch(padding, /chart|diagram|concept|learner|repository|visual/i);
});
