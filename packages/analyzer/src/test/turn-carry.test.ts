import assert from 'node:assert/strict';
import test from 'node:test';

import { EMPTY_CARRY, extendCarry, renderCarry } from '../server/turnCarry.js';

/**
 * WHAT ONE TURN HANDS THE NEXT — the six planted cases from
 * `docs/research/design-what-the-model-receives.md`.
 *
 * Measured cause: 5.4 provider calls a turn, each carrying ~5,300 tokens of
 * which 5,330 are the digest and the belt rebuilt unchanged, and a turn that
 * read `brief.ts` hands the next one the NAME `brief.ts` and none of its text.
 */
const EXCERPT = 'export function renderBriefFromGraph(graph) { return graph.nodes.map(n => n.label); }';

/* ── case 1 ──────────────────────────────────────────────────────────────── */

test('case 1: a file read on turn 1 is present on turn 2, with its text', () => {
  /* The case Max's report is about: the next turn should not have to re-read. */
  const c = extendCarry(EMPTY_CARRY, 1, { filesRead: [{ path: 'src/brief.ts', excerpt: EXCERPT }] });
  const block = renderCarry(c).join('\n');
  assert.match(block, /Read src\/brief\.ts \(turn 1\)/);
  assert.match(block, /renderBriefFromGraph/, 'the TEXT is carried, not just the name');
});

/* ── case 2 ──────────────────────────────────────────────────────────────── */

test('case 2: the chart drawn on turn 1 is named on turn 2, as structure', () => {
  /*
   * A proposal TITLE is not a chart. "why that arrow" can only be answered by a
   * turn that knows the focus and the neighbours.
   */
  const c = extendCarry(EMPTY_CARRY, 1, {
    chart: { title: 'brief.ts', focus: 'brief.ts', neighbours: ['cli.ts', 'repoServer.ts'] },
  });
  const block = renderCarry(c).join('\n');
  assert.match(block, /Drew "brief\.ts" \(turn 1\): brief\.ts with cli\.ts, repoServer\.ts/);
});

/* ── case 3 ──────────────────────────────────────────────────────────────── */

test('case 3: a concept already taught is carried with the turn’s own first line', () => {
  const c = extendCarry(EMPTY_CARRY, 1, {
    concept: { title: 'brief.ts', text: 'The brief renders the scanned graph into markdown. It also formats paths.' },
  });
  const block = renderCarry(c).join('\n');
  assert.match(block, /Taught brief\.ts \(turn 1\): The brief renders the scanned graph into markdown\./);
  assert.doesNotMatch(block, /It also formats paths/, 'one line, not the whole turn');
});

test('teaching the same concept twice updates it rather than listing it twice', () => {
  let c = extendCarry(EMPTY_CARRY, 1, { concept: { title: 'brief.ts', text: 'First pass. More.' } });
  c = extendCarry(c, 2, { concept: { title: 'brief.ts', text: 'Second pass, in more detail. More.' } });
  assert.strictEqual(c.concepts.length, 1);
  assert.strictEqual(c.concepts[0]!.turn, 2);
});

/* ── case 4 ──────────────────────────────────────────────────────────────── */

test('case 4: the block is bounded — excerpts degrade to names before entries are dropped', () => {
  /*
   * A twenty-turn lesson must not grow the prompt without limit, and a name is
   * enough to say "already read" and stop a re-read, which is most of the value.
   * So the text goes first and the name survives.
   */
  let c = EMPTY_CARRY;
  for (let i = 1; i <= 12; i += 1) c = extendCarry(c, i, { filesRead: [{ path: `src/f${i}.ts`, excerpt: EXCERPT }] });
  assert.ok(c.files.length <= 8, `bounded, got ${c.files.length}`);
  assert.ok(c.dropped > 0, 'and it says how many it dropped');
  const withText = c.files.filter((f) => f.excerpt !== undefined);
  assert.ok(withText.length <= 3, 'only the newest keep their text');
  assert.ok(c.files.some((f) => f.excerpt === undefined), 'older ones kept their names');
  const block = renderCarry(c).join('\n');
  assert.match(block, /older item/, 'dropping is reported, not silent');
  assert.match(block, /do not re-read to confirm it exists/, 'a degraded entry still stops a re-read');
});

/* ── case 5 ──────────────────────────────────────────────────────────────── */

test('case 5: nothing carried is invented — a turn with no findings adds nothing', () => {
  /*
   * A carry is prompt material, and prompt material nobody produced is the same
   * fabrication as an invented edge. A refused or errored turn must leave no
   * trace at all.
   */
  const before = extendCarry(EMPTY_CARRY, 1, { filesRead: [{ path: 'src/a.ts', excerpt: EXCERPT }] });
  const after = extendCarry(before, 2, {});
  assert.deepStrictEqual(after, before, 'a turn that found nothing changes nothing');
  /* And a concept with no text carries no note rather than a written-up one. */
  const c = extendCarry(EMPTY_CARRY, 1, { concept: { title: 'x.ts' } });
  assert.strictEqual(c.concepts[0]!.note, undefined);
  assert.match(renderCarry(c).join('\n'), /Taught x\.ts \(turn 1\)$/m);
});

/* ── case 6 ──────────────────────────────────────────────────────────────── */

test('case 6: a fresh conversation carries nothing, and renders nothing', () => {
  /*
   * A header promising continuity with nothing under it invites the model to
   * invent the continuity, so an empty carry renders as no lines at all.
   */
  assert.deepStrictEqual(renderCarry(EMPTY_CARRY), []);
  assert.deepStrictEqual(renderCarry(undefined), []);
});

/* ── the size claim the kill number rests on ─────────────────────────────── */

test('the block is small enough to be worth sending — a full carry under 500 tokens', () => {
  /*
   * The kill number is about REPEATED content falling below 40% of the turn. A
   * carry that itself cost 2,000 tokens would trade one re-send for another, so
   * its own size is asserted here rather than assumed.
   *
   * THE BOUND WAS 300 TOKENS AND THAT NUMBER WAS A GUESS, written before
   * anything was measured. A full six-file carry is 1,354 chars — about 339
   * tokens, or 6.3% of the 5,373-token turn it rides in. The design is right and
   * the assertion was wrong, so the bound is now 500 with the measurement under
   * it, rather than the caps being cut to fit a figure nobody had checked.
   */
  let c = EMPTY_CARRY;
  for (let i = 1; i <= 6; i += 1) {
    c = extendCarry(c, i, {
      filesRead: [{ path: `packages/analyzer/src/server/file${i}.ts`, excerpt: EXCERPT }],
      concept: { title: `file${i}.ts`, text: 'A sentence about it that is long enough to be a real note.' },
    });
  }
  c = extendCarry(c, 7, { chart: { title: 'f.ts', focus: 'f.ts', neighbours: ['a.ts', 'b.ts', 'c.ts'] } });
  const chars = renderCarry(c).join('\n').length;
  assert.ok(chars < 2000, `a full carry is ~${Math.ceil(chars / 4)} tokens; expected under 500`);
  /* And the ratio that actually matters: a rounding error beside the turn. */
  assert.ok(Math.ceil(chars / 4) / 5373 < 0.1, 'the carry is under a tenth of the turn it rides in');
});
