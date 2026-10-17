import assert from 'node:assert';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanRepo } from '../scan.js';
import { buildConceptChart } from '../server/conceptChart.js';
import { buildQueue, subjectlessRefusal } from '../server/lessonState.js';

/**
 * THE REFUSAL, SCORED BOTH WAYS — because counting firings is not a criterion.
 *
 * `subjectless-lesson.test.ts` case 6 registers: *"the refusal fires on exactly
 * 4 of the 13 bank asks"*, with the note that five or more means false positives
 * and three or fewer means it is not doing its job. **That criterion counts
 * firings and never asks whether they were right**, so a refusal that fired on
 * everything would score the same as one that fired on the right things.
 *
 * The question it never asks — what does this do when the interesting thing is
 * NOT happening? — needs a second bank, and the two together give the rates
 * that actually describe the rule:
 *
 *   IN-REPO   the 13 registered bank asks. Every subject is in this tree,
 *             verified by inspection. A refusal here is a FALSE POSITIVE.
 *   ABSENT    teach-shaped asks about subjects no source repository contains.
 *             A non-refusal here is a MISS.
 *
 * Measured on this repository, 1,101 nodes:
 *
 *   IN-REPO   refused  4/13   → 30.8% false positive
 *   ABSENT    refused  7/7    → 100% recall
 *   precision of a refusal: 7 correct of 11 fired = 63.6%
 *
 * **Recall was never the problem.** The four false positives are
 * `harness-03/05/06/08`, whose subjects are `verifyGate.ts`, `askTools.ts`
 * (twice) and `explain/explain.ts` — all present, all checked against the tree.
 * `buildQueue` matches FILENAMES, so a subject named by concept produces an
 * empty queue, and an empty queue was being reported as "not in this
 * repository".
 *
 * ── WHAT THIS FILE DOES AND DELIBERATELY DOES NOT DO ─────────────────────
 *
 * It does NOT change the gating, so case 6's registered number is untouched and
 * still passes. Fixing the four means changing `buildQueue`, which decides what
 * every lesson TEACHES — a much larger blast radius than a refusal message — and
 * it would drop the registered count from 4 to 0, which case 6 currently reads
 * as the rule being broken. **That registration needs rewriting before the fix,
 * not after, and by whoever owns it.** The two-sided criterion below is what it
 * should be rewritten to.
 *
 * What it DOES is pin both rates, so neither can move quietly: a fifth false
 * positive fails, a lost refusal fails, and a genuine fix to `buildQueue` also
 * fails — loudly, in the file that explains why the number changed.
 *
 * ── THE GUARD CAUGHT THE OBVIOUS FIX ON ITS FIRST OUTING ─────────────────
 *
 * Mutated on a private copy of `dist` (never the shared one: two lanes build in
 * this tree). Mutation N was the repair anyone would reach for first — *stop
 * refusing when the ask's words match a real file* — and it failed **three**
 * cases, including RECALL.
 *
 * That is the finding, not a test detail: `learningLoop.ts` matches "machine
 * learning" and `cycles.ts` matches "the Krebs cycle", so deferring on a word
 * match stops refusing subjects that genuinely are not here. **The naive repair
 * of the false positives reintroduces the silent nothing it was meant to
 * remove**, and it does so invisibly, because the in-repo bank alone would show
 * only the improvement.
 *
 * Whoever fixes `buildQueue` needs both banks in front of them. That is what
 * this file is for.
 *
 * ── THE PAIR, AND WHICH HALF IS ALLOWED TO LOSE ──────────────────────────
 *
 * "Was it refused" is the weaker second half. The one that matters to the
 * product is whether the learner got a DRAWING, so the pair reported on every
 * change to this rule is:
 *
 *   IN-GRAPH DRAW RATE          9/13 = 69.2%   ← protect this
 *   OUT-OF-GRAPH REFUSAL RATE   7/7  = 100%    ← may stay imperfect
 *
 * **The asymmetry is deliberate and it is a product judgement, stated so the
 * next change follows from it rather than the reverse.** A learner asking about
 * something outside this repository and getting a clear "not here, and here is
 * what is" costs little. A learner asking about the ask pipeline and being
 * refused costs the feature. `docs/CANON.md` puts engineers first, and the
 * engineer's ask is the in-graph one.
 *
 * So: **the draw rate may not fall. The refusal rate may fall to 6/7 for a
 * change that raises the draw rate above 12/13, and no further** — one missed
 * refusal is a shrug the reader can recover from; a second means the rule is
 * no longer doing its job.
 *
 * ── AND THE OBVIOUS FIX FAILS THAT TRADE OUTRIGHT ────────────────────────
 *
 * Mutation N — defer the refusal whenever the ask matches a real filename —
 * measured on both banks:
 *
 *   draw rate     9/13 = 69.2%   UNCHANGED
 *   refusal rate  5/7  = 71.4%   down from 7/7
 *
 * **It buys nothing and costs two.** Not one learner gets a lesson they were not
 * getting; two out-of-graph asks stop being told anything. The reason is
 * structural and worth stating plainly: the refusal message is DOWNSTREAM of
 * `buildQueue`, so no edit to it can create a lesson. Only `buildQueue` moves
 * the draw rate.
 *
 * Which is also the warning for the real fix. Widening `buildQueue` to match the
 * ask's words would raise the draw rate — and would put `learningLoop.ts` in the
 * queue for "machine learning", producing a confident lesson about the
 * autonomous loop. **A wrong lesson is worse than a refusal**, so that fix has to
 * be narrower than the one this file's suggestion text can afford to be.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..');

/** The registered bank, verbatim from case 6. Every subject is in this tree. */
const IN_REPO: ReadonlyArray<readonly [string, string]> = [
  ['cs-05', 'Teach me what a jail (path sandbox) is, from the real jail code here.'],
  ['cs-06', 'Teach me how SSE streaming works in this server, step by step.'],
  ['harness-01', 'Teach me how harness engineering works, using this repository as the example — in depth, visually, bit by bit.'],
  ['harness-02', 'Teach me what an evidence ledger is in this codebase and why it exists.'],
  ['harness-03', 'Teach me the verify contract: what it demands and when.'],
  ['harness-04', 'Teach me how the prose-diff salvage works and the failure it answers.'],
  ['harness-05', 'Teach me what the round budget is and how the loop spends it.'],
  ['harness-06', 'Teach me how tool calls are parsed from fenced blocks here.'],
  ['harness-07', 'Teach me the teach contract itself — how this very lesson is being graded.'],
  ['harness-08', 'Teach me what the architecture digest is and how it is budgeted.'],
  ['link-04', 'Fetch https://en.wikipedia.org/wiki/Model_Context_Protocol and teach me what MCP is and where this repo implements one.'],
  ['mix-03', 'Teach me the difference between a benchmark score and product quality, using the bench tools in this repo.'],
  ['mix-06', 'Teach me how this repo tests itself — the shape of one locking test.'],
];

