import assert from 'node:assert/strict';
import test from 'node:test';

import { scanRepo } from '../scan.js';
import { deriveCheckIn, deriveNextPictureCheckIn, buildConceptChart } from '../server/conceptChart.js';

/**
 * THE NEXT-PICTURE CHECK-IN — asked before the picture that answers it.
 *
 * Registered bands: `docs/research/next-picture-checkin.md`. This file locks the
 * SHAPE of the question, not whether it teaches; the bands decide that, and they
 * are read from a card run that has not happened.
 */
const repoGraph = async () => scanRepo(process.cwd(), { cluster: true });
const nodeFor = (g: Awaited<ReturnType<typeof repoGraph>>, suffix: string) =>
  g.nodes.find((n) => String(n.path ?? '').split('\\').join('/').endsWith(suffix));

test('it asks a prediction, and says the picture is coming', async () => {
  const g = await repoGraph();
  const n = nodeFor(g, 'src/brief.ts');
  assert.ok(n, 'fixture assumption: brief.ts is in the graph');
  const p1 = deriveNextPictureCheckIn(g, { title: 'brief.ts', nodeId: n.id })!;
  const q = p1.question;
  assert.ok(q, 'a concept with dependents must produce a question');
  assert.match(q, /^Before I draw it/, 'the prediction comes first, or it is not a pretest');
  assert.match(q, /show you the picture next turn/, 'the learner is told the answer is coming');
  /* And it must NOT be the comprehension form, which points at what is already
     on screen. Two different questions, two different jobs. */
  assert.doesNotMatch(q, /Looking at the picture/);
  /* Ruled 2026-09-06: "would break", not "breaks first" (the scan has no
     ordering) and not "depends on" (answerable from recall, so not a
     prediction). And the arrow that decides it is carried for the reveal. */
  assert.match(q, /would break if/);
  assert.doesNotMatch(q, /breaks? first/);
  assert.doesNotMatch(q, /do you think depends on it/);
  assert.ok(p1.arrow.includes('→'), 'the deciding arrow is carried');
  assert.ok(q.includes(p1.expect), 'the true answer is one of the options offered');
});

test('every option is a real file of the same kind and extension', async () => {
  /*
   * THE DEFECT THIS LOCKS OUT. The first version drew distractors from any node
   * and produced "which of acp, cli.ts or repo depends on it?" — one file among
   * two service names. The odd one out is visible without knowing anything about
   * the repository, so the question measured shape-spotting.
   */
  const g = await repoGraph();
  const n = nodeFor(g, 'src/brief.ts')!;
  const q = deriveNextPictureCheckIn(g, { title: 'brief.ts', nodeId: n.id })!.question;
  const options = /Which of (.+?) do you think/.exec(q)![1]!.split(/,\s*|\s+or\s+/);
  assert.strictEqual(options.length, 3, 'three options');
  const basenames = new Set(
    g.nodes
      .filter((x) => x.kind === 'file')
      .map((x) => String(x.path ?? '').split('\\').join('/').split('/').pop()),
  );
  for (const o of options) {
    assert.ok(basenames.has(o), `${o} must be a real file in this repository, not an invention`);
    assert.ok(o.endsWith('.ts'), `${o} must share the answer's extension`);
  }
});

test('the same concept always asks the same question, different concepts do not', async () => {
  /*
   * Deterministic so a bench can compare two runs; NOT constant, because taking
   * the first two candidates gave every concept the same pair, and a learner who
   * meets the same two wrong answers twice learns "pick the unfamiliar one" —
   * a rule about the question rather than about the repository.
   */
  const g = await repoGraph();
  const a = nodeFor(g, 'src/brief.ts')!;
  const b = nodeFor(g, 'src/scan.ts')!;
  const qa1 = deriveNextPictureCheckIn(g, { title: 'brief.ts', nodeId: a.id })?.question;
  const qa2 = deriveNextPictureCheckIn(g, { title: 'brief.ts', nodeId: a.id })?.question;
  const qb = deriveNextPictureCheckIn(g, { title: 'scan.ts', nodeId: b.id })?.question;
  assert.strictEqual(qa1, qa2, 'same concept, same question');
  assert.notStrictEqual(qa1, qb, 'different concepts must not share their distractors');
});

