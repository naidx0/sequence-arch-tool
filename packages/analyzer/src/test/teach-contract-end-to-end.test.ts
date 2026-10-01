import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { scanRepo } from '../scan.js';
import { buildDigest } from '../explain/explain.js';
import { beginTeachTurn } from '../server/teachTurn.js';
import {
  runAskPipeline,
  gradeTeachTurn,
  type AskPipelineInput,
  type AskStreamEvent,
} from '../server/askPipeline.js';

/**
 * THE THREE THINGS A FINISHED LESSON OWES, ON ONE TURN, END TO END.
 *
 * `9d5a26fd` recorded that a teach turn does not finish a lesson on this
 * repository and that the contract is therefore UNTESTED: the live probes hit
 * the ask deadline, so no turn ever produced a lesson to grade. The pieces have
 * tests — `check-in.test.ts`, `concept-chart.test.ts`, `taught-and-advance.test.ts`
 * — but nothing asserted the three together on a single turn, which is the claim
 * `TEACH-MODE-GOAL.md` actually makes.
 *
 * This drives ONE teach turn through `runAskPipeline` with a scripted provider,
 * against a real scan of a real repository, and asserts:
 *
 *   1. the ask is recognised as a lesson request and gets a concept;
 *   2. a visual reaches the canvas;
 *   3. the turn closes on a comprehension question.
 *
 * ── WHY IT IS CARD-FREE, AND WHAT THAT COSTS ─────────────────────────────
 *
 * §6 says the contract is unverified "against a live turn". Two of the three are
 * not model behaviour at all: the concept comes from `buildQueue` over the
 * scanned graph, and the visual from `buildConceptChart` over the same graph.
 * Measured over 296 recorded turns, the MODEL called `propose_chart` on 5 and
 * the product derived the other ~97%. So (1) and (2) are product logic and a
 * scripted provider tests them exactly. Only (3) is the model's, and the product
 * appends a derived check-in when the model writes none — deliberately, per the
 * comment at the append site: "a reveal that depends on the model doing it is a
 * reveal that does not happen."
 *
 * ── WHAT WOULD MAKE THIS PASS FOR THE WRONG REASON ───────────────────────
 *
 * Named and excluded rather than assumed unlikely, because all three are live
 * possibilities here and one of them already fooled this lane once (§8: "with a
 * picture" was read as model compliance when the picture was the product's):
 *
 *   · RECOGNISED BECAUSE THE PHRASING MATCHED A LITERAL. The ask deliberately
 *     names NO file, so the concept cannot be echoed from the question — it has
 *     to come out of the graph. Asserted directly, and the control run with
 *     `teach: false` gets no concept at all.
 *   · A VISUAL THAT WAS ALREADY THERE. Events are captured from this run only,
 *     the chart must NAME this turn's concept, and the control run emits none —
 *     so the chart is this turn's and is caused by the teach flag.
 *   · A QUESTION THAT IS NOT ABOUT THE LESSON. A closing CLARIFYING offer is a
 *     question and satisfies "ends with ?", and 24 of 94 measured turns closed
 *     on exactly that. The last case asserts the grader still rejects it, so
 *     "a question was asked" cannot pass this contract on its own.
 *
 * THE SCRIPTED PROVIDER WRITES NO CHECK-IN AND CALLS NO CHART TOOL, on purpose.
 * That is the measured majority case, and it makes the split visible: whatever
 * this turn ends up owning, the model did not supply it.
 */

/** A real repository with a clear import edge, so a concept has something to draw. */
function fixtureRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-teach-contract-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'teach-contract', version: '1.0.0', type: 'module' }),
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

/*
 * A lesson-shaped answer with NO closing check-in and NO chart call — the
 * measured majority shape. Substantive prose, so the append gate's word floor
 * and its "the turn did not run out" condition are both satisfied and the thing
 * under test is the contract rather than a stub that was too short to qualify.
 */
