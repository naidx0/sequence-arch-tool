import assert from 'node:assert';
import { test } from 'node:test';

import { classifyAskIntent, isDrawishAskQuestion, isTeachAskQuestion } from '../server/askIntent.js';

/* ════════════════════════════════════════════════════════════════════════════
   TEACH — the 2026-09-02 owner failure, locked.

   He typed a "teach me this: …" question with the Teach control unselected and
   the classifier heard `chat`, so the teach contract never entered the belt and
   the answer interrogated him about chart formats. Every case below is one of
   the shapes that must never fall through again, plus the shapes that must NOT
   be captured — a lesson refuses the edit tools, so a mis-fired teach turn is a
   turn that cannot do the work it was asked for.
   ════════════════════════════════════════════════════════════════════════════ */

test('classifyAskIntent: teach — the owner\'s verbatim 2026-09-02 question', () => {
  const verbatim =
    'teach me this: AI Overview — Learn Supervised Learning, which is the foundational ' +
    'machine learning concept where an algorithm learns from labeled data to make predictions.';
  assert.strictEqual(classifyAskIntent(verbatim), 'teach');
  assert.strictEqual(isTeachAskQuestion(verbatim), true);
});

test('classifyAskIntent: teach — the real request shapes', () => {
  assert.strictEqual(classifyAskIntent('teach me this'), 'teach');
  assert.strictEqual(classifyAskIntent('Teach me how backpressure works'), 'teach');
  assert.strictEqual(classifyAskIntent('explain supervised learning to me'), 'teach');
  assert.strictEqual(classifyAskIntent('walk me through the request lifecycle'), 'teach');
  assert.strictEqual(classifyAskIntent('help me understand event sourcing'), 'teach');
  assert.strictEqual(classifyAskIntent('what is a vector embedding'), 'teach');
  assert.strictEqual(classifyAskIntent('what does idempotent mean'), 'teach');
  assert.strictEqual(classifyAskIntent('eli5 consistent hashing'), 'teach');
});

test('classifyAskIntent: teach beats draw — a lesson that says "diagram" is still a lesson', () => {
  // The failing turn drew ONE markdown block because nothing said "lesson".
  assert.strictEqual(classifyAskIntent('teach me this and draw a diagram of it'), 'teach');
  assert.strictEqual(classifyAskIntent('walk me through OAuth, visualize each step'), 'teach');
});

test('classifyAskIntent: an edit ask that merely contains "explain" is NOT a lesson', () => {
  // Teach mode REFUSES edit_file/propose_files, so a false teach here would
  // leave the user's actual request impossible to carry out.
  assert.strictEqual(classifyAskIntent('fix the auth bug and explain it to me'), 'edit');
  assert.strictEqual(
    classifyAskIntent('refactor orders.ts to use a repository and explain what you changed'),
    'edit',
  );
  assert.strictEqual(isTeachAskQuestion('fix the auth bug and explain it to me'), false);
  // "teach me" outranks even an edit verb: it is a lesson ABOUT a fix.
  assert.strictEqual(classifyAskIntent('teach me how to fix the routing bug'), 'teach');
});

test('classifyAskIntent: teaching material has to be ASKED FOR, not merely mentioned', () => {
  /*
   * `tutorial` / `crash course` / `beginner's guide` used to sit in the
   * imperative tier as bare nouns, and that tier returns BEFORE the edit
   * short-circuit — so an edit request that cited a tutorial became a lesson
   * that refuses edit_file, propose_files, propose_topology and run_command for
   * the whole turn, with nothing on screen but "Taught this as a lesson".
   */
  assert.strictEqual(
    classifyAskIntent('Fix the broken step in deploy.yml — the docs tutorial says it needs a cache key'),
    'edit',
  );
  assert.strictEqual(
    isTeachAskQuestion('the crash course in the README is wrong, update it'),
    false,
  );
  // Asked for, not mentioned: still a lesson.
  assert.strictEqual(classifyAskIntent('give me a crash course on backpressure'), 'teach');
  assert.strictEqual(classifyAskIntent('write me a beginner\'s guide to embeddings'), 'teach');
  assert.strictEqual(classifyAskIntent('give me an overview of supervised learning'), 'teach');
});

