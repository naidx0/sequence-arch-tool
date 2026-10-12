/**
 * SeqChart — the contract that lets a picture be checked before it is believed.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import { CHART_KINDS, chartFamily, validateChart, type SeqChart } from './chart.js';

test('every one of the 45 model-facing kinds maps to a renderer family', () => {
  assert.strictEqual(CHART_KINDS.length, 45);
  for (const k of CHART_KINDS) {
    assert.ok(chartFamily(k), `${k} has no family`);
  }
  // The compression claim: 45 names, a handful of renderers.
  const families = new Set(CHART_KINDS.map(chartFamily));
  assert.ok(families.size <= 9, `families stay small, got ${families.size}`);
});

test('a chart that INVENTS repo structure is refused, naming the fake node', () => {
  const chart = {
    version: 1,
    kind: 'system-architecture',
    title: 'The system',
    items: [
      { id: 'a', label: 'Gateway', nodeId: 'svc:gateway' },
      { id: 'b', label: 'Ghost', nodeId: 'svc:does-not-exist' },
    ],
  };
  const known = new Set(['svc:gateway']);
  const bad = validateChart(chart, known);
  assert.strictEqual(bad.ok, false);
  assert.ok(
    bad.ok === false && bad.problems.some((p) => p.message.includes('svc:does-not-exist')),
    'the fabricated node is named',
  );
  // The same chart without the ghost passes.
  const good = validateChart({ ...chart, items: [chart.items[0]] }, known);
  assert.strictEqual(good.ok, true);
});

test('a chart about an IDEA (no nodeIds) is legal — not everything is repo structure', () => {
  const r = validateChart(
    {
      version: 1,
      kind: 'before-and-after',
      title: 'Counting vs learning',
      items: [
        { id: 'x', label: 'Counts table' },
        { id: 'y', label: 'Trained weights' },
      ],
      links: [{ from: 'x', to: 'y', label: 'converges to' }],
    },
    new Set(['svc:gateway']),
  );
  assert.strictEqual(r.ok, true);
});

test('structural problems are each named: bad kind, empty items, dangling link, bad focus', () => {
  const r = validateChart({
    version: 1,
    kind: 'not-a-real-kind',
    title: '',
    items: [],
    links: [{ from: 'nope', to: 'also-nope' }],
    focusItemId: 'missing',
  });
  assert.strictEqual(r.ok, false);
  const msgs = r.ok === false ? r.problems.map((p) => p.path).join(',') : '';
  for (const path of ['kind', 'title', 'items', 'links[0].from', 'focusItemId']) {
    assert.ok(msgs.includes(path), `${path} flagged (got ${msgs})`);
  }
});

test('a chart matching the PUBLISHED tool contract validates — version is stamped, not demanded', () => {
  /*
   * The `propose_chart` tool schema publishes {kind, title, items, links?,
   * focusItemId?} and the teach contract says "EVERY concept ships ONE visual,
   * drawn with propose_chart" — neither mentions `version`. A schema-conformant
   * call was refused with "version: version must be 1", the teach grader then
   * bounced the turn for having NO VISUAL, and the lesson landed with no
   * picture: the owner's "we need to SEE the breakdown on our app" failing
   * inside the fix for it.
   */
  const r = validateChart({
    kind: 'data-flow',
    title: 'How a request reaches the model',
    items: [
      { id: 'ui', label: 'Composer' },
      { id: 'srv', label: 'Ask pipeline' },
    ],
    links: [{ from: 'ui', to: 'srv' }],
    focusItemId: 'srv',
  });
  assert.strictEqual(r.ok, true, r.ok === false ? JSON.stringify(r.problems) : '');
  assert.strictEqual(r.ok === true && r.chart.version, 1, 'the payload still carries the stamp');
  // A version this code does not understand is still refused.
  const wrong = validateChart({
    version: 2,
    kind: 'bar',
    title: 'X',
    items: [{ id: 'a', label: 'A' }],
  });
  assert.strictEqual(wrong.ok, false);
  assert.ok(wrong.ok === false && wrong.problems.some((p) => p.path === 'version'));
});

test('duplicate item ids are refused — a chart must address each item exactly once', () => {
  const r = validateChart({
    version: 1,
    kind: 'hierarchy',
    title: 'Tree',
    items: [
      { id: 'a', label: 'A' },
      { id: 'a', label: 'A again' },
    ],
  } satisfies Partial<SeqChart> as unknown);
  assert.strictEqual(r.ok, false);
});

