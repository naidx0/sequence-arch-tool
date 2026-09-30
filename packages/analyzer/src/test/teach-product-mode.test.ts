import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isProductQuestion,
  productQuestionScore,
  renderProductQuestionInstructions,
  teachProductTurn,
} from '../server/askPipeline.js';
import { PRODUCT_QUESTION_MODEL } from '../server/productQuestionModel.js';

/* The owner's three questions from 2026-09-24, verbatim, and two that are about code. */
const OWNER = [
  'tell me about the app how it works and the advtanges on the ai canvas please',
  'move away from the actual files and code and show me flow charts of the advtnage of the actual app and why it exits the conext behind it',
  'i dont get what is ml harness, what does it do, what is the product, whats the actual product flow',
];

test('the owner product questions are product questions; a code question is not', () => {
  for (const q of OWNER) assert.ok(isProductQuestion(q), q);
  assert.ok(!isProductQuestion('Teach me how routes.py calls the inventory client'));
  assert.ok(!isProductQuestion('Explain the softmax gradient in nn_bigram.py'));
});

test('product mode is on by default in a teach turn, and =0 turns it off', () => {
  const before = process.env.SEQUENCE_TEACH_PRODUCT_MODE;
  try {
    process.env.SEQUENCE_TEACH_PRODUCT_MODE = '0';
    assert.equal(teachProductTurn({ repoRoot: '/repo', teach: true, question: OWNER[2]! }), false);
    delete process.env.SEQUENCE_TEACH_PRODUCT_MODE;
    assert.equal(teachProductTurn({ repoRoot: '/repo', teach: true, question: OWNER[2]! }), true);
    assert.equal(teachProductTurn({ repoRoot: '/repo', teach: false, question: OWNER[2]! }), false);
  } finally {
    if (before === undefined) delete process.env.SEQUENCE_TEACH_PRODUCT_MODE;
    else process.env.SEQUENCE_TEACH_PRODUCT_MODE = before;
  }
});

test('the product section shows the start of the last answer so it is not sent again', () => {
  const none = renderProductQuestionInstructions(undefined);
  assert.match(none, /README\.md/);
  assert.match(none, /5 numbered steps/);
  assert.doesNotMatch(none, /did not land/);
  const withLast = renderProductQuestionInstructions(['User: what is it?', 'Assistant: The app is a multi-service harness: svc:ml-harness']);
  assert.match(withLast, /did not land.*The app is a multi-service harness/);
});

test('the new-only fallback sends only the sentences the last answer did not have', async () => {
  const { repeatFallback, REPEAT_FALLBACK } = await import('../server/askPipeline.js');
  const last = 'Assistant: The gateway takes the request and hands it to the orders service. Orders stores it in postgres.';
  const draft =
    'The gateway takes the request and hands it to the orders service. Orders stores it in postgres. ' +
    'Payments are charged through the Stripe client before the invoice is written. Shipping hears about the order from a queue and books the parcel.';
  const before = process.env.SEQUENCE_TEACH_REPEAT_FALLBACK;
  try {
    delete process.env.SEQUENCE_TEACH_REPEAT_FALLBACK;
    assert.equal(repeatFallback(draft, [last]), REPEAT_FALLBACK);
    process.env.SEQUENCE_TEACH_REPEAT_FALLBACK = 'new-only';
    const out = repeatFallback(draft, [last]);
    assert.match(out, /^Adding to my last answer:/);
    assert.match(out, /Stripe client/);
    assert.doesNotMatch(out, /hands it to the orders service/);
    assert.equal(repeatFallback('The gateway takes the request and hands it to the orders service.', [last]), REPEAT_FALLBACK);
  } finally {
    if (before === undefined) delete process.env.SEQUENCE_TEACH_REPEAT_FALLBACK;
    else process.env.SEQUENCE_TEACH_REPEAT_FALLBACK = before;
  }
});

