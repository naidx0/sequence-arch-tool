/**
 * LESSON STATE — the queue that makes "continue" mean something.
 *
 * Measured cause: of the 47 turns in the 20-conversation teach bench, 17 never
 * became lessons, and 10 of those were "continue to the next point" — a turn
 * where the contract demands exactly one concept and the pipeline supplied none,
 * because `TeachTurnContext.concept` was read and never written.
 *
 * The division these tests pin down: the ASK sets the grain and the count, the
 * GRAPH sets the candidates and the order. Both halves have a way to be wrong,
 * and each is checked.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import type { ArchEdge, ArchGraph, ArchNode } from '@sequence/schema';

import { scanRepo } from '../scan.js';

import {
  advanceLesson,
  buildQueue,
  lessonExhausted,
  newLesson,
  nextConcept,
} from '../server/lessonState.js';

const node = (id: string, label: string, path?: string): ArchNode =>
  ({ id, label, kind: 'file', ...(path === undefined ? {} : { path }) }) as ArchNode;

const edge = (srcId: string, dstId: string): ArchEdge =>
  ({ id: `${srcId}->${dstId}`, srcId, dstId, kind: 'import', confidence: 1, origin: 'deterministic' }) as ArchEdge;

/* names.txt -> bigram_counts.py -> sampling.py, the makemore shape */
const graph = {
  nodes: [
    node('file:bigram_counts.py', 'bigram_counts.py', 'bigram_counts.py'),
    node('file:sampling.py', 'sampling.py', 'sampling.py'),
    node('file:nn_bigram.py', 'nn_bigram.py', 'nn_bigram.py'),
  ],
  edges: [edge('file:bigram_counts.py', 'file:sampling.py'), edge('file:sampling.py', 'file:nn_bigram.py')],
} as Pick<ArchGraph, 'nodes' | 'edges'>;

test('a sequence ask yields several concepts, grounded and in edge order', () => {
  const q = buildQueue(graph, 'Teach me how bigram_counts.py works — bit by bit, visually.');
  assert.ok(q.length >= 2, `expected a sequence, got ${JSON.stringify(q)}`);
  assert.equal(q[0].nodeId, 'file:bigram_counts.py', 'the named node leads');
  assert.equal(q[1].nodeId, 'file:sampling.py', 'then the edge’s destination, not alphabetical order');
  for (const c of q) {
    assert.ok(
      graph.nodes.some((n) => n.id === c.nodeId),
      `${c.nodeId} is not a node in this graph — a queue may not invent structure`,
    );
  }
});

test('a single-question ask yields ONE concept, not a syllabus', () => {
  /* "Why is the dot marker used at both ends" wants one explanation. Padding it
     with neighbours would invent a lesson the learner never asked for, and they
     cannot see the queue to correct it. */
  const q = buildQueue(graph, 'Why does sampling.py use the dot marker at both ends?');
  assert.equal(q.length, 1);
  assert.equal(q[0].nodeId, 'file:sampling.py');
});

test('an ask that names nothing gets an EMPTY queue, not a manufactured one', () => {
  /* An attached law article or a maths note has no nodes. The honest answer is
     no queue — the belt then behaves exactly as it does today. */
  assert.deepEqual(buildQueue(graph, 'Teach me the doctrine of consideration, one point at a time.'), []);
});

test('"continue" after a taught concept receives the NEXT concept, not an empty slot', () => {
  /* THE DEFECT, in one assertion. This is the turn that produced ten words
     across ten of the bench's seventeen fragments. */
  const lesson = newLesson('s1', 'Teach me how bigram_counts.py works — bit by bit', graph);
  const first = nextConcept(lesson);
  assert.ok(first, 'the opening turn has a concept');

  const after = advanceLesson(lesson, { passed: true, turn: 1 });
  const second = nextConcept(after);
  assert.ok(second, 'the "continue" turn has a concept');
  assert.notEqual(second.nodeId, first.nodeId, 'and it is a DIFFERENT one');
  assert.deepEqual(after.taught.map((t) => t.nodeId), [first.nodeId]);
  assert.equal(after.taught[0].turn, 1);
});