test('validateChart returns a problem (never throws) on a non-array links shape slip', () => {
  for (const bad of [{}, 'none', 0, 42, true]) {
    const r = validateChart({
      version: 1,
      kind: 'bar',
      title: 'X',
      items: [{ id: 'a', label: 'A' }],
      links: bad,
    } as unknown);
    assert.strictEqual(r.ok, false, `links=${JSON.stringify(bad)} must fail, not throw`);
    assert.ok(r.ok === false && r.problems.some((p) => p.path === 'links'));
  }
  // A well-formed links array still validates.
  const good = validateChart({
    version: 1,
    kind: 'data-flow',
    title: 'X',
    items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    links: [{ from: 'a', to: 'b' }],
  });
  assert.strictEqual(good.ok, true);
});

/* ═══ the refusal must name the admissible set ════════════════════════════ */

/**
 * THE ml-01 PAIR, REBUILT FROM THE RAW LOG.
 *
 * Two 20-conversation teach runs, four propose_chart calls between them, every
 * one refused here. The second call in each pair is the interesting one: told
 * its `nodeId`s were invented, the model dropped them; never told which item
 * ids existed, it kept joining items by their file names and stopped asking.
 *
 *   links[0].from: unknown item nn_bigram.py; links[0].to: unknown item bigram_counts.py
 *
 * Those are LABELS. The gate is not that the message is longer -- it is that a
 * caller which does exactly what the message says lands a chart, which is
 * asserted mechanically at the end by parsing the suggestion back out and
 * revalidating. If the suggestion were wrong or absent, that step fails.
 */
const ML01_RETRY = {
  version: 1 as const,
  kind: 'data-flow' as const,
  title: 'Bigram counting',
  items: [
    { id: 'counts', label: 'bigram_counts.py' },
    { id: 'nn', label: 'nn_bigram.py' },
    { id: 'sample', label: 'sampling.py' },
  ],
  links: [
    { from: 'nn_bigram.py', to: 'bigram_counts.py' },
    { from: 'sampling.py', to: 'bigram_counts.py' },
  ],
};

test('a link joined by LABEL is refused with the id that label belongs to', () => {
  const got = validateChart(ML01_RETRY);
  assert.strictEqual(got.ok, false);
  if (got.ok) return;
  const from = got.problems.find((p) => p.path === 'links[0].from');
  assert.ok(from, 'the offending endpoint is still reported');
  /* The id it should have used, named. This is the whole fix: before it, the
     message said "unknown item nn_bigram.py" and stopped. */
  assert.match(from.message, /did you mean "nn"/);
  /* And WHY, because a bare suggestion teaches nothing and the same call comes
     back next turn in a different costume. */
  assert.match(from.message, /LABEL/);
  /* The admissible set, listed -- items are capped at 40, so this is bounded. */
  assert.match(from.message, /known items: "counts", "nn", "sample"/);
});

test('following the refusal mechanically lands a chart', () => {
  const first = validateChart(ML01_RETRY);
  assert.strictEqual(first.ok, false);
  if (first.ok) return;

  /* Do exactly what the messages say, by parsing them -- no human judgement in
     between. A message that cannot be followed by a machine is a message that
     could suggest anything at all and still pass a "contains a hint" test. */
  const suggestion = (path: string): string => {
    const problem = first.problems.find((p) => p.path === path);
    assert.ok(problem, `expected a problem at ${path}`);
    const m = /did you mean "([^"]+)"/.exec(problem.message);
    assert.ok(m, `no suggestion to follow in: ${problem.message}`);
    return m[1]!;
  };
  const repaired = {
    ...ML01_RETRY,
    links: [
      { from: suggestion('links[0].from'), to: suggestion('links[0].to') },
      { from: suggestion('links[1].from'), to: suggestion('links[1].to') },
    ],
  };
  const second = validateChart(repaired);
  assert.strictEqual(
    second.ok,
    true,
    `the repaired chart must validate; got ${JSON.stringify(second.ok ? [] : second.problems)}`,
  );
});

test('a genuinely invented id gets the admissible set and NO invented suggestion', () => {
  /* The other half, and the one that keeps this honest: a wrong suggestion is
     worse than none, because the model will take it. `zzzz` resembles nothing
     here, so the message must list what exists and suggest nothing. */
  const got = validateChart({
    version: 1,
    kind: 'data-flow',
    title: 'Invented',
    items: [{ id: 'counts', label: 'bigram_counts.py' }],
    links: [{ from: 'counts', to: 'zzzzzzzz' }],
  });
  assert.strictEqual(got.ok, false);
  if (got.ok) return;
  const to = got.problems.find((p) => p.path === 'links[0].to');
  assert.ok(to);
  assert.doesNotMatch(to.message, /did you mean/);
  assert.match(to.message, /known items: "counts"/);
});

