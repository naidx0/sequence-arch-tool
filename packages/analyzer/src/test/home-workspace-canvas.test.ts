import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isArchitectureDesignAsk,
  renderAskInstructionBelt,
  type AskInstructionHashInput,
} from '../server/askPipeline.js';
import { askOpenAiToolSupplemental } from '../server/askTools.js';

/**
 * THE BLANK WORKSPACE IS A CANVAS, NOT A DESIGN BRIEF.
 *
 * THE REPORT, owner walking the installed app, 2026-09-17. In the blank/home
 * workspace he asked "explain LLMs and their internal architecture using visuals
 * in 3D" and the reply told him it would "stage three to five assumptions, then
 * emit an SEQD diagram". He wanted it BUILT on the AI Canvas — markdown,
 * mermaid, svg, html, react.
 *
 * TWO PEOPLE OPEN THE SAME EMPTY SCREEN. One is designing a system that does not
 * exist and wants the architecture board; the other wants something explained
 * and wants to see it. They shared one branch because neither has a repository,
 * and the branch belonged to the first of them: web2 sets `proposeArchitecture`
 * on every non-teach repo-less turn, and the belt answered with the
 * `propose_topology` grammar.
 *
 * THE FIX IS A SUBSTITUTION, not a note added underneath. This tree's own
 * record is explicit that an appended counter-instruction loses to the law it
 * argues with (measured 0/1 against 3/3 for removing the law). So on an
 * explanatory home-workspace turn the architecture section is NOT RENDERED and
 * the canvas section stands in its place.
 *
 * TEACH MODE IS UNTOUCHED, and every assertion about it here is there to prove
 * that: the lesson contract already owns what a teach turn draws.
 */

const OWNER_ASK = 'explain LLMs and their internal architecture using visuals in 3D';

function belt(over: Partial<AskInstructionHashInput> & { question: string }): string {
  return renderAskInstructionBelt({
    designMode: true,
    repoRoot: null,
    ...over,
  });
}

/* --------------------------- which ask is which --------------------------- */

test('THE OWNER\u2019S ASK is an explanation, not a design brief — "architecture" is its SUBJECT', () => {
  assert.equal(isArchitectureDesignAsk(OWNER_ASK), false);
});

test('the explanatory shapes all land on the canvas side', () => {
  for (const q of [
    OWNER_ASK,
    'explain how backpropagation works',
    'show me how a transformer moves a token through its layers',
    'what is a Kalman filter',
    'visualise the attention mechanism',
    'walk me through TCP slow start',
    'illustrate the architecture of a GPU',
  ]) {
    assert.equal(isArchitectureDesignAsk(q), false, `explanatory ask read as a design brief: ${q}`);
  }
});

test('a real design brief still is one — the fix must not cost the greenfield user their board', () => {
  for (const q of [
    'Design the architecture for this system: users upload photos from a mobile app, ' +
      'thumbnails are generated asynchronously, and results are served worldwide.',
    'I want to build a stock trading bot that reads filings overnight',
    'propose an architecture for a multi-tenant billing service',
    'design a checkout flow for a marketplace',
    'sketch the topology of the ingest pipeline',
    'put the payment services on the board',
  ]) {
    assert.equal(isArchitectureDesignAsk(q), true, `design brief read as an explanation: ${q}`);
  }
});

test('an empty question is neither, and a lesson is never a design brief', () => {
  assert.equal(isArchitectureDesignAsk('   '), false);
  assert.equal(
    isArchitectureDesignAsk('teach me how to design a checkout system'),
    false,
    'teach mode owns its own contract and this must not reach past it',
  );
});

/* ------------------------------ the belt itself --------------------------- */

test('THE OWNER\u2019S TURN: the belt carries the canvas section and NOT the architecture grammar', () => {
  const text = belt({ question: OWNER_ASK });
  assert.match(text, /--- HOME WORKSPACE \(binding\) ---/);
  assert.match(text, /canvas\.write_mermaid/);
  /*
   * THE SUBSTITUTION, ASSERTED AS AN ABSENCE — and asserted on the SECTION, not
   * on the word. `propose_topology` is also NAMED in the one-line menu of
   * surfaces every drawing turn carries ("repository architecture ->
   * propose_topology"), which is a pointer, not a grammar, and banning the
   * string would make this test pass for the wrong reason the day that menu
   * moves. What must be gone is the design-topology SECTION: its opening line,
   * its scope question, and its propose-now order.
   */
  assert.ok(
    !text.includes('To put a diagram ON THE ARCHITECTURE BOARD'),
    'the design-topology section is still rendered for an explanatory ask',
  );
  assert.ok(
    !/compact overview|already asked for a design of a system/.test(text),
    'the scope question / propose-now order survived the substitution',
  );
});

test('the canvas WRITERS are offered in the home workspace at all — they used to need the word "draw"', () => {
  /* "explain X" says neither draw nor diagram, so `isDrawishAskQuestion` was
     false and the one screen with no code to talk about had no way to show
     anything. */
  assert.match(belt({ question: OWNER_ASK }), /--- AI CANVAS \(typed artifact blocks\) ---/);
  assert.match(belt({ question: 'what is a Kalman filter' }), /canvas\.write_svg/);
});

test('the 3D ask gets a LOCAL-FIRST instruction, because the frame has no network', () => {
  const text = belt({ question: OWNER_ASK });
  assert.match(text, /NO NETWORK/);
  assert.match(text, /never load a remote\s+script or font/);
  assert.match(text, /inline SVG/);
});

test('a design brief in the same workspace keeps the architecture section and loses the canvas one', () => {
  const text = belt({
    question: 'Design the architecture for this system: photo uploads, async thumbnails, global CDN.',
    proposeArchitecture: true,
  });
  assert.match(text, /propose_topology/);
  assert.ok(
    !text.includes('--- HOME WORKSPACE (binding) ---'),
    'a design brief must not be told to stop proposing architecture',
  );
});

test('TEACH MODE IS UNCHANGED: the lesson contract renders and the home section stays out of it', () => {
  const text = belt({ question: OWNER_ASK, teach: true });
  assert.ok(
    !text.includes('--- HOME WORKSPACE (binding) ---'),
    'the teach contract already decides what a lesson draws',
  );
  assert.match(text, /TEACH MODE \(binding contract\)/);
});

test('an attached repository is untouched — this rule is about the home workspace only', () => {
  const text = renderAskInstructionBelt({
    designMode: false,
    repoRoot: 'C:/repo',
    question: OWNER_ASK,
  });
  assert.ok(!text.includes('--- HOME WORKSPACE (binding) ---'));
});

test('a plot ask still routes to propose_chart, not to the canvas section', () => {
  const text = belt({ question: 'plot a parabola, y = x^2' });
  assert.ok(
    !text.includes('--- HOME WORKSPACE (binding) ---'),
    'a math plot has its own binding section and must not gain a second one',
  );
  assert.match(text, /PLOT \/ MATH DRAW \(binding\)/);
});

/* --------------------- the native tool list says the same ----------------- */

test('the OpenAI tool list mirrors the belt: the home workspace gets the canvas writers', () => {
  const supplemental = askOpenAiToolSupplemental({
    teachTurn: false,
    question: OWNER_ASK,
    designMode: true,
  });
  assert.equal(supplemental?.canvas, true, 'the belt describes tools the model was not given');
  const withoutDesign = askOpenAiToolSupplemental({ teachTurn: false, question: OWNER_ASK });
  assert.equal(
    withoutDesign,
    undefined,
    'an attached-repo turn with the same words is unchanged',
  );
});
