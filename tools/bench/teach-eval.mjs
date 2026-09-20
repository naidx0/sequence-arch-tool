#!/usr/bin/env node
/**
 * THE TEACH-MODE TESTING BENCH — 50+ graded lesson conversations.
 *
 * Owner directive (2026-09-01): "a testing mode … video upload, document
 * upload, link article upload … full visual flow walkthrough from point to
 * point — using hard and a variety of concepts, law, math, ml … run around
 * 50 different conversations minimum."
 *
 * What this runs, per conversation:
 *   - a multi-turn teach-mode lesson through the REAL pipeline (real model,
 *     temperature 0), over a real scanned repo (makemore / shopfront / this
 *     monorepo), with the learner's replies scripted ("got it", a prediction
 *     answer, a confusion) so pacing across turns is exercised;
 *   - "video upload" = an attached transcript (.srt-shaped text) — honest
 *     about what a local-first engine ingests; "document upload" = attached
 *     article text; "link upload" = the lesson may fetch_url a public page;
 *   - every assistant turn graded by the SAME gradeTeachTurn the harness
 *     enforces live, plus bench-only checks: a visual present (canvas block,
 *     mermaid/ascii diagram), a check-in present, word budget.
 *
 * Output: tools/bench/out/teach-eval-report.json + a printed scoreboard.
 * Nothing here fabricates: a conversation that errors is recorded as an
 * error, and the score is computed only over what actually ran.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { CALL_TIMEOUT_MS, makeCallGuard } from './lib/call-guard.mjs';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const dist = (p) => url.pathToFileURL(path.join(root, 'packages/analyzer/dist', p)).href;

/*
 * Mirrors the product's flag so the two arms of the registered teach
 * measurement differ in one thing. Default OFF, matching the product default,
 * so an unflagged bench run is the control.
 */
const BENCH_CARRY = process.env.SEQUENCE_ASK_CARRY_WIRE === '1';

import { armFileName, artefactGaps, wouldClobberAnotherRun } from './lib/arm-identity.mjs';

/** Stamped once, so every file a run writes carries the same run's identity. */
const RUN_STARTED_AT = new Date().toISOString();

const { runAskPipeline, gradeTeachTurn, TEACH_STUB_WORDS } = await import(
  dist('server/askPipeline.js'),
);
const { scanRepoCached } = await import(dist('index.js'));
const { buildDigest } = await import(dist('explain/explain.js'));
const { resolveInRepo } = await import(dist('server/jail.js'));
const { extractQuestions } = await import('./skipperModel.mjs');
const { newLesson, nextConcept, advanceLesson, applyPlan, needsPlan, lessonExhausted, buildTeachContext, carryPrediction, taughtThisTurn } =
  await import(dist('server/lessonState.js'));
const { gradeCheckIn } = await import(dist('server/checkIn.js'));
const { EMPTY_CARRY, renderCarry } = await import(dist('server/turnCarry.js'));
const { requestModelText } = await import(dist('server/provider.js')).catch(() => ({}));

const REPOS = {
  makemore: path.join(root, 'examples/makemore'),
  shopfront: path.join(root, 'packages/analyzer/test/fixtures/shopfront'),
  sequence: root,
};

/* ------------------------------------------------------------ attachments -- */

const ML_TRANSCRIPT = [
  '1',
  '00:00:01,000 --> 00:00:09,000',
  'Today we build makemore: a character-level language model that learns to',
  'generate names by counting which letter follows which.',
  '',
  '2',
  '00:00:09,500 --> 00:00:21,000',
  "We wrap every name with a dot marker, so 'emma' becomes .emma. — the dot",
  'plays both start-of-name and end-of-name, giving us one clean 27x27 table.',
  '',
  '3',
  '00:00:21,500 --> 00:00:34,000',
  'Then the punchline: a single linear layer trained by gradient descent on',
  'one-hot characters learns exactly this counts table. Counting IS learning.',
].join('\n');

const LAW_ARTICLE = [
  'CONSIDERATION IN CONTRACT LAW — A PRIMER',
  '',
  'A promise is enforceable as a contract only when it is supported by',
  'consideration: something of value, bargained for and given in exchange.',
  'Past consideration — a benefit already conferred before the promise — is',
  'no consideration at all, because nothing was exchanged FOR the promise.',
  'Courts do not weigh adequacy: a peppercorn suffices if bargained for.',
  'The doctrine draws the line between enforceable bargains and bare',
  'gratuitous promises, which (absent reliance) the law leaves to honor.',
].join('\n');

const MATH_NOTE = [
  'GRADIENT DESCENT ON THE NEGATIVE LOG LIKELIHOOD',
  '',
  'Given data pairs (x, y) and a model p(y|x; W), training minimizes',
  'NLL(W) = -(1/N) * sum log p(y_i | x_i; W).',
  'Each step: W <- W - lr * dNLL/dW. For a softmax over logits W[x],',
  'the gradient at row x is (probs - onehot(y)) — the difference between',
  'what the model believes and what actually happened. When the data are',
  'bigram counts, the optimum reproduces the normalized count table.',
].join('\n');

/* ----------------------------------------------------------- the 52 bank -- */

/* The bank's acknowledgement and the turn-count lever, in their own module so a
   test can import them without starting a bench run. */
import { GOT_IT, scriptedTurns } from './lib/scripted-turns.mjs';
const CONFUSED = "I don't understand that yet — can you explain it differently?";

function convo(id, domain, repo, q, replies, attachment) {
  return { id, domain, repo, question: q, replies, attachment };
}

