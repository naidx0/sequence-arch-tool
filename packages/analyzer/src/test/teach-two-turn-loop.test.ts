import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { scanRepo } from '../scan.js';
import { buildDigest } from '../explain/explain.js';
import { beginTeachTurn } from '../server/teachTurn.js';
import { readLesson } from '../server/sessionsStore.js';
import type { LessonShape } from '../server/lessonState.js';
import {
  runAskPipeline,
  type AskPipelineInput,
  type AskStreamEvent,
} from '../server/askPipeline.js';

/**
 * TWO TURNS, BECAUSE ONE TURN IS NOT A LESSON.
 *
 * `teach-contract-end-to-end.test.ts` proves a single turn recognises the ask,
 * puts a visual on the canvas and closes on a comprehension question. The
 * failure it cannot see is a lesson that never ENDS: a second turn that repeats
 * the first, a comprehension question nobody's answer is ever checked against, a
 * learner who says "I don't understand" and gets the same visual again.
 *
 * So this drives TURN ONE, then TURN TWO carrying the learner's answer, exactly
 * as `repoServer.ts` does it — `runAskPipeline`, then `askTurn.finish(...)` with
 * the turn's `openPrediction`, then a fresh `beginTeachTurn` on the same thread
 * that reads the lesson back off disk.
 *
 * ── WHAT IT FOUND, AND WHY THE ASSERTIONS ARE SHAPED THIS WAY ────────────
 *
 * The product's side of turn two DOES NOT READ THE LEARNER'S ANSWER. Verified
 * in the source before this test was written, not inferred from its output:
 *
 *   · `advanceLesson(lesson, { passed, turn })` moves the queue on `passed`,
 *     which is `taughtThisTurn({ visual, endsWithCheck })` — both properties of
 *     the MODEL's output. The learner's reply is not an argument to it.
 *   · the reveal fires on `openArrow?.arrow !== undefined && chart && !atCap`
 *     and states the answer outright. Nothing compares the reply to `expect`.
 *   · the ONLY handling of "I don't understand" in the whole server is
 *     `askPipeline.ts:1293` — a sentence in the BELT, addressed to the model.
 *     There is no code.
 *
 * That is this repository's signature failure for the fifth time: the clause is
 * present and unconditional, and nothing checks it. It is recorded here as a
 * CHARACTERISATION — these tests assert what the product does today, including
 * the part it does not do, so that the day someone implements answer-grading the
 * equality cases below go red and say so.
 *
 * **This is not a claim that turn two never differs.** A real model reads the
 * learner's answer in the prompt and may well respond to it. The scripted
 * provider holds the MODEL constant on purpose, so the only thing that varies
 * between the two branches is the learner's reply, and what is measured is the
 * PRODUCT's contribution. §8 of `teach-mode-driven-end-to-end.md` measured how
 * much of a teach turn the product supplies; this is the same question one turn
 * later.
 *
 * ── NAME WHAT THE CHECK READS BEFORE WHAT IT PROVES ──────────────────────
 *
 * These read: `result.text` of turn two, and the `LessonShape` on disk after it.
 * They do NOT read the canvas as rendered (that is `packages/web2`, CODEFORGE
 * DESIGN's), and they do not read a live model. An equality assertion is worth
 * nothing unless the comparison can detect a difference, so the last case feeds
 * DIFFERENT model text through the same comparison and requires it to go red —
 * without it, "the two branches match" would pass on a comparator that always
 * matches.
 *
 * ── EVERY CASE HERE HAS BEEN SEEN TO FAIL ────────────────────────────────
 *
 * A test nobody has watched fail is a test nobody knows is wired, and two of
 * these assert that something does NOT happen — the exact shape that passes on
 * a check reading the wrong thing. So the compiled output was mutated in an
 * isolated copy of `dist` (never the shared one: two lanes build in this tree)
 * and each mutation had to kill its case AND leave the others green:
 *
 *   A  `advanceLesson` returns the lesson unchanged
 *        → kills ADVANCES only.
 *   B  the reveal's `openArrow` forced to undefined
 *        → kills the with-the-flag case only; the default case stays green,
 *          which is right — it asserts there is no reveal.
 *   C  turn two's text made to depend on the learner's answer
 *        → kills GAP-1 only. This is the one that matters: it is answer-grading
 *          in miniature, and it proves GAP-1 will go red the day that ships.
 *   D  a learner who says they are lost does not advance the queue — the belt's
 *        own rule at `askPipeline.ts:1293`, implemented
 *        → kills GAP-2 only.
 *
 * C and D are separate mutations because GAP-1 reads the TEXT and GAP-2 reads
 * the QUEUE. C left GAP-2 green and D left GAP-1 green, so neither case stands
 * in for the other and both were needed.
 */

