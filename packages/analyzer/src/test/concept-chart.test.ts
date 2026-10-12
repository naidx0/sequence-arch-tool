import assert from 'node:assert/strict';
import test from 'node:test';

import { buildConceptChart } from '../server/conceptChart.js';

/**
 * THE VISUAL DECIDED IN CODE — and the tests are mostly about what it REFUSES
 * to draw.
 *
 * A chart the product drew is more dangerous than one the model drew, because a
 * reader has no reason to doubt it. So the load-bearing assertions here are the
 * negative ones: no node, no such node, nothing connected to it — draw nothing.
 * Shipping a one-box diagram to make `visual present` move would be fabricating
 * evidence to satisfy a metric, which is the failure this whole lane exists to
 * prevent.
 */

const GRAPH = {
  nodes: [
    { id: 'a', label: 'scan.ts', path: 'src/scan.ts' },
    { id: 'b', label: 'join.ts', path: 'src/join.ts' },
    { id: 'c', label: 'facts.ts', path: 'src/facts.ts' },
  ],
  edges: [
    { srcId: 'a', dstId: 'b' },
    { srcId: 'c', dstId: 'a' },
  ],
} as never;

test('a concept naming a real node becomes a chart of what touches it', () => {
  const chart = buildConceptChart(GRAPH, { title: 'the scanner', nodeId: 'a' })!;
  assert.ok(chart, 'a connected node yields a chart');
  assert.strictEqual(chart.kind, 'data-flow');
  assert.strictEqual(chart.title, 'the scanner');
  assert.strictEqual(chart.focusItemId, 'a');
  /* Every item is a real node, carrying the id the validator checks. That is
     what makes this grounded rather than drawn. */
  const realIds = new Set(['a', 'b', 'c']);
  for (const item of chart.items) {
    assert.ok(realIds.has(String(item.nodeId)), `${String(item.nodeId)} is a node in the graph`);
  }
});

test('edge DIRECTION is preserved — a reversed arrow is a false claim', () => {
  const chart = buildConceptChart(GRAPH, { title: 'the scanner', nodeId: 'a' })!;
  const links = chart.links ?? [];
  /* a -> b in the graph, and c -> a. Drawing either backwards would say
     something about the architecture that the scan does not. */
  assert.ok(links.some((l) => l.from === 'a' && l.to === 'b'), 'outgoing edge kept as outgoing');
  assert.ok(links.some((l) => l.from === 'c' && l.to === 'a'), 'incoming edge kept as incoming');
  assert.ok(!links.some((l) => l.from === 'b' && l.to === 'a'));
});

test('it draws NOTHING when there is nothing to say', () => {
  /* The three refusals, and they matter more than the chart. */
  assert.strictEqual(buildConceptChart(GRAPH, { title: 'an idea' }), undefined, 'no nodeId');
  assert.strictEqual(
    buildConceptChart(GRAPH, { title: 'x', nodeId: 'not-a-node' }),
    undefined,
    'a nodeId the graph does not have',
  );
  assert.strictEqual(
    buildConceptChart(
      { nodes: [{ id: 'q', label: 'lone.ts' }], edges: [] } as never,
      { title: 'x', nodeId: 'q' },
    ),
    undefined,
    'a node nothing touches — one box is not a picture of a relationship',
  );
  assert.strictEqual(buildConceptChart(undefined, { title: 'x', nodeId: 'a' }), undefined);
  assert.strictEqual(buildConceptChart(GRAPH, undefined), undefined);
});

test('the caption states PROVENANCE, not meaning', () => {
  /* Meaning is the model's sentence. If this file wrote "the scanner feeds the
     joiner because …" it would be asserting something the graph does not show,
     under the product's own byline. */
  const chart = buildConceptChart(GRAPH, { title: 'the scanner', nodeId: 'a' })!;
  assert.match(chart.caption ?? '', /from the scanned graph/);
});

test('it is capped, so a hub node does not produce an unreadable chart', () => {
  const hub = {
    nodes: [
      { id: 'h', label: 'hub.ts' },
      ...Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, label: `n${i}.ts` })),
    ],
    edges: Array.from({ length: 12 }, (_, i) => ({ srcId: 'h', dstId: `n${i}` })),
  } as never;
  const chart = buildConceptChart(hub, { title: 'the hub', nodeId: 'h' })!;
  assert.ok(chart);
  assert.ok((chart.links ?? []).length <= 4, 'at most four neighbours');
  assert.ok(chart.items.length <= 5, 'the focus plus its neighbours');
});

