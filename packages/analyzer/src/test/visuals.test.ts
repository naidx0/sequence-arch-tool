import assert from 'node:assert';
import { test } from 'node:test';

import {
  drawVisual,
  formatCell,
  layeredStack,
  matrix,
  tokenStrip,
  VISUAL_KINDS,
} from '../server/visuals.js';

/**
 * EXPLANATORY VISUALS — the pictures a box-and-arrow chart cannot draw.
 *
 * Owner, 2026-09-13, on a teach turn that drew three boxes for "how does an LLM
 * work": "the drawings are horrible." Five of his six reference images carry
 * DATA — a matrix of numbers, a token sequence, a value moving down a stack —
 * where every chart family here carries only labels.
 *
 * These cases lock the three things that make such a picture honest rather than
 * decorative: it refuses a spec it cannot draw truthfully, it scales to the data
 * it was actually given, and it says what it left out.
 */

/* ── token strip ─────────────────────────────────────────────────────────── */

test('a token strip draws every token AND its index — the mapping is the lesson', () => {
  /*
   * The teaching is that "Data" becomes a number. A box labelled "Tokeniser"
   * says none of that, which is the whole reason this builder exists.
   */
  const out = tokenStrip({
    title: 'Tokenising "Data visualization"',
    tokens: [
      { label: 'Data', id: 5178 },
      { label: ' visual', id: 5874 },
      { label: 'ization', id: 2065 },
    ],
  });
  assert.ok(out !== null, 'a well-formed strip must draw');
  for (const token of ['Data', ' visual', 'ization']) {
    assert.ok(out.includes(token), `the token ${JSON.stringify(token)} is missing`);
  }
  for (const id of ['5178', '5874', '2065']) {
    assert.ok(out.includes(id), `the index ${id} is missing — the mapping is the point`);
  }
});

test('IT SAYS WHAT IT LEFT OUT — a long sequence is cut and the cut is drawn', () => {
  /*
   * Silently drawing the first 24 of 60 would be a picture claiming the
   * sequence ended there. Same rule the transcript's memory trim obeys: a
   * reader told nothing about what is missing reads it as complete.
   */
  const tokens = Array.from({ length: 60 }, (_, i) => ({ label: `t${i}`, id: i }));
  const out = tokenStrip({ title: 'Long', tokens });
  assert.ok(out !== null);
  assert.match(out, /36 more tokens not drawn/);
});

test('an empty strip refuses rather than drawing an empty frame', () => {
  assert.strictEqual(tokenStrip({ title: 'Nothing', tokens: [] }), null);
  assert.strictEqual(tokenStrip({ title: 'Junk', tokens: undefined as never }), null);
});

/* ── matrix ──────────────────────────────────────────────────────────────── */

const ATTENTION = {
  title: 'Attention scores',
  rows: ['Data', 'visual', 'ization'],
  cols: ['Data', 'visual', 'ization'],
  values: [
    [7.4, null, null],
    [2.1, 6.8, null],
    [0.4, 1.9, 5.5],
  ] as (number | null)[][],
  axes: { rows: 'Query', cols: 'Key' },
};

test('a matrix draws every real value, and its legend prints the real endpoints', () => {
  const out = matrix(ATTENTION);
  assert.ok(out !== null, 'a well-formed matrix must draw');
  for (const value of ['7.4', '2.1', '6.8', '5.5']) {
    assert.ok(out.includes(value), `the value ${value} is missing from the grid`);
  }
  /* The scale is derived from THIS data — 0.4 to 7.4 — not from a fixed range.
     A fixed 0..1 scale would paint a logit matrix one flat colour and hide the
     structure being taught. */
  assert.ok(out.includes('0.4') && out.includes('7.4'), 'the legend must print the observed range');
});

test('A MASKED CELL IS DRAWN AS ABSENT, NEVER AS ZERO', () => {
  /*
   * In an attention matrix the mask IS half the lesson: the upper triangle is
   * not "a score of zero", it is "this token cannot see that one". Drawing it
   * as a zero-valued cell would teach the opposite of the truth.
   */
  const out = matrix(ATTENTION);
  assert.ok(out !== null);
  assert.match(out, /stroke-dasharray/, 'a null cell must be drawn as an empty outline');
  const zeroCells = (out.match(/>0<\/text>/g) ?? []).length;
  assert.strictEqual(zeroCells, 0, 'no masked cell may be printed as the number zero');
});

test('A RAGGED MATRIX IS REFUSED — padding it would draw cells nobody supplied', () => {
  /*
   * A row shorter than the column count is the model having failed to answer.
   * Filling the gap is this product inventing data, in picture form.
   */
  assert.strictEqual(
    matrix({ ...ATTENTION, values: [[1, 2, 3], [4, 5], [6, 7, 8]] }),
    null,
  );
  assert.strictEqual(matrix({ ...ATTENTION, rows: [], cols: [] }), null);
  assert.strictEqual(matrix({ ...ATTENTION, values: [] }), null);
});