/** A real repository with a chain, so a concept has dependents to predict about. */
function fixtureRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-two-turn-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'two-turn', version: '1.0.0', type: 'module' }),
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
  /*
   * A SECOND AND THIRD CHAIN, and they are load-bearing rather than padding.
   *
   * `attemptNextPictureCheckIn` builds its wrong answers from files of the SAME
   * EXTENSION that are NOT already in the concept's chart, and returns
   * `skipped: 'too-few-distractors'` with fewer than two. A lone three-file
   * chain has all three files in the chart, so the prediction can never be built
   * and the two-turn case silently measures nothing.
   *
   * THEY IMPORT EACH OTHER ON PURPOSE. The first version of this fixture used
   * four ISOLATED files, and that measured something else entirely: the queue
   * came out alphabetical, its head was an unconnected file, `buildConceptChart`
   * drew nothing for it, and the run recorded
   * `checkInSkipped: 'no-chart-derived-this-turn'` — a lesson turn with no
   * picture and no question. Real repository files have edges; a fixture whose
   * files have none tests the empty case while claiming to test the loop.
   */
  fs.writeFileSync(
    path.join(repo, 'src', 'alpha.js'),
    "import { beta } from './beta.js';\nexport function alpha() {\n  return beta();\n}\n",
  );
  fs.writeFileSync(path.join(repo, 'src', 'beta.js'), "export function beta() {\n  return 'b';\n}\n");
  fs.writeFileSync(
    path.join(repo, 'src', 'gamma.js'),
    "import { delta } from './delta.js';\nexport function gamma() {\n  return delta();\n}\n",
  );
  fs.writeFileSync(path.join(repo, 'src', 'delta.js'), "export function delta() {\n  return 'd';\n}\n");
  return root;
}

const LESSON_TEXT =
  'The gateway is the front door of this system. Every request arrives there first, and it does ' +
  'not decide anything itself: it hands the request straight to the router, which is the piece ' +
  'that knows where things go. The router then passes the request down to the store. That is the ' +
  'whole path a request takes through this code, and each hop is a real import you can follow.';

const THREAD = 'thread-two-turn';

interface TurnOut {
  text: string;
  lesson: LessonShape | undefined;
  charts: number;
}

/** One turn, wired the way `repoServer.ts` wires it. */
async function runTurn(
  repo: string,
  sessionsRoot: string,
  question: string,
  modelText: string,
): Promise<TurnOut> {
  const graph = await scanRepo(repo, {});
  const turn = beginTeachTurn({
    teach: true,
    question,
    threadIdFromRequest: THREAD,
    sessionsRoot,
    graph,
  });
  const ctx = turn.contextField();
  const events: AskStreamEvent[] = [];
  const input = {
    question,
    intents: [],
    scopeLines: [],
    surface: undefined,
    deictic: false,
    design: undefined,
    designMode: false,
    askMode: 'research',
    graph,
    digest: buildDigest(graph),
    cfg: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' },
    resolveReadable: (p: string) => path.resolve(repo, p),
    repoRoot: repo,
    callProvider: async () => ({ text: modelText, toolRequests: [] }),
    teach: true,
    ...ctx,
  } as unknown as AskPipelineInput;

  const result = await runAskPipeline(input, (e) => events.push(e));
  const charts = events.filter((e) => e.type === 'chart:proposal').length;
  /* THE PERSISTING HALF, which is what makes turn two a second turn rather than
     a first one repeated: without `finish` no lesson is written and turn two
     starts from nothing. */
  turn.finish({
    text: result.text,
    diagram: undefined,
    chartsThisTurn: charts,
    ...(result.openPrediction === undefined ? {} : { openPrediction: result.openPrediction }),
  });
  return { text: result.text, lesson: readLesson(sessionsRoot, THREAD), charts };
}

