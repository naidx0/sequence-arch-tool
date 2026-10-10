import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildQueue } from '../server/lessonState.js';
import { scanRepo } from '../scan.js';

/**
 * A LEARNER TYPES "the bigram counts", NOT "bigram_counts.py".
 *
 * Measured at the seat: the first phrasing produced an empty queue on a graph
 * containing `file:bigram_counts.py` — no concept, no derived chart, no lesson
 * — while the second produced the whole lesson. The underscore was the entire
 * difference. Everything downstream already worked and was gated behind an ask
 * that spelled a filename the way a scanner does.
 *
 * The corpus is `tools/bench/queue-paraphrases.json` so the same rows can be
 * measured outside the test run.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..', '..', '..');
const spec = JSON.parse(
  fs.readFileSync(path.join(REPO, 'tools/bench/queue-paraphrases.json'), 'utf8'),
) as {
  repo: string;
  rows: { control: string; paraphrases: string[] }[];
  names_nothing: string[];
};

const seedOf = (q: { nodeId?: string }[]): string => q[0]?.nodeId ?? '(none)';

test('natural phrasing selects the same concept as the filename spelling', async () => {
  const graph = await scanRepo(path.join(REPO, spec.repo), {});
  let matched = 0;
  let total = 0;
  const misses: string[] = [];
  for (const row of spec.rows) {
    const want = seedOf(buildQueue(graph, row.control));
    assert.notStrictEqual(want, '(none)', `the control itself must work: ${row.control}`);
    for (const paraphrase of row.paraphrases) {
      total += 1;
      if (seedOf(buildQueue(graph, paraphrase)) === want) matched += 1;
      else misses.push(paraphrase);
    }
  }
  /*
   * 14 of 15 measured, and the floor is set at 13 rather than at what was
   * measured: this is a corpus of English, and pinning the exact number would
   * make an added row a failing test rather than new information.
   *
   * The one miss is "explain the neural net bigram" — a SYNONYM for `nn`, not a
   * spelling of it. Matching it would mean deciding that "neural net" means
   * `nn`, which is the kind of guess `names_nothing` exists to forbid.
   */
  assert.ok(
    matched >= 13,
    `only ${matched}/${total} paraphrases found their concept; missed: ${misses.join(' | ')}`,
  );
});

test('an ask that names nothing in the graph still gets NOTHING', async () => {
  /*
   * THE HALF THAT MATTERS. A matcher that finds more concepts by guessing is
   * worse than the substring test it replaced: an invented concept becomes a
   * confident derived chart about a file the learner never asked about, which
   * is exactly what the no-node refusal exists to prevent. This assertion is
   * disqualifying on its own — no recall number buys it off.
   */
  const graph = await scanRepo(path.join(REPO, spec.repo), {});
  for (const ask of spec.names_nothing) {
    assert.deepStrictEqual(
      buildQueue(graph, ask),
      [],
      `"${ask}" names nothing in this repository and must produce no queue`,
    );
  }
});

test('every token must match — one shared word is not a naming', async () => {
  /* The single rule doing both jobs: "the bigram counts" carries `bigram` AND
     `count`; "the counts" carries one of the two. */
  const graph = await scanRepo(path.join(REPO, spec.repo), {});
  assert.ok(buildQueue(graph, 'teach me how the bigram counts work').length > 0);
  assert.deepStrictEqual(buildQueue(graph, 'teach me the counts'), []);
});
