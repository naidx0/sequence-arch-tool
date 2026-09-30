/*
 * Locks for tools/bench/lesson-quality.mjs. Each test pairs two lessons that differ in ONE way the
 * owner cares about, so a change to the scorer that stops seeing that difference goes red.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreLesson, scoreChart, compareVariants, lessonFromEvents, sentencesOf } from '../bench/lesson-quality.mjs';
import { mergeOrders, tally, pairPrompt, judgePairs } from '../bench/lesson-judge.mjs';

const CHUNKED = `## How a request reaches the model

Think of it as a relay with three runners. The picture shows them left to right.

1. **The composer** (\`web/src/Composer.tsx\`) is where you type. It packs your words into a request.
2. **The engine** (\`app/engine.py:42\`) receives it. It decides which model runs.
3. **The provider** (\`app/providers/ollama.py:18\`) is the only part that talks to the model.

Why is the engine in the middle? Because it is the one place that knows your settings, so there is one source of truth.

I'm skipping how the answer streams back for now.

Which part would change if you swapped Ollama for another backend?`;

const WALL =
  'The `Composer` in `web/src/Composer.tsx` serialises the `AskRequest` which `connect.tsx` posts to `/api/ask` where `repoServer.ts` parses it into `AskPipelineInput`, routes via `classifyAskIntent`, builds the belt with `renderTeachModeInstructions`, calls `callProviderMetered` against `app/providers/ollama.py`, and streams `delta` frames back through `holdToolFences` into `streamCoalescer.ts`. Does this make sense?';

test('a chunked, glossed lesson beats the same content as one dense sentence', () => {
  const a = scoreLesson(CHUNKED);
  const b = scoreLesson(WALL);
  assert.ok(a.overall > b.overall + 10, `${a.overall} vs ${b.overall}`);
  assert.ok(a.sub.clarity > b.sub.clarity);
  assert.ok(a.sub.jargon > b.sub.jargon);
  assert.ok(b.flags.some((f) => /code names per sentence|sentences average/.test(f)));
});

test('length alone is not penalised: the same lesson with a second glossed section scores no lower on clarity', () => {
  const longer = CHUNKED.replace(
    'I\'m skipping',
    'Here is a second way to see it. Picture a restaurant. You order at the counter. The kitchen decides who cooks. The chef is the only one at the stove.\n\nI\'m skipping',
  );
  const a = scoreLesson(CHUNKED);
  const b = scoreLesson(longer);
  assert.ok(b.metrics.words > a.metrics.words);
  assert.ok(b.sub.clarity >= a.sub.clarity - 1, `${b.sub.clarity} vs ${a.sub.clarity}`);
});

test('shouting, dismissive words and telling the reader they are wrong cost tone', () => {
  const harsh = CHUNKED.replace('Think of it', 'OBVIOUSLY this is simple. You are wrong if you think otherwise. Just think of it').replace(
    'Why is the engine',
    'You MUST NEVER forget this! Why is the engine',
  );
  const a = scoreLesson(CHUNKED);
  const b = scoreLesson(harsh);
  assert.ok(a.sub.tone - b.sub.tone >= 25, `${a.sub.tone} vs ${b.sub.tone}`);
  assert.ok(b.metrics.shoutedWords.includes('OBVIOUSLY'));
  assert.ok(b.metrics.harshAtReader >= 1);
});

test('a comprehension close is a check-in; a clarifying offer is flagged', () => {
  const clar = CHUNKED.replace(/Which part would change[^?]*\?/, 'Would you like me to show the streaming side next?');
  const a = scoreLesson(CHUNKED);
  const b = scoreLesson(clar);
  assert.equal(a.metrics.closingClarifying, false);
  assert.equal(b.metrics.closingClarifying, true);
  assert.ok(a.sub.teaching > b.sub.teaching);
});

test('a mid-lesson question left unanswered is counted; an answered one is not', () => {
  const open = 'Think of the engine as a switchboard. What does it route? Then the provider runs. Which file holds the provider?';
  const s = scoreLesson(open);
  assert.equal(s.metrics.midQuestionsLeftOpen, 1);
  assert.equal(scoreLesson(CHUNKED).metrics.midQuestionsAnswered, 1);
});

test('leaked reasoning, a planning opener and a promised-but-absent drawing cost hygiene', () => {
  const planning = 'Let me first check the files and then I will explain.\n\n' + CHUNKED;
  const leak = '<think>the user wants</think>' + CHUNKED;
  const promise = CHUNKED.replace(/Which part would change[^?]*\?/, 'Let me draw this on the canvas.');
  assert.ok(scoreLesson(planning).metrics.planningOpen);
  assert.ok(scoreLesson(leak).metrics.leak);
  assert.ok(scoreLesson(promise).metrics.drawPromise);
  for (const t of [planning, leak, promise]) assert.ok(scoreLesson(t).sub.hygiene < scoreLesson(CHUNKED).sub.hygiene);
});

test('a chart the text talks about beats a chart it ignores, which beats no chart', () => {
  const chart = { items: [{ label: 'composer' }, { label: 'engine' }, { label: 'provider' }], steps: [1, 2] };
  const ignored = { items: [{ label: 'tokenizer' }, { label: 'scheduler' }, { label: 'cache' }] };
  const none = scoreLesson(CHUNKED.replace('The picture shows them left to right.', '').replace(/\(\`[^`]+\`\)/g, ''), {});
  const withRefs = scoreLesson(CHUNKED, { chart });
  const withIgnored = scoreLesson(CHUNKED, { chart: ignored });
  assert.ok(withRefs.sub.visual > withIgnored.sub.visual);
  assert.ok(withIgnored.sub.visual > none.sub.visual);
  assert.equal(withRefs.metrics.chartLabelsMentioned, 1);
});

test('internal tool vocabulary aimed at the learner is counted', () => {
  const s = scoreLesson('I called read_topology and propose_chart with a seqd block. Does that make sense for the engine module?');
  assert.ok(s.metrics.toolVocab >= 3);
  assert.ok(s.flags.some((f) => /internal tool term/.test(f)));
});

test('an empty or near-empty answer scores zero and says so', () => {
  const s = scoreLesson('Sure.');
  assert.equal(s.overall <= 10, true);
  assert.deepEqual(s.flags, ['no lesson: fewer than 12 words of prose']);
});

test('sentences: bullets count as sentences and abbreviations do not split', () => {
  const ss = sentencesOf('- one item here\n- two items here, e.g. this one. And more words');
  assert.equal(ss.length, 3);
});

test('stream logs: deltas concatenate, a final result wins, a chart frame is kept', () => {
  const lines = [
    JSON.stringify({ type: 'delta', text: 'Hello ' }),
    JSON.stringify({ type: 'delta', text: 'there' }),
    JSON.stringify({ type: 'chart:proposal', proposal: { items: [{ label: 'a' }], links: [] } }),
  ];
  const l1 = lessonFromEvents(lines);
  assert.equal(l1.text, 'Hello there');
  assert.equal(l1.chart.items[0].label, 'a');
  const l2 = lessonFromEvents([...lines, JSON.stringify({ type: 'result', text: 'Final answer' })]);
  assert.equal(l2.text, 'Final answer');
});

test('A/B: three similar runs a side are reported as not separable, deterministically', () => {
  const A = [1, 2, 3].map((i) => ({ id: `r${i}`, text: CHUNKED }));
  const B = [1, 2, 3].map((i) => ({ id: `r${i}`, text: CHUNKED.replace('relay', i === 2 ? 'team' : 'relay') }));
  const r1 = compareVariants(A, B, ['off', 'on']);
  const r2 = compareVariants(A, B, ['off', 'on']);
  assert.deepEqual(r1.byDim, r2.byDim);
  assert.equal(r1.byDim.overall.verdict, 'not separable');
  assert.equal(r1.paired.length, 3);
});

test('A/B: a clearly better variant is named when every run is better', () => {
  const A = [1, 2, 3, 4, 5, 6].map((i) => ({ id: `r${i}`, text: WALL }));
  const B = [1, 2, 3, 4, 5, 6].map((i) => ({ id: `r${i}`, text: CHUNKED }));
  const r = compareVariants(A, B, ['off', 'on']);
  assert.equal(r.byDim.overall.verdict, 'on better');
  assert.ok(r.paired.every((p) => p.winner === 'on'));
});


test('judge: a criterion counts only when both orders agree, which cancels position bias', () => {
  // A judge that always prefers whatever it sees first says "1" both times: that is a tie, not a win.
  const biased = { clear: '1', visual: '1', teaches: '1', kind: '1', true: '1', overall: '1' };
  const m = mergeOrders(biased, biased);
  assert.ok(Object.values(m).every((v) => v === 'tie'));
  // A judge that prefers B in both orders gives B the win.
  const m2 = mergeOrders({ overall: '2', clear: '2' }, { overall: '1', clear: '1' });
  assert.equal(m2.overall, 'B');
  assert.equal(m2.clear, 'B');
  assert.equal(tally([m2]).overall.B, 1);
});

test('judge: the prompt carries the question, both answers and the facts', () => {
  const p = pairPrompt({ question: 'teach me the engine', first: 'AAA', second: 'BBB', facts: 'engine.py exists' });
  for (const s of ['teach me the engine', 'AAA', 'BBB', 'engine.py exists', '"overall"']) assert.ok(p.includes(s));
});

test('judge: judgePairs asks twice per pair, swapping order', async () => {
  const seen = [];
  const ask = async (prompt) => {
    seen.push(prompt);
    const firstIsB = prompt.indexOf('ANSWER 1 ===\nB-text') >= 0;
    return JSON.stringify({ overall: firstIsB ? '1' : '2' });
  };
  const r = await judgePairs([{ id: 'x', question: 'q', a: 'A-text', b: 'B-text' }], ask);
  assert.equal(seen.length, 2);
  assert.equal(r.merged[0].overall, 'B');
});

/* Real charts from the 2026-09-23 teach measurements over ML Harness, transcribed from the reports. */
const HUB = {
  kind: 'system-architecture',
  items: ['Service', 'Platform Module', 'Panes Module', 'Readers Module', 'Engine Module', 'Ui Module', 'shims Module'].map((label, i) => ({ id: `i${i}`, label })),
  links: [1, 2, 3, 4, 5, 6].map((i) => ({ from: 'i0', to: `i${i}`, label: 'contains' })),
};
const LOOP = {
  kind: 'data-flow',
  items: [{ id: 'f', label: 'frontend' }, { id: 'h', label: 'ml-harness' }, { id: 'a', label: 'ml-harness-app' }],
  links: [{ from: 'f', to: 'h', label: 'frontend to ml-harness' }, { from: 'h', to: 'a', label: 'calls over HTTP' }, { from: 'a', to: 'h', label: 'ml-harness-app to ml-harness' }],
  steps: [1, 2, 3],
};
const TRACE = {
  kind: 'data-flow',
  items: [{ id: 'fe', label: 'frontend', nodeId: 'svc:frontend' }, { id: 'cl', label: 'engine client', nodeId: 'file:frontend/src/lib/engine/client.ts' }, { id: 'mn', label: 'API server', nodeId: 'file:app/main.py' }, { id: 'db', label: 'Database', nodeId: 'ds:ml-harness-db' }],
  links: [{ from: 'fe', to: 'cl', label: 'uses' }, { from: 'cl', to: 'mn', label: 'GET /health' }, { from: 'mn', to: 'db', label: 'reads schema_version' }],
  steps: [1, 2, 3],
};

