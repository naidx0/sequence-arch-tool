import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateChart } from '@sequence/schema';

import { scanRepo } from '../scan.js';
import { deriveBeforeAfterChart } from '../server/conceptChart.js';

const ANALYZER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOPFRONT = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'shopfront');

async function shopfrontGraph() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-plan-before-after-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(SHOPFRONT, repo, { recursive: true });
  return scanRepo(repo);
}

const PLAN = [
  'Plan: add an order status endpoint.',
  '',
  '1. `orders/app/routes.py` — add a `GET /orders/{id}/status` route that reads the order row.',
  '2. Update gateway/src/routes/orders.ts to forward the status call to orders.',
  '3. Create `orders/app/status.py` for the status lookup, so routes.py stays thin.',
  '4. Tidy orders/app/cache.py while we are there.',
  '5. Verify with `orders/tests/test_status.py` and the gateway route test.',
].join('\n');

test('a plan that names scanned files gets a two-column before/after of those files', async () => {
  const graph = await shopfrontGraph();
  const chart = deriveBeforeAfterChart(graph, PLAN)!;
  assert.ok(chart, 'expected a chart');
  assert.equal(chart.kind, 'before-and-after');
  assert.deepEqual(chart.axes?.columns, ['Before', 'After']);
  const before = chart.items.filter((i) => i.group === 'Before');
  const after = chart.items.filter((i) => i.group === 'After');
  assert.deepEqual(before.map((i) => i.label), ['routes.py', 'orders.ts']);
  /* Every Before box is a real scanned node, and says what it does today. */
  const ids = new Set(graph.nodes.map((n) => n.id));
  for (const item of before) {
    assert.ok(item.nodeId && ids.has(item.nodeId));
    assert.match(item.detail!, /uses|used by|no scanned connections/);
  }
  /* After keeps the same boxes with the plan's own words, and adds the new file. */
  assert.deepEqual(after.map((i) => i.label), ['routes.py', 'orders.ts', 'status.py']);
  assert.match(after[0]!.detail!, /add a GET \/orders\/\{id\}\/status route/);
  assert.equal(after[1]!.detail, 'Update orders.ts to forward the status call to orders.');
  assert.equal(after[2]!.nodeId, undefined);
  assert.equal(after[2]!.tone, 'good');
  assert.match(after[2]!.detail!, /^new file: /);
  assert.ok(validateChart(chart, ids).ok);
});

test('an unknown path is drawn only when its line says it is new', async () => {
  const graph = await shopfrontGraph();
  const labels = deriveBeforeAfterChart(graph, PLAN)!.items.map((i) => i.label);
  /* "Tidy orders/app/cache.py" and "Verify with orders/tests/test_status.py" name files the scan does not have. */
  assert.ok(!labels.includes('cache.py'));
  assert.ok(!labels.includes('test_status.py'));
});

test('nothing is drawn when the plan names no file the scan knows', async () => {
  const graph = await shopfrontGraph();
  assert.equal(deriveBeforeAfterChart(graph, 'Create `billing/new_service.py` and wire it up.'), undefined);
  assert.equal(deriveBeforeAfterChart(graph, 'Refactor the auth layer so it is cleaner.'), undefined);
  assert.equal(deriveBeforeAfterChart(undefined, PLAN), undefined);
});

test('a file named twice is drawn once, and a column never runs past eight rows', async () => {
  const graph = await shopfrontGraph();
  const twice = deriveBeforeAfterChart(graph, `${PLAN}\n6. Re-check orders/app/routes.py after step 3.`)!;
  assert.equal(twice.items.filter((i) => i.label === 'routes.py' && i.group === 'Before').length, 1);
  const files = graph.nodes.filter((n) => n.path && /\.(py|ts|go|java)$/.test(n.path)).slice(0, 12);
  assert.ok(files.length > 8);
  const long = deriveBeforeAfterChart(graph, files.map((n, i) => `${i + 1}. Change ${n.path}.`).join('\n'))!;
  assert.equal(long.items.filter((i) => i.group === 'Before').length, 8);
  assert.equal(long.items.filter((i) => i.group === 'After').length, 8);
});