test('a matrix with no finite value at all refuses, rather than dividing by a zero range', () => {
  assert.strictEqual(
    matrix({ title: 'All masked', rows: ['a'], cols: ['b'], values: [[null]] }),
    null,
  );
});

test('a flat matrix still draws — every value equal is a real answer', () => {
  const out = matrix({ title: 'Uniform', rows: ['a', 'b'], cols: ['x', 'y'], values: [[1, 1], [1, 1]] });
  assert.ok(out !== null, 'min === max must not be treated as a failure');
});

/* ── layered stack ───────────────────────────────────────────────────────── */

test('a layered stack threads ONE value through repeated blocks, and says how many times', () => {
  /*
   * The teaching is that the same block runs N times. A flow chart draws N
   * different boxes and loses exactly that, which is why `layer` needed its own
   * builder rather than another chart kind.
   */
  const out = layeredStack({
    title: 'A transformer block',
    carries: 'hidden state',
    layers: [
      { label: 'Layer norm' },
      { label: 'Self-attention', detail: 'each token looks at the ones before it' },
      { label: 'Feed-forward' },
    ],
    repeat: { fromIndex: 0, toIndex: 2, times: 12 },
  });
  assert.ok(out !== null);
  assert.ok(out.includes('hidden state'), 'what travels down the stack must be named');
  assert.ok(out.includes('× 12'), 'the repeat count must be drawn');
  assert.ok(out.includes('each token looks at the ones before it'), 'the detail line is missing');
});

test('an out-of-range repeat is dropped, and the stack still draws', () => {
  /* A bad bracket must not cost the whole picture — the layers are still true. */
  const out = layeredStack({
    title: 'Stack',
    layers: [{ label: 'One' }, { label: 'Two' }],
    repeat: { fromIndex: 0, toIndex: 9, times: 4 },
  });
  assert.ok(out !== null);
  assert.ok(out.includes('One') && out.includes('Two'));
  assert.ok(!out.includes('× 4'), 'a repeat naming a layer that does not exist must not be drawn');
});

test('an empty or absurd stack refuses', () => {
  assert.strictEqual(layeredStack({ title: 'None', layers: [] }), null);
  assert.strictEqual(
    layeredStack({ title: 'Too many', layers: Array.from({ length: 17 }, () => ({ label: 'x' })) }),
    null,
  );
});

/* ── the shared contract ─────────────────────────────────────────────────── */

