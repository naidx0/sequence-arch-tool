import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { scanRepo } from '../scan.js';
import { buildConceptChart } from '../server/conceptChart.js';
import { buildQueue, subjectlessRefusal } from '../server/lessonState.js';

/**
 * THE REFUSAL HAS TO BE GROUNDED TOO.
 *
 * §10 established that "drawn, not described" is not a rendering gap: the
 * product draws the architecture from the scanned graph whenever the concept is
 * IN the graph, and draws nothing when it is not. So for an out-of-graph subject
 * the deliverable is the REFUSAL — and a refusal that shrugs is the worst of the
 * available outcomes, because the reader cannot tell whether the product failed,
 * is thinking, or has nothing to say.
 *
 * THE REPORTED SHAPE, from reading the refusal the CLI seat check printed:
 *
 *   'Name a file — "teach me jail.ts" — or say the lesson is about this code…'
 *
 * `jail.ts` is hardcoded. It is a real file in THIS repository and in no way a
 * real file in the user's. So the one concrete suggestion the product makes,
 * at the exact moment it is admitting it could not find a subject, is a
 * **guess** — the thing this product's first law forbids, inside the message
 * whose whole job is to be honest about not knowing.
 *
 * WHAT THIS DOES NOT CHANGE: the recogniser. `subjectlessRefusal` stays gated on
 * `TEACH_ASK`, so a bare "what is machine learning" still does not reach it and
 * a pointed repo question ("Why does the retry flag exist?") still keeps today's
 * behaviour. Widening that is a decision about teach mode's input domain and is
 * pinned in `teach-drawn-not-described.test.ts`, not taken here.
 *
 * ── MUTATED, AND THE FIRST ROUND CAUGHT THIS FILE ITSELF ─────────────────
 *
 * Mutations were run against a private copy of `dist` (never the shared one:
 * two lanes build in this tree):
 *
 *   H  the degree filter deleted from `drawableSubjects`
 *        → FIRST RUN: everything stayed GREEN. The fixture had an edge on every
 *          file, so there was no undrawable file for the check to catch and the
 *          drawability assertion could not have failed. That is this test
 *          passing for the wrong reason, and the mutation found it rather than
 *          review. The fixture now has exactly two connected files and three
 *          orphans, and H kills the drawability case alone.
 *   I  the hardcoded `jail.ts` restored
 *        → kills three of the four, which is the original defect being caught by
 *          every assertion that should catch it; the boundary case stays green.
 */

/**
 * A repository with no `jail.ts` — i.e. almost every repository — and, just as
 * importantly, one where MOST files are unconnected.
 *
 * THE FIRST VERSION OF THIS FIXTURE MADE THE DRAWABLE TEST PASS FOR THE WRONG
 * REASON. Every file in it had at least one edge, so deleting the degree filter
 * from `drawableSubjects` changed nothing and the test stayed green — it could
 * not have caught an undrawable suggestion, which is the only thing it exists to
 * catch. Mutation H found that, not review.
 *
 * So: exactly TWO connected files, and three orphans. With the filter, only the
 * connected pair can be suggested. Without it, an orphan reaches the top three
 * and draws a lone box — which is what makes the filter load-bearing and the
 * test able to fail.
 */
function shopfront(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-refusal-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'shopfront', version: '1.0.0', type: 'module' }),
  );
  /* The only edge in the repository. */
  fs.writeFileSync(
    path.join(repo, 'src', 'gateway.js'),
    "import { route } from './router.js';\nexport function handle(r) {\n  return route(r);\n}\n",
  );
  fs.writeFileSync(
    path.join(repo, 'src', 'router.js'),
    'export function route(r) {\n  return r;\n}\n',
  );
  /* Orphans: real files, no edges, nothing to draw around them. */
  for (const name of ['constants.js', 'types.js', 'version.js']) {
    fs.writeFileSync(
      path.join(repo, 'src', name),
      `export const ${name.replace('.js', '').toUpperCase()} = 1;\n`,
    );
  }
  return root;
}