const ASK = 'Teach me how this system works, in this repo.';

/** Turn one, then turn two carrying `answer` as the learner's reply. */
async function twoTurns(
  answer: string,
  secondTurnModelText = LESSON_TEXT,
): Promise<{ first: TurnOut; second: TurnOut; cleanup: () => void }> {
  const root = fixtureRepo();
  const sessions = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-two-turn-sess-'));
  const repo = path.join(root, 'repo');
  const first = await runTurn(repo, sessions, ASK, LESSON_TEXT);
  const second = await runTurn(repo, sessions, answer, secondTurnModelText);
  return {
    first,
    second,
    cleanup: () => {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(sessions, { recursive: true, force: true });
    },
  };
}

const RIGHT = 'I think gateway.js would break, because it imports router.js.';
const WRONG = 'I think store.js would break, because it is at the end of the chain.';
const LOST = 'I do not understand any of that, can you explain it differently?';

test('the lesson ADVANCES across two turns — turn two is not turn one repeated', async () => {
  const { first, second, cleanup } = await twoTurns(RIGHT);
  try {
    assert.ok(first.lesson !== undefined, 'turn one must write a lesson');
    assert.strictEqual(first.lesson!.taught.length, 1, 'turn one taught one concept');
    assert.strictEqual(
      second.lesson!.taught.length,
      2,
      'turn two must teach the NEXT concept, not re-teach the first',
    );
    const taughtTitles = second.lesson!.taught.map((t) => t.title);
    assert.notStrictEqual(
      taughtTitles[0],
      taughtTitles[1],
      `the two turns taught the same concept: ${taughtTitles.join(', ')}`,
    );
  } finally {
    cleanup();
  }
});

test('BY DEFAULT turn one leaves NO open prediction, so turn two has nothing to reveal', async () => {
  /*
   * THE TWO-TURN CONTRACT IS OFF IN THE SHIPPED DEFAULT, and this is the case
   * that says so. `attemptNextPictureCheckIn` — the only thing that ever sets
   * `openPrediction` — is reached only when
   * `SEQUENCE_TEACH_CHECKIN_FORM === 'next-picture'`. Unset, the turn still
   * closes on a derived comprehension question, but it carries no expected
   * answer, so nothing links turn one to turn two.
   *
   * That means the ONLY mechanism in the product connecting a question to the
   * turn that resolves it is behind an environment flag. Characterised, not
   * endorsed: the day it ships on, this case goes red.
   */
  assert.strictEqual(
    process.env.SEQUENCE_TEACH_CHECKIN_FORM,
    undefined,
    'this case describes the UNSET default; the environment already sets the flag',
  );
  const { first, second, cleanup } = await twoTurns(RIGHT);
  try {
    assert.strictEqual(first.lesson?.open, undefined, 'no prediction is stored by default');
    assert.doesNotMatch(
      second.text,
      /Last turn you were asked which would break/,
      'with nothing stored there is nothing to reveal',
    );
    /* The turn DOES still close on a derived question — the contract's other
       half is on by default, and this separates the two. */
    assert.match(first.text, /Looking at the picture:/, 'the derived check-in still fires');
  } finally {
    cleanup();
  }
});