test('an invented nodeId is hinted at the nearest real node, never listed', () => {
  const known = new Set(['web-ui', 'api-gateway', 'billing-service']);
  const got = validateChart(
    {
      version: 1,
      kind: 'data-flow',
      title: 'Nodes',
      items: [
        { id: 'a', label: 'UI', nodeId: 'webui' },
        { id: 'b', label: 'Nothing like it', nodeId: 'qqqqqqqq' },
      ],
    },
    known,
  );
  assert.strictEqual(got.ok, false);
  if (got.ok) return;
  const near = got.problems.find((p) => p.path === 'items[0].nodeId');
  assert.ok(near);
  assert.match(near.message, /Did you mean "web-ui"\?/);
  /* The node set is the whole repository. Hint, never list. */
  assert.doesNotMatch(near.message, /known items/);
  const far = got.problems.find((p) => p.path === 'items[1].nodeId');
  assert.ok(far);
  assert.doesNotMatch(far.message, /Did you mean/);
});

/* ═══ an invented EDGE is as false as an invented node ═══════════════════ */

/**
 * The validator refused a chart that named a node the repository does not have,
 * and accepted one that drew an arrow between two nodes it does have and are
 * not connected. That second thing is a claim about the architecture the scan
 * does not support, made in a picture, where a reader has no way to check it.
 *
 * The rule is narrow because a teaching chart has to stay legal: only a link
 * whose BOTH endpoints carry a nodeId is an architectural claim. A chart about
 * an idea is the model's own picture and none of the graph's business.
 */
const NODES = new Set(['a', 'b', 'c']);
const EDGES = new Set(['a>b']);
const chartWith = (
  links: { from: string; to: string }[],
  withNodeIds = true,
): unknown => ({
  version: 1,
  kind: 'data-flow',
  title: 'flow',
  items: [
    { id: 'x', label: 'scan.ts', ...(withNodeIds ? { nodeId: 'a' } : {}) },
    { id: 'y', label: 'join.ts', ...(withNodeIds ? { nodeId: 'b' } : {}) },
    { id: 'z', label: 'facts.ts', ...(withNodeIds ? { nodeId: 'c' } : {}) },
  ],
  links,
});

test('an arrow between two real nodes must be an edge the scan has', () => {
  const good = validateChart(chartWith([{ from: 'x', to: 'y' }]), NODES, EDGES);
  assert.strictEqual(good.ok, true, 'a>b exists and is drawn');

  const invented = validateChart(chartWith([{ from: 'x', to: 'z' }]), NODES, EDGES);
  assert.strictEqual(invented.ok, false);
  if (invented.ok) return;
  assert.match(invented.problems[0]!.message, /no edge a -> c in this repository/);
});

test('DIRECTION is part of the claim, and the refusal names the real one', () => {
  const reversed = validateChart(chartWith([{ from: 'y', to: 'x' }]), NODES, EDGES);
  assert.strictEqual(reversed.ok, false);
  if (reversed.ok) return;
  /* Telling the model the arrow exists the other way round is the difference
     between a refusal it can act on and one it can only retry blindly. */
  assert.match(reversed.problems[0]!.message, /The scan has a -> b/);
});

test('a refused arrow names what the scan DOES connect from its start, three at most', () => {
  /* Live on ML Harness, 2026-09-22: `no edge mod:ml-harness-app/0 ->
     mod:ml-harness-app/3` six times in six runs, and the model retried blind.
     A refusal that names the connections the start has gives a small model a
     real one to pick. */
  const edges = new Set(['a>b', 'a>q', 'a>r', 'a>s', 'b>c']);
  const refused = validateChart(chartWith([{ from: 'x', to: 'z' }]), NODES, edges);
  assert.strictEqual(refused.ok, false);
  if (refused.ok) return;
  const msg = refused.problems[0]!.message;
  assert.match(msg, /From a the scan connects: a -> b, a -> q, a -> r \(\+1 more\)/, msg);
  assert.ok(!msg.includes('b -> c'), 'only connections from the start are named');

  /* A start with no connection at all says nothing extra, rather than an empty list. */
  const lonely = validateChart(chartWith([{ from: 'z', to: 'x' }]), NODES, edges);
  assert.strictEqual(lonely.ok, false);
  if (lonely.ok) return;
  assert.ok(!/the scan connects/.test(lonely.problems[0]!.message), lonely.problems[0]!.message);
});

