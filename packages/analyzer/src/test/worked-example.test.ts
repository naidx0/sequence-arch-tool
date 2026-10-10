import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanRepo } from '../scan.js';
import { buildConceptChart, deriveWorkedExample, withWorkedExample } from '../server/conceptChart.js';

const ANALYZER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOPFRONT = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'shopfront');

async function shopfrontGraph() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-worked-example-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(SHOPFRONT, repo, { recursive: true });
  return scanRepo(repo);
}

/* Service-level boxes, the way a model's own system-architecture chart draws them. */
const SERVICES = {
  version: 1,
  kind: 'system-architecture',
  title: 'shopfront',
  items: [
    { id: 'g', label: 'gateway', nodeId: 'svc:gateway' },
    { id: 'o', label: 'orders', nodeId: 'svc:orders' },
    { id: 'db', label: 'postgres', nodeId: 'ds:postgres' },
  ],
  links: [
    { from: 'o', to: 'db', label: 'stores orders' },
    { from: 'g', to: 'o', label: 'HTTP' },
  ],
} as never;

test('the example is a real call off the scan: file, line, route, and where it lands', async () => {
  const graph = await shopfrontGraph();
  const line = deriveWorkedExample(graph, SERVICES);
  /* A call beats a data access even though the data arrow comes first on the chart. */
  assert.match(line!, /^A real example from this code: `gateway\/src\/routes\/[a-z]+\.ts:\d+` sends `(GET|POST) \/orders[^`]*` over HTTP, and it lands in `orders\/app\/routes\.py`\.$/);
  /* And the file:line it names is really that call. */
  const [, file, lineNo] = /`([^`:]+):(\d+)`/.exec(line!)!;
  const src = fs.readFileSync(path.join(SHOPFRONT, file!), 'utf8').split('\n')[Number(lineNo) - 1]!;
  assert.match(src, /ORDERS_URL/);
});

test('a data arrow alone gives the table it touches', async () => {
  const graph = await shopfrontGraph();
  const onlyDb = { ...(SERVICES as object), links: [{ from: 'o', to: 'db' }] } as never;
  assert.match(deriveWorkedExample(graph, onlyDb)!, /`orders\/app\/db\.py:\d+` (reads|writes to|uses) the `orders` table in `postgres`\./);
});

test('the product-drawn concept chart gets an example too', async () => {
  const graph = await shopfrontGraph();
  const chart = buildConceptChart(graph, { title: 'orders routes', nodeId: 'file:orders/app/routes.py' } as never);
  assert.ok(chart, 'the fixture yields a concept chart');
  assert.match(deriveWorkedExample(graph, chart)!, /^A real example from this code: `[^`]+:\d+` /);
});

test('nothing is said without a scanned edge between two boxes on the chart', async () => {
  const graph = await shopfrontGraph();
  const unrelated = {
    version: 1,
    kind: 'data-flow',
    title: 'x',
    items: [
      { id: 'a', label: 'inventory', nodeId: 'svc:inventory' },
      { id: 'b', label: 'invoices', nodeId: 'svc:invoices' },
      { id: 'c', label: 'idea', },
    ],
    links: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
  } as never;
  assert.equal(deriveWorkedExample(graph, unrelated), undefined);
  assert.equal(deriveWorkedExample(undefined, SERVICES), undefined);
});

test('a lesson with its own example is left byte for byte; otherwise the line goes before the check-in', async () => {
  const graph = await shopfrontGraph();
  const own = 'For example, the gateway asks orders for one order and waits.\n\nWhat do you think happens if orders is down?';
  assert.equal(withWorkedExample(own, graph, SERVICES), own);
  const plain = 'The gateway forwards each order request to the orders service.\n\nWhat do you think happens if orders is down?';
  const out = withWorkedExample(plain, graph, SERVICES).split('\n\n');
  assert.equal(out.length, 3);
  assert.match(out[1]!, /^A real example from this code:/);
  assert.match(out[2]!, /\?$/);
});