test('classifyAskIntent: a "what is <state>" question is status, not a lesson', () => {
  /*
   * Measured against the shipped classifier: each of these classified `teach`,
   * which caps the answer at ~150 words on ONE concept, demands a chart, and
   * refuses run_command — so the agent could not run the suite that answers the
   * question. The excludes list cannot catch them: they name no repo noun at
   * all.
   */
  for (const q of [
    'what is failing in CI right now',
    'what is wrong with this code?',
    'what is broken here?',
    'what is happening with the build',
  ]) {
    assert.notStrictEqual(classifyAskIntent(q), 'teach', q);
    assert.strictEqual(isTeachAskQuestion(q), false, q);
  }
  // A gerund CONCEPT is not a state — these stay lessons.
  assert.strictEqual(classifyAskIntent('what is caching'), 'teach');
  assert.strictEqual(classifyAskIntent('what is sharding'), 'teach');
});

test('classifyAskIntent: the product answers its OWN surfaces as lookups, not lessons', () => {
  // Risks, cycles, impact and the graph are the grounded-logic questions
  // Sequence exists to answer; a 150-word one-concept lesson answers them worse.
  for (const q of [
    'what are the current risks',
    'what are the cycles in the graph?',
    'what is the impact of this change',
    'what is this error?',
  ]) {
    assert.notStrictEqual(classifyAskIntent(q), 'teach', q);
  }
});

test('classifyAskIntent: explore keeps the bare lookup shapes', () => {
  /*
   * THE DECIDED PRECEDENCE. A bare "how does X work" is the commonest grounded
   * lookup in a tool whose subject is your own repo, and is deliberately in no
   * teach pattern; the learner has to be in the sentence for a lesson to fire.
   */
  assert.strictEqual(classifyAskIntent('How does the gateway work?'), 'explore');
  assert.strictEqual(classifyAskIntent('explain how the scanner works'), 'explore');
  assert.strictEqual(classifyAskIntent('teach me how the gateway works'), 'teach');
  assert.strictEqual(classifyAskIntent('help me understand how the gateway works'), 'teach');
  // A "what are" that is really a graph lookup stays explore.
  assert.strictEqual(classifyAskIntent('what are the callers of parseGraph?'), 'explore');
});

test('classifyAskIntent: "what is" pointed at the user\'s own material is not a concept question', () => {
  assert.strictEqual(classifyAskIntent('What is the purpose of this repo?'), 'chat');
  assert.strictEqual(classifyAskIntent('what is the auth module'), 'chat');
});

test('classifyAskIntent: draw — diagram / board / canvas language', () => {
  assert.strictEqual(classifyAskIntent('Draw me a travel insurer architecture on the board'), 'draw');
  assert.strictEqual(classifyAskIntent('Visualize the checkout flow as a mermaid diagram'), 'draw');
  assert.strictEqual(classifyAskIntent('Sketch a wireframe on the canvas'), 'draw');
  assert.strictEqual(classifyAskIntent('Map out the services'), 'draw');
});

test('classifyAskIntent: edit — change / fix / refactor language', () => {
  assert.strictEqual(classifyAskIntent('Fix the auth bug in gateway'), 'edit');
  assert.strictEqual(classifyAskIntent('Refactor orders.ts to use a repository'), 'edit');
  assert.strictEqual(classifyAskIntent('Implement retry logic for the worker'), 'edit');
  assert.strictEqual(classifyAskIntent('Update the README and remove the stale section'), 'edit');
});