test('recogniser v2: wider questions count, a question naming a file does not, and a started conversation stays in product mode', () => {
  assert.ok(isProductQuestion('whats shopfront? is it a real store or a demo'));
  assert.ok(isProductQuestion("what's the point of it existing lol"));
  assert.ok(isProductQuestion('who is this for?'));
  assert.ok(!isProductQuestion('what does routes.py do?'));
  const before = process.env.SEQUENCE_TEACH_PRODUCT_MODE;
  process.env.SEQUENCE_TEACH_PRODUCT_MODE = '1';
  try {
    const history = ['User: who is this for?', 'Assistant: For shop owners.'];
    assert.equal(teachProductTurn({ repoRoot: '/repo', teach: true, question: 'show that on the canvas pls', historyLines: history }), true);
    assert.equal(teachProductTurn({ repoRoot: '/repo', teach: true, question: 'show that on the canvas pls', historyLines: [] }), false);
    assert.equal(teachProductTurn({ repoRoot: '/repo', teach: true, question: 'now open routes.py', historyLines: history }), false);
  } finally {
    if (before === undefined) delete process.env.SEQUENCE_TEACH_PRODUCT_MODE;
    else process.env.SEQUENCE_TEACH_PRODUCT_MODE = before;
  }
});

test('a product answer with numbered steps and no chart gets those steps drawn as a user flow', async () => {
  const { productStepsChart } = await import('../server/askPipeline.js');
  const answer =
    'ML Harness helps you decide whether to train a model.\n\n1. You describe your task: what data you have.\n2. It profiles the data and checks for leaks.\n3. It measures a baseline with a local model.\n4. It tries better prompts before any training.\n5. Only then does it hand training to a backend.';
  const chart = productStepsChart(answer, 'what is ml harness?');
  assert.ok(chart);
  assert.equal(chart!.kind, 'user-flow');
  assert.deepEqual(chart!.items.map((i) => i.label), [
    'You describe your task',
    'It profiles the data and checks for leaks',
    'It measures a baseline with a local model',
    'It tries better prompts before any training',
    'Only then does it hand training to a backend',
  ]);
  assert.equal(chart!.links!.length, 4);
  assert.ok(chart!.items.every((i) => i.nodeId === undefined));
  assert.equal(productStepsChart('One sentence, no steps.', 'what is it?'), undefined);
});

test('product mode needs a repository: a subject lesson with none is not a product question', () => {
  const before = process.env.SEQUENCE_TEACH_PRODUCT_MODE;
  delete process.env.SEQUENCE_TEACH_PRODUCT_MODE;
  try {
    const q = 'what is an llm, break it down for me please';
    assert.equal(teachProductTurn({ teach: true, question: q, repoRoot: null }), false);
    assert.equal(teachProductTurn({ teach: true, question: q, repoRoot: '/repo', teachContext: { subjectNotInRepo: true } }), false);
    assert.equal(teachProductTurn({ teach: true, question: 'what is this app, who is it for?', repoRoot: '/repo' }), true);
  } finally {
    if (before !== undefined) process.env.SEQUENCE_TEACH_PRODUCT_MODE = before;
  }
});

test('missingProductParts names what a product answer leaves out', async () => {
  const { missingProductParts } = await import('../server/askPipeline.js');
  assert.deepEqual(missingProductParts('It is a tool.'), ['who it is for', 'why it exists', 'how it works, as numbered steps', 'its advantages']);
  const full =
    'It is a tool built for small store owners, so that selling is simple.\n1. Order.\n2. Pay.\n3. Ship.\nAdvantages: fewer steps.';
  assert.deepEqual(missingProductParts(full), []);
});