test('picture: an inventory hub and a flow that loops back both read worse than a traced flow', () => {
  const hub = scoreChart(HUB);
  const loop = scoreChart(LOOP);
  const trace = scoreChart(TRACE);
  assert.equal(hub.containsHub, true);
  assert.equal(loop.cycle, true);
  assert.equal(trace.cycle, false);
  assert.ok(trace.score > loop.score && trace.score > hub.score, `${trace.score} ${loop.score} ${hub.score}`);
  assert.equal(trace.groundedShare, 1);
});

test('picture: raw ids as labels and more than eight boxes are flagged', () => {
  const big = { kind: 'system-architecture', items: Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, label: `svc:thing-${i}` })), links: [] };
  const s = scoreChart(big);
  assert.equal(s.rawIdLabels, 12);
  assert.ok(s.flags.some((f) => /12 boxes/.test(f)));
  assert.ok(s.score < 30);
});

test('picture: when the chart is known, it moves the lesson visual score', () => {
  const good = scoreLesson(CHUNKED, { chart: TRACE });
  const bad = scoreLesson(CHUNKED, { chart: HUB });
  assert.ok(good.sub.visual > bad.sub.visual);
  assert.ok(bad.flags.some((f) => f.startsWith('picture: an inventory')));
});

test('acronyms a learner reads as words are not counted as shouting', () => {
  const s = scoreLesson('The frontend sends HTTP requests to the FastAPI service, which checks CORS and then writes rows to SQLITE for you. WATCH this part closely, it matters.');
  assert.deepEqual(s.metrics.shoutedWords, ['WATCH']);
});

