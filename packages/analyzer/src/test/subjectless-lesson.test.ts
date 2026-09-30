import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanRepo } from '../scan.js';
import { buildQueue, subjectlessRefusal } from '../server/lessonState.js';

/**
 * A LESSON REQUEST WITH NO SUBJECT — the planted cases, numbered as
 * `docs/research/design-the-subjectless-lesson.md` numbers them.
 *
 * Card-free: `buildQueue` and `subjectlessRefusal` are pure functions of a
 * scanned graph and an ask, and the refusal fires before any provider call, so
 * none of this needs a model.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(HERE, '..', '..');
const SHOPFRONT = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'shopfront');
const shopfront = (async () => scanRepo(SHOPFRONT, { cluster: true }))();

const refusalFor = async (ask: string): Promise<string | undefined> =>
  subjectlessRefusal(ask, buildQueue(await shopfront, ask));

/* ── the owner's own sentence, 2026-09-09 ──────────────────────────────── */

test('THE REPORTED SHAPE: "I want to learn about X" is a lesson request', async () => {
  /*
   * BUILT FROM THE REPORTED SHAPE, not a convenient one. Max's words, relayed
   * 2026-09-09: *"I want to learn about machine learning. What is it?"*
   *
   * Driven end to end against this repository it produced a repo-grounded
   * answer — where the string "machine learning" occurs in the codebase, citing
   * two test files, `askIntent.ts:38` and `docs/PIVOT-V2.md:67` — at 145,904
   * input tokens and 0 of 2,902 edges of coverage. No refusal, no lesson.
   *
   * The refusal clause was PRESENT and self-gated on a condition the ask had not
   * met: `TEACH_ASK` listed "teach me", "take me through", "walk me through" and
   * two more, and none of them is how the owner asked. The queue was empty, so
   * the second gate would have passed; the first never let it through.
   *
   * That is the failure mode this repo has now hit four times — the clause is
   * there and the condition is wrong — so the fix is the recogniser, not a
   * louder instruction.
   */
  const r = await refusalFor('I want to learn about machine learning. What is it?');
  assert.ok(
    r !== undefined,
    'a first-person request to learn a subject the repository does not contain must be refused, ' +
      'not answered with wherever that phrase happens to appear in the code',
  );
  assert.match(r ?? '', /could not find a subject/i);
});

test('…and the first-person forms travel together', async () => {
  for (const ask of [
    "I'd like to learn about backpressure.",
    'I would like to learn about vector databases.',
    'Help me learn about consensus algorithms.',
  ]) {
    assert.ok(await refusalFor(ask), `not recognised as a lesson request: ${ask}`);
  }
});

test('a sentence that merely CONTAINS "learn" is not a lesson request', async () => {
  /*
   * The reason the widening is anchored on first-person intent rather than on
   * the word. "The model learns from data" is a claim, not a request, and a
   * recogniser that fired on it would refuse ordinary questions about ML code.
   */
  assert.equal(
    await refusalFor('Where does the model learn from labelled data in this repo?'),
    undefined,
  );
});

/* ── case 1: a lesson ask with no subject refuses, naming both remedies ──── */

test('case 1: a lesson ask with no subject refuses, and names both remedies', async () => {
  const r = await refusalFor('Teach me what the retry policy is.');
  assert.ok(r !== undefined, 'a lesson request with no subject must be refused');
  /*
   * BOTH REMEDIES, because naming only one leaves the learner guessing at the
   * other. These are the two signals buildQueue actually uses — a file, or a
   * reference to the repository — so the sentence cannot drift from the code
   * without this failing.
   */
  /*
   * WAS `/teach me jail\.ts/i`, CHANGED 2026-09-09 — and the reason matters,
   * because changing an assertion to fit a change is usually how a test stops
   * being one.
   *
   * `jail.ts` was hardcoded in the refusal. It is a real file in THIS repository
   * and in nobody else's, so on any other repo the product's one concrete
   * suggestion — offered at the moment it admits it cannot find a subject — was
   * a file that does not exist. The assertion did not check the remedy; it
   * pinned the guess.
   *
   * The INTENT below is unchanged and still checked: the refusal must show that
   * naming a file is a way out. What it no longer does is require a specific
   * foreign filename. `teach-refusal-names-real-subjects.test.ts` then goes
   * further than this ever did — with a graph, every file the refusal names must
   * exist in THAT repository and must draw a chart with at least one edge.
   */
  assert.match(r, /name a file/i, 'it shows how to name a file');
  assert.doesNotMatch(r, /jail\.ts/i, 'and does not invent one from another repository');
  assert.match(r, /in this repo/i, 'and how to point at the repository');
  assert.match(r, /could not find a subject/i, 'and says plainly what went wrong');
});

/* ── case 2: naming a file does not refuse ───────────────────────────────── */

test('case 2: a lesson ask that names a file is not refused', async () => {
  assert.strictEqual(await refusalFor('Teach me what orders.ts does here.'), undefined);
});

/* ── case 3: referencing the repository does not refuse ──────────────────── */

test('case 3: a lesson ask that references the repository is not refused', async () => {
  assert.strictEqual(await refusalFor('Teach me what this repo does.'), undefined);
});

/* ── case 4: a pointed question is not handed a lesson refusal ───────────── */

test('case 4: a pointed question with no subject is NOT refused — the known gap', async () => {
  /*
   * "Why does the retry flag exist?" also has an empty queue, and this
   * deliberately leaves it alone: a refusal written for lessons should not be
   * handed to a question that never asked for one.
   *
   * SO THIS ASSERTS A GAP, NOT A FIX. That ask keeps today's behaviour, which
   * the design page calls the dangerous one. Anyone reading the refusal as
   * "silent subject-less answers are solved" is reading it wrong, and this case
   * is where that is written down.
   */
  assert.strictEqual(await refusalFor('Why does the retry flag exist?'), undefined);
  assert.strictEqual(buildQueue(await shopfront, 'Why does the retry flag exist?').length, 0);
});