test('every colour is a Graphite token — these pictures are theme-native', () => {
  /*
   * `AiCanvasBlockBody` renders SVG INLINE, so CSS custom properties cascade
   * into it. A hex literal here would be a picture that ignores the theme, and
   * would break the token law every other surface in this product obeys.
   */
  const drawings = [
    tokenStrip({ title: 'a', tokens: [{ label: 'x', id: 1 }] }),
    matrix(ATTENTION),
    layeredStack({ title: 'c', layers: [{ label: 'y' }] }),
  ];
  for (const out of drawings) {
    assert.ok(out !== null);
    const hex = out.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    assert.deepStrictEqual(hex, [], `a hex literal reached an SVG: ${hex.join(', ')}`);
    assert.match(out, /var\(--/, 'the drawing must read Graphite tokens');
  }
});

test('LABELS ARE ESCAPED — a model-supplied label is text, never markup', () => {
  /*
   * These strings come from a model and are interpolated into markup that the
   * canvas renders with dangerouslySetInnerHTML. An unescaped `<` is an
   * injection, and the product is the one writing this SVG.
   */
  const out = tokenStrip({
    title: 'Escaping <script>alert(1)</script>',
    tokens: [{ label: '<img src=x onerror=alert(1)>', id: 0 }],
  });
  assert.ok(out !== null);
  assert.ok(!out.includes('<script>'), 'a raw <script> reached the markup');
  assert.ok(!out.includes('<img'), 'a raw <img> reached the markup');
  assert.ok(out.includes('&lt;script&gt;'), 'the title must be escaped, not dropped');
});

test('every drawing carries an accessible name — a picture that IS the explanation cannot be invisible', () => {
  const out = matrix(ATTENTION);
  assert.ok(out !== null);
  assert.match(out, /role="img"/);
  assert.match(out, /<title>/);
  assert.match(out, /aria-label="/);
});

test('drawVisual is the ONE door, and refuses a kind outside the closed set', () => {
  assert.deepStrictEqual([...VISUAL_KINDS], [
    'token-strip',
    'matrix',
    'layered-stack',
    'annotated-flow',
  ]);
  assert.ok(drawVisual({ kind: 'matrix', ...ATTENTION }) !== null);
  assert.strictEqual(drawVisual({ kind: 'three-d-transformer' } as never), null);
  assert.strictEqual(drawVisual(null as never), null);
});

test('A LONG TITLE IS NEVER CLIPPED — an SVG viewBox cuts silently, it does not scroll', () => {
  /*
   * Caught by LOOKING at the first render, not by a passing suite: a six-column
   * matrix headed "Self-attention: each token looks only at the ones before it"
   * drew the heading cut off at "the ones", because every builder sized its
   * viewBox from its CONTENT and a grid is narrower than its own sentence.
   *
   * "Nothing overflows its box" is a legibility law here, and SVG is the one
   * surface where breaking it is invisible to every other check — the markup is
   * valid, the text element exists, and the pixels are simply gone.
   */
  const title = 'Self-attention: each token looks only at the ones before it';
  const drawings = [
    matrix({ ...ATTENTION, title }),
    tokenStrip({ title, tokens: [{ label: 'a', id: 1 }] }),
    layeredStack({ title, layers: [{ label: 'one' }] }),
  ];
  for (const out of drawings) {
    assert.ok(out !== null);
    const viewBox = /viewBox="0 0 (\d+(?:\.\d+)?) /.exec(out);
    assert.ok(viewBox, 'no viewBox to measure');
    const width = Number.parseFloat(viewBox[1]!);
    /* The same 0.56em-per-character measure the builder sizes by, plus the
       padding it must clear. */
    assert.ok(
      width >= title.length * 7.3,
      `the title needs ~${Math.ceil(title.length * 7.3)}px and the viewBox is ${width}`,
    );
  }
});

test('formatCell keeps a number inside a 34px cell and never goes scientific', () => {
  assert.strictEqual(formatCell(7), '7');
  assert.strictEqual(formatCell(0.4271), '0.43');
  assert.strictEqual(formatCell(-25.34), '-25.3');
  assert.strictEqual(formatCell(1234.5), '1235');
  assert.ok(!formatCell(0.0000001).includes('e'), 'scientific notation is unreadable in a cell');
});

/*
 * ANNOTATED FLOW — the fourth shape stage 2 names, and the last one built.
 *
 * `docs/research/agent-drawing-and-teaching-visuals.md` §4: every chart family
 * "is nodes, edges, bars or cards", and what the owner's references have in
 * common is that "the picture carries DATA … where our chart carries only
 * labels". `data-flow` draws A → B; it cannot draw what is ON the wire, and
 * that is usually the lesson.
 */
const good = {
  kind: 'annotated-flow' as const,
  title: 'What actually travels',
  stages: [{ label: 'Browser', note: 'types a question' }, { label: 'API' }, { label: 'Model' }],
  edges: [
    { carries: 'the typed question', shape: 'JSON, ~40 bytes' },
    { carries: 'token ids', shape: 'int32[12]' },
  ],
};

test('annotated-flow: draws the stages, and puts the payload ON the arrow', () => {
  const out = drawVisual(good);
  assert.ok(out);
  for (const s of ['Browser', 'API', 'Model']) assert.ok(out!.includes(s), s);
  // The thing this builder exists for: the value between the boxes.
  assert.ok(out!.includes('the typed question'));
  assert.ok(out!.includes('int32[12]'));
  // The shape is a literal, so it is mono.
  assert.match(out!, /font-family="var\(--font-mono/);
});

test('annotated-flow: REFUSES a wrong edge count rather than drawing a bare arrow', () => {
  // One short and the last arrow is unlabelled — a picture asserting a step
  // nobody described. One too many and an edge describes a hop not drawn.
  assert.equal(drawVisual({ ...good, edges: [good.edges[0]!] }), null);
  assert.equal(drawVisual({ ...good, edges: [...good.edges, { carries: 'extra' }] }), null);
});

test('annotated-flow: refuses an edge that carries nothing — that is just data-flow', () => {
  assert.equal(drawVisual({ ...good, edges: [{ carries: '' }, good.edges[1]!] }), null);
});

test('annotated-flow: needs at least two stages, and caps the length', () => {
  assert.equal(drawVisual({ ...good, stages: [{ label: 'Only' }], edges: [] }), null);
  const many = Array.from({ length: 9 }, (_, i) => ({ label: `s${i}` }));
  assert.equal(
    drawVisual({ ...good, stages: many, edges: many.slice(1).map(() => ({ carries: 'x' })) }),
    null,
  );
});

test('annotated-flow: shape is optional — a value with no size still draws', () => {
  const out = drawVisual({
    ...good,
    edges: [{ carries: 'the question' }, { carries: 'token ids' }],
  });
  assert.ok(out);
  assert.ok(out!.includes('the question'));
});

test('annotated-flow: is in VISUAL_KINDS, so the one door knows about it', () => {
  assert.ok((VISUAL_KINDS as readonly string[]).includes('annotated-flow'));
});

test('annotated-flow: escapes model text, like every other builder', () => {
  const out = drawVisual({
    ...good,
    stages: [{ label: '<script>x</script>' }, { label: 'B' }],
    edges: [{ carries: 'a & b' }],
  });
  assert.ok(out);
  assert.ok(!out!.includes('<script>'));
  assert.ok(out!.includes('&amp;'));
});