const LESSON_WITHOUT_A_CHECK =
  'The gateway is the front door of this system. Every request arrives there first, and it does ' +
  'not decide anything itself: it hands the request straight to the router, which is the piece ' +
  'that knows where things go. The router then passes the request down to the store. That is the ' +
  'whole path a request takes through this code, and each hop is a real import you can follow in ' +
  'the files themselves rather than a diagram someone drew by hand.';

function scriptedProvider(text: string) {
  let calls = 0;
  const callProvider = async () => {
    calls += 1;
    return { text, toolRequests: [] } as never;
  };
  return { callProvider, calls: () => calls };
}

async function inputFor(
  repo: string,
  teach: boolean,
  sessionsRoot: string | null,
  question: string,
  callProvider: unknown,
): Promise<{ input: AskPipelineInput; concept: string | undefined }> {
  const graph = await scanRepo(repo, {});
  /* THE SHARED ASSEMBLY, not a hand-built teachContext: a rule in two handlers
     is one rule until measured, and this test exists to check the real one. */
  const turn = beginTeachTurn({
    teach,
    question,
    threadIdFromRequest: 'thread-contract',
    sessionsRoot,
    graph,
  });
  /* `Concept` is `{ title, nodeId? }`, not a string — the title is the file. */
  const ctx = turn.contextField() as {
    teachContext?: { concept?: { title?: string } };
  };
  return {
    concept: ctx.teachContext?.concept?.title,
    input: {
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
      callProvider,
      ...(teach ? { teach: true } : {}),
      ...ctx,
    } as unknown as AskPipelineInput,
  };
}

const charts = (events: AskStreamEvent[]): { title?: string; caption?: string }[] =>
  events
    .filter((e) => e.type === 'chart:proposal')
    .map((e) => (e as unknown as { chart: { title?: string; caption?: string } }).chart);

/** The ask names no file on purpose — the concept must come out of the graph. */
const ASK = 'Teach me how this system works, in this repo.';