test('the output passes the SAME validator the model must pass', () => {
  /* A bug here would otherwise ship because the product happened to be the
     author. buildConceptChart returns only what validateChart accepted, so this
     asserts the contract rather than the implementation. */
  const chart = buildConceptChart(GRAPH, { title: 'the scanner', nodeId: 'a' })!;
  assert.strictEqual(chart.version, 1);
  assert.ok(chart.items.length > 0);
  const ids = new Set(chart.items.map((i) => i.id));
  for (const link of chart.links ?? []) {
    assert.ok(ids.has(link.from) && ids.has(link.to), 'links join declared items');
  }
});

/* ═══ the check-in derived from the picture ══════════════════════════════ */

import { deriveCheckIn } from '../server/conceptChart.js';
import { gradeCheckIn } from '../server/checkIn.js';

/**
 * The chart had to be REFUSABLE because it claims something about the
 * repository. The question claims nothing — it names two files and a direction
 * already on the screen and asks the learner to predict a consequence — so what
 * these lock is different: that it passes the same honest grader the model is
 * held to, that it is a PREDICTION rather than the weaker "does that make
 * sense?", and that it says nothing when there is nothing drawn.
 */
test('the derived check passes the honest grader, as a prediction', () => {
  const chart = buildConceptChart(GRAPH, { title: 'the scanner', nodeId: 'a' })!;
  const question = deriveCheckIn(chart)!;
  assert.ok(question, 'a chart with links yields a question');
  const graded = gradeCheckIn(`The scanner walks the tree at scan.ts:12. ${question}`);
  assert.strictEqual(graded.endsWithCheck, true, 'it must be a check the product accepts');
  assert.strictEqual(graded.shape, 'prediction', 'a prediction, not a comprehension formality');
  assert.notStrictEqual(graded.parrotedExample, true);
});

test('it names only files that are on the screen', () => {
  /* The whole reason it cannot be wrong about the code: every noun in it is an
     item of the chart the learner is looking at. */
  const chart = buildConceptChart(GRAPH, { title: 'the scanner', nodeId: 'a' })!;
  const question = deriveCheckIn(chart)!;
  const labels = chart.items.map((i) => i.label);
  for (const word of question.split(/[\s,?—-]+/).filter((w) => w.includes('.'))) {
    assert.ok(labels.includes(word), `${word} appears in the question but not in the chart`);
  }
});

test('the direction of the question follows the direction of the arrows', () => {
  /* a -> b and c -> a. Asked about `a`, the thing that BREAKS is what points at
     it — `c` — not what it points at. Getting this backwards would teach the
     dependency the wrong way round while looking perfectly fluent. */
  const chart = buildConceptChart(GRAPH, { title: 'the scanner', nodeId: 'a' })!;
  const question = deriveCheckIn(chart)!;
  assert.match(question, /facts\.ts/, 'facts.ts imports scan.ts, so it is what breaks');
  assert.doesNotMatch(
    question,
    /would break in join\.ts/,
    'join.ts is downstream of scan.ts and does not break when scan.ts changes',
  );
});

test('no picture, no question', () => {
  assert.strictEqual(deriveCheckIn(undefined), undefined);
  assert.strictEqual(
    deriveCheckIn({ version: 1, kind: 'data-flow', title: 't', items: [] } as never),
    undefined,
    'a chart with no focus item asks nothing',
  );
});

/* ═══ the gate: a check on a preamble is worse than no check ═════════════ */

/**
 * MEASURED, and the reason this gate exists: 6 of 13 and 7 of 15 derived checks
 * landed on read-first preambles — "First, let me read the relevant file" at 33
 * to 57 words — and one landed straight after a clarifying offer.
 *
 * The queue advances on a visual AND an accepted check, and the product now
 * supplies both, so a preamble turn could advance the lesson PAST A CONCEPT
 * NEVER TAUGHT. That is the opposite of why the derived check was built: the
 * queue failing to advance at all is what it was for.
 */
test('the stub boundary is the one the bench uses, not a second opinion', async () => {
  const { TEACH_STUB_WORDS } = await import('../server/askPipeline.js');
  /* The bench calls a turn a stub at `words <= 35`. If these two numbers drift,
     the product withholds a check on turns the instrument counts, or the other
     way round, and neither shows up as a failure anywhere. */
  assert.strictEqual(TEACH_STUB_WORDS, 35);
});

/* ═══ a slot for each direction, and a label that names one file ═════════ */

/**
 * FIRST-COME LIED BY OMISSION.
 *
 * Measured on the real product: `brief.ts` has four files importing it and one
 * it imports. The four inbound edges filled the four slots in graph edge order
 * and the chart showed no outbound arrow at all. Every arrow drawn was TRUE,
 * and a reader would still have concluded the file depends on nothing when it
 * depends on one thing — a false claim assembled entirely out of true ones,
 * which is the hardest kind to notice.
 */