/**
 * Subjects a source repository does not contain.
 *
 * Two are near-misses on purpose: "machine learning" and "the Krebs cycle" both
 * have a generic word ("learning", "cycle") that DOES appear in a filename here,
 * so they exercise the case where a wrong match looks exactly like a right one.
 */
const ABSENT: ReadonlyArray<readonly [string, string]> = [
  ['ml', 'teach me what machine learning is'],
  ['transformer', 'teach me what a transformer is'],
  ['gradient', 'teach me how gradient descent works'],
  ['photosynthesis', 'teach me how photosynthesis works'],
  ['krebs', 'teach me the Krebs cycle'],
  ['aqueduct', 'teach me how Roman aqueducts were built'],
  ['bayes', "teach me Bayes' theorem"],
];

/** The four known false positives, by id. Named so a fifth cannot hide. */
const KNOWN_FALSE_POSITIVES = ['harness-03', 'harness-05', 'harness-06', 'harness-08'];

test('RECALL: every genuinely absent subject is refused — the rule does its job', async () => {
  /*
   * The half that was never in doubt, measured anyway, because "it refuses
   * things" and "it refuses the right things" are different claims and only one
   * of them was registered.
   */
  const graph = await scanRepo(REPO, { cluster: true });
  const missed: string[] = [];
  for (const [id, ask] of ABSENT) {
    if (subjectlessRefusal(ask, buildQueue(graph, ask), graph) === undefined) missed.push(id);
  }
  assert.deepStrictEqual(missed, [], `absent subjects that were NOT refused: ${missed.join(', ')}`);
});