test('a chart about an IDEA is not checked against the graph', () => {
  /* The escape hatch, and the reason the rule can be strict where it applies:
     a real runtime flow the static scan cannot see is legitimate to draw — just
     not as a claim about scanned structure. The refusal says so. */
  const conceptual = validateChart(chartWith([{ from: 'x', to: 'z' }], false), NODES, EDGES);
  assert.strictEqual(conceptual.ok, true);
  const refusal = validateChart(chartWith([{ from: 'x', to: 'z' }]), NODES, EDGES);
  assert.strictEqual(refusal.ok, false);
  if (refusal.ok) return;
  assert.match(refusal.problems[0]!.message, /drop the nodeId/);
});

test('a caller with no graph gets exactly the old behaviour', () => {
  /* The web client renders charts it did not author and has no edge set. It
     must not start refusing them. */
  assert.strictEqual(validateChart(chartWith([{ from: 'x', to: 'z' }]), NODES).ok, true);
});

/* ═══ steps: the flow, hop by hop ═══════════════════════════════════════ */

/**
 * Owner, 2026-09-22: "a detailed maybe even animated diagram on the AI canvas
 * which shows the flows coming from engine sending all of the AI token requests
 * into the harness". A flow chart already has the boxes and the arrows; `steps`
 * is the ORDER the data moves through them, one hop at a time, so the canvas
 * can play it. A step is a hop along an arrow, so every step is held to exactly
 * the terms an arrow is.
 */
const stepped = (steps: unknown, over: Record<string, unknown> = {}): unknown => ({
  kind: 'data-flow',
  title: 'How a token request travels',
  items: [
    { id: 'engine', label: 'Engine' },
    { id: 'provider', label: 'Provider' },
    { id: 'model', label: 'Model' },
  ],
  links: [{ from: 'engine', to: 'provider' }],
  steps,
  ...over,
});

test('a flow chart carries ordered steps, and a step with no arrow gets one derived', () => {
  const got = validateChart(
    stepped([
      { from: 'engine', to: 'provider', says: 'the request' },
      { from: 'provider', to: 'model', says: 'tokens', detail: 'streamed back one by one' },
    ]),
  );
  assert.strictEqual(got.ok, true, got.ok ? '' : JSON.stringify(got.problems));
  if (!got.ok) return;
  assert.deepStrictEqual(
    got.chart.steps?.map((s) => `${s.from}->${s.to}:${s.says}`),
    ['engine->provider:the request', 'provider->model:tokens'],
    "the order is the author's, untouched",
  );
  /* The second hop had no arrow. It gets one, so the picture draws the hop it
     plays -- and so the arrow goes through the same check any arrow does. */
  assert.deepStrictEqual(
    got.chart.links?.map((l) => `${l.from}->${l.to}`),
    ['engine->provider', 'provider->model'],
  );
});

test('a step naming an item the chart does not have is refused the way a link is', () => {
  const got = validateChart(stepped([{ from: 'engine', to: 'harness', says: 'the request' }]));
  assert.strictEqual(got.ok, false);
  if (got.ok) return;
  const p = got.problems.find((x) => x.path === 'steps[0].to');
  assert.ok(p, JSON.stringify(got.problems));
  assert.match(p.message, /unknown item "harness"/);
  assert.match(p.message, /known items: "engine", "provider", "model"/);
});

test('a derived step arrow between two real nodes must be an edge the scan has', () => {
  const grounded = (from: string, to: string): unknown => ({
    kind: 'data-flow',
    title: 'flow',
    items: [
      { id: 'x', label: 'scan.ts', nodeId: 'a' },
      { id: 'y', label: 'join.ts', nodeId: 'b' },
      { id: 'z', label: 'facts.ts', nodeId: 'c' },
    ],
    steps: [{ from, to, says: 'a hop' }],
  });
  assert.strictEqual(validateChart(grounded('x', 'y'), NODES, EDGES).ok, true, 'a>b is scanned');
  const invented = validateChart(grounded('x', 'z'), NODES, EDGES);
  assert.strictEqual(invented.ok, false);
  if (invented.ok) return;
  const p = invented.problems.find((x) => x.path === 'steps[0]');
  assert.ok(p, JSON.stringify(invented.problems));
  assert.match(p.message, /no edge a -> c in this repository/);
});