test('a turn that hands the work back is capped below a rough lesson', () => {
  const greet = scoreLesson('Hello! This looks like the start of a conversation. What are you working on? Would you like help mapping the service, or something else? I can read files and trace dependencies once I know what you need.');
  const stop = scoreLesson('Wrote 1 item on the whiteboard. I stopped because this turn hit its time budget while I was still looking things up, so I have not written an answer rather than guess at one. Ask again to continue from here.');
  const confirm = scoreLesson("Your last turn cited providers.py, facade.py and security.py, which I haven't verified yet. Can you confirm which files are available?");
  for (const s of [greet, stop, confirm]) {
    assert.ok(s.overall <= 40, `deflection scored ${s.overall}`);
    assert.ok(s.flags.some((f) => /hands the work back/.test(f)));
  }
  assert.ok(confirm.flags.some((f) => /too thin/.test(f)));
});

test('tool-call debris from a stripped native call is told apart from a refusal', () => {
  const debris = scoreLesson('The service answers on port 8000 and the frontend talks to it for you. name="read_file"> name="path">app/main.py and then we can look at how requests move.');
  assert.ok(debris.metrics.toolDebris);
  assert.ok(debris.flags.some((f) => /serving\/template fault/.test(f)));
  const fence = scoreLesson('Here is the layout of the service you asked about, drawn from the scan. sequence-tool ) and that is the end of it for this turn.');
  assert.ok(fence.metrics.toolDebris);
  const clean = scoreLesson('The frontend sends a request to the service, and the service reads the database before it answers you.');
  assert.ok(!clean.metrics.toolDebris);
});

test('a concrete case read off the code counts as an example', () => {
  const s = scoreLesson('The gateway forwards each order to the orders service. A real example from this code: `gateway/src/routes/orders.ts:9` sends `GET /orders/*` over HTTP.');
  assert.ok(s.metrics.analogies >= 1);
  assert.ok(!s.flags.some((f) => /no example or analogy/.test(f)));
});

test('product answers: a closing question is neutral, neither a bonus nor a penalty', () => {
  const body = 'Shopfront is an online shop built for small store owners. It splits selling into small services so each can change alone. You place an order, pay, and it ships.';
  const withQ = `${body}\n\nWhat would you check first if an order never shipped?`;
  const lessonGap = scoreLesson(withQ).sub.teaching - scoreLesson(body).sub.teaching;
  assert.ok(lessonGap > 0, 'a lesson still earns its check-in');
  assert.equal(scoreLesson(withQ, { product: true }).sub.teaching, scoreLesson(body, { product: true }).sub.teaching);
});
