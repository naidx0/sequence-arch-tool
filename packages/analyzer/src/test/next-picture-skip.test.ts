import assert from 'node:assert/strict';
import test from 'node:test';

import type { ArchGraph } from '@sequence/schema';
import { attemptNextPictureCheckIn, deriveNextPictureCheckIn } from '../server/conceptChart.js';

/**
 * WHY NO QUESTION WAS ASKED — one planted case per reason.
 *
 * Nine turns across two card runs drew a chart, wrote substantive prose, closed
 * without their own check-in, and carried no derived question. Nothing recorded
 * which gate closed, so the bucket was guessed at twice and both guesses were
 * wrong: the queue was full in all nine, and the mixed-direction reading was
 * measured against the chart the TURN drew, when this derivation builds its own
 * for the NEXT concept and never looks at that one.
 *
 * A decision nobody records is a decision nobody can check.
 */
const file = (id: string, label: string) => ({ id, label, kind: 'file', path: label }) as never;
const edge = (srcId: string, dstId: string) =>
  ({ id: `${srcId}->${dstId}`, srcId, dstId, kind: 'import', confidence: 1, origin: 'deterministic' }) as never;

/**
 * A graph with `dependents` files importing `focus.ts`, plus `spares` unrelated
 * `.ts` files. `outbound` makes focus.ts import others instead — a focus with
 * edges but nothing pointing AT it, which is the only way to reach reason 3: a
 * node with no edges at all draws no chart, and stops one gate earlier.
 */
function graphWith(dependents: number, spares: number, outbound = 0): Pick<ArchGraph, 'nodes' | 'edges'> {
  const nodes = [file('file:focus.ts', 'focus.ts')];
  const edges: unknown[] = [];
  for (let i = 0; i < dependents; i += 1) {
    nodes.push(file(`file:dep${i}.ts`, `dep${i}.ts`));
    edges.push(edge(`file:dep${i}.ts`, 'file:focus.ts'));
  }
  for (let i = 0; i < outbound; i += 1) {
    nodes.push(file(`file:out${i}.ts`, `out${i}.ts`));
    edges.push(edge('file:focus.ts', `file:out${i}.ts`));
  }
  for (let i = 0; i < spares; i += 1) nodes.push(file(`file:spare${i}.ts`, `spare${i}.ts`));
  return { nodes, edges } as unknown as Pick<ArchGraph, 'nodes' | 'edges'>;
}

const NEXT = { title: 'focus.ts', nodeId: 'file:focus.ts' };

test('reason 1: no next concept — the lesson has nothing queued to ask about', () => {
  assert.deepStrictEqual(attemptNextPictureCheckIn(graphWith(2, 3), undefined), {
    skipped: 'no-next-concept',
  });
});

test('reason 2: the next concept draws nothing — no chart, so no focus to ask about', () => {
  /* A node the graph does not contain cannot be charted. */
  const a = attemptNextPictureCheckIn(graphWith(2, 3), { title: 'absent.ts', nodeId: 'file:absent.ts' });
  assert.strictEqual(a.skipped, 'next-concept-draws-nothing');
  assert.strictEqual(a.prediction, undefined);
});

test('reason 3: NOTHING DEPENDS on the next concept — the answer would be "none of them"', () => {
  /*
   * The gate the mixed-direction reading was groping at. `dependents` are the
   * items whose arrow points AT the focus; with none, a question whose true
   * answer is "nothing" teaches the wrong lesson about the graph.
   */
  const a = attemptNextPictureCheckIn(graphWith(0, 4, 2), NEXT);
  assert.strictEqual(a.skipped, 'nothing-depends-on-the-next-concept');
  /* And a focus with NO edges at all stops one gate earlier, which is a
     different fault with a different name. */
  assert.strictEqual(attemptNextPictureCheckIn(graphWith(0, 4, 0), NEXT).skipped, 'next-concept-draws-nothing');
});

test('reason 4: too few distractors — a two-option question is not a prediction', () => {
  /*
   * The pool is same-extension files NOT already in the chart. With one spare
   * there is nothing to choose between, and a question with one wrong answer
   * measures nothing.
   */
  const a = attemptNextPictureCheckIn(graphWith(1, 1), NEXT);
  assert.strictEqual(a.skipped, 'too-few-distractors');
});

test('and when it succeeds there is no reason at all — the two cannot both be present', () => {
  const a = attemptNextPictureCheckIn(graphWith(2, 4), NEXT);
  assert.ok(a.prediction !== undefined, 'a question was produced');
  assert.strictEqual(a.skipped, undefined, 'so no gate is named');
  assert.match(a.prediction.question, /Before I draw it/);
  assert.match(a.prediction.arrow, /→ focus\.ts$/);
});

test('the wrapper and the attempt cannot disagree — one body, two views', () => {
  /*
   * `deriveNextPictureCheckIn` is the thin wrapper. If the two were separate
   * implementations the reason could explain an outcome that did not happen,
   * which is worse than no reason.
   */
  for (const g of [graphWith(0, 4, 2), graphWith(1, 1), graphWith(2, 4)]) {
    const attempt = attemptNextPictureCheckIn(g, NEXT);
    const direct = deriveNextPictureCheckIn(g, NEXT);
    assert.deepStrictEqual(direct, attempt.prediction);
    assert.strictEqual(direct === undefined, attempt.skipped !== undefined);
  }
});