test('WITH the next-picture form on, turn two reveals turn one’s prediction and names a real arrow', async () => {
  /*
   * The control for the case above: the SAME two turns, differing only in the
   * flag. Without this pair, "no reveal by default" could equally mean the
   * reveal is broken everywhere — which is a different defect with a different
   * fix.
   */
  const before = process.env.SEQUENCE_TEACH_CHECKIN_FORM;
  process.env.SEQUENCE_TEACH_CHECKIN_FORM = 'next-picture';
  try {
    const { first, second, cleanup } = await twoTurns(RIGHT);
    try {
      assert.ok(
        first.lesson?.open?.arrow !== undefined,
        `turn one must leave an open prediction: ${JSON.stringify(first.lesson?.open)}`,
      );
      assert.match(
        second.text,
        /Last turn you were asked which would break/,
        `turn two must resolve it: ${second.text.slice(-260)}`,
      );
      assert.ok(
        second.text.includes(first.lesson!.open!.arrow),
        'the reveal must name the arrow from the scanned graph',
      );
    } finally {
      cleanup();
    }
  } finally {
    if (before === undefined) delete process.env.SEQUENCE_TEACH_CHECKIN_FORM;
    else process.env.SEQUENCE_TEACH_CHECKIN_FORM = before;
  }
});

test('THE GAP: turn two is byte-identical whether the learner was RIGHT or WRONG', async () => {
  /*
   * The learner's answer is the ONLY thing that differs between these two runs —
   * same repo, same scan, same scripted model text, same thread. If the product
   * read the answer, something here would change.
   *
   * It does not. Recorded as the current behaviour rather than asserted as
   * correct: when answer-grading is implemented this case goes red, which is
   * exactly what should happen.
   */
  const a = await twoTurns(RIGHT);
  const b = await twoTurns(WRONG);
  try {
    assert.strictEqual(
      a.second.text,
      b.second.text,
      'the product already distinguishes a right answer from a wrong one — update this characterisation',
    );
    assert.strictEqual(
      a.second.lesson!.taught.length,
      b.second.lesson!.taught.length,
      'a wrong answer advances the lesson exactly as a right one does',
    );
  } finally {
    a.cleanup();
    b.cleanup();
  }
});

test('THE GAP, second half: "I do not understand" advances the lesson like a correct answer', async () => {
  /*
   * The belt says: "If the learner says they did not understand, re-explain the
   * SAME concept differently — do not move on." That sentence is
   * `askPipeline.ts:1293`, and it is the ONLY handling of the case in the
   * server: there is no code behind it. So the queue advances regardless, and a
   * learner who said they were lost is moved on to the next concept.
   */
  const lost = await twoTurns(LOST);
  const right = await twoTurns(RIGHT);
  try {
    assert.strictEqual(
      lost.second.lesson!.taught.length,
      right.second.lesson!.taught.length,
      'saying you are lost already changes the queue — update this characterisation',
    );
    assert.strictEqual(
      lost.second.lesson!.taught.map((t) => t.title).join(','),
      right.second.lesson!.taught.map((t) => t.title).join(','),
      'the same concepts are marked taught either way',
    );
  } finally {
    lost.cleanup();
    right.cleanup();
  }
});

test('NON-VACUITY: the comparison CAN detect a difference, so the equalities above mean something', async () => {
  /*
   * An equality assertion is worthless if the comparison always matches. Same
   * learner answer both times; only the MODEL's text differs. If this fails, the
   * two cases above are tautologies and prove nothing about the learner's answer.
   */
  const a = await twoTurns(RIGHT, LESSON_TEXT);
  const b = await twoTurns(RIGHT, `${LESSON_TEXT} The store is the last hop and writes nothing.`);
  try {
    assert.notStrictEqual(
      a.second.text,
      b.second.text,
      'the comparison cannot see a difference, so the equality cases above are tautologies',
    );
  } finally {
    a.cleanup();
    b.cleanup();
  }
});