test('a bounced turn does NOT consume a concept', () => {
  /* The harness bounces a turn that broke a hard rule and the next turn
     re-teaches it. If the queue advanced anyway, the re-teach would be of the
     wrong concept — a silent skip. */
  const lesson = newLesson('s1', 'Teach me how bigram_counts.py works — bit by bit', graph);
  const after = advanceLesson(lesson, { passed: false, turn: 1 });
  assert.deepEqual(after.queue, lesson.queue);
  assert.deepEqual(after.taught, []);
});

test('advancing returns a NEW lesson and leaves the old one alone', () => {
  /* The caller writes what this returns. Mutating in place would let a failed
     write leave memory ahead of disk — the reload bug the file exists to avoid. */
  const lesson = newLesson('s1', 'Teach me how bigram_counts.py works — bit by bit', graph);
  const before = lesson.queue.length;
  advanceLesson(lesson, { passed: true, turn: 1 });
  assert.equal(lesson.queue.length, before);
});

test('a one-concept lesson reports itself DONE rather than handing back nothing', () => {
  const lesson = newLesson('s1', 'Why does sampling.py use the dot marker?', graph);
  assert.equal(lesson.queue.length, 1);
  assert.equal(lessonExhausted(lesson), false, 'not done before it is taught');

  const done = advanceLesson(lesson, { passed: true, turn: 1 });
  assert.equal(nextConcept(done), undefined);
  assert.equal(lessonExhausted(done), true, 'the belt needs to know, to say the honest sentence');
});

test('a lesson with no nodes is never "exhausted" — it never had a queue', () => {
  /* Otherwise every article lesson would open by announcing it had finished. */
  const lesson = newLesson('s1', 'Teach me the doctrine of consideration.', graph);
  assert.deepEqual(lesson.queue, []);
  assert.equal(lessonExhausted(lesson), false);
});

test('the subject records only node ids the graph really has', () => {
  const lesson = newLesson('s1', 'Teach me how bigram_counts.py works — bit by bit', graph);
  for (const id of lesson.subject.nodeIds) {
    assert.ok(graph.nodes.some((n) => n.id === id), `${id} is not in the graph`);
  }
});

test('a two-letter label cannot match half the English language', () => {
  /* `askNames` requires three characters. Without it a node labelled "go" or
     "db" matches almost any sentence and every lesson gets the same queue. */
  const tiny = {
    nodes: [node('n:go', 'go'), node('file:sampling.py', 'sampling.py', 'sampling.py')],
    edges: [],
  } as Pick<ArchGraph, 'nodes' | 'edges'>;
  const q = buildQueue(tiny, 'Teach me how sampling.py works — step by step');
  assert.deepEqual(q.map((c) => c.nodeId), ['file:sampling.py']);
});

/* --------------------------------------------------- persistence: a reload -- */

test('a reload keeps the lesson — the queue survives a fresh process', async () => {
  /*
   * THE SECOND HALF OF THE DEFECT. A queue that lives in memory is a queue that
   * a refresh silently empties, and the learner's next "continue" is a fragment
   * again — the same ten words, from a different cause.
   */
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { readLesson, writeLesson } = await import('../server/sessionsStore.js');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-lesson-'));
  try {
    const lesson = newLesson('sess-1', 'Teach me how bigram_counts.py works — bit by bit', graph);
    const after = advanceLesson(lesson, { passed: true, turn: 1 });
    writeLesson(root, 'sess-1', after);

    // A different call, reading only from disk — no shared object.
    const reloaded = readLesson(root, 'sess-1');
    assert.ok(reloaded, 'lesson.json must exist beside the transcript');
    assert.deepEqual(reloaded.queue, after.queue);
    assert.deepEqual(reloaded.taught, after.taught);
    assert.equal(nextConcept(reloaded)?.nodeId, nextConcept(after)?.nodeId);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an unrecognised lesson file is ignored, not fed to the belt', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { readLesson } = await import('../server/sessionsStore.js');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-lesson-bad-'));
  try {
    const dir = path.join(root, '.sequence', 'sessions', 's');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'lesson.json'), JSON.stringify({ version: 99, nope: true }));
    assert.equal(readLesson(root, 's'), undefined, 'a shape we do not know is not a lesson');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------- what the first version of this got wrong -- */

