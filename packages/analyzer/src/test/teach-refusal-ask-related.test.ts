import assert from 'node:assert';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanRepo } from '../scan.js';
import { buildQueue, subjectlessRefusal } from '../server/lessonState.js';

/**
 * THE REFUSAL POINTED AT THE WRONG FILES — measured on its own registered bank.
 *
 * `subjectless-lesson.test.ts` case 6 registers a KILL NUMBER: the refusal fires
 * on exactly 4 of the 13 bank asks, and the note says "five or more is a false
 * positive reaching real lessons". **Those four already are.** Checked against
 * the tree:
 *
 *   harness-03  "the verify contract"          → packages/analyzer/src/harness/verifyGate.ts
 *   harness-05  "the round budget"             → askTools.ts (MAX_ASK_TOOL_ROUNDS)
 *   harness-06  "tool calls parsed from fences"→ askTools.ts (parseFenced…)
 *   harness-08  "the architecture digest"      → explain/explain.ts (buildDigest)
 *
 * Every one of those subjects IS in this repository. The learner asked to be
 * taught something real and was told the product "could not find a subject for
 * this lesson in the scanned repository". `buildQueue` matches FILENAMES, and
 * these subjects are named by concept, so an empty queue means "no filename
 * matched" and was being reported as "not in this repository". **The rule's
 * label and the rule's content are two different things.**
 *
 * It got worse before it got better: the previous commit made the refusal
 * enumerate the most-connected files, so a learner asking about the verify
 * contract was confidently pointed at `index.ts, repoServer.ts, scan.ts`. A
 * wrong answer with a plausible explanation under it is worse than a bare one.
 *
 * ── WHY THE SUGGESTION NAMES THE WORD IT MATCHED ─────────────────────────
 *
 * Matching the ask's own words against filenames finds the right file for all
 * four. It also finds `learningLoop.ts` for "machine learning" — which is the
 * autonomous loop and has nothing to do with machine learning. The right answer
 * and the wrong answer look identical from inside the check.
 *
 * So the refusal states the word it matched on. "These files have 'learning' in
 * the name" is true whether or not the match is meaningful, and it lets the
 * reader see instantly that only a generic word matched. Naming what the check
 * READ, before what it proves.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..');

/** The four asks the refusal fires on, from the registered bank. */
const REPORTED: ReadonlyArray<readonly [string, string]> = [
  ['harness-03', 'Teach me the verify contract: what it demands and when.'],
  ['harness-05', 'Teach me what the round budget is and how the loop spends it.'],
  ['harness-06', 'Teach me how tool calls are parsed from fenced blocks here.'],
  ['harness-08', 'Teach me what the architecture digest is and how it is budgeted.'],
];

/** The generic list the refusal used to answer every one of these with. */
const REPO_AT_LARGE = ['index.ts', 'repoServer.ts', 'scan.ts'];

test('THE REPORTED SHAPE: a refused lesson is pointed at files related to the ASK, not to the repo at large', async () => {
  /*
   * THIS ASSERTION WAS NARROWED AFTER SEEING THE OUTPUT, and that is worth
   * stating because narrowing a test to fit a result is usually how it stops
   * being one.
   *
   * The first version named the word it expected each ask to match — 'digest'
   * for harness-08. The implementation matched 'architecture' instead and
   * suggested `buildArchitecture.ts`, which is a source file about assembling
   * the architecture; every file with 'digest' in its name is a TEST, and source
   * sorts before tests deliberately. So my expectation encoded a guess about
   * WHICH word would win, which was never the property under test.
   *
   * The property is what is asserted now: the suggestion is drawn from the ASK,
   * and is not the repo-at-large list this used to answer with. That is checked
   * per file rather than per ask, so it is stricter about each name than the
   * version it replaced, and the exact-answer case (verifyGate.ts) keeps its own
   * test below.
   */
  const graph = await scanRepo(REPO, { cluster: true });
  for (const [id, ask] of REPORTED) {
    const text = subjectlessRefusal(ask, buildQueue(graph, ask), graph);
    assert.ok(text !== undefined, `${id} is one of the four the refusal fires on`);
    const named = text!.match(/[A-Za-z0-9_.-]+\.(?:ts|tsx|js|mjs)\b/g) ?? [];
    assert.ok(named.length > 0, `${id}: the refusal must name something: ${text}`);

    const askWords = (ask.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []).filter(
      (w) => w.length > 3,
    );
    for (const f of named) {
      assert.ok(
        askWords.some((w) => f.toLowerCase().includes(w)),
        `${id}: suggested ${f}, which carries no word from the ask`,
      );
      assert.ok(
        !REPO_AT_LARGE.includes(f),
        `${id}: fell back to the repo-at-large list (${f}) instead of answering the ask`,
      );
    }
  }
});