test('classifyAskIntent: explore — callers / dependencies / search language', () => {
  assert.strictEqual(classifyAskIntent('What calls the billing service?'), 'explore');
  assert.strictEqual(classifyAskIntent('Who depends on gateway?'), 'explore');
  assert.strictEqual(classifyAskIntent('Search for where SEQUENCE_BIND_HOST is used'), 'explore');
  assert.strictEqual(classifyAskIntent('Find where we parse JWT tokens'), 'explore');
  assert.strictEqual(classifyAskIntent('Trace the request path through nginx'), 'explore');
});

test('classifyAskIntent: chat — general questions without edit/explore/draw signals', () => {
  assert.strictEqual(classifyAskIntent('What is the purpose of this repo?'), 'chat');
  assert.strictEqual(classifyAskIntent('Summarize the architecture in plain English'), 'chat');
  assert.strictEqual(classifyAskIntent(''), 'chat');
});

test('classifyAskIntent: draw beats edit when both appear', () => {
  assert.strictEqual(
    classifyAskIntent('Draw a diagram and then fix the labels'),
    'draw',
  );
});

test('isDrawishAskQuestion matches classifyAskIntent draw bucket', () => {
  const drawish = 'Show this on the board as a flowchart';
  assert.strictEqual(classifyAskIntent(drawish), 'draw');
  assert.strictEqual(isDrawishAskQuestion(drawish), true);
  assert.strictEqual(isDrawishAskQuestion('What calls billing?'), false);
});

test('classifyAskIntent: the product\'s own vocabulary for its surfaces classifies draw', () => {
  // Measured on a real journey walk (2026-08-29): this exact phrasing
  // classified `chat`, so no canvas tools armed and no draw contract fired.
  assert.strictEqual(
    classifyAskIntent(
      'Propose adding a rate-limiter service in front of the backend on the architecture board (compact).',
    ),
    'draw',
  );
  assert.strictEqual(classifyAskIntent('Put the checkout flow onto the whiteboard canvas'), 'draw');
  assert.strictEqual(classifyAskIntent('show the services on the arch board'), 'draw');
  // An unrelated "board"-ish word is NOT a drawing ask.
  assert.notStrictEqual(classifyAskIntent('why does the onboarding flow fail?'), 'draw');
});

test('A REPO DEICTIC IS A LOOKUP, NOT A LESSON — "what is fragile here?"', () => {
  /*
   * THIS IS THE SHAPE THAT BROKE THE GATE, not a convenient one. `/api/ask`'s
   * "a request with NO surface field builds the byte-identical prompt" asks
   * exactly "what is fragile here?" and failed `6 !== 2`: the question
   * classified `teach`, the teach contract engaged, and one provider call
   * became three. A lookup had silently become a lesson — and on a turn that
   * needed to edit, teach mode would have refused the tools to do it.
   *
   * Two independent guards, because either alone leaves the family open:
   * "fragile" belongs in the closed class of STATE words beside "flaky" and
   * "slow", and "here" is a repo deictic that scopes any of them to the
   * attached repository without naming a noun the excludes list could match.
   */
  assert.notStrictEqual(classifyAskIntent('what is fragile here?'), 'teach');
  assert.notStrictEqual(classifyAskIntent('what is slow here?'), 'teach');
  assert.notStrictEqual(classifyAskIntent('what is risky right now?'), 'teach');
  assert.notStrictEqual(classifyAskIntent('what are the brittle parts currently?'), 'teach');

  /*
   * AND THE FIX MUST NOT EAT THE FEATURE. A concept question with no deictic
   * and no state word is still the lesson this tier exists for — if these flip,
   * the guard has been widened into a kill switch.
   */
  assert.strictEqual(classifyAskIntent('what is supervised learning?'), 'teach');
  assert.strictEqual(classifyAskIntent('what is sharding?'), 'teach');
  /* The owner's own failing sentence, still a lesson. */
  assert.strictEqual(
    classifyAskIntent('teach me this: AI Overview — Learn Supervised Learning'),
    'teach',
  );
});