test('a container node is never a concept', () => {
  /*
   * MEASURED FAILURE of the first version: "Teach me how makemore works — bit by
   * bit" produced the queue ["makemore", "makemore"] — the repo and service
   * nodes, twice, because both carry the repository's own name. A turn told its
   * concept is "makemore" has been told nothing, and a duplicate label cannot
   * identify either node it belongs to.
   */
  const withContainer = {
    nodes: [
      node('repo:makemore', 'makemore'),
      node('svc:makemore', 'makemore'),
      node('file:sampling.py', 'sampling.py', 'sampling.py'),
    ],
    edges: [],
  } as Pick<ArchGraph, 'nodes' | 'edges'>;
  const q = buildQueue(withContainer, 'Teach me how sampling.py works — bit by bit');
  assert.deepEqual(q.map((c) => c.title), ['sampling.py']);
});

test('naming the repository seeds the lesson from its files, in edge order', () => {
  /*
   * The other half of the same failure. Excluding containers made the ask that
   * NAMES the repository return nothing at all — the exact ask the design was
   * written around. Naming the repo is a signal that the lesson is about this
   * repo; combined with a sequence-shaped ask it seeds from the files.
   */
  const withContainer = {
    nodes: [
      node('repo:makemore', 'makemore'),
      node('file:bigram_counts.py', 'bigram_counts.py', 'bigram_counts.py'),
      node('file:sampling.py', 'sampling.py', 'sampling.py'),
    ],
    edges: [edge('file:bigram_counts.py', 'file:sampling.py')],
  } as Pick<ArchGraph, 'nodes' | 'edges'>;
  const q = buildQueue(withContainer, 'Teach me how makemore works — bit by bit, visually.');
  assert.deepEqual(q.map((c) => c.title), ['bigram_counts.py', 'sampling.py']);
});

test('naming the repository does NOT seed a lesson that is about an attachment', () => {
  /* An attached law primer has no place in a queue built from makemore's files.
     The empty queue is what keeps it out, and it must stay empty. */
  const withContainer = {
    nodes: [node('repo:makemore', 'makemore'), node('file:sampling.py', 'sampling.py', 'sampling.py')],
    edges: [],
  } as Pick<ArchGraph, 'nodes' | 'edges'>;
  assert.deepEqual(
    buildQueue(withContainer, 'I attached a law primer. Teach me the doctrine of consideration, one point at a time.'),
    [],
  );
});

test('an ask that points at the repository without naming a file still gets a queue', () => {
  /*
   * MEASURED: 12 of the 20 bench asks name no node at all — "Teach me what a
   * bigram is and how this repo counts them", "softmax as it appears in this
   * training loop". Requiring a filename left the queue empty for the majority,
   * and an empty queue is the fragment this module exists to remove. A phrase
   * pointing at the repository is the same signal as naming it.
   */
  const q = buildQueue(graph, 'Teach me what a bigram is and how this repo counts them, step by step');
  assert.ok(q.length >= 2, `expected a queue, got ${JSON.stringify(q)}`);
  for (const c of q) assert.ok(graph.nodes.some((n) => n.id === c.nodeId));
});

test('an attachment lesson with no repo reference still gets nothing', () => {
  /* The other side of the same rule, and the one that matters more: a law
     primer has no business drawing a queue out of makemore's files. */
  assert.deepEqual(
    buildQueue(graph, 'I attached a law primer. Teach me the doctrine of consideration, one point at a time.'),
    [],
  );
});

/* ------------------------------------------- source three: the model's plan -- */

test('THE RED TEST: a law-primer ask has no queue, and a plan gives it one', async () => {
  /*
   * The case the graph cannot serve, and the one that dominates the bench: 12 of
   * 20 asks name no node and are not sequence-shaped. An attached primer's
   * concepts live in the article; no amount of edge-walking finds them.
   *
   * This test fails without source three — the queue stays empty and every
   * "continue" is a fragment, which is exactly what the 20-conversation run
   * measured.
   */
  const { applyPlan, needsPlan, validatePlan } = await import('../server/lessonState.js');
  const ask = 'I attached a law primer. Teach me the doctrine of consideration, one point at a time.';
  const lesson = newLesson('s1', ask, graph);
  assert.deepEqual(lesson.queue, [], 'the graph cannot order this ask');
  assert.equal(needsPlan(lesson), true);

  const plan = validatePlan(
    { concepts: [{ title: 'what consideration is' }, { title: 'why past consideration is none' }] },
    new Set(graph.nodes.map((n) => n.id)),
  );
  assert.equal(plan.ok, true, plan.reason);

  const planned = applyPlan(lesson, plan.concepts);
  assert.ok(planned.queue.length >= 2, 'the lesson now has concepts to teach');
  assert.equal(nextConcept(planned)?.title, 'what consideration is');

  const after = advanceLesson(planned, { passed: true, turn: 0 });
  assert.equal(nextConcept(after)?.title, 'why past consideration is none', '"continue" has somewhere to go');
});