const BANK = [
  // ML over makemore (the flagship arc), varied entry points + predictions
  convo('ml-01', 'ml', 'makemore', 'Teach me how makemore works — bit by bit, visually.', [GOT_IT, 'My prediction: sampling.py uses the counts from bigram_counts.py?']),
  convo('ml-02', 'ml', 'makemore', 'Teach me what a bigram is and how this repo counts them.', [GOT_IT]),
  convo('ml-03', 'ml', 'makemore', 'Teach me how sampling from a counts table generates a name, step by step.', [CONFUSED, GOT_IT]),
  convo('ml-04', 'ml', 'makemore', 'Teach me why the dot marker is used at both ends of a name here.', [GOT_IT]),
  convo('ml-05', 'ml', 'makemore', 'Teach me how the one-layer neural net in this repo relates to the counts table.', [GOT_IT, 'Prediction: the learned W row for "." ranks the same starters as the counted row?']),
  convo('ml-06', 'ml', 'makemore', 'Teach me what negative log likelihood measures in nn_bigram.py.', [CONFUSED]),
  convo('ml-07', 'ml', 'makemore', 'Teach me the full data flow point to point: names file to generated name. Show the flow visually.', [GOT_IT]),
  convo('ml-08', 'ml', 'makemore', 'Teach me what would break if names.txt were empty — walk the code.', [GOT_IT]),
  convo('ml-09', 'ml', 'makemore', 'Teach me how random.choices implements weighted sampling in this repo.', [GOT_IT]),
  convo('ml-10', 'ml', 'makemore', 'Teach me softmax as it appears in this training loop.', [CONFUSED, GOT_IT]),
  // ML with the "video" (transcript attachment)
  convo('ml-11', 'ml', 'makemore', 'I uploaded a lecture transcript. Teach me the lesson it describes using the real code here, bit by bit.', [GOT_IT, GOT_IT], { name: 'lecture.srt', text: ML_TRANSCRIPT }),
  convo('ml-12', 'ml', 'makemore', 'Using my attached transcript, teach me the punchline it mentions — that counting IS learning — with evidence from this repo.', [GOT_IT], { name: 'lecture.srt', text: ML_TRANSCRIPT }),
  // Math (document upload)
  convo('math-01', 'math', 'makemore', 'Teach me the math of gradient descent as used in this repo.', [GOT_IT], { name: 'gd-note.md', text: MATH_NOTE }),
  convo('math-02', 'math', 'makemore', 'Teach me why the softmax gradient is probs minus one-hot, grounded in nn_bigram.py.', [CONFUSED], { name: 'gd-note.md', text: MATH_NOTE }),
  convo('math-03', 'math', 'makemore', 'Teach me what a probability distribution over 27 characters means concretely here.', [GOT_IT]),
  convo('math-04', 'math', 'makemore', 'Teach me how row-normalization turns counts into probabilities in sampling.py.', [GOT_IT]),
  convo('math-05', 'math', 'makemore', 'Teach me what the learning rate does in this training loop, and what too-large looks like.', [GOT_IT]),
  convo('math-06', 'math', 'makemore', 'Teach me matrix indexing: why one-hot input times W just selects a row.', [CONFUSED, GOT_IT]),
  // Law (document upload — teaching from an attached article, classroom repo for structure)
  convo('law-01', 'law', 'makemore', 'I attached a law primer. Teach me the doctrine of consideration from it, one point at a time.', [GOT_IT, GOT_IT], { name: 'consideration.md', text: LAW_ARTICLE }),
  convo('law-02', 'law', 'makemore', 'From my attached article: teach me why past consideration is no consideration.', [GOT_IT], { name: 'consideration.md', text: LAW_ARTICLE }),
  convo('law-03', 'law', 'makemore', 'From the attached primer, teach me the peppercorn rule and what courts refuse to weigh.', [CONFUSED], { name: 'consideration.md', text: LAW_ARTICLE }),
  convo('law-04', 'law', 'makemore', 'Using the attached primer, teach me the difference between a bargain and a gratuitous promise.', [GOT_IT], { name: 'consideration.md', text: LAW_ARTICLE }),
  // Systems / architecture over shopfront (the multi-service fixture)
  convo('sys-01', 'systems', 'shopfront', 'Teach me the architecture of this system point to point — walk one order from entry to database, visually.', [GOT_IT, 'Prediction: the gateway talks to the worker through a queue?']),
  convo('sys-02', 'systems', 'shopfront', 'Teach me what the gateway service does, from its real code.', [GOT_IT]),
  convo('sys-03', 'systems', 'shopfront', 'Teach me how the services here communicate — queues vs HTTP.', [CONFUSED]),
  convo('sys-04', 'systems', 'shopfront', 'Teach me what a datastore node is in this graph and which services touch it.', [GOT_IT]),
  convo('sys-05', 'systems', 'shopfront', 'Teach me what breaks downstream if the payments route fails — the blast radius.', [GOT_IT]),
  convo('sys-06', 'systems', 'shopfront', 'Teach me the invoices flow bit by bit with a visual.', [GOT_IT, GOT_IT]),
  convo('sys-07', 'systems', 'shopfront', 'Teach me the difference between an import edge and an interaction edge in this repo.', [GOT_IT]),
  convo('sys-08', 'systems', 'shopfront', 'Teach me how docker-compose declares these services and how the scan reads it.', [GOT_IT]),
  // Harness engineering over the Sequence monorepo itself (the owner's own example)
  convo('harness-01', 'harness', 'sequence', 'Teach me how harness engineering works, using this repository as the example — in depth, visually, bit by bit.', [GOT_IT, GOT_IT]),
  convo('harness-02', 'harness', 'sequence', 'Teach me what an evidence ledger is in this codebase and why it exists.', [GOT_IT]),
  convo('harness-03', 'harness', 'sequence', 'Teach me the verify contract: what it demands and when.', [CONFUSED]),
  convo('harness-04', 'harness', 'sequence', 'Teach me how the prose-diff salvage works and the failure it answers.', [GOT_IT]),
  convo('harness-05', 'harness', 'sequence', 'Teach me what the round budget is and how the loop spends it.', [GOT_IT]),
  convo('harness-06', 'harness', 'sequence', 'Teach me how tool calls are parsed from fenced blocks here.', [GOT_IT]),
  convo('harness-07', 'harness', 'sequence', 'Teach me the teach contract itself — how this very lesson is being graded.', [GOT_IT]),
  convo('harness-08', 'harness', 'sequence', 'Teach me what the architecture digest is and how it is budgeted.', [CONFUSED, GOT_IT]),
  // CS fundamentals over varied repos
  convo('cs-01', 'cs', 'makemore', 'Teach me big-O of building the counts table versus sampling one name.', [GOT_IT]),
  convo('cs-02', 'cs', 'makemore', 'Teach me what a dict-based string interner (stoi/itos) is and why both directions exist.', [GOT_IT]),
  convo('cs-03', 'cs', 'shopfront', 'Teach me what makes a service boundary real versus cosmetic, using two services here.', [GOT_IT]),
  convo('cs-04', 'cs', 'shopfront', 'Teach me idempotency using the payment flow in this repo as the example.', [CONFUSED]),
  convo('cs-05', 'cs', 'sequence', 'Teach me what a jail (path sandbox) is, from the real jail code here.', [GOT_IT]),
  convo('cs-06', 'cs', 'sequence', 'Teach me how SSE streaming works in this server, step by step.', [GOT_IT]),
  // Link/article lessons (fetch_url in-turn; network best-effort, graded the same)
  convo('link-01', 'link', 'makemore', 'Fetch https://en.wikipedia.org/wiki/Bigram and teach me bigrams: the article definition first, then this repo as the living example.', [GOT_IT]),
  convo('link-02', 'link', 'makemore', 'Fetch https://en.wikipedia.org/wiki/Markov_chain and teach me how this repo is a tiny Markov chain.', [GOT_IT]),
  convo('link-03', 'link', 'shopfront', 'Fetch https://en.wikipedia.org/wiki/Message_queue and teach me message queues using the real queue edges in this repo.', [GOT_IT]),
  convo('link-04', 'link', 'sequence', 'Fetch https://en.wikipedia.org/wiki/Model_Context_Protocol and teach me what MCP is and where this repo implements one.', [GOT_IT]),
  // Hard/mixed extras to clear 50 with room
  convo('mix-01', 'mixed', 'makemore', 'Teach me, Feynman-style, how I would explain this bigram model to a 12-year-old — still grounded in the real files.', [GOT_IT]),
  convo('mix-02', 'mixed', 'shopfront', 'Teach me how to READ an architecture diagram: use this repo as the worked example, one visual element at a time.', [GOT_IT]),
  convo('mix-03', 'mixed', 'sequence', 'Teach me the difference between a benchmark score and product quality, using the bench tools in this repo.', [GOT_IT]),
  convo('mix-04', 'mixed', 'makemore', 'Teach me where this tiny model fails — names it can never produce — from the code.', [GOT_IT]),
  convo('mix-05', 'mixed', 'shopfront', 'Quiz-teach me: show one service, ask me what I think it calls, then reveal the truth with evidence.', ['I think it calls the payments service directly.']),
  convo('mix-06', 'mixed', 'sequence', 'Teach me how this repo tests itself — the shape of one locking test.', [GOT_IT]),
  /*
   * THE REPOSITORY-LESS CONDITION (docs/research/lesson-kinds.md).
   *
   * Twenty asks a learner would actually type, across three subjects, with NO
   * repository attached. There is deliberately no filename-form control: the
   * whole point is that no structure exists to name, so the baseline is zero
   * visual by construction rather than by measurement.
   *
   * These are the asks the math conversations only LOOK like. Those are "the
   * math as used in this repo", attached to makemore, and already carry a code
   * chart; these carry nothing, and that is the condition a subject kind has to
   * be measured against.
   */
  convo('subj-01', 'math', null, 'Teach me about polynomials.', [GOT_IT]),
  convo('subj-02', 'math', null, 'Teach me why a derivative is a limit.', [CONFUSED, GOT_IT]),
  convo('subj-03', 'math', null, 'Teach me what a logarithm actually does.', [GOT_IT]),
  convo('subj-04', 'math', null, 'Teach me how to complete the square, step by step.', [GOT_IT]),
  convo('subj-05', 'math', null, 'Teach me what makes a function continuous.', [GOT_IT]),
  convo('subj-06', 'math', null, 'Teach me the difference between mean and median.', [GOT_IT]),
  convo('subj-07', 'math', null, 'Teach me why dividing by zero is undefined.', [CONFUSED, GOT_IT]),
  convo('subj-08', 'ml', null, 'Teach me what gradient descent is, from scratch.', [GOT_IT]),
  convo('subj-09', 'ml', null, 'Teach me what overfitting means and how you spot it.', [GOT_IT]),
  convo('subj-10', 'ml', null, 'Teach me how a neural network learns, in plain terms.', [CONFUSED, GOT_IT]),
  convo('subj-11', 'ml', null, 'Teach me the difference between precision and recall.', [GOT_IT]),
  convo('subj-12', 'ml', null, 'Teach me what a loss function is for.', [GOT_IT]),
  convo('subj-13', 'ml', null, 'Teach me why we split data into train and test.', [GOT_IT]),
  convo('subj-14', 'cs', null, 'Teach me what a hash table is and why it is fast.', [GOT_IT]),
  convo('subj-15', 'cs', null, 'Teach me how a binary search works, step by step.', [GOT_IT]),
  convo('subj-16', 'cs', null, 'Teach me what big-O notation is really saying.', [CONFUSED, GOT_IT]),
  convo('subj-17', 'cs', null, 'Teach me the difference between a stack and a queue.', [GOT_IT]),
  convo('subj-18', 'cs', null, 'Teach me what a race condition is.', [GOT_IT]),
  convo('subj-19', 'cs', null, 'Teach me how garbage collection decides what to free.', [GOT_IT]),
  convo('subj-20', 'cs', null, 'Teach me why immutability makes concurrency easier.', [GOT_IT]),
];