test('no next concept, and a concept with no dependents, draw nothing', async () => {
  const g = await repoGraph();
  assert.strictEqual(deriveNextPictureCheckIn(g, undefined), undefined);
  /* A question whose honest answer is "none of them" teaches the wrong thing
     about the graph, so it is not asked at all. */
  assert.strictEqual(
    deriveNextPictureCheckIn(g, { title: 'nothing-in-this-repo-xyz', nodeId: 'file:does/not/exist.ts' }),
    undefined,
  );
});

test('the current form is untouched by the new one', async () => {
  /* The flag is off by default and the comprehension form must be byte-identical
     to what it was, or every number measured against it is void. */
  const g = await repoGraph();
  const n = nodeFor(g, 'src/brief.ts')!;
  const chart = buildConceptChart(g, { title: 'brief.ts', nodeId: n.id });
  const q = deriveCheckIn(chart)!;
  assert.match(q, /^Looking at the picture:/);
  assert.match(q, /do you think would break/);
});

/* ═══ the reveal ═════════════════════════════════════════════════════════ */

import { runAskPipeline } from '../server/askPipeline.js';
import { buildDigest } from '../explain/explain.js';

/**
 * THE REVEAL CARRIES THE REASON, AND IT FIRES.
 *
 * Ruled 2026-09-06: feedback must name the arrow that decides the answer, not
 * only the verdict. Built in CODE rather than asked of the model, because the
 * prompt already had a branch instructing the model to resolve an open
 * prediction and NOTHING EVER SET `open` — so that branch had never once fired.
 * A reveal that depends on the model doing it is a reveal that does not happen,
 * which is the same lesson the derived visual and the derived check-in each
 * cost a night to learn.
 *
 * No model call: the provider is a stub, so this is free and can run in the
 * gate.
 */
test('a turn with an open prediction reveals it, naming the arrow', async () => {
  const graph = await repoGraph();
  const n = nodeFor(graph, 'src/brief.ts')!;
  const result = await runAskPipeline(
    {
      question: 'continue',
      intents: [],
      scopeLines: [],
      askMode: 'research',
      surface: undefined,
      design: undefined,
      deictic: false,
      designMode: false,
      graph,
      digest: buildDigest(graph),
      cfg: { provider: 'openai-compatible', model: 'stub', apiKey: 'x' },
      resolveReadable: () => null,
      repoRoot: null,
      permission: 'full',
      teach: true,
      teachContext: {
        concept: { title: 'brief.ts', nodeId: n.id },
        open: { question: 'which would break?', expect: 'cli.ts', arrow: 'cli.ts → brief.ts' },
      },
      turnDeadlineMs: 0,
      callProvider: async () => ({
        text:
          'The brief module turns a spec graph into a markdown brief. It reads the spec, walks the ' +
          'nodes and edges in order, and writes the rules and the task list that the scaffolder ' +
          'then follows, without ever touching the repository it describes.',
        toolRequests: [],
      }),
    },
    () => {},
  );
  const text = String(result.text ?? '');
  assert.match(text, /Last turn you were asked which would break/, 'the reveal fires');
  assert.match(text, /cli\.ts → brief\.ts/, 'and it names the arrow, not just the verdict');
  assert.match(text, /that is the dependency/, 'the reason, in the graph’s own terms');
});

test('no open prediction, no reveal', async () => {
  /* The branch must not fire on a turn nobody was asked anything on — a reveal
     of a question that was never put is a claim about the learner. */
  const graph = await repoGraph();
  const n = nodeFor(graph, 'src/brief.ts')!;
  const result = await runAskPipeline(
    {
      question: 'continue',
      intents: [],
      scopeLines: [],
      askMode: 'research',
      surface: undefined,
      design: undefined,
      deictic: false,
      designMode: false,
      graph,
      digest: buildDigest(graph),
      cfg: { provider: 'openai-compatible', model: 'stub', apiKey: 'x' },
      resolveReadable: () => null,
      repoRoot: null,
      permission: 'full',
      teach: true,
      teachContext: { concept: { title: 'brief.ts', nodeId: n.id } },
      turnDeadlineMs: 0,
      callProvider: async () => ({ text: 'A short answer about brief.ts and what it does.', toolRequests: [] }),
    },
    () => {},
  );
  assert.doesNotMatch(String(result.text ?? ''), /Last turn you were asked/);
});