test('a plan naming an invented node is refused WHOLE, and the queue stays empty', async () => {
  /*
   * The same refusal propose_chart applies, for the same reason. Refused whole
   * rather than half-accepted: a queue the learner cannot see, half of which
   * points at nothing, is worse than no queue.
   */
  const { applyPlan, validatePlan } = await import('../server/lessonState.js');
  const lesson = newLesson('s1', 'Teach me the doctrine of consideration.', graph);
  const plan = validatePlan(
    {
      concepts: [
        { title: 'a real one', nodeId: 'file:sampling.py' },
        { title: 'an invented one', nodeId: 'softmax_output' },
      ],
    },
    new Set(graph.nodes.map((n) => n.id)),
  );
  assert.equal(plan.ok, false);
  assert.match(plan.reason ?? '', /may not invent structure/);
  assert.deepEqual(applyPlan(lesson, plan.concepts).queue, [], 'a refused plan poisons nothing');
});

test('a plan never overwrites a queue the graph already produced', async () => {
  const { applyPlan, needsPlan, validatePlan } = await import('../server/lessonState.js');
  const lesson = newLesson('s1', 'Teach me how bigram_counts.py works — bit by bit', graph);
  assert.ok(lesson.queue.length > 0);
  assert.equal(needsPlan(lesson), false, 'a lesson with a queue is not asking for a plan');
  const plan = validatePlan({ concepts: [{ title: 'something else entirely' }] }, undefined);
  assert.deepEqual(applyPlan(lesson, plan.concepts).queue, lesson.queue);
});

test('a concept with no nodeId is allowed — the primer has no file behind it', async () => {
  const { validatePlan } = await import('../server/lessonState.js');
  const plan = validatePlan({ concepts: [{ title: 'consideration' }] }, new Set(['file:x']));
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.concepts, [{ title: 'consideration' }]);
});

test('an empty plan is refused rather than installed as an empty lesson', async () => {
  const { validatePlan } = await import('../server/lessonState.js');
  assert.equal(validatePlan({ concepts: [] }, undefined).ok, false);
  assert.equal(validatePlan(null, undefined).ok, false);
});

test('the finished one-concept lesson can name what touches it', async () => {
  /* 10 of the 20 bench asks are one concept, and their "continue" deserves the
     honest sentence with a real proposal — not a fragment, and not an invented
     next topic. One hop, from the graph. */
  const { neighboursOf } = await import('../server/lessonState.js');
  assert.deepEqual(neighboursOf(graph, 'file:sampling.py'), ['bigram_counts.py', 'nn_bigram.py']);
  assert.deepEqual(neighboursOf(graph, undefined), []);
});

/* ------------------------------------ the honest sentence for a finished lesson -- */

test('a finished lesson tells the belt to say so and propose, not to answer in a sentence', async () => {
  const { renderTeachModeInstructions } = await import('../server/askPipeline.js');
  const belt = renderTeachModeInstructions({
    lessonDone: { neighbours: ['bigram_counts.py', 'nn_bigram.py'] },
  });
  assert.match(belt, /LESSON THEY ASKED FOR IS TAUGHT/);
  assert.match(belt, /bigram_counts\.py/, 'the proposal is grounded in real neighbours');
  assert.match(belt, /do not answer in a sentence/i, 'the fragment is named and forbidden');
});

test('with no neighbours the finished lesson asks — the one place that is allowed', async () => {
  /* Asking the learner to choose is banned everywhere else in this contract.
     Here the lesson that set the scope is over, so it is the right question. */
  const { renderTeachModeInstructions } = await import('../server/askPipeline.js');
  const belt = renderTeachModeInstructions({ lessonDone: { neighbours: [] } });
  assert.match(belt, /ask what they want to look at next/);
});

