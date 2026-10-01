import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../scan.js';
import { resolveInRepo } from '../server/jail.js';
import {
  executeAskTool,
  openaiAskToolDefinitions,
  renderChartToolHintSection,
} from '../server/askTools.js';

/**
 * FLOW LINES ON propose_chart (canvas plan, Slice 1: lines in, JSON out).
 *
 * Behind SEQUENCE_CHART_FLOW_LINES=1. With it on, `flow` compiles into the same
 * chart and then goes through the same grounding as JSON: a path resolves to
 * the scanned node, a hop between two real files must be a scanned edge, and a
 * refusal names the line. With it off nothing changes.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOPFRONT = path.join(here, '..', '..', 'test', 'fixtures', 'shopfront');

async function ctx() {
  const root = fs.realpathSync(SHOPFRONT);
  const graph = await scanRepo(SHOPFRONT, { cluster: true });
  return {
    graph,
    resolveReadable: (rel: string) => resolveInRepo(root, rel),
    repoRoot: root,
    designMode: false,
    question: 'how does an order get in?',
    canvasToolsEnabled: true,
  } as unknown as Parameters<typeof executeAskTool>[2];
}

async function withFlag<T>(value: string | undefined, fn: () => Promise<T> | T): Promise<T> {
  const before = process.env.SEQUENCE_CHART_FLOW_LINES;
  if (value === undefined) delete process.env.SEQUENCE_CHART_FLOW_LINES;
  else process.env.SEQUENCE_CHART_FLOW_LINES = value;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.SEQUENCE_CHART_FLOW_LINES;
    else process.env.SEQUENCE_CHART_FLOW_LINES = before;
  }
}

const GROUNDED = [
  'g "Gateway route" = gateway/src/routes/orders.ts',
  'o "Orders API" = orders/app/routes.py',
  'g -> o: the order | The gateway forwards the order to the orders service',
  'o -> person: a receipt | The customer gets an answer',
];

test('flag on: flow lines draw a grounded chart, paths resolved to scanned nodes', async () => {
  const c = await ctx();
  const r = await withFlag('1', () =>
    executeAskTool('propose_chart', { kind: 'data-flow', title: 'How an order gets in', flow: GROUNDED }, c),
  );
  assert.equal(r.ok, true, r.evidence);
  assert.deepEqual(
    r.chart?.items.map((i) => [i.id, i.nodeId]),
    [
      ['g', 'file:gateway/src/routes/orders.ts'],
      ['o', 'file:orders/app/routes.py'],
      ['person', undefined],
    ],
  );
  assert.deepEqual(r.chart?.links?.map((l) => `${l.from}>${l.to}:${l.label}`), [
    'g>o:the order',
    'o>person:a receipt',
  ]);
  /* One string works too (native tool calls send it that way). */
  const one = await withFlag('1', () =>
    executeAskTool('propose_chart', { kind: 'data-flow', title: 'x', flow: GROUNDED.join('\n') }, c),
  );
  assert.equal(one.ok, true, one.evidence);
});

test('flag on: an invented hop between real files is refused on the line that drew it', async () => {
  const c = await ctx();
  const flow = [
    'o = orders/app/routes.py',
    'g = gateway/src/routes/orders.ts',
    'o -> g: a callback',
  ];
  const r = await withFlag('1', () => executeAskTool('propose_chart', { kind: 'data-flow', title: 'x', flow }, c));
  assert.equal(r.ok, false);
  assert.match(r.evidence, /line 3 \(o -> g\): no edge file:orders\/app\/routes\.py -> file:gateway\/src\/routes\/orders\.ts/);
  assert.match(r.evidence, /The scan has file:gateway\/src\/routes\/orders\.ts -> file:orders\/app\/routes\.py/);

  const ghost = await withFlag('1', () =>
    executeAskTool('propose_chart', { kind: 'data-flow', title: 'x', flow: ['a = src/nope.ts', 'a -> b'] }, c),
  );
  assert.equal(ghost.ok, false);
  assert.match(ghost.evidence, /line 1 \(a\): "src\/nope\.ts" is not a node/);

  const chained = await withFlag('1', () =>
    executeAskTool('propose_chart', { kind: 'data-flow', title: 'x', flow: ['a -> b -> c'] }, c),
  );
  assert.equal(chained.ok, false);
  assert.match(chained.evidence, /line 1: .*one hop per line/);
});

test('flag off: flow is ignored and the published tool and fence example are unchanged', async () => {
  const c = await ctx();
  const r = await withFlag(undefined, () =>
    executeAskTool('propose_chart', { kind: 'data-flow', title: 'x', flow: GROUNDED }, c),
  );
  assert.equal(r.ok, false);
  assert.match(r.evidence, /items must be non-empty/);
  const spec = await withFlag(undefined, () => openaiAskToolDefinitions(['propose_chart'])[0]!);
  assert.deepEqual(spec.function.parameters.required, ['kind', 'title', 'items']);
  assert.ok(!('flow' in (spec.function.parameters.properties as object)));
  const hint = await withFlag(undefined, () => renderChartToolHintSection().join('\n'));
  assert.match(hint, /"items":\[/);
  assert.doesNotMatch(hint, /"flow"/);
});

test('flag on: the tool asks for flow lines, items stay available, and items win when both are sent', async () => {
  const spec = await withFlag('1', () => openaiAskToolDefinitions(['propose_chart'])[0]!);
  assert.deepEqual(spec.function.parameters.required, ['kind', 'title']);
  assert.match(spec.function.description, /a -> b: what moves \| what happens/);
  assert.ok('items' in (spec.function.parameters.properties as object));
  const hint = await withFlag('1', () => renderChartToolHintSection());
  /* The fence example is valid JSON a model can copy. */
  const start = hint.indexOf('```sequence-tool');
  const body = hint.slice(start + 1, hint.indexOf('```', start + 1)).join('\n');
  const call = JSON.parse(body) as { args: { flow: string[] } };
  assert.equal(call.args.flow.length, 3);
  const c = await ctx();
  const both = await withFlag('1', () =>
    executeAskTool(
      'propose_chart',
      { kind: 'data-flow', title: 'x', items: [{ id: 'a', label: 'A' }], flow: ['z -> y'] },
      c,
    ),
  );
  assert.equal(both.ok, true, both.evidence);
  assert.deepEqual(both.chart?.items.map((i) => i.id), ['a']);
});
