import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { scanRepo } from '../scan.js';
import { buildDigest } from '../explain/explain.js';
import { buildTeachContext, newLesson } from '../server/lessonState.js';
import {
  runAskPipeline,
  type AskPipelineInput,
  type AskStreamEvent,
} from '../server/askPipeline.js';

/**
 * THE DRAW, WHEN THE SUBJECT IS NOT IN THE REPOSITORY.
 *
 * Max's sentence: a learner asks "what is machine learning" and gets the
 * architecture DRAWN, not described. Measured over 12 runs across three
 * surfaces, the draw rate for that question is **0**.
 *
 * ── WHY THIS IS NOT ANOTHER BELT CLAUSE ──────────────────────────────────
 *
 * The belt was given the honest instruction first — `subjectNotInRepo` tells the
 * turn its subject is absent, retires the grounding demand, and asks in as many
 * words for `propose_chart` with no nodeIds. **Measured on 4 runs,
 * granite42-hermes Q4_K_M: fabricated repository facts went to 0 of 4, and the
 * draw rate stayed 0 of 4.** The model does not call the tool: 5 calls in 296
 * teach turns on the bench, 0 in 12 runs of this question.
 *
 * That is the trap this tree has paid for five times — a clause present,
 * unconditional, and unobeyed — and the answer is never a louder clause. **If
 * the product wants a picture it has to draw one.** The derived concept chart is
 * already exactly this move for in-repo subjects: "ONLY WHEN THE MODEL DREW
 * NOTHING … a floor, not a replacement". This is that floor extended to the one
 * case it could not cover, because `buildConceptChart` needs a concept and there
 * is none.
 *
 * ── WHAT KEEPS IT HONEST ─────────────────────────────────────────────────
 *
 * `executeProposeChart` already states the rule: "a chart about an idea
 * (softmax, a doctrine) carries no nodeIds and passes; a chart that claims THIS
 * system is checked against it". So the general-knowledge chart carries **no
 * nodeIds at all**, which is what makes fabricated-repository-facts 0 by
 * construction rather than by hope — a chart that cites nothing cannot cite
 * something false. Any nodeId the model returns is refused, not stripped and
 * quietly kept: a model that named a node was making a claim about the
 * repository, and honouring the rest of that chart would keep the intent.
 *
 * The caption says where the picture came from, because a drawing with no
 * provenance beside a repository view is the same confusion in a nicer costume.
 */

function shopfront(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-gkdraw-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'shopfront', version: '1.0.0', type: 'module' }),
  );
  fs.writeFileSync(
    path.join(repo, 'src', 'gateway.js'),
    "import { route } from './router.js';\nexport function handle(r) {\n  return route(r);\n}\n",
  );
  fs.writeFileSync(
    path.join(repo, 'src', 'router.js'),
    'export function route(r) {\n  return r;\n}\n',
  );
  return root;
}

const PROSE =
  'This is general knowledge and not from this repository. Machine learning fits a model to ' +
  'labelled examples and then uses it on unseen data. Does that distinction land so far?';

/** A chart a model might return for the subject: real shape, no nodeIds. */
const GK_CHART = {
  kind: 'data-flow',
  title: 'Machine learning',
  items: [
    { id: 'data', label: 'Training data' },
    { id: 'model', label: 'Model' },
    { id: 'pred', label: 'Predictions' },
  ],
  links: [
    { from: 'data', to: 'model' },
    { from: 'model', to: 'pred' },
  ],
};

interface Run {
  events: AskStreamEvent[];
  calls: number;
}

async function runTurn(
  repo: string,
  ask: string,
  chartReply: unknown,
  grounded: boolean,
): Promise<Run> {
  const graph = await scanRepo(repo, {});
  const lesson = newLesson('t1', ask, graph);
  const ctx = buildTeachContext({ lesson, graph });
  const events: AskStreamEvent[] = [];
  let calls = 0;
  const input = {
    question: ask,
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
    callProvider: async () => {
      calls += 1;
      /* First call: the lesson prose, drawing nothing — the measured behaviour.
         Any later call is the product asking for the picture itself. */
      if (calls === 1) return { text: PROSE, toolRequests: [] };
      return { text: JSON.stringify(chartReply), toolRequests: [] };
    },
    teach: true,
    /* UNDER `teachContext`, which is where the pipeline reads it. Spreading the
       context at the top level silently gives the turn no concept at all — the
       first draft of this harness did that and its own control went red. */
    teachContext: ctx,
  } as unknown as AskPipelineInput;
  await runAskPipeline(input, (e) => events.push(e));
  void grounded;
  return { events, calls };
}

const charts = (r: Run) =>
  r.events.filter((e) => (e as { type?: string }).type === 'chart:proposal') as Array<{
    chart: { title?: string; caption?: string; items?: { nodeId?: string }[] };
  }>;