test('an unfinished lesson gets no such slot', async () => {
  const { renderTeachModeInstructions } = await import('../server/askPipeline.js');
  const belt = renderTeachModeInstructions({ concept: { title: 'a thing' } });
  assert.doesNotMatch(belt, /LESSON THEY ASKED FOR IS TAUGHT/);
});

test('the belt asks for a plan only when the graph could not build one', async () => {
  const { renderTeachModeInstructions } = await import('../server/askPipeline.js');
  assert.match(renderTeachModeInstructions({ needsPlan: true }), /CALL propose_plan/);
  assert.doesNotMatch(
    renderTeachModeInstructions({ concept: { title: 'a thing' } }),
    /CALL propose_plan/,
    'a lesson that already has a queue must not be asked to re-plan',
  );
});

test('propose_plan accepts a document-shaped plan and refuses an invented node', async () => {
  const { executeAskTool } = await import('../server/askTools.js');
  const ctx = { graph: { nodes: [{ id: 'file:a.py', label: 'a.py', path: 'a.py' }] } } as never;

  const ok = await executeAskTool(
    'propose_plan',
    { concepts: [{ title: 'what consideration is' }, { title: 'past consideration' }] },
    ctx,
  );
  assert.strictEqual(ok.ok, true, String(ok.evidence));
  assert.equal(ok.plan?.length, 2, 'the concepts ride on the result for the pipeline to store');

  const bad = await executeAskTool(
    'propose_plan',
    { concepts: [{ title: 'invented', nodeId: 'softmax_output' }] },
    ctx,
  );
  assert.strictEqual(bad.ok, false);
  assert.match(String(bad.evidence), /may not invent structure/);
});

test('propose_plan resolves a file stem the same way propose_chart does', async () => {
  const { executeAskTool } = await import('../server/askTools.js');
  const ctx = { graph: { nodes: [{ id: 'file:a.py', label: 'a.py', path: 'a.py' }] } } as never;
  const r = await executeAskTool('propose_plan', { concepts: [{ title: 'the file', nodeId: 'a.py' }] }, ctx);
  assert.strictEqual(r.ok, true, String(r.evidence));
  assert.equal(r.plan?.[0].nodeId, 'file:a.py', 'the stem became the real node id');
});

/* ── the lesson/question boundary, on a real scanned repository ──────────── */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOPFRONT = path.join(HERE, '..', '..', 'test', 'fixtures', 'shopfront');
const shopfront = (async () => scanRepo(SHOPFRONT, { cluster: true }))();

test('a lesson ask with no sequence phrase still gets its neighbours', async () => {
  /*
   * THE PLANTED CASE FOR THE BRANCH CHANGE, on the shopfront fixture rather than
   * a hand-built graph, because the defect was about real asks over a real scan.
   *
   * Before: SEQUENCE_ASK alone decided, so this returned ONE concept — the named
   * file and nothing around it. Five of the thirteen bench conversations are
   * exactly this shape (cs-05, link-04, mix-03, mix-06, harness-07) and every one
   * ran on a queue of one, which is why a stub in their first turn was the
   * difference between a second turn having a concept and having none.
   */
  const g = await shopfront;
  const q = buildQueue(g, 'Teach me what orders.ts does here.');
  assert.ok(q.length > 1, `a lesson ask must see neighbours, got ${JSON.stringify(q.map((c) => c.title))}`);
  assert.strictEqual(q[0].title, 'orders.ts', 'and the named node still leads');
  for (const c of q) {
    assert.ok(
      g.nodes.some((n) => n.id === c.nodeId),
      `${c.nodeId} is not a node in this graph — a queue may not invent structure`,
    );
  }
});

test('a pointed question on the same node still gets exactly one', async () => {
  /*
   * THE HALF THAT KEEPS THE CHANGE HONEST. The rule being relaxed is not "one
   * concept is wrong"; it is "a sequence phrase is the wrong way to detect a
   * lesson". A question about one file still wants one explanation, and this
   * asserts the boundary from the other side so widening TEACH_ASK later cannot
   * quietly swallow it.
   */
  const g = await shopfront;
  const q = buildQueue(g, 'Why does orders.ts use the retry flag at both ends?');
  assert.strictEqual(q.length, 1, 'a pointed question is not a syllabus');
  assert.strictEqual(q[0].title, 'orders.ts');
});