/* --------------------------------------------------------------- driver -- */

const cfg = {
  provider: 'openai-compat',
  model: process.env.SEQUENCE_AI_MODEL || 'minimax/minimax-m3:free',
  apiKey: process.env.SEQUENCE_AI_API_KEY || process.env.OPENROUTER_API_KEY,
  baseUrl: process.env.SEQUENCE_AI_BASE_URL || 'https://openrouter.ai/api/v1',
  params: {
    maxRetries: 3,
    temperature: 0,
    /*
     * NO HIDDEN REASONING, and a deadline that only a real stall can reach.
     *
     * granite42-hermes's chat template sets `enable_thinking = True` unless the
     * request says otherwise, so every turn of the 2026-09-04 run opened a
     * reasoning block nothing in this bench grades and no reader ever sees.
     * Measured against the live server on one short question: 1,200 ms with 316
     * characters of unseen reasoning, 343 ms with none. Across a 6-8K-token
     * Teach prompt it is the difference between the ~420 s conversations first
     * measured and the 1,835 s one that followed.
     *
     * `reasoningEffort`, not `think`: on the OpenAI-shaped wire this bench uses,
     * Ollama accepts and IGNORES `think` — measured, along with
     * `chat_template_kwargs`, which it also ignores.
     *
     * The bench measures the teach CONTRACT: whether a turn paces itself, ends
     * on a check-in, and ships a visual. Hidden reasoning is not part of that
     * contract, so paying for it distorts only the clock.
     */
    reasoningEffort: process.env.SEQUENCE_AI_REASONING_EFFORT || 'none',
    /*
     * NINETY SECONDS, AND THE NUMBER MATTERS BECAUSE THE SERVER'S IS 300.
     *
     * This was ten minutes, which is ABOVE the local runtime's ~5 min, so it
     * could never fire first: on 2026-09-06 seven requests hung, each answered
     * 500 after 5m03s, and the bench waited for every one of them. Thirty-five
     * minutes of a held GPU card bought nothing. A client deadline above the
     * server's is not a deadline, it is a comment.
     *
     * Ninety seconds is still well above the 30-60 s a healthy turn takes here,
     * so it cannot cut a good generation; it means a hang costs the card about a
     * minute instead of five, and ends as a REPORTED timeout that `errored`
     * counts and the scoreboard excludes.
     */
    timeoutMs: Number(process.env.SEQUENCE_AI_TIMEOUT_MS || CALL_TIMEOUT_MS),
  },
};
if (!cfg.apiKey) {
  console.error('teach-eval: no API key (SEQUENCE_AI_API_KEY / OPENROUTER_API_KEY)');
  process.exit(2);
}

// Mirror the CLI's provider wiring exactly (askCli.ts): tools attached, usage mapped.
const providerMod = await import(dist('server/provider.js'));
const toolsMod = await import(dist('server/askTools.js'));
const TOOLS = toolsMod.openaiAskToolDefinitions(toolsMod.askToolsForJobMode('code', 'full'));
/*
 * ONE GUARD FOR THE WHOLE RUN, because "two consecutive" is a property of the
 * run and not of any one call. It retries a timeout once and ends the run when
 * two calls in a row have hung — see tools/bench/lib/call-guard.mjs for why
 * both halves are needed and tools/ci/call-guard.test.mjs for the planted cases.
 */
const guard = makeCallGuard({
  /*
   * cfg.params, NOT cfg.model — `cfg.model` is a STRING, the model's name, so
   * `cfg.model.timeoutMs` was undefined and always had been. The guard then fell
   * back to its own CALL_TIMEOUT_MS default, so the ninety-second cap did hold —
   * by the default, not by this wiring — and the log line printed
   * "TIMEOUT ... at undefined ms" through a whole card run before anyone read it.
   * The commit that added this claimed cfg.model.timeoutMs was the deadline; it
   * never was.
   */
  timeoutMs: cfg.params.timeoutMs,
  onEvent: (e) =>
    console.error(`[teach-eval] TIMEOUT ${e.label} attempt ${e.attempt + 1} at ${cfg.params.timeoutMs} ms`),
});