test('each direction that exists gets a slot', () => {
  /* Four importers and one import, the brief.ts shape, at the cap. */
  const graph = {
    nodes: [
      { id: 'f', label: 'brief.ts', path: 'src/brief.ts' },
      ...['a', 'b', 'c', 'd'].map((id) => ({ id, label: `${id}.ts`, path: `src/${id}.ts` })),
      { id: 'dep', label: 'dep.ts', path: 'src/dep.ts' },
    ],
    edges: [
      ...['a', 'b', 'c', 'd'].map((id) => ({ srcId: id, dstId: 'f' })),
      { srcId: 'f', dstId: 'dep' },
    ],
  } as never;
  const chart = buildConceptChart(graph, { title: 'brief', nodeId: 'f' })!;
  const outbound = (chart.links ?? []).filter((l) => l.from === 'f');
  assert.strictEqual(outbound.length, 1, 'the one thing it depends on is drawn');
  assert.ok((chart.links ?? []).length <= 4, 'and the cap still holds');
});

test('a file with only dependents is drawn exactly as before', () => {
  /* The commonest shape must not change: reserving a slot for a direction that
     does not exist would cost a real neighbour for nothing. */
  const graph = {
    nodes: [
      { id: 'f', label: 'f.ts', path: 'src/f.ts' },
      ...['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, label: `${id}.ts`, path: `src/${id}.ts` })),
    ],
    edges: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ srcId: id, dstId: 'f' })),
  } as never;
  const chart = buildConceptChart(graph, { title: 'f', nodeId: 'f' })!;
  assert.strictEqual((chart.links ?? []).length, 4);
  assert.ok((chart.links ?? []).every((l) => l.to === 'f'));
});

test('a label that names twenty files is extended until it names one', () => {
  /*
   * The first chart to draw an outbound edge read `brief.ts -> index.ts`. True,
   * and useless: twenty nodes in this repository are labelled `index.ts`, and
   * `src/index.ts` is no better because every package has one.
   */
  const graph = {
    nodes: [
      { id: 'f', label: 'brief.ts', path: 'packages/analyzer/src/brief.ts' },
      { id: 'i1', label: 'index.ts', path: 'packages/schema/src/index.ts' },
      { id: 'i2', label: 'index.ts', path: 'packages/acp/src/index.ts' },
    ],
    edges: [{ srcId: 'f', dstId: 'i1' }],
  } as never;
  const chart = buildConceptChart(graph, { title: 'brief', nodeId: 'f' })!;
  const target = chart.items.find((i) => i.id === 'i1')!;
  assert.strictEqual(target.label, 'schema/src/index.ts', 'extended until it distinguishes');
  const focus = chart.items.find((i) => i.id === 'f')!;
  assert.strictEqual(focus.label, 'brief.ts', 'and a unique name is left alone');
});

/* ═══ a question with no repository behind it ════════════════════════════ */

/**
 * THE REPOSITORY-LESS CONDITION, DRY-RUN BEFORE IT COST CARD TIME.
 *
 * `docs/research/subject-condition-prediction.md` adds twenty asks with no
 * repository attached. Driving one through the pipeline with a canned provider
 * — no model, no card — found two defects that would otherwise have surfaced
 * partway through a paid run.
 */
test('a teach turn with no repository does not demand a picture of nothing', async () => {
  const { gradeTeachTurn } = await import('../server/askPipeline.js');
  /*
   * `graphBasenames === null` means no repository. buildConceptChart correctly
   * draws nothing without one, so demanding a visual anyway is the belt asking
   * for something the product cannot produce: the turn bounces, the model
   * cannot satisfy it, and it bounces again. Measured: THREE provider calls for
   * one turn, two of them unanswerable, before this.
   */
  const answer = 'A polynomial is a sum of powers of x. Does this make sense so far?';
  const withoutRepo = gradeTeachTurn(answer, null, undefined, false);
  assert.ok(
    !withoutRepo.some((p) => p.includes('NO VISUAL')),
    'no repository, no visual demanded',
  );

  /* And it still demands one where a graph EXISTS — every figure on record is
     from a repository that has one, and this must not have moved them. */
  const withRepo = gradeTeachTurn(answer, new Set(['scan.ts']), undefined, false);
  assert.ok(
    withRepo.some((p) => p.includes('NO VISUAL')),
    'a repository is attached, so the visual rule still applies',
  );
});