test('withoutClosingQuestion drops a short closing question paragraph and nothing else', async () => {
  const { withoutClosingQuestion } = await import('../server/askPipeline.js');
  assert.equal(withoutClosingQuestion('It is a shop.\n\nWhich part hands off next?'), 'It is a shop.');
  assert.equal(withoutClosingQuestion('Is it a shop? Yes, it is a shop.'), 'Is it a shop? Yes, it is a shop.');
  assert.equal(withoutClosingQuestion('Only one paragraph, ending on a question?'), 'Only one paragraph, ending on a question?');
  assert.equal(withoutClosingQuestion('It is a shop.\n\nIt ships orders.'), 'It is a shop.\n\nIt ships orders.');
});

test('recogniser v3: the reader asking what they get, whether it is worth it, or how it compares', () => {
  for (const q of [
    'Please can you explain what the user is receiving at the end when using this product?',
    'Investor here. Tell me what this shop does and why anyone would build it like this.',
    'How does it stack up against just putting the store on a hosted platform?',
    'Bottom line, is this worth building on or not?',
    'is this tool usefull for me or is it for companies',
  ]) {
    assert.ok(isProductQuestion(q), q);
  }
  assert.ok(!isProductQuestion('How does routes.py call the inventory client?'));
});

test('the classifier catches product questions the patterns miss, and =0 turns it off', () => {
  const asked = [
    'are the workout plans made by real trainers or generated?',
    'does the transcription thing work with accents? mine is strong',
    'how private are the journal entries? could the company read them',
  ];
  for (const q of asked) assert.ok(isProductQuestion(q), q);
  process.env.SEQUENCE_TEACH_PRODUCT_CLASSIFIER = '0';
  try {
    for (const q of asked) assert.ok(!isProductQuestion(q), q);
  } finally {
    delete process.env.SEQUENCE_TEACH_PRODUCT_CLASSIFIER;
  }
});

test('the classifier adds no code question from its own training set, and the generated model matches the trainer', () => {
  const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
  const rows = JSON.parse(fs.readFileSync(path.join(root, 'tools/bench/data/product-question-train.json'), 'utf8')) as {
    label: string;
    question: string;
  }[];
  const code = rows.filter((r) => r.label === 'code');
  assert.ok(code.length >= 100);
  for (const r of code) assert.ok(productQuestionScore(r.question) <= PRODUCT_QUESTION_MODEL.threshold, r.question);
  assert.equal(PRODUCT_QUESTION_MODEL.docs.product + PRODUCT_QUESTION_MODEL.docs.code, rows.length);
  assert.equal(productQuestionScore('what does routes.py do?') > PRODUCT_QUESTION_MODEL.threshold, false);
});

test('a pattern hit that talks about the code stays a code question', () => {
  assert.ok(!isProductQuestion('what does the app do when the user loses connection mid-upload, where is that handled in the code'));
  assert.ok(!isProductQuestion('Where does the app read environment variables, and what happens if one is missing?'));
  assert.ok(!isProductQuestion("What's the purpose of the .PHONY line in the Makefile?"));
  assert.ok(isProductQuestion('what does this app do?'));
  assert.ok(isProductQuestion('Is it worth learning this data-viz library in 2026 or is everyone moving elsewhere?'));
});

