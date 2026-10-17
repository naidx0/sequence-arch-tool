import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../scan.js';
import { resolveInRepo } from '../server/jail.js';
import { executeAskTool } from '../server/askTools.js';

/**
 * INVENTED LINKS DROPPED IN CODE (SEQUENCE_CHART_DROP_INVENTED_LINKS=1).
 *
 * A chart refused only for links the scan lacks is drawn without them, and the
 * model is told which ones were left out. Anything else is still refused, and
 * with the flag off nothing changes.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOPFRONT = path.join(here, '..', '..', 'test', 'fixtures', 'shopfront');
const GATEWAY = 'file:gateway/src/routes/orders.ts';
const ORDERS = 'file:orders/app/routes.py';

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
  const before = process.env.SEQUENCE_CHART_DROP_INVENTED_LINKS;
  if (value === undefined) delete process.env.SEQUENCE_CHART_DROP_INVENTED_LINKS;
  else process.env.SEQUENCE_CHART_DROP_INVENTED_LINKS = value;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.SEQUENCE_CHART_DROP_INVENTED_LINKS;
    else process.env.SEQUENCE_CHART_DROP_INVENTED_LINKS = before;
  }
}

/* gateway -> orders is scanned; the callback orders -> gateway is invented. */
const ARGS = {
  kind: 'data-flow',
  title: 'How an order gets in',
  items: [
    { id: 'g', label: 'Gateway route', nodeId: GATEWAY },
    { id: 'o', label: 'Orders API', nodeId: ORDERS },
    { id: 'p', label: 'the customer' },
  ],
  links: [
    { from: 'g', to: 'o', label: 'the order' },
    { from: 'o', to: 'g', label: 'a callback' },
    { from: 'o', to: 'p', label: 'a receipt' },
  ],
};

test('flag on: an invented link between real parts is left out, the rest is drawn, and the model is told', async () => {
  const c = await ctx();
  const r = await withFlag('1', () => executeAskTool('propose_chart', ARGS, c));
  assert.equal(r.ok, true, r.evidence);
  assert.deepEqual(r.chart?.items.map((i) => i.id), ['g', 'o', 'p']);
  assert.deepEqual(r.chart?.links?.map((l) => `${l.from}>${l.to}:${l.label}`), ['g>o:the order', 'o>p:a receipt']);
  assert.match(String(r.content), new RegExp(`Left out 1 link\\(s\\) .*${ORDERS} -> ${GATEWAY}.*do not describe them as real`));
  assert.match(r.evidence, /left out 1 invented link/);
});

test('flag off: the same chart is refused, as before', async () => {
  const c = await ctx();
  const r = await withFlag(undefined, () => executeAskTool('propose_chart', ARGS, c));
  assert.equal(r.ok, false);
  assert.match(r.evidence, /no edge file:orders\/app\/routes\.py -> file:gateway/);
});

test('flag on: a part the scan lacks is still refused, not dropped', async () => {
  const c = await ctx();
  const ghost = {
    ...ARGS,
    items: [...ARGS.items, { id: 'x', label: 'ghost', nodeId: 'file:src/nope.ts' }],
    links: [...ARGS.links, { from: 'g', to: 'x' }],
  };
  const r = await withFlag('1', () => executeAskTool('propose_chart', ghost, c));
  assert.equal(r.ok, false);
  assert.match(r.evidence, /nope\.ts/);
});

test('flag on: a chart whose every link is invented is still refused, not drawn as boxes', async () => {
  const c = await ctx();
  const allInvented = { ...ARGS, items: ARGS.items.slice(0, 2), links: [{ from: 'o', to: 'g', label: 'a callback' }] };
  const r = await withFlag('1', () => executeAskTool('propose_chart', allInvented, c));
  assert.equal(r.ok, false);
  assert.match(r.evidence, /no edge file:orders\/app\/routes\.py -> file:gateway/);
});