const callProvider = async (c, prompt, _onDelta, opts) =>
  guard.run(() => callProviderOnce(c, prompt, _onDelta, opts), `turn ${prompt.length}ch`);

const callProviderOnce = async (c, prompt, _onDelta, opts) => {
  const { text, providerUsage, toolRequests } = await providerMod.generateTextWithUsage(c, prompt, {
    tools: TOOLS,
    ...(opts?.cacheBreakpointChars !== undefined
      ? { cacheBreakpointChars: opts.cacheBreakpointChars }
      : {}),
  });
  return {
    text,
    ...(toolRequests?.length ? { toolRequests } : {}),
    usage: providerUsage
      ? { inputTokens: providerUsage.inputTokens, outputTokens: providerUsage.outputTokens, estimated: false }
      : { inputTokens: Math.round(prompt.length / 4), outputTokens: Math.round(text.length / 4), estimated: true },
  };
};

/*
 * `hasVisual` USED TO LIVE HERE AND IS DELIBERATELY GONE.
 *
 * A bench that re-implements the rule it is benchmarking measures itself. This
 * copy had drifted from `gradeTeachTurn` on three points: it accepted ```mermaid
 * (the grader refuses it — only ```seqd reaches the board, so a wall of
 * `graph TD` is read, not seen), it accepted ANY fence containing `-->` or `=>`
 * (so a lesson showing one arrow function scored a visual), and it never looked
 * for `chart:proposal`, which is the event the contract actually asks for. It
 * also counted `topology:proposal`, a tool teach mode refuses outright.
 *
 * The turn now passes `visualThisTurn` to the grader and reads back its verdict,
 * so there is exactly one definition of "visual" in the repository.
 */

