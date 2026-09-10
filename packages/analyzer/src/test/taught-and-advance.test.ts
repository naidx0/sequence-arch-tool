import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { advanceLesson, taughtThisTurn } from '../server/lessonState.js';
import type { LessonShape } from '../server/lessonState.js';

/**
 * THE ADVANCE RULE — a turn that taught advances the queue, whether or not it
 * asked.
 *
 * Ruled 2026-09-06 off the ceiling arms. Over the turns past a lesson's scripted
 * replies, concepts given and charts drawn were IDENTICAL to the first turns — 18
 * of 26 each — while the concept repeated 17 and 18 times of 18 and the queue
 * never moved from 6. The coupling to the check-in stalled the syllabus: no
 * check-in, no advance, so the same concept was re-taught and the same picture
 * redrawn while every surface said the lesson was working.
 */
const ANALYZER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const lesson = (taught: string[], queue: string[]): LessonShape => ({
  version: 1,
  sessionId: 's1',
  subject: { ask: 'teach me', nodeIds: [] },
  queue: queue.map((t) => ({ title: t })),
  taught: taught.map((t, i) => ({ title: t, turn: i })),
});

/* ── the ruling, as three cases ──────────────────────────────────────────── */

test('a turn that TAUGHT and did NOT ask still advances the queue', () => {
  /*
   * THE RULING ITSELF. This is the case that was false before, and it is the
   * whole stall: a lesson drew its picture, said something substantial, failed to
   * close with a check-in, and paid for it by re-teaching the same concept for
   * the rest of the conversation.
   */
  assert.strictEqual(taughtThisTurn({ visual: true, endsWithCheck: false }), true);
  const after = advanceLesson(lesson(['a'], ['b', 'c']), {
    passed: taughtThisTurn({ visual: true, endsWithCheck: false }),
    turn: 1,
  });
  assert.deepStrictEqual(after.queue.map((c) => c.title), ['c'], 'b was consumed');
  assert.deepStrictEqual(after.taught.map((c) => c.title), ['a', 'b']);
});

test('a stub does NOT advance — nothing was taught', () => {
  /*
   * The half that keeps the ruling from becoming "always advance". A turn with no
   * visual taught nothing, and advancing past a concept nobody was shown would
   * lose it silently — worse than repeating it.
   */
  assert.strictEqual(taughtThisTurn({ visual: false, endsWithCheck: false }), false);
  const before = lesson(['a'], ['b', 'c']);
  const after = advanceLesson(before, { passed: taughtThisTurn({ visual: false }), turn: 1 });
  assert.deepStrictEqual(after.queue.map((c) => c.title), ['b', 'c'], 'the queue is untouched');
  assert.deepStrictEqual(after, before, 'and the lesson is returned unchanged');
});

test('a refused turn does NOT advance — a refusal is not a lesson', () => {
  /*
   * A subject-less request is refused before any provider call, so it has no
   * visual and no concept. It must not consume one: the learner was told what was
   * missing, not taught anything.
   */
  assert.strictEqual(taughtThisTurn({ visual: false, endsWithCheck: false }), false);
  const before = lesson([], ['b']);
  assert.deepStrictEqual(advanceLesson(before, { passed: taughtThisTurn({ visual: false }), turn: 0 }), before);
});

test('a turn that taught AND asked still advances — the ruling widens, it does not swap', () => {
  assert.strictEqual(taughtThisTurn({ visual: true, endsWithCheck: true }), true);
});

/* ── one definition, two callers ─────────────────────────────────────────── */

test('the product and the bench share the predicate — neither recomputes it', () => {
  /*
   * These two drifted once already: the bench advanced on a trailing question
   * mark while the product advanced on an honest check, so a turn closing "would
   * you like me to show the diagram?" consumed a concept in one and not the
   * other. A rule that lives in two places is one rule until it is measured.
   */
  const turn = fs.readFileSync(path.join(ANALYZER, 'src', 'server', 'teachTurn.ts'), 'utf8');
  assert.match(turn, /taughtThisTurn\(\{/, 'the product calls it');
  assert.ok(
    !/const taught =\s*\n?\s*\(chartsThisTurn > 0/.test(turn),
    'and no longer computes it inline',
  );
  const bench = fs.readFileSync(path.join(ANALYZER, '..', '..', 'tools', 'bench', 'teach-eval.mjs'), 'utf8');
  assert.match(bench, /taughtThisTurn\(\{/, 'the bench calls it');
  assert.ok(
    !/graded\.visual === true && graded\.endsWithCheck === true/.test(bench),
    'and no longer has its own copy',
  );
});

/* ── the check-in reason, one per turn ───────────────────────────────────── */

test('the check-in gate names ONE reason, in the order the code tests them', () => {
  /*
   * The instrument half. The first version wrote a reason only when every OTHER
   * condition had passed, so a turn that was at cap AND had no derived chart
   * recorded nothing and 27 of 52 turns a run stayed silent. The first condition
   * that closes is the reason, because that is the one the turn actually failed.
   */
  const src = fs.readFileSync(path.join(ANALYZER, 'src', 'server', 'askPipeline.ts'), 'utf8');
  const gate = src.slice(src.indexOf('const checkInGate'), src.indexOf('if (checkInGate !== undefined)'));
  const order = ['stub', 'at-cap', 'own-check-in', 'no-chart-derived-this-turn'];
  let at = -1;
  for (const reason of order) {
    const i = gate.indexOf(`'${reason}'`);
    assert.ok(i > at, `${reason} must be tested after the one before it`);
    at = i;
  }
  assert.ok(
    gate.includes('if (input.teach !== true) return undefined'),
    'a turn that is not a teach turn has no gate to close and no reason to report',
  );
});