const ASK = 'teach me what machine learning is';

test('THE REPORTED SHAPE: the refusal does not name a file that is not in this repository', async () => {
  const root = shopfront();
  try {
    const graph = await scanRepo(path.join(root, 'repo'), {});
    const text = String(subjectlessRefusal(ASK, buildQueue(graph, ASK), graph));

    assert.ok(text.includes('could not find a subject'), 'still refuses');
    assert.doesNotMatch(
      text,
      /jail\.ts/,
      'the refusal suggested a file from a different repository — that is a guess, in the message whose job is honesty',
    );
    /* Every filename it does mention must be real HERE. */
    const real = new Set(
      graph.nodes.map((n) => String(n.path ?? n.id).split('/').pop() ?? '').filter(Boolean),
    );
    const mentioned = text.match(/[A-Za-z0-9_.-]+\.(?:js|ts|tsx|mjs|py)\b/g) ?? [];
    assert.ok(mentioned.length > 0, `the refusal must name something concrete: ${text}`);
    for (const m of mentioned) {
      assert.ok(real.has(m), `refusal names ${m}, which is not a file in this repository`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('what it names is DRAWABLE — each suggestion yields a chart with at least one edge', async () => {
  /*
   * "Name what is drawable" is the point. A suggestion that produces a lone box
   * would send the reader to a concept that cannot be drawn, which is the same
   * failure one step later — and §10's control is that a drawing of an
   * ARCHITECTURE needs edges, not just nodes.
   */
  const root = shopfront();
  try {
    const graph = await scanRepo(path.join(root, 'repo'), {});
    const text = String(subjectlessRefusal(ASK, buildQueue(graph, ASK), graph));
    const mentioned = [...new Set(text.match(/[A-Za-z0-9_.-]+\.(?:js|ts|tsx|mjs|py)\b/g) ?? [])];
    assert.ok(mentioned.length > 0, 'nothing suggested');
    for (const basename of mentioned) {
      const node = graph.nodes.find(
        (n) => (String(n.path ?? n.id).split('/').pop() ?? '') === basename,
      );
      assert.ok(node !== undefined, `${basename} is not a node`);
      const chart = buildConceptChart(graph, { title: basename, nodeId: node!.id });
      assert.ok(chart !== undefined, `${basename} draws nothing`);
      assert.ok(
        (chart!.links ?? []).length >= 1,
        `${basename} draws a lone box, not an architecture: ${JSON.stringify(chart!.links)}`,
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('with NO graph it suggests no filename at all rather than inventing one', async () => {
  /*
   * The honest fallback. Without a scan there is nothing to enumerate, and the
   * refusal must say so instead of reaching for an example — which is exactly
   * the bug above in its purest form.
   */
  const text = String(subjectlessRefusal(ASK, []));
  assert.ok(text.includes('could not find a subject'), 'still refuses');
  assert.strictEqual(
    (text.match(/[A-Za-z0-9_.-]+\.(?:js|ts|tsx|mjs|py)\b/g) ?? []).length,
    0,
    `with no graph the refusal must name no file: ${text}`,
  );
});

test('the refusal is still gated on the ask being a lesson request', async () => {
  /*
   * THE BOUNDARY, unchanged and re-pinned here because this file touches the
   * same function. A pointed repo question with an empty queue must NOT be
   * handed a refusal written for lessons, and a bare "what is X" must still fall
   * through — see `teach-drawn-not-described.test.ts`.
   */
  const root = shopfront();
  try {
    const graph = await scanRepo(path.join(root, 'repo'), {});
    for (const ask of ['Why does the retry flag exist?', 'what is machine learning']) {
      assert.strictEqual(
        subjectlessRefusal(ask, buildQueue(graph, ask), graph),
        undefined,
        `${ask} must not be treated as a lesson request`,
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
