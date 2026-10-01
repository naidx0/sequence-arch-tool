import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { scanRepo } from '../scan.js';
import { buildConceptChart } from '../server/conceptChart.js';
import { buildQueue, subjectlessRefusal } from '../server/lessonState.js';

/**
 * "DRAWN, NOT DESCRIBED" — measured against the owner's own example.
 *
 * The brief: *"A learner asks 'what is machine learning' and gets a VISUALISED
 * EXPLANATION ON THE AI CANVAS — the architecture drawn, not described."*
 *
 * What reaches the canvas is `chart:proposal`. Two things can emit one: the
 * MODEL calling `propose_chart`, and the PRODUCT deriving a chart from the
 * scanned graph via `buildConceptChart`. §8 of
 * `docs/research/teach-mode-driven-end-to-end.md` measured the split over 296
 * teach turns — the model called `propose_chart` on **5**, the product supplied
 * ~97% — so the product's derivation is what decides whether anything is drawn,
 * and it is deterministic and testable with no model at all.
 *
 * ── WHAT THIS PINS ───────────────────────────────────────────────────────
 *
 * Run against the real repository (1,101 nodes, 2,922 edges) before it was
 * written, so these are recorded numbers rather than a guess:
 *
 *   "what is machine learning"              queue 0, no refusal, NO chart
 *   "teach me what machine learning is"     queue 0, REFUSED,    NO chart
 *   "I want to learn about machine learning" queue 0, REFUSED,   NO chart
 *   "teach me the ask pipeline in this repo" queue 6, no refusal, data-flow
 *                                            chart, 5 items, 4 links
 *
 * So the drawing machinery WORKS: a concept the scan can find is drawn from the
 * graph, with real nodes and real edges. **The gap is the input domain, not the
 * drawing.** "What is machine learning" has nothing to draw because there is no
 * machine learning in the scanned graph — the architecture the brief asks to see
 * drawn does not exist in the repository being scanned.
 *
 * ── THE PART THAT IS A DECISION, NOT A BUG ───────────────────────────────
 *
 * The bare question form is not recognised as a lesson request at all, so it
 * does not even get the honest refusal that "I want to learn about X" now gets:
 * it falls through to an ordinary repo ask and answers in prose about a
 * repository containing no such subject.
 *
 * That is deliberate and this test does NOT change it. `subjectlessRefusal` is
 * gated on `TEACH_ASK` precisely so that a pointed question with an empty queue
 * — "Why does the retry flag exist?" — keeps today's behaviour instead of being
 * handed a refusal written for lessons. Widening the recogniser to bare
 * questions would silently re-open that, which is why the boundary is pinned
 * here rather than moved. Resolving it is item (c) in this lane's brief:
 * BLOCKED ON A DECISION, report it, do not resolve it alone.
 *
 * ── EVERY CASE HERE HAS BEEN SEEN TO FAIL ────────────────────────────────
 *
 * Two of these assert that something does NOT happen — draws nothing, is not
 * refused — which is the shape that passes on a check reading the wrong thing.
 * So the compiled output was mutated in a private copy of `dist` (never the
 * shared one: two lanes build in this tree), and each mutation had to kill its
 * own case and leave the others green:
 *
 *   E  `buildConceptChart` returns a chart even with no concept
 *        → kills the owner's-example case.
 *   F  `TEACH_ASK` widened to match a bare "what is X"
 *        → kills the owner's-example case at its refusal line, which is exactly
 *          the boundary this file exists to pin.
 *   G  the derived chart keeps its nodes but loses its links
 *        → kills the CONTROL only. Boxes with no edges still satisfy "a chart
 *          was drawn"; they do not satisfy "the ARCHITECTURE was drawn", and
 *          without this mutation nothing proved the difference was checked.
 */

/** A real repository with no machine learning in it — a small web service. */
function serviceRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-drawn-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'shopfront', version: '1.0.0', type: 'module' }),
  );
  fs.writeFileSync(
    path.join(repo, 'src', 'gateway.js'),
    "import { route } from './router.js';\nexport function handle(req) {\n  return route(req);\n}\n",
  );
  fs.writeFileSync(
    path.join(repo, 'src', 'router.js'),
    "import { store } from './store.js';\nexport function route(r) {\n  return store(r);\n}\n",
  );
  fs.writeFileSync(path.join(repo, 'src', 'store.js'), 'export function store(r) {\n  return r;\n}\n');
  return root;
}

test('THE OWNER’S EXAMPLE: "what is machine learning" draws NOTHING on this repository', async () => {
  const root = serviceRepo();
  try {
    const graph = await scanRepo(path.join(root, 'repo'), {});
    const ask = 'what is machine learning';
    const queue = buildQueue(graph, ask);

    assert.strictEqual(queue.length, 0, 'nothing in the scan matches the ask');
    assert.strictEqual(
      buildConceptChart(graph, queue[0]),
      undefined,
      'with no concept there is no derived chart, so the canvas receives nothing to draw',
    );
    /*
     * AND IT IS NOT REFUSED EITHER — the bare question form is not a recognised
     * lesson request, so the ask falls through to an ordinary repo answer.
     * Pinned, not fixed: see the header. If this line ever goes red, someone has
     * widened `TEACH_ASK` to bare questions, and the "Why does the retry flag
     * exist?" case needs re-checking in the same change.
     */
    assert.strictEqual(
      subjectlessRefusal(ask, queue),
      undefined,
      'the bare question form is deliberately not treated as a lesson request',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the same subject asked AS A LESSON is refused honestly rather than answered in prose', async () => {
  const root = serviceRepo();
  try {
    const graph = await scanRepo(path.join(root, 'repo'), {});
    for (const ask of [
      'teach me what machine learning is',
      'I want to learn about machine learning',
      'walk me through machine learning',
    ]) {
      const queue = buildQueue(graph, ask);
      assert.strictEqual(queue.length, 0, `${ask}: nothing to teach`);
      assert.match(
        String(subjectlessRefusal(ask, queue)),
        /could not find a subject for this lesson in the scanned repository/,
        `${ask}: must be refused, not answered from the digest`,
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('THE CONTROL: a subject that IS in the scan is DRAWN — real nodes, real edges', async () => {
  /*
   * Without this the tests above would equally support "the product cannot
   * draw", which is a different defect with a different fix. The drawing
   * machinery works; what it needs is a subject the scan can find.
   */
  const root = serviceRepo();
  try {
    const graph = await scanRepo(path.join(root, 'repo'), {});
    const ask = 'teach me the router in this repo';
    const queue = buildQueue(graph, ask);
    assert.ok(queue.length > 0, 'a subject in the scan produces a queue');

    const chart = buildConceptChart(graph, queue[0]);
    assert.ok(chart !== undefined, 'a concept in the graph is drawn');
    assert.ok(chart!.items.length >= 2, `a drawing needs nodes: ${JSON.stringify(chart!.items)}`);
    assert.ok(
      (chart!.links ?? []).length >= 1,
      `a drawing of an ARCHITECTURE needs edges, not just a list of boxes: ${JSON.stringify(chart!.links)}`,
    );
    /* Every node drawn is a real file from the scan, not a label invented for
       the picture — "grounded, not guessed" applies to the canvas too. */
    const realLabels = new Set(
      graph.nodes.map((n) => String(n.path ?? n.id).split('/').pop() ?? '').filter(Boolean),
    );
    for (const item of chart!.items) {
      const base = String(item.label).split('/').pop() ?? '';
      assert.ok(realLabels.has(base), `drawn node ${item.label} is not a real file in the scan`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