/* ── case 5: the refusal is not a lesson ─────────────────────────────────── */

test('case 5: a refusal is not a lesson — it teaches nothing and cannot be counted as one', async () => {
  /*
   * The refusal is returned from `TeachTurn.refusal()` before the provider call
   * and before `finish()`, so no lesson is written, no concept is taught and no
   * chart is derived. Asserted at the source, because the property that matters
   * is WHERE it returns, and a value-level test cannot see that.
   */
  const src = fs.readFileSync(path.join(ANALYZER_ROOT, 'src', 'server', 'teachTurn.ts'), 'utf8');
  assert.match(src, /refusal: \(\) =>/, 'the TeachTurn exposes a refusal');
  const server = fs.readFileSync(path.join(ANALYZER_ROOT, 'src', 'server', 'repoServer.ts'), 'utf8');
  for (const handler of ['askRefusal', 'streamRefusal']) {
    const at = server.indexOf(`const ${handler} = askTurn.refusal();`);
    assert.ok(at > 0, `${handler} must consult the TeachTurn`);
    /* And it must come BEFORE the pipeline runs, or it is not saving a call. */
    const pipelineAt = server.indexOf('runAskPipeline', at);
    assert.ok(pipelineAt > at, `${handler} must be decided before the provider call`);
  }
});

/* ── the two-handlers law ────────────────────────────────────────────────── */

test('both ask handlers consult ONE refusal, not two copies of the rule', () => {
  /*
   * A rule that lives in two handlers is one rule until it is measured, and
   * `/api/ask` and `/api/ask/stream` have drifted before — the checkpoint
   * migration was wired into one route while the client hydrated from the other,
   * and the bug survived a green gate. So the decision lives on the TeachTurn
   * and both sites call it; neither may re-implement the test.
   */
  const server = fs.readFileSync(path.join(ANALYZER_ROOT, 'src', 'server', 'repoServer.ts'), 'utf8');
  assert.strictEqual(
    server.split('askTurn.refusal()').length - 1,
    2,
    'exactly two call sites, one per handler',
  );
  assert.ok(
    !/TEACH_ASK|subjectlessRefusal\(/.test(server),
    'neither handler may re-derive the rule — it belongs to lessonState',
  );
});

/* ── case 6 and the kill number ──────────────────────────────────────────── */

test('case 6 / KILL NUMBER: the refusal fires on exactly 4 of the 13 bank asks', async () => {
  /*
   * THE KILL NUMBER FROM THE DESIGN PAGE, checked rather than trusted. Five or
   * more is a false positive reaching real lessons and the change comes out;
   * three or fewer means it is not doing the job it was built for. Re-check this
   * on any change to TEACH_ASK.
   *
   * Run against THIS repository's graph, because that is what the bank asks are
   * about and a fixture cannot answer the question.
   */
  const ASKS: ReadonlyArray<readonly [string, string]> = [
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
  const graph = await scanRepo(path.resolve(ANALYZER_ROOT, '..', '..'), { cluster: true });
  const refused = ASKS.filter(([, ask]) => subjectlessRefusal(ask, buildQueue(graph, ask)) !== undefined).map(
    ([id]) => id,
  );
  assert.deepStrictEqual(
    refused,
    ['harness-03', 'harness-05', 'harness-06', 'harness-08'],
    'exactly the four subject-less asks, and no others',
  );
});

/* ── the hole a180b036 opened, and the case that keeps it shut ───────────── */

test('the refusal fires even when NO THREAD is named — it is about the ask, not the conversation', async () => {
  /*
   * SEEN FROM THE SEAT, 2026-09-06. A subject-less "teach me" typed into the
   * running app was NOT refused: it reached a model call, ten seconds of another
   * lane's GPU card, and had to be stopped by hand.
   *
   * The cause was mine and it was in this file's neighbour. `refusal()` read
   * `lesson === undefined ? undefined : ...`; a180b036 then made the server
   * refuse to file a lesson under a thread the caller had not named, so `lesson`
   * became undefined for any client not sending `threadId` — and that commit's
   * CLIENT half lives in packages/web2, which the app serves from a separate
   * build. Server had the new rule, browser had last night's bundle, refusal
   * gone.
   *
   * Whether an ask names a subject is a property of the ask and the graph. This
   * asserts it is computed from those and nothing else, with no thread anywhere
   * in sight.
   */
  const { beginTeachTurn } = await import('../server/teachTurn.js');
  const graph = await shopfront;
  const turn = beginTeachTurn({
    teach: true,
    question: 'Teach me what the retry policy is.',
    threadIdFromRequest: undefined,
    sessionsRoot: null,
    graph,
  });
  const r = turn.refusal();
  assert.ok(r !== undefined, 'a subject-less teach ask is refused with no thread and no sessions root');
  assert.match(r, /could not find a subject/);
});

test('and a thread-less ask that DOES name a subject is still not refused', () => {
  /* The other side of the same boundary: no thread must not mean "refuse
     everything", or the fix would trade one silent failure for a loud one. */
  return (async () => {
    const { beginTeachTurn } = await import('../server/teachTurn.js');
    const turn = beginTeachTurn({
      teach: true,
      question: 'Teach me what orders.ts does here.',
      threadIdFromRequest: undefined,
      sessionsRoot: null,
      graph: await shopfront,
    });
    assert.strictEqual(turn.refusal(), undefined);
  })();
});
