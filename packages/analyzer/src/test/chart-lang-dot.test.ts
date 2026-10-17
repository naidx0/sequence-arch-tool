import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../scan.js';
import { resolveInRepo } from '../server/jail.js';
import { ASK_TOOL_REGISTRY, executeAskTool } from '../server/askTools.js';

/**
 * SEQUENCE_CHART_LANG=dot: a small model draws propose_chart as a Graphviz digraph
 * of file paths, compiled into the same chart and held to the same validator, with
 * invented links dropped (0018a) and a chart of only invented links refused.
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

async function withLang<T>(value: string | undefined, fn: () => Promise<T> | T): Promise<T> {
  const before = process.env.SEQUENCE_CHART_LANG;
  if (value === undefined) delete process.env.SEQUENCE_CHART_LANG;
  else process.env.SEQUENCE_CHART_LANG = value;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.SEQUENCE_CHART_LANG;
    else process.env.SEQUENCE_CHART_LANG = before;
  }
}

const REAL = '"gateway/src/routes/orders.ts" -> "orders/app/routes.py" [label="the order"];';
const INVENTED = '"orders/app/routes.py" -> "gateway/src/routes/orders.ts" [label="a callback"];';
const call = (body: string) => ({ kind: 'data-flow', title: 'How an order gets in', dot: `digraph G {\n  ${body}\n}` });

test('dot on: a digraph of real files is drawn as a grounded chart', async () => {
  const c = await ctx();
  const r = await withLang('dot', () => executeAskTool('propose_chart', call(REAL), c));
  assert.equal(r.ok, true, r.evidence);
  assert.equal(r.chart?.links?.length, 1);
  assert.deepEqual(r.chart?.items.map((i) => i.nodeId).sort(), ['file:gateway/src/routes/orders.ts', 'file:orders/app/routes.py']);
});

test('dot on: an invented hop is left out, and a chart of only invented hops is refused', async () => {
  const c = await ctx();
  const mixed = await withLang('dot', () => executeAskTool('propose_chart', call(`${REAL}\n  ${INVENTED}`), c));
  assert.equal(mixed.ok, true, mixed.evidence);
  assert.equal(mixed.chart?.links?.length, 1);
  assert.match(String(mixed.content), /Left out 1 link/);
  const only = await withLang('dot', () => executeAskTool('propose_chart', call(INVENTED), c));
  assert.equal(only.ok, false);
});

test('the tool the model sees asks for dot only when the flag is set', async () => {
  await withLang('dot', () => {
    assert.match(ASK_TOOL_REGISTRY.propose_chart.description, /Graphviz digraph/);
    assert.ok('dot' in (ASK_TOOL_REGISTRY.propose_chart.parameters as { properties: object }).properties);
  });
  await withLang(undefined, () => {
    assert.doesNotMatch(ASK_TOOL_REGISTRY.propose_chart.description, /Graphviz/);
  });
});