async function runConversation(c, graphs) {
  /*
   * NO REPOSITORY IS A CONDITION, NOT A MISSING FIELD.
   *
   * `docs/research/lesson-kinds.md` asks what happens when an ask has no
   * structure the product can check -- "teach me about polynomials" -- and the
   * bench could not answer, because every conversation in the bank attaches a
   * repository. The math conversations are the trap: they read like subject
   * asks and are all "the math AS USED IN THIS REPO", attached to makemore, and
   * they already carry visuals at 8 of 13 because the CODE chart fires for
   * them. Measuring a subject kind against those would credit it with the code
   * path's gain.
   *
   * `repo: null` is therefore a real absence: no path, no graph, no digest. The
   * baseline is zero visual BY CONSTRUCTION -- buildConceptChart returns
   * nothing without a graph -- which is what makes the condition worth having.
   */
  const repoPath = c.repo === null ? null : REPOS[c.repo];
  const { graph, digest } = c.repo === null ? { graph: null, digest: '' } : graphs[c.repo];
  const history = [];
  const turns = [];
  const questions = scriptedTurns(c, Number(process.env.TEACH_EVAL_MIN_TURNS || 0));
  /*
   * LESSON STATE, carried across the turns of this conversation.
   *
   * The product cannot do this yet — `/ask` has no chat-session identity, so the
   * server cannot key a lesson — but the bench calls `runAskPipeline` directly
   * and can pass `teachContext`, which is exactly where the measured defect
   * lives: 10 of the 17 fragment turns were "continue to the next point", a turn
   * whose contract demands one concept and whose `teachContext.concept` was
   * never filled by anybody.
   *
   * So the bench supplies it, and the fragment count is the test of whether
   * lesson state is what those turns were missing.
   */
  let lesson = newLesson(c.id, c.question, graph);
  /* WHAT ONE TURN HANDS THE NEXT. The bench carried prose only, so a turn that
     read brief.ts handed the next one a paragraph about brief.ts and none of it.
     See packages/analyzer/src/server/turnCarry.ts. */
  let carry = EMPTY_CARRY;
  for (let t = 0; t < questions.length; t++) {
    const events = [];
    const input = {
      question: questions[t],
      intents: [],
      scopeLines: [],
      surface: undefined,
      deictic: false,
      design: undefined,
      designMode: false,
      askMode: 'implementation',
      graph,
      digest,
      cfg,
      /* With no repository there is nothing to resolve and nothing to read:
         the reading tools must refuse rather than reach outside a root that
         does not exist. */
      resolveReadable: repoPath === null ? () => null : (rel) => resolveInRepo(repoPath, rel),
      repoRoot: repoPath,
      permission: 'full',
      teach: true,
      /* ONE assembly, shared with the ask handler (buildTeachContext). The two
         used to be written separately and drifted: the product passed
         lessonDone: {} where this passed neighbours, so every belt number here
         described a contract the product did not render. */
      /*
       * THE BENCH THREADS THE CARRY ITSELF, and until 2026-09-06 it did so
       * UNCONDITIONALLY -- which made `SEQUENCE_ASK_CARRY_WIRE` inert here and
       * the registered control arm identical to the treatment. The bench calls
       * `runAskPipeline` directly and never reaches `carryStore`, so the flag
       * gates the BENCH's threading, not the product's plumbing.
       *
       * WHAT THIS ARM MEASURES, said plainly so no result page overstates it:
       * the MECHANISM -- whether a carry block in the prompt changes a teach
       * turn. NOT the plumbing. A bench calling the pipeline directly measures
       * the pipeline, not the product.
       */
      ...(BENCH_CARRY ? { carry, turnIndex: t } : {}),
      teachContext: buildTeachContext({
        lesson,
        graph,
        ...(['short', 'mid', 'pad'].includes(process.env.TEACH_BELT)
          ? { beltVariant: process.env.TEACH_BELT }
          : {}),
      }),
      history: history.slice(-8),
      ...(c.attachment
        ? {
            attachmentLines: [
              `--- ATTACHMENT ${c.attachment.name} (uploaded by the learner) ---`,
              c.attachment.text,
            ],
          }
        : {}),
      callProvider,
      /*
       * NO TURN DEADLINE, STATED EXPLICITLY RATHER THAN INHERITED.
       *
       * The product now bounds an interactive turn at ASK_TURN_DEADLINE_MS,
       * because a reader is waiting. Nobody waits on a bench turn, and a
       * harness clock that cuts a slow turn would put a HARNESS artefact
       * into a number meant to measure the MODEL -- and would do it silently,
       * which is exactly how the d96eac49 advance-rule change made the
       * [4, 12] chart-call baseline incomparable (docs/research/redirect-visual-result.md).
       *
       * So the bench opts out on purpose. If a turn here is slow, that is a
       * finding about the model and it should show up as a slow turn, not as
       * a truncated one.
       */
      turnDeadlineMs: 0,
    };
    let text = '';
    let err = null;
    /* HOISTED. The graded record below reads coverage / premise / contextFit off
       the pipeline result, and a `const` declared inside the try is not visible
       there — `node --check` would not have caught that, only a run would. */
    let result = null;
    try {
      result = await runAskPipeline(input, (e) => events.push(e));
      text = result.text ?? '';
    } catch (e) {
      err = String(e && e.message ? e.message : e);
    }
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const basenames = new Set(
      graph.nodes
        .map((n) => String(n.label ?? n.id).replace(/\\/g, '/').split('/').pop().toLowerCase())
        .filter((b) => b.includes('.')),
    );
    /*
     * ALL FOUR ARGUMENTS, and the missing two are why this bench did not measure
     * the contract it claimed to. `gradeTeachTurn(text, basenames)` left
     * `readBasenames` and `visualThisTurn` undefined, and both rules that depend
     * on them are guarded — `if (readBasenames)` and `if (visualThisTurn ===
     * false)`. Undefined is not false, so the visual bounce and the
     * cite-without-reading bounce had NEVER fired here. JS arity is silent; the
     * grader is TypeScript and would have caught this, the bench is .mjs and did
     * not.
     *
     * Both are reconstructed the way the live pipeline builds them:
     * `filesReadThisTurn` from `file:read` events (askPipeline.ts:2142), and the
     * visual flag from charts-or-canvas (its call site passes
     * `chartsThisTurn > 0 || canvasWriteSucceededThisTurn`).
     */
    const readBasenames = new Set(
      events
        .filter((e) => e.type === 'file:read' && e.path)
        .map((e) => String(e.path).replace(/\\/g, '/').split('/').pop().toLowerCase()),
    );
    const visualThisTurn = events.some(
      (e) => e.type === 'chart:proposal' || e.type === 'canvas:block',
    );
    const problems = err
      ? ['error: ' + err]
      : gradeTeachTurn(text, basenames, readBasenames, visualThisTurn);
    const graded = {
      turn: t,
      words,
      /*
       * THE TURN'S OWN TEXT, which this report never kept.
       *
       * Everything above is a measurement OF the text — a word count, whether it
       * ends in a question mark, whether a chart call happened — and every one of
       * them is a claim the reader has to take on trust, because the thing being
       * measured was pushed into the conversation history and then dropped.
       *
       * It cost a re-run to answer "what were those seventeen short turns?", and
       * that question will be asked again of every future report. The same
       * omission already forced `skipper-eval.mjs` to refuse an entire
       * 117-turn report: it recorded `endsWithQuestion`, a COUNT, and discarded
       * the questions themselves.
       *
       * Capped at the same 2000 characters the history entry uses, so the report
       * carries exactly what the model was shown of its own last turn.
       */
      text: text.slice(0, 2000),
      endsWithQuestion: /\?\s*$/.test(text.trim()),
      /*
       * ENDS WITH A CHECK, which is not the same claim. Measured 2026-09-05: of
       * 31 questions across 47 turns, 15 were CLARIFYING — "would you like me to
       * show the diagram?" — the one shape the contract bans outright, and every
       * one of them satisfied `endsWithQuestion`. Both are recorded so the old
       * numbers stay comparable and the honest one sits beside them.
       */
      ...(() => {
        const v = gradeCheckIn(text);
        return {
          endsWithCheck: v.endsWithCheck,
          checkShape: v.shape,
          ...(v.parrotedLabel ? { parrotedLabel: true } : {}),
        };
      })(),
      /*
       * DERIVED FROM THE GRADER, not measured a second time here. The bench used
       * to carry its own `hasVisual`, and the two definitions drifted: it counted
       * a ```mermaid fence (which the grader deliberately refuses, because only
       * ```seqd reaches the board) and it counted ANY fence containing `-->` or
       * `=>` — so every lesson that showed a line of JavaScript scored a visual.
       * The grader already handles the prose fallback (```seqd or a box-drawing
       * glyph); asking it once and reading its verdict is the only way these two
       * cannot disagree again.
       */
      visual: !err && !problems.some((p) => p.includes('NO VISUAL')),
      /*
       * COVERAGE AND PREMISE ARE READ STRUCTURALLY, off the pipeline result —
       * never by looking for a phrase in the prose.
       *
       * A phrase list measures the WORDING and calls it the behaviour: it goes
       * green when a model happens to say "I did not read", and red when the
       * same honest turn says it differently. These fields are the product's own
       * verdicts, they ride the ask result (`askPayloadFields`), and reading them
       * is the difference between benchmarking the contract and benchmarking a
       * vocabulary. `null` is recorded when the field is absent, which for both
       * of these means "nothing to say" rather than "not checked".
       */
      /*
       * THE QUESTIONS THEMSELVES, not a count of them.
       *
       * This report recorded `endsWithQuestion` and nothing else, so the skipper
       * bench — which asks whether a comprehension question required having
       * FOLLOWED the lesson — had no input: the questions were never kept. A run
       * that measures presence and discards the thing present cannot be re-read
       * for anything else, and re-running costs hours on a shared card.
       *
       * Extracted by the same `extractQuestions` the skipper bench uses, so
       * "what counts as a question" has one definition rather than two that
       * drift — the failure this bench has already had once, with `hasVisual`.
       */
      questions: err ? [] : extractQuestions(text),
      /*
       * THE THREE-WAY SPLIT ON THE VISUAL METRIC, and without it a low visual
       * rate names no culprit.
       *
       *   chartCalls === 0                      the model NEVER ASKED for a
       *                                         chart → the prompt contract
       *   chartCalls > 0, chartProposals === 0  it asked and the tool refused
       *                                         → the tool surface
       *   chartProposals > 0 but visual false   it drew and the grade missed it
       *                                         → the grader
       *
       * `chart:proposal` fires only once a chart has validated against the
       * scanned graph, so the gap between the call and the event IS the refusal.
       * The historical 117-turn report could answer none of this: it recorded no
       * events at all, and its grader never ran the visual rule, so "the same
       * grader over the same tool surface" was true of neither half.
       */
      chartCalls: events.filter((e) => e.type === 'tool:start' && e.name === 'propose_chart').length,
      chartProposals: events.filter((e) => e.type === 'chart:proposal').length,
      /*
       * THE REFUSAL REASON, which the counts above cannot supply.
       *
       * Added 2026-09-04, four conversations into the first instrumented run,
       * on finding that ml-04 t0 recorded `chartCalls: 1, chartProposals: 0` —
       * a refusal — with no way to say what was wrong with the arguments. The
       * `asked-refused` class is exactly the one that would point at the tool
       * surface rather than the prompt contract, and a count without a cause
       * cannot do that: it is a number that ends the investigation instead of
       * starting it.
       *
       * The reason was in the event stream the whole time. askPipeline pushes
       * `tool:done` with `evidence` set to the refusal string when a tool call
       * is rejected, so this captures it for every propose_chart — refused or
       * not — and lets the run say WHICH validateChart rule bit.
       */
      /*
       * DID SOURCE THREE FIRE? The last run could not say. `propose_plan` was
       * built, the bench applied whatever plan arrived, and nothing recorded
       * whether the model ever called it — so "the queue is still empty" and
       * "the model never planned" were indistinguishable, which is the same
       * failure that made the first lesson-state run unreadable.
       */
      planCalls: events.filter((e) => e.type === 'tool:start' && e.name === 'propose_plan').length,
      planAccepted: events.filter((e) => e.type === 'plan:proposed').length,
      planOutcomes: events
        .filter((e) => e.type === 'tool:done' && e.name === 'propose_plan')
        .map((e) => e.evidence ?? null),
      /* What the turn was actually handed, so a metric can be read against it. */
      /* THE STUB LINE, FROM THE PRODUCT. Every stub figure in docs/research
         was computed at 35 words by an analysis script, while the bench source
         defined no such threshold and the product did not know it -- three
         places, one number, none of them shared. Recorded per turn now, from
         the constant the product gates on, so a report and the behaviour it
         describes cannot drift. */
      stub: (text.trim().split(/\s+/).filter(Boolean).length || 0) <= TEACH_STUB_WORDS
        && !/\?\s*$/.test(text.trim()),
      queueLen: lesson.queue.length,
      conceptGiven: nextConcept(lesson)?.title ?? null,
      chartOutcomes: events
        .filter((e) => e.type === 'tool:done' && e.name === 'propose_chart')
        .map((e) => e.evidence ?? null),
      /*
       * THE CHART ITSELF, not just the one-line summary.
       *
       * Two accepted model-authored charts needed re-examining against the
       * graph -- were their edges real? -- and the report held only
       * `charted data-flow "..." (3 items)`. A summary cannot answer a question
       * about content, and re-running to recover it costs a card slot.
       */
      charts: events
        .filter((e) => e.type === 'chart:proposal')
        .map((e) => e.chart ?? null),
      coverage: result?.coverage ?? null,
      premise: result?.premise ?? null,
      contextFit: result?.contextFit ?? null,
      contractProblems: problems,
      /*
       * WHY THE TURN STOPPED — `atCap` decomposed, which the report has never
       * carried.
       *
       * Reading the two next-picture arms, ten of 28 turns had a chart,
       * substantive prose, no model check-in and no derived one. The only
       * condition left in that branch of askPipeline is
       * `atCap = atCeiling || spentOnNothing || outOfTime`, and nothing wrote it
       * down, so the largest bucket in the analysis could not be confirmed from
       * the files — only inferred by elimination.
       *
       * THE PIPELINE ALREADY REPORTS IT. `metrics.stopReason` is exactly those
       * three ('ceiling', 'no-progress', 'deadline') plus 'complete' and
       * 'breaker', and `metrics.rounds` is the count. The product was not
       * missing the quantity; the bench was throwing it away. Nothing new is
       * derived here — a second definition of "at cap" beside the pipeline's own
       * would be the two-handlers defect wearing a bench costume.
       */
      stopReason: result?.metrics?.stopReason ?? null,
      rounds: result?.metrics?.rounds ?? null,
      /* WHICH GATE CLOSED ON THE CHECK-IN. The companion to stopReason: nine
         turns drew a chart and asked nothing, and the reason was guessed at twice
         and wrong twice because nothing wrote it down. */
      checkInSkipped: result?.checkInSkipped ?? null,
      /*
       * FABRICATION, WHICH THE BELT CONDITION COULD NOT MEASURE AT ALL.
       *
       * `claims.unsupportedTechnologies` is produced by the pipeline and was
       * never recorded here, so the belt run — whose whole registered risk was
       * fabrication rising when the tool instructions came out — reported
       * UNMEASURABLE on the kill that mattered most. A threshold registered
       * against a quantity the INSTRUMENT cannot produce.
       *
       * `checked` rides with it because the check itself says why: "an empty
       * finding list from a check that could not run is not a clean bill of
       * health". A zero here means nothing without it.
       */
      /*
       * ABSENT IS NOT ZERO, AND THE BENCH IS WHERE THAT GETS RESOLVED.
       *
       * The product sets `claims` ONLY when the check has findings, on purpose:
       * `claim-check-stream.test.ts` says "absent, not empty: the field's
       * presence is the signal, so an empty report on every clean answer would
       * make it meaningless." That is a deliberate design with a test behind it
       * and it is not weakened to suit a measurement.
       *
       * But it makes a clean answer and an unrun check identical from out here,
       * which is the third distinct reason the fabrication clause has failed to
       * measure. So the bench records what IT knows: the check runs when the
       * turn is not design mode, has a graph, and produced non-empty text —
       * every one of which is visible here. `ran` carries that, so a zero has a
       * denominator and a stub turn is never counted as a clean bill of health.
       */
      claims: (() => {
        const text = result?.text ?? '';
        /*
         * DERIVED FROM WHAT IS CERTAINLY LOCAL. The pipeline runs the check
         * when `!designMode && graph && text.trim()` — and this bench sets
         * `designMode: false` and attaches `graph` on EVERY turn (see the input
         * object above), so text is the only term that varies. Written this way
         * rather than reading those two variables because `node --check`
         * accepts an identifier that is not in scope, and this file has already
         * paid for that once today.
         *
         * If the bench ever gains a design mode, or a run without a graph, this
         * line is wrong and the comment is where to start.
         */
        const ran = text.trim().length > 0;
        if (!result?.claims) {
          return { unsupportedTechnologies: 0, unsupportedTerms: [], unknownPaths: 0, checked: null, ran };
        }
        return {
          unsupportedTechnologies: (result.claims.unsupportedTechnologies ?? []).length,
          unsupportedTerms: (result.claims.unsupportedTechnologies ?? []).map((u) => u.term),
          unknownPaths: (result.claims.unknownPaths ?? []).length,
          checked: result.claims.checked ?? null,
          ran,
        };
      })(),
      error: err,
    };
    /* A plan the model wrote this turn becomes the queue, once. */
    for (const e of events) {
      if (e.type === 'plan:proposed') lesson = applyPlan(lesson, e.concepts);
    }
    turns.push(graded);
    /*
     * The queue advances ONLY on a turn that actually taught — the grader's own
     * two hard rules, a visual and a closing check-in. A bounced turn leaves
     * `queue[0]` where it is so the next turn re-teaches the same concept
     * instead of silently skipping it.
     */
    const taughtBefore = lesson.taught.length;
    lesson = advanceLesson(lesson, {
      /*
       * `endsWithCheck`, matching the product. This advanced on
       * `endsWithQuestion` — a trailing question mark — while repoServer's ask
       * handler advances on the honest check, so a turn closing with "would you
       * like me to show the diagram?" consumed a concept HERE and did not in the
       * product. A bench that advances on a rule the product does not use is
       * measuring a different lesson.
       */
      /* THE PRODUCT'S OWN PREDICATE, not a copy. These two drifted once already —
         the bench advanced on a trailing question mark while the product advanced
         on an honest check — and the 2026-09-06 ruling (a turn that taught and did
         not ask still advances) has to reach both or the bench measures a lesson
         the product does not run. */
      passed: taughtThisTurn({ visual: graded.visual === true, endsWithCheck: graded.endsWithCheck === true }),
      turn: t,
    });
    /*
     * CARRY THE NEXT-PICTURE PREDICTION INTO THE NEXT TURN, through the product's
     * own rule.
     *
     * Without this the bench asked seven next-picture questions across two card
     * runs and produced ZERO reveals — not rarely, never. The reveal is what
     * scores the registered band, and in the product it round-trips
     * askPipeline -> teachTurn.finish() writing lesson.open -> the next turn
     * reading teachContext.open. The bench calls runAskPipeline directly, so
     * finish() never ran and nothing carried it: a two-turn contract measured by
     * a one-turn harness.
     *
     * `carryPrediction` is the product's function, not a copy of it. A bench that
     * decided separately what carrying means would be the same defect one layer
     * out — and buildTeachContext above already forwards `lesson.open`, so this
     * one assignment is the whole repair.
     */
    lesson = carryPrediction(lesson, result?.openPrediction, taughtBefore);
    if (result?.carryOut) carry = result.carryOut;
    if (err) break;
    history.push({ role: 'user', text: questions[t] });
    history.push({ role: 'assistant', text: text.slice(0, 2000) });
  }
  const assistantTurns = turns.filter((t) => !t.error);
  const paced = assistantTurns.filter((t) => t.words > 0 && t.words <= 250).length;
  const questioned = assistantTurns.filter((t) => t.endsWithQuestion).length;
  const visualed = assistantTurns.filter((t) => t.visual).length;
  return {
    id: c.id,
    domain: c.domain,
    repo: c.repo,
    /* The final lesson, so `TEACH_EVAL_WRITE_SESSIONS` can put it on disk as a
       real session. Carried always; written only under the flag. */
    lesson,
    turns,
    score: {
      turnsRun: turns.length,
      errored: turns.some((t) => t.error) ? 1 : 0,
      pacedRate: assistantTurns.length ? paced / assistantTurns.length : 0,
      questionRate: assistantTurns.length ? questioned / assistantTurns.length : 0,
      visualRate: assistantTurns.length ? visualed / assistantTurns.length : 0,
    },
  };
}