test('the verify-contract ask names verifyGate.ts, which is the actual answer', async () => {
  /* The sharpest single case: there is a right answer and it is one file. */
  const graph = await scanRepo(REPO, { cluster: true });
  const ask = REPORTED[0]![1];
  const text = String(subjectlessRefusal(ask, buildQueue(graph, ask), graph));
  assert.match(text, /verifyGate\.ts/, `expected verifyGate.ts: ${text}`);
});

test('it SAYS which word it matched, so a generic match is visible as one', async () => {
  /*
   * "machine learning" matches `learningLoop.ts` on the word "learning" alone.
   * That suggestion is not wrong about the filename and is useless about the
   * subject, and the only defence is that the refusal shows its working.
   */
  const graph = await scanRepo(REPO, { cluster: true });
  const ask = 'teach me what machine learning is';
  const text = String(subjectlessRefusal(ask, buildQueue(graph, ask), graph));
  assert.match(
    text,
    /learning/i,
    'the matched word must appear, so the reader can judge the match',
  );
  assert.doesNotMatch(
    text,
    /files I can draw|most connected/i,
    'a word-match must not be dressed up as the product knowing the subject',
  );
});

test('an ask matching NOTHING still falls back to the most-connected files', async () => {
  /*
   * The fallback from the previous commit is still correct when the ask gives
   * nothing to match on — "transformer" appears in no filename here. Without
   * this the change would trade one empty refusal for another.
   */
  const graph = await scanRepo(REPO, { cluster: true });
  const ask = 'teach me what a transformer is';
  const text = String(subjectlessRefusal(ask, buildQueue(graph, ask), graph));
  assert.match(text, /most connected/i, `expected the fallback: ${text}`);
  const named = text.match(/[A-Za-z0-9_.-]+\.(?:ts|tsx|js|mjs)\b/g) ?? [];
  assert.ok(named.length > 0, 'and it still names real subjects');
});

test('THE CLAIM AND THE LIST ARE THE SAME THING: every file named really carries the stated word', async () => {
  /*
   * Found in a seat check, not by a test, which is why this one exists. The
   * refusal announced: these files have "verify" in their name — verifyGate.ts,
   * verifyGate.test.ts, teach-contract-end-to-end.test.ts. The third matched
   * "contract". The sentence was false about two thirds of its own list, which
   * is the label-and-content fault in its purest form: the rule said one thing
   * and its output contained another, on the same line.
   */
  const graph = await scanRepo(REPO, { cluster: true });
  for (const [id, ask] of REPORTED) {
    const text = String(subjectlessRefusal(ask, buildQueue(graph, ask), graph));
    const claimed = text.match(/have "([a-z0-9]+)" in their name/i)?.[1];
    assert.ok(claimed !== undefined, `${id}: the refusal must state the word it matched: ${text}`);
    const named = text.match(/[A-Za-z0-9_.-]+\.(?:ts|tsx|js|mjs)\b/g) ?? [];
    assert.ok(named.length > 0, `${id}: nothing named`);
    for (const f of named) {
      assert.ok(
        f.toLowerCase().includes(claimed!.toLowerCase()),
        `${id}: claimed "${claimed}" but named ${f}, which does not contain it`,
      );
    }
  }
});

test('the boundary is unchanged: a pointed repo question is still not refused', async () => {
  const graph = await scanRepo(REPO, { cluster: true });
  for (const ask of ['Why does the retry flag exist?', 'what is machine learning']) {
    assert.strictEqual(
      subjectlessRefusal(ask, buildQueue(graph, ask), graph),
      undefined,
      `${ask} must not be treated as a lesson request`,
    );
  }
});