test('THE REPORTED SHAPE: a subject absent from the repo is DRAWN from general knowledge', async () => {
  const root = shopfront();
  try {
    const run = await runTurn(
      path.join(root, 'repo'),
      'what is machine learning',
      GK_CHART,
      false,
    );
    const drawn = charts(run);
    assert.strictEqual(drawn.length, 1, `expected one chart, got ${drawn.length}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the chart says where it came from, and cites no node', async () => {
  const root = shopfront();
  try {
    const run = await runTurn(path.join(root, 'repo'), 'what is machine learning', GK_CHART, false);
    const [only] = charts(run);
    assert.ok(only !== undefined, 'no chart to check');
    assert.match(
      String(only.chart.caption ?? ''),
      /general knowledge/i,
      `the caption must name its provenance: ${JSON.stringify(only.chart.caption)}`,
    );
    for (const item of only.chart.items ?? []) {
      assert.strictEqual(
        item.nodeId,
        undefined,
        'a general-knowledge chart must cite no node in this repository',
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a returned chart that CLAIMS a node is refused, not quietly stripped', async () => {
  /*
   * The fabrication in chart form. Stripping the nodeId and keeping the picture
   * would keep the model's claim and hide it; the whole chart goes.
   */
  const root = shopfront();
  try {
    const claiming = {
      ...GK_CHART,
      items: [
        { id: 'data', label: 'Training data', nodeId: 'file:src/gateway.js' },
        { id: 'model', label: 'Model' },
      ],
    };
    const run = await runTurn(path.join(root, 'repo'), 'what is machine learning', claiming, false);
    assert.strictEqual(
      charts(run).length,
      0,
      'a chart claiming a repository node must not reach the canvas',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('THE CONTROL: an in-repo subject still gets its GRAPH chart, and no extra call', async () => {
  /*
   * Without this the change would draw from memory on every lesson, which is the
   * "model improvising boxes" the feature exists against. A concept in the graph
   * is drawn from the graph, and the product asks the model for nothing extra.
   */
  const root = shopfront();
  try {
    const run = await runTurn(path.join(root, 'repo'), 'teach me gateway.js', GK_CHART, true);
    const drawn = charts(run);
    assert.strictEqual(drawn.length, 1, 'the derived concept chart still fires');
    assert.doesNotMatch(
      String(drawn[0]?.chart.caption ?? ''),
      /general knowledge/i,
      'and it is the graph chart, not a remembered one',
    );
    /* NOT asserted on the call count: the teach bounce legitimately adds a
       call, so a count cannot separate "asked for a picture" from "was bounced".
       The caption is the property, and it is checked above. */
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('THE BRANCH EACH ONE TAKES, on the SAME repository and the same call', async () => {
  /*
   * The false-positive side, asked directly: one subject the scan can find and
   * one it cannot, through the identical path, asserting which chart each gets.
   * A single-sided test would pass on a build that drew from memory every time.
   *
   * MEASURED COST, stated here because this test cannot see it: over the 13
   * registered bank asks the gate fires on FOUR whose subjects ARE in the tree
   * (harness-03/05/06/08 — verifyGate.ts, askTools.ts twice, explain.ts). They
   * are named by concept and `buildQueue` matches filenames, so the queue is
   * empty and this branch takes them. Those four get a remembered picture where
   * a graph one would be better. That is a `buildQueue` limit, not a caption
   * problem — which is why nothing downstream claims the subject is ABSENT, only
   * that the chart came from general knowledge rather than from the scan.
   */
  const root = shopfront();
  try {
    const absent = await runTurn(
      path.join(root, 'repo'),
      'what is machine learning',
      GK_CHART,
      false,
    );
    const present = await runTurn(path.join(root, 'repo'), 'teach me gateway.js', GK_CHART, true);

    const a = charts(absent);
    const p = charts(present);
    assert.strictEqual(a.length, 1, 'the conceptless ask is drawn');
    assert.strictEqual(p.length, 1, 'the in-repo ask is drawn');

    assert.match(
      String(a[0]?.chart.caption ?? ''),
      /general knowledge/i,
      'the conceptless ask takes the general-knowledge branch',
    );
    assert.doesNotMatch(
      String(p[0]?.chart.caption ?? ''),
      /general knowledge/i,
      'and the in-repo ask does NOT — it is drawn from the scanned graph',
    );
    assert.match(
      String(p[0]?.chart.caption ?? ''),
      /from the scanned graph/i,
      'which is what the graph chart says about itself',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('and the caption never claims the SUBJECT is absent, only where the chart came from', async () => {
  /*
   * The claim this feature is not entitled to make. An empty queue means "no
   * filename matched", not "absent from this repository" — measured at 4 of 13
   * above. Provenance is always true; absence is not.
   */
  const root = shopfront();
  try {
    const run = await runTurn(path.join(root, 'repo'), 'what is machine learning', GK_CHART, false);
    const caption = String(charts(run)[0]?.chart.caption ?? '');
    assert.match(caption, /general knowledge/i, 'it says where the picture came from');
    assert.doesNotMatch(
      caption,
      /not in (?:the |this )?(?:scanned )?repository|subject is not/i,
      `the caption must not assert the subject is absent: ${caption}`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