async function main() {
  const outDir = path.join(here, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  /* A BOUNDED RUN IS A REAL RUN, and it must say so. `TEACH_EVAL_LIMIT=20` takes
     the first N conversations; the count and the cap are printed and written into
     the report, because a number whose denominator is not stated is a claim
     rather than a measurement (docs/how-to-verify.md, third law). */
  const limit = Number(process.env.TEACH_EVAL_LIMIT || '') || BANK.length;
  /*
   * A SECOND CONDITION, BECAUSE THE INSTRUMENT COULD NOT SEE THE CHANGE.
   *
   * `TEACH_EVAL_LIMIT=20` takes the first twenty, and every one of them runs on
   * `makemore`: three Python files. So the re-export change -- 2,600 edges to
   * 2,851 on this repository, one dependency edge in eleven -- was invisible to
   * every number the bench produces, because makemore has no re-exports and is
   * not even JavaScript.
   *
   * `TEACH_EVAL_REPO=sequence` selects the conversations that run on a
   * JavaScript/TypeScript repository instead. It does NOT change the makemore
   * twenty: every figure on record is comparable on those and stays so, which
   * is why this filters rather than reorders.
   */
  const only = process.env.TEACH_EVAL_REPO;
  /* `TEACH_EVAL_REPO=none` selects the repository-less condition; any other
     value names a repository in REPOS. */
  const pool = only ? BANK.filter((c) => (only === 'none' ? c.repo === null : c.repo === only)) : BANK;
  const BANK_RUN = pool.slice(0, limit);
  console.log(
    `teach-eval: ${BANK_RUN.length} of ${pool.length} conversations` +
      (only ? ` on ${only}` : '') +
      `, model ${cfg.model}`,
  );
  const graphs = {};
  for (const [name, repoPath] of Object.entries(REPOS)) {
    const graph = await scanRepoCached(repoPath, { cluster: true });
    graphs[name] = { graph, digest: buildDigest(graph) };
    console.log(`scanned ${name}: ${graph.nodes.length} nodes`);
  }
  /*
   * ── TEACH_EVAL_WRITE_SESSIONS ─────────────────────────────────────────────
   *
   * The bench builds a lesson per conversation IN MEMORY and never writes one.
   * That is right for a bench — a run should not litter a workspace — but it
   * means the checkpoint's registered prediction ("open the 13 sequence-condition
   * lessons on the current build") has nothing to open.
   *
   * Under this flag each conversation is written as a real session: `lesson.json`
   * stamped with the build that wrote it, and `canvas.json` carrying the charts
   * the run actually produced. Off by default, and the sessions it writes are
   * named `bench-<id>` so they are identifiable and removable as a set — the
   * fifteen contentless sessions an unflagged instrument left in this repository
   * are the reason that matters.
   */
  const WRITE_SESSIONS = process.env.TEACH_EVAL_WRITE_SESSIONS === '1';
  /*
   * The same `builtAt` the running server reports: the mtime of the entry file
   * the analyzer is executing. Deliberately not a commit — a commit says what
   * the tree is on, not what this process loaded, which is the distinction
   * `/api/build` was built to make.
   */
  const BUILT_AT = (() => {
    try {
      return fs.statSync(path.join(root, 'packages/analyzer/dist/cli.js')).mtime.toISOString();
    } catch {
      return null;
    }
  })();
  let sessionsWritten = 0;
  const writeBenchSession = (r) => {
    if (!WRITE_SESSIONS || r.repo === null) return;
    const repoRoot = REPOS[r.repo];
    if (repoRoot === undefined) return;
    const id = `bench-${r.id}`;
    const dir = path.join(repoRoot, '.sequence', 'sessions', id);
    fs.mkdirSync(dir, { recursive: true });
    const charts = r.turns.flatMap((t) => t.charts ?? []);
    fs.writeFileSync(
      path.join(dir, 'lesson.json'),
      `${JSON.stringify({ ...r.lesson, sessionId: id, writtenBy: BUILT_AT, turn: r.turns.length }, null, 2)}
`,
    );
    fs.writeFileSync(
      path.join(dir, 'canvas.json'),
      `${JSON.stringify({ version: 1, sessionId: id, blocks: [], charts }, null, 2)}
`,
    );
    /*
     * AND REGISTER IT IN THE INDEX, or it does not exist.
     *
     * The first version wrote the two files and stopped. `GET /api/sessions/:id`
     * refuses an id that is not in `index.json` — correctly — so all thirteen
     * answered 404, the checkpoint prediction measured nothing, and it reported
     * "MIGRATED 0 of 0" as though that were a clean result. They were also
     * invisible in the session list, which is the same fact seen from the user's
     * side.
     *
     * A session directory is not a session. The index is what makes it one.
     */
    const idxPath = path.join(repoRoot, '.sequence', 'sessions', 'index.json');
    let idx = { version: 1, activeId: null, sessions: [] };
    try {
      idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
    } catch {
      /* No index yet: the shape above is the empty one. */
    }
    const now = new Date().toISOString();
    idx.sessions = [
      { id, title: r.id, createdAt: now, updatedAt: now, mode: 'code' },
      ...(idx.sessions ?? []).filter((x) => x.id !== id),
    ];
    fs.writeFileSync(idxPath, `${JSON.stringify(idx, null, 2)}
`);
    sessionsWritten += 1;
  };

  const results = [];
  for (const c of BANK_RUN) {
    const started = Date.now();
    const r = await runConversation(c, graphs);
    results.push(r);
    writeBenchSession(r);
    const s = r.score;
    console.log(
      `[${results.length}/${BANK.length}] ${c.id} (${c.domain}/${c.repo ?? 'no-repo'}) ` +
        `turns=${s.turnsRun} paced=${(s.pacedRate * 100).toFixed(0)}% ` +
        `q=${(s.questionRate * 100).toFixed(0)}% visual=${(s.visualRate * 100).toFixed(0)}% ` +
        `${s.errored ? 'ERROR ' : ''}${Math.round((Date.now() - started) / 1000)}s`,
    );
    /*
     * EVERY ARM KEEPS ITS OWN FILE, AND THE ARM NAMES ITSELF.
     *
     * This wrote only `teach-eval-report.json`, and on 2026-09-07 a four-arm
     * measurement lost three arms to it: each run overwrote the last, and only
     * the final arm's detail survived. The scoreboard goes to the log, so
     * charts could still be read while three registered clauses -- concepts,
     * refusals and fabrication -- had been recorded per turn and then deleted.
     * Four exit codes of zero, nothing errored, three quarters of the
     * measurement gone. It cost 8,797 seconds of card.
     *
     * The first fix was `TEACH_EVAL_OUT=<name>`, and it was the wrong shape: it
     * put the arm's identity in a variable somebody has to remember to set, and
     * the failure it prevents is precisely the failure of forgetting. So the
     * filename is now DERIVED from what makes an arm an arm -- the repo, the
     * flags in force, and the run's start instant. Two arms of the same
     * configuration still differ by instant, so no run can land on another's
     * file no matter what anyone remembers.
     *
     * `TEACH_EVAL_OUT` still overrides, for a human who wants a readable name.
     */
    const armName = armFileName({
      repo: process.env.TEACH_EVAL_REPO,
      wire: BENCH_CARRY,
      refs: process.env.SEQUENCE_ASK_CARRY_REFERENTS === '1',
      trim: process.env.SEQUENCE_ASK_TRIM_TOOLS === '1',
      startedAt: RUN_STARTED_AT,
      override: process.env.TEACH_EVAL_OUT,
    });
    const armPath = path.join(outDir, `${armName}.json`);
    /*
     * REFUSE TO OVERWRITE. A run that would land on an existing arm's file
     * stops rather than replacing it -- the whole defect this section exists
     * for was one file quietly becoming another.
     */
    let priorWhen = null;
    const armExists = fs.existsSync(armPath);
    if (armExists) {
      try {
        priorWhen = JSON.parse(fs.readFileSync(armPath, 'utf8')).when ?? null;
      } catch {
        priorWhen = null;
      }
    }
    if (wouldClobberAnotherRun({ exists: armExists, priorWhen, runStartedAt: RUN_STARTED_AT })) {
      console.error(
        `teach-eval: REFUSED -- ${armPath} belongs to another run (when=${priorWhen ?? 'unreadable'}). ` +
          'An arm must not overwrite an arm. Move it, or set TEACH_EVAL_OUT.',
      );
      process.exit(3);
    }
    const payload = JSON.stringify({ model: cfg.model, when: RUN_STARTED_AT, results }, null, 1);
    fs.writeFileSync(armPath, payload);
    /* The fixed path stays for whatever reads it by name. It is the COPY now,
       not the record. */
    fs.writeFileSync(path.join(outDir, 'teach-eval-report.json'), payload);

    /*
     * ASSERT THE WRITE, DO NOT MERELY PERFORM IT.
     *
     * The same rule the mutation harness learned an hour earlier: a step that
     * cannot tell you it failed is a step you did not take. Re-read what was
     * just written and check it parses and holds every conversation.
     */
    let persisted;
    try {
      persisted = JSON.parse(fs.readFileSync(armPath, 'utf8'));
    } catch (e) {
      console.error(`teach-eval: REFUSED -- ${armPath} did not read back as JSON: ${e.message}`);
      process.exit(4);
    }
    if ((persisted.results?.length ?? 0) !== results.length) {
      console.error(
        `teach-eval: REFUSED -- ${armPath} holds ${persisted.results?.length ?? 0} conversations, ` +
          `the run produced ${results.length}.`,
      );
      process.exit(4);
    }
    console.log(`teach-eval: arm written to ${path.basename(armPath)} (${results.length} conversations)`);
  }
  const ok = results.filter((r) => !r.score.errored);

  /*
   * THE ARTEFACT GATE — a scoreboard is not permission to believe a run.
   *
   * Mechanism A ended with four exit codes of zero, four scoreboards, and three
   * of its four registered clauses holding no data. The scoreboard reports what
   * it can compute from what survived; it has no idea what the registration
   * asked for. So this asserts, BEFORE the scoreboard prints, that the per-turn
   * fields the registered clauses read are actually present.
   *
   * `claims` is the one that has now been unmeasured twice for two different
   * reasons — absent from the bench for the belt run, and deleted by an
   * overwrite for this one — so it is named first and checked hardest.
   *
   * Errored turns are exempt: a turn that never reached the provider has
   * nothing to record, and demanding fields of it would make the gate fire on
   * the one thing it should not.
   */
  const { checked, claimsRan, broken } = artefactGaps(results);
  if (checked === 0) {
    console.error('teach-eval: REFUSED — no clean turns to score. A run that measured nothing must not print a scoreboard.');
    process.exit(5);
  }
  if (broken.length > 0) {
    console.error(
      `teach-eval: REFUSED — ${checked} clean turns, and a registered clause has no data: ` +
        broken.map(([k, n]) => `${k} missing on ${n}`).join('; ') +
        '. A run that produced three quarters of nothing must not end with a zero.',
    );
    process.exit(5);
  }
  console.log(
    `teach-eval: artefacts present on all ${checked} clean turns; ` +
      `the claim check RAN on ${claimsRan} of them (a fabrication zero is read against that, not against ${checked})`,
  );

  const avg = (k) => (ok.reduce((a, r) => a + r.score[k], 0) / Math.max(1, ok.length)) * 100;
  console.log('---- SCOREBOARD ----');
  console.log(`conversations: ${results.length} (${ok.length} clean, ${results.length - ok.length} errored)`);
  console.log(`paced (<=250 words): ${avg('pacedRate').toFixed(1)}%`);
  console.log(`ends with check-in:  ${avg('questionRate').toFixed(1)}%`);
  console.log(`visual present:      ${avg('visualRate').toFixed(1)}%`);
  const byDomain = {};
  for (const r of ok) {
    (byDomain[r.domain] ??= []).push(r);
  }
  for (const [d, rs] of Object.entries(byDomain)) {
    const a = (k) => ((rs.reduce((x, r) => x + r.score[k], 0) / rs.length) * 100).toFixed(0);
    console.log(`  ${d.padEnd(8)} n=${rs.length}  paced=${a('pacedRate')}% q=${a('questionRate')}% visual=${a('visualRate')}%`);
  }
}

main().catch((e) => {
  console.error('teach-eval failed:', e);
  process.exit(1);
});