test('steps are bounded: 24 hops, 80 characters said, 240 of detail', () => {
  const hop = { from: 'engine', to: 'provider', says: 'the request' };
  assert.strictEqual(validateChart(stepped(Array.from({ length: 24 }, () => hop))).ok, true);
  const tooMany = validateChart(stepped(Array.from({ length: 25 }, () => hop)));
  assert.strictEqual(tooMany.ok, false);
  if (!tooMany.ok) assert.ok(tooMany.problems.some((p) => p.path === 'steps' && /at most 24/.test(p.message)));

  const long = validateChart(stepped([{ ...hop, says: 'x'.repeat(81) }]));
  assert.strictEqual(long.ok, false);
  if (!long.ok) assert.ok(long.problems.some((p) => p.path === 'steps[0].says' && /80/.test(p.message)));
  assert.strictEqual(validateChart(stepped([{ ...hop, says: 'x'.repeat(80) }])).ok, true);

  const noSays = validateChart(stepped([{ from: 'engine', to: 'provider' }]));
  assert.strictEqual(noSays.ok, false);
  if (!noSays.ok) assert.ok(noSays.problems.some((p) => p.path === 'steps[0].says'));

  const wordy = validateChart(stepped([{ ...hop, detail: 'y'.repeat(241) }]));
  assert.strictEqual(wordy.ok, false);
  if (!wordy.ok) assert.ok(wordy.problems.some((p) => p.path === 'steps[0].detail' && /240/.test(p.message)));
  assert.strictEqual(validateChart(stepped([{ ...hop, detail: 'y'.repeat(240) }])).ok, true);
});

test('steps belong to flow charts, and a non-array steps is a problem, never a throw', () => {
  const bar = validateChart(stepped([{ from: 'engine', to: 'provider', says: 'x' }], { kind: 'bar' }));
  assert.strictEqual(bar.ok, false);
  if (!bar.ok) assert.ok(bar.problems.some((p) => p.path === 'steps' && /data-flow/.test(p.message)));
  for (const slip of [{}, 'none', 0]) {
    const got = validateChart(stepped(slip));
    assert.strictEqual(got.ok, false);
    if (!got.ok) assert.ok(got.problems.some((p) => p.path === 'steps'));
  }
});

test('a flow chart with no steps is returned exactly as before', () => {
  const plain = validateChart(stepped(undefined));
  assert.strictEqual(plain.ok, true);
  if (!plain.ok) return;
  assert.strictEqual(plain.chart.steps, undefined);
  assert.deepStrictEqual(plain.chart.links, [{ from: 'engine', to: 'provider' }]);
});

/* ═══ a nodeId that is not text is a problem, never a throw ══════════════

   Live, 2026-09-22 (teach battery r3): "tool:start propose_chart at 410 s,
   then nothing". The model had just been told to "drop the nodeId" and wrote
   `nodeId: null`; the validator handed it to the lower-casing hint, which
   threw, and the throw took the whole answer stream down with it. */

test('a nodeId of null, a number or an object is refused at its path, never thrown', () => {
  const known = new Set(['svc:gateway']);
  for (const nodeId of [null, 3, { id: 'svc:gateway' }, ['svc:gateway'], '']) {
    const chart = {
      kind: 'data-flow',
      title: 'A concept',
      items: [
        { id: 'a', label: 'Idea', nodeId },
        { id: 'b', label: 'Other' },
      ],
    };
    for (const graph of [known, undefined]) {
      let got: ReturnType<typeof validateChart> | undefined;
      assert.doesNotThrow(() => {
        got = validateChart(chart, graph);
      }, `nodeId ${JSON.stringify(nodeId)} must not throw`);
      assert.strictEqual(got!.ok, false, `nodeId ${JSON.stringify(nodeId)} is refused`);
      if (got!.ok) continue;
      const p = got!.problems.find((q) => q.path === 'items[0].nodeId');
      assert.ok(p, `the problem is at items[0].nodeId for ${JSON.stringify(nodeId)}`);
      assert.match(p.message, /nodeId is text — leave it out for a concept/);
    }
  }
});

test('link, step and focus ends that are not text are refused, never thrown', () => {
  const base = {
    kind: 'data-flow',
    title: 'Hops',
    items: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
  };
  for (const bad of [null, 3, { id: 'a' }]) {
    const variants = [
      { ...base, links: [{ from: bad, to: 'b' }] },
      { ...base, links: [{ from: 'a', to: bad }] },
      { ...base, steps: [{ from: bad, to: 'b', says: 'x' }] },
      { ...base, steps: [{ from: 'a', to: bad, says: 'x' }] },
      { ...base, focusItemId: bad },
    ];
    for (const v of variants) {
      let got: ReturnType<typeof validateChart> | undefined;
      assert.doesNotThrow(() => {
        got = validateChart(v, new Set(['svc:gateway']));
      });
      assert.strictEqual(got!.ok, false, JSON.stringify(v));
    }
  }
});