test('PRECISION: the false positives are exactly the four known ones — a fifth fails here', async () => {
  const graph = await scanRepo(REPO, { cluster: true });
  const fired = IN_REPO.filter(
    ([, ask]) => subjectlessRefusal(ask, buildQueue(graph, ask), graph) !== undefined,
  ).map(([id]) => id);
  assert.deepStrictEqual(
    fired,
    KNOWN_FALSE_POSITIVES,
    'the refusal fires on a different set of in-repo asks than the four measured. ' +
      'FEWER means someone improved buildQueue — good, and case 6 in subjectless-lesson.test.ts ' +
      'must be re-registered in the same change, because it reads 4 as correct. ' +
      'MORE means a real regression reaching real lessons.',
  );
});

test('the scorecard: recall 7/7, false positives 4/13, precision 7 of 11', async () => {
  /*
   * The numbers written down as numbers, so a reader does not have to derive
   * them from two other tests. This is the criterion case 6 should have been:
   * one rate is meaningless without the other.
   */
  const graph = await scanRepo(REPO, { cluster: true });
  const refused = (ask: string) =>
    subjectlessRefusal(ask, buildQueue(graph, ask), graph) !== undefined;

  const recall = ABSENT.filter(([, a]) => refused(a)).length;
  const falsePositives = IN_REPO.filter(([, a]) => refused(a)).length;

  assert.strictEqual(recall, ABSENT.length, 'recall');
  assert.strictEqual(falsePositives, KNOWN_FALSE_POSITIVES.length, 'false positives');
  const precision = recall / (recall + falsePositives);
  assert.ok(
    precision > 0.6 && precision < 0.7,
    `precision moved off 63.6% (now ${(precision * 100).toFixed(1)}%) — update this file and the ` +
      'registration together, never one alone',
  );
});

test('THE NUMBER TO PROTECT: 9 of 13 in-graph asks put a real drawing on the canvas', async () => {
  /*
   * Not "was it refused" — did the learner get a DRAWING. A chart with at least
   * one edge, because §10 registered that a drawing of an ARCHITECTURE needs
   * edges and a lone box does not qualify.
   *
   * This is the half that may not fall. If a change raises it, say so with the
   * refusal rate beside it; if a change lowers it, the change is wrong whatever
   * it did to the other number.
   */
  const graph = await scanRepo(REPO, { cluster: true });
  const noDraw: string[] = [];
  for (const [id, ask] of IN_REPO) {
    const queue = buildQueue(graph, ask);
    const chart = queue.length === 0 ? undefined : buildConceptChart(graph, queue[0]);
    if (chart === undefined || (chart.links ?? []).length === 0) noDraw.push(id);
  }
  assert.deepStrictEqual(
    noDraw,
    KNOWN_FALSE_POSITIVES,
    'the set of in-graph asks that draw NOTHING has moved. Fewer is the goal and must be ' +
      'reported with the out-of-graph refusal rate beside it; more is a regression in the half ' +
      'this rule exists to protect.',
  );
  assert.strictEqual(
    IN_REPO.length - noDraw.length,
    9,
    'the in-graph draw rate is 9/13 — update this and the header together, never one alone',
  );
});

test('a word-matched suggestion on an ABSENT subject still shows the word it matched', async () => {
  /*
   * The measured cost of matching the ask's words: 2 of the 7 absent subjects
   * get a filename suggestion — `learningLoop.ts` for machine learning,
   * `cycles.ts` for the Krebs cycle — because one generic word hit. Neither is
   * about the subject.
   *
   * The defence is that the refusal states the word, so the reader sees the
   * match is generic. That defence is the thing tested here: without it these
   * two are a confident wrong answer, which is worse than no answer at all.
   */
  const graph = await scanRepo(REPO, { cluster: true });
  for (const [id, ask] of [ABSENT[0]!, ABSENT[4]!]) {
    const text = String(subjectlessRefusal(ask, buildQueue(graph, ask), graph));
    const claimed = text.match(/have "([a-z0-9]+)" in their name/i)?.[1];
    if (claimed === undefined) continue; /* fell back to most-connected: also fine */
    const named = text.match(/[A-Za-z0-9_.-]+\.(?:ts|tsx|js|mjs)\b/g) ?? [];
    for (const f of named) {
      assert.ok(
        f.toLowerCase().includes(claimed.toLowerCase()),
        `${id}: claimed "${claimed}" but named ${f}`,
      );
    }
  }
});