test('README inline: the product turn carries the README start and does not ask for a read', async () => {
  const os = await import('node:os');
  const { readProductReadme } = await import('../server/askPipeline.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-readme-'));
  try {
    assert.equal(readProductReadme(dir), undefined);
    fs.writeFileSync(path.join(dir, 'README.md'), '# Shopfront\r\nA small online shop.\r\n' + 'x'.repeat(5000));
    const readme = readProductReadme(dir)!;
    assert.ok(readme.startsWith('# Shopfront\nA small online shop.'));
    assert.ok(readme.endsWith('[... README continues]'));
    const withIt = renderProductQuestionInstructions(undefined, readme);
    assert.ok(withIt.includes('README (start):'));
    assert.ok(!withIt.includes('with read_file BEFORE'));
    assert.ok(renderProductQuestionInstructions(undefined).includes('with read_file BEFORE'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('README inline is on by default and =0 turns it off', async () => {
  const { productReadmeInlineEnabled } = await import('../server/askPipeline.js');
  delete process.env.SEQUENCE_TEACH_PRODUCT_README_INLINE;
  assert.equal(productReadmeInlineEnabled(), true);
  process.env.SEQUENCE_TEACH_PRODUCT_README_INLINE = '0';
  try {
    assert.equal(productReadmeInlineEnabled(), false);
  } finally {
    delete process.env.SEQUENCE_TEACH_PRODUCT_README_INLINE;
  }
});

test('the product skeleton is on by default and SEQUENCE_TEACH_PRODUCT_TEMPLATE=0 turns it off', () => {
  delete process.env.SEQUENCE_TEACH_PRODUCT_TEMPLATE;
  const text = renderProductQuestionInstructions(undefined);
  for (const h of ['**What it is:**', '**Who it is for:**', '**Why it exists:**', '**How it works:**', '**Advantages:**']) {
    assert.ok(text.includes(h), h);
  }
  process.env.SEQUENCE_TEACH_PRODUCT_TEMPLATE = '0';
  try {
    assert.ok(!renderProductQuestionInstructions(undefined).includes('**Who it is for:**'));
  } finally {
    delete process.env.SEQUENCE_TEACH_PRODUCT_TEMPLATE;
  }
});

test('product turns do not ask for a chart by default; SEQUENCE_TEACH_PRODUCT_NO_CHART_ASK=0 asks again', () => {
  delete process.env.SEQUENCE_TEACH_PRODUCT_NO_CHART_ASK;
  const text = renderProductQuestionInstructions(undefined);
  assert.ok(!text.includes('ONE propose_chart'));
  assert.ok(text.includes('Do not call propose_chart'));
  process.env.SEQUENCE_TEACH_PRODUCT_NO_CHART_ASK = '0';
  try {
    assert.ok(renderProductQuestionInstructions(undefined).includes('ONE propose_chart'));
  } finally {
    delete process.env.SEQUENCE_TEACH_PRODUCT_NO_CHART_ASK;
  }
});

test('lean product turn: only with the flag, a product question, and a README', async () => {
  const os = await import('node:os');
  const { leanProductTurn } = await import('../server/askPipeline.js');
  const withReadme = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-lean-'));
  const without = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-lean-'));
  fs.writeFileSync(path.join(withReadme, 'README.md'), '# Tool\nIt does things.');
  const q = { teach: true, question: 'what does this app do?' };
  try {
    assert.equal(leanProductTurn({ ...q, repoRoot: withReadme }), false);
    process.env.SEQUENCE_TEACH_PRODUCT_LEAN_DIGEST = '1';
    assert.equal(leanProductTurn({ ...q, repoRoot: withReadme }), true);
    assert.equal(leanProductTurn({ ...q, repoRoot: without }), false);
    assert.equal(leanProductTurn({ teach: true, question: 'what does routes.py do?', repoRoot: withReadme }), false);
  } finally {
    delete process.env.SEQUENCE_TEACH_PRODUCT_LEAN_DIGEST;
    fs.rmSync(withReadme, { recursive: true, force: true });
    fs.rmSync(without, { recursive: true, force: true });
  }
});

test('a product question that points at the repo stays in product mode even when the subject check says otherwise', () => {
  const ctx = { subjectNotInRepo: true };
  assert.equal(teachProductTurn({ teach: true, repoRoot: '/repo', question: 'so what does this thing actually do?', teachContext: ctx }), true);
  assert.equal(teachProductTurn({ teach: true, repoRoot: '/repo', question: 'what problem is the tool trying to solve for people?', teachContext: ctx }), true);
  assert.equal(teachProductTurn({ teach: true, repoRoot: '/repo', question: 'what is an llm, break it down', teachContext: ctx }), false);
  process.env.SEQUENCE_TEACH_PRODUCT_POINTS_AT_REPO = '0';
  try {
    assert.equal(teachProductTurn({ teach: true, repoRoot: '/repo', question: 'so what does this thing actually do?', teachContext: ctx }), false);
  } finally {
    delete process.env.SEQUENCE_TEACH_PRODUCT_POINTS_AT_REPO;
  }
});

test('a bare "it" points at the repo unless the question names its own subject first; =0 turns it off', async () => {
  const { pointsAtRepo } = await import('../server/askPipeline.js');
  for (const q of ['who uses it?', "what's the point of it?", 'explain it?', 'Can you describe the typical user journey?']) assert.equal(pointsAtRepo(q), true, q);
  for (const q of ['what is an llm, break it down', 'teach me recursion, why does it matter']) assert.equal(pointsAtRepo(q), false, q);
  process.env.SEQUENCE_TEACH_PRODUCT_BARE_IT = '0';
  try {
    assert.equal(pointsAtRepo('who uses it?'), false);
    assert.equal(pointsAtRepo('who uses this?'), true);
  } finally {
    delete process.env.SEQUENCE_TEACH_PRODUCT_BARE_IT;
  }
});

test('a product draft whose only faults are its shape settles without a bounce, unless the flag is 0', async () => {
  const { productShapeSettles } = await import('../server/askPipeline.js');
  const closing = 'your reply does not END with the closing check-in question the contract requires';
  const length = 'your reply is 90 words — the root overview is about 250-350 words';
  const visual = 'this concept has NO VISUAL — call propose_chart';
  /* Written about the product, not to the reader, and no closing question: the shape the
     first A/B showed isLessonDraft refusing. */
  const answer =
    '**What it is:** ML Harness is the local-first tool that answers whether training a model is the right call. ' +
    '**Who it is for:** people in ML engineering who need evidence before a month of fine-tuning. ' +
    '**How it works:** 1. A web UI sits above an engine. 2. The engine runs the judge. 3. Results land in SQLite. ' +
    '**Advantages:** decision-grade evidence instead of trial and error.';
  const before = process.env.SEQUENCE_TEACH_PRODUCT_NO_SHAPE_BOUNCE;
  try {
    process.env.SEQUENCE_TEACH_PRODUCT_NO_SHAPE_BOUNCE = '0';
    assert.equal(productShapeSettles(true, [closing], answer), false);
    delete process.env.SEQUENCE_TEACH_PRODUCT_NO_SHAPE_BOUNCE;
    assert.equal(productShapeSettles(true, [closing], answer), true);
    assert.equal(productShapeSettles(true, [closing, length], answer), true);
    assert.equal(productShapeSettles(true, [], answer), true);
    assert.equal(productShapeSettles(false, [closing], answer), false);
    assert.equal(productShapeSettles(true, [closing, visual], answer), false);
    assert.equal(productShapeSettles(true, [closing], 'ML Harness is a tool.'), false);
  } finally {
    if (before === undefined) delete process.env.SEQUENCE_TEACH_PRODUCT_NO_SHAPE_BOUNCE;
    else process.env.SEQUENCE_TEACH_PRODUCT_NO_SHAPE_BOUNCE = before;
  }
});

test('a short product answer is asked for only with SEQUENCE_TEACH_PRODUCT_SHORT=1', () => {
  const before = process.env.SEQUENCE_TEACH_PRODUCT_SHORT;
  try {
    delete process.env.SEQUENCE_TEACH_PRODUCT_SHORT;
    assert.ok(!renderProductQuestionInstructions(undefined).includes('about 150 words'));
    process.env.SEQUENCE_TEACH_PRODUCT_SHORT = '1';
    assert.ok(renderProductQuestionInstructions(undefined).includes('Keep the whole answer to about 150 words'));
  } finally {
    if (before === undefined) delete process.env.SEQUENCE_TEACH_PRODUCT_SHORT;
    else process.env.SEQUENCE_TEACH_PRODUCT_SHORT = before;
  }
});