test('a teach turn is RECOGNISED and gets a concept out of the graph, not out of the question', async () => {
  const root = fixtureRepo();
  const sessions = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-teach-sessions-'));
  try {
    const script = scriptedProvider(LESSON_WITHOUT_A_CHECK);
    const { concept } = await inputFor(path.join(root, 'repo'), true, sessions, ASK, script.callProvider);

    assert.ok(concept !== undefined && concept !== '', 'a teach ask must be given a concept');
    /* NOT ECHOED FROM THE QUESTION — the exclusion, asserted rather than assumed.
       The ask names no file, so a concept that appears in it would mean the queue
       read the words back instead of reading the graph. */
    assert.ok(
      !ASK.toLowerCase().includes(String(concept).toLowerCase()),
      `the concept "${concept}" came from the question, not the graph`,
    );
    assert.match(String(concept), /\.(js|ts)$/, `a concept is a real file: got "${concept}"`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(sessions, { recursive: true, force: true });
  }
});

test('a VISUAL reaches the canvas, it names this turn’s concept, and the model did not draw it', async () => {
  const root = fixtureRepo();
  const sessions = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-teach-sessions-'));
  try {
    const script = scriptedProvider(LESSON_WITHOUT_A_CHECK);
    const { input, concept } = await inputFor(
      path.join(root, 'repo'),
      true,
      sessions,
      ASK,
      script.callProvider,
    );
    const events: AskStreamEvent[] = [];
    await runAskPipeline(input, (e) => events.push(e));

    const drawn = charts(events);
    assert.ok(drawn.length > 0, 'a concept turn owes the learner a picture');
    const named = `${drawn[0]?.title ?? ''} ${drawn[0]?.caption ?? ''}`;
    assert.ok(
      named.includes(String(concept)),
      `the chart must be about THIS turn's concept "${concept}", got "${named.trim()}"`,
    );
    /* The provider script calls no chart tool, so the picture is the product's
       derived chart. Recorded here rather than left implied: a green assertion
       above is NOT evidence that the model complied with the visual rule. */
    assert.strictEqual(script.calls() > 0, true, 'the provider really was called');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(sessions, { recursive: true, force: true });
  }
});

test('THE CONTROL: the same repo and the same script WITHOUT teach gets no concept and no chart', async () => {
  /*
   * The exclusion for both cases above. Without this, a pipeline that drew a
   * chart on every ask would pass them, and so would a queue that handed out a
   * concept regardless of the flag.
   */
  const root = fixtureRepo();
  try {
    const script = scriptedProvider(LESSON_WITHOUT_A_CHECK);
    const { input, concept } = await inputFor(
      path.join(root, 'repo'),
      false,
      null,
      ASK,
      script.callProvider,
    );
    assert.strictEqual(concept, undefined, 'a non-teach ask must not be given a concept');
    const events: AskStreamEvent[] = [];
    await runAskPipeline(input, (e) => events.push(e));
    assert.strictEqual(charts(events).length, 0, 'the derived chart is caused by the teach flag');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the turn closes on a COMPREHENSION question — and a clarifying offer does not count as one', async () => {
  const root = fixtureRepo();
  const sessions = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-teach-sessions-'));
  try {
    const script = scriptedProvider(LESSON_WITHOUT_A_CHECK);
    const { input } = await inputFor(path.join(root, 'repo'), true, sessions, ASK, script.callProvider);
    const events: AskStreamEvent[] = [];
    const result = await runAskPipeline(input, (e) => events.push(e));

    assert.match(
      result.text.trim(),
      /\?[\x22\x27’)\]]?\s*$/,
      `a lesson turn must close on a question: ${result.text.slice(-160)}`,
    );

    /*
     * THE EXCLUSION, and the one that matters most. "Ends with a question mark"
     * is satisfied by a closing CLARIFYING offer — 24 of 94 measured turns closed
     * on one, and every one satisfied the old test. If the grader accepted that
     * shape, the assertion above would be worth nothing, so the shape is put to
     * the grader directly.
     */
    const names = new Set(['gateway.js', 'router.js', 'store.js']);
    const clarifying =
      'The gateway hands each request to the router, and router.js passes it to store.js. ' +
      'Would you like me to show you the data view or the architecture view next?';
    const problems = gradeTeachTurn(clarifying, names, names, true);
    assert.ok(
      problems.length > 0,
      'a closing clarifying offer must NOT satisfy the check-in contract',
    );

    /* And the shape that should pass, so the rule above is a gate and not a
       refusal of every closing question. */
    const comprehension =
      'The gateway hands each request to the router, and router.js passes it to store.js. ' +
      'So what do you think happens to a request if router.js cannot reach store.js?';
    assert.deepStrictEqual(
      gradeTeachTurn(comprehension, names, names, true),
      [],
      'a real comprehension close must pass',
    );

    /*
     * WHO ACTUALLY CLOSED THE TURN — asserted, not left to be assumed.
     *
     * The scripted provider writes no question at all, so the closing check-in
     * above is the PRODUCT's derived one, appended after the bounce. Measured
     * here: 120 characters added to the model's text, reading "Looking at the
     * picture: gateway.js reads from router.js — what do you think would break
     * in gateway.js if that changed?" — grounded in the derived chart and a real
     * edge of the scanned graph.
     *
     * This is the same shape as §8's correction, and it is why the assertion at
     * the top of this test must never be read as "the model complied": all three
     * things a finished lesson owes are delivered HERE by the product. That is a
     * deliberate design ("a reveal that depends on the model doing it is a
     * reveal that does not happen"), and it is worth an assertion so nobody
     * later reads a green suite as evidence about a model.
     */
    assert.ok(
      result.text.trim().length > LESSON_WITHOUT_A_CHECK.length,
      'the product must append a check-in when the model writes none',
    );
    assert.ok(
      !LESSON_WITHOUT_A_CHECK.includes('?'),
      'the fixture must contain no question, or the assertion above proves nothing',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(sessions, { recursive: true, force: true });
  }
});
