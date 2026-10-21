import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { ArchGraph } from '@sequence/schema';
import { readBoard } from '../boards/boardStore.js';
import { planServiceFlow, writeServiceFlow } from '../boards/serviceFlow.js';
import { scanRepo } from '../scan.js';
import { createRepoServer } from '../server/repoServer.js';

/**
 * U14 — "generate workflow" on a service node. Grounded in the scan of the shopfront fixture
 * (8 services; gateway/orders/payments/invoices/shipping register routes, notifications and
 * inventory register none the scanner reads), with no model anywhere.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOPFRONT = path.join(path.resolve(here, '..', '..'), 'test', 'fixtures', 'shopfront');

function specimen(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-flow-'));
  fs.cpSync(SHOPFRONT, dir, { recursive: true, filter: (p) => !/[\\/](node_modules|\.git|\.sequence)([\\/]|$)/.test(p.slice(SHOPFRONT.length)) });
  return dir;
}

let graphPromise: Promise<ArchGraph> | undefined;
const graph = (): Promise<ArchGraph> => (graphPromise ??= scanRepo(SHOPFRONT, {}));

test('a service with routes yields a non-empty flow grounded in the scan, every step citing its file and line', async () => {
  const g = await graph();
  const plan = planServiceFlow(g, SHOPFRONT, 'svc:orders', 'auto');
  assert.equal(plan.audience, 'customer');
  const pages = plan.steps.filter((s) => s.kind === 'page' || s.kind === 'action');
  assert.deepEqual(pages.map((s) => s.label), ['POST /orders', 'GET /orders/{order_id}'], 'the health probe is left out; the collection comes before its member');
  for (const s of pages) {
    assert.ok(s.file && s.line, `${s.label} cites its registration`);
    assert.ok(fs.existsSync(path.join(SHOPFRONT, s.file!)), s.file);
  }
  assert.equal(plan.grounded.routes, 2);
  assert.ok(plan.grounded.edgesFromCode >= 2, `gateway calls into both routes; got ${plan.grounded.edgesFromCode}`);
  assert.ok(plan.steps.some((s) => s.kind === 'entry' && s.label === 'From gateway'), 'callers from the graph become entry nodes');
  assert.ok(plan.notes.some((n) => /health probe/.test(n)));
  /* every link points at real steps */
  const ids = new Set(plan.steps.map((s) => s.id));
  for (const l of plan.links) assert.ok(ids.has(l.from) && ids.has(l.to), JSON.stringify(l));
  assert.ok(plan.links.some((l) => l.basis === 'code'));
});

test('the gateway flow ties its routes to the services it calls', async () => {
  const plan = planServiceFlow(await graph(), SHOPFRONT, 'gateway', 'customer');
  assert.ok(plan.grounded.routes >= 4);
  assert.ok(plan.steps.some((s) => s.kind === 'call' && /^Calls orders: POST \/orders/.test(s.label)), plan.steps.map((s) => s.label).join(' | '));
});

test('a service with no routes in the scan is an honest empty result and draws nothing', async () => {
  const g = await graph();
  const root = specimen();
  const plan = planServiceFlow(g, root, 'svc:notifications', 'auto');
  assert.deepEqual(plan.steps, []);
  assert.deepEqual(plan.grounded, { routes: 0, edgesFromCode: 0 });
  assert.deepEqual(plan.notes, ["The scanner found no routes it can read in this service's code, so there is no flow to ground. Nothing was drawn."]);
  const written = writeServiceFlow(root, g, 'notifications', 'auto');
  assert.equal(written.board, null);
  assert.equal(written.group, null);
  assert.equal(fs.existsSync(path.join(root, '.sequence', 'boards')), false, 'nothing was written');
});

test('audience: admin on a customer-only service is an honest empty; an admin path and a role check classify admin', async () => {
  const g = await graph();
  const none = planServiceFlow(g, SHOPFRONT, 'orders', 'admin');
  assert.deepEqual(none.steps, []);
  assert.match(none.notes.join(' '), /no admin routes/);
  /* A synthetic service: /admin path, a role check in a plain path, and a plain route. */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-flow-admin-'));
  fs.mkdirSync(path.join(root, 'web'));
  fs.writeFileSync(
    path.join(root, 'web', 'app.js'),
    [
      "app.get('/admin/users', (req, res) => res.send('u'));",
      "app.post('/reports', requireAdmin, (req, res) => res.redirect('/admin/users'));",
      "app.get('/cart', (req, res) => { if (!req.user) return res.status(401).end(); res.redirect('/checkout'); });",
      "app.get('/checkout', (req, res) => res.send('c'));",
      '',
    ].join('\n'),
  );
  const fake: ArchGraph = {
    version: 2,
    scannedAt: '',
    repoRoot: root,
    repoName: 'x',
    nodes: [{ id: 'svc:web', kind: 'service', label: 'web', path: 'web' }],
    edges: [],
    warnings: [],
    routes: [
      { service: 'web', method: 'GET', path: '/admin/users', file: 'web/app.js', line: 1 },
      { service: 'web', method: 'POST', path: '/reports', file: 'web/app.js', line: 2 },
      { service: 'web', method: 'GET', path: '/cart', file: 'web/app.js', line: 3 },
      { service: 'web', method: 'GET', path: '/checkout', file: 'web/app.js', line: 4 },
    ],
  };
  const admin = planServiceFlow(fake, root, 'web', 'admin');
  assert.deepEqual(admin.steps.filter((s) => s.method).map((s) => s.label), ['GET /admin/users', 'POST /reports']);
  assert.match(admin.steps.find((s) => s.label === 'POST /reports')!.why!, /role check "requireAdmin"/);
  assert.match(admin.steps.find((s) => s.label === 'GET /admin/users')!.why!, /admin path/);
  assert.ok(admin.links.some((l) => l.basis === 'code' && /\/admin\/users/.test(l.detail ?? '')), 'POST /reports redirects to the admin page');
  const cust = planServiceFlow(fake, root, 'web', 'customer');
  assert.deepEqual(cust.steps.filter((s) => s.method).map((s) => s.label), ['GET /cart', 'GET /checkout']);
  const cart = cust.steps.find((s) => s.label === 'GET /cart')!;
  const checkout = cust.steps.find((s) => s.label === 'GET /checkout')!;
  assert.ok(cust.links.some((l) => l.from === cart.id && l.to === checkout.id && l.basis === 'code'), 'redirect /checkout is an edge from the code');
  assert.ok(cust.steps.some((s) => s.kind === 'outcome' && /^Error 401/.test(s.label)), 'an error status the handler returns becomes an outcome');
  assert.equal(planServiceFlow(fake, root, 'web', 'auto').audience, 'customer', 'auto picks the majority (2 customer, 2 admin ties to customer)');
});

test('writeServiceFlow draws a frame, boxes and arrows as one group on a whiteboard, and drawing again replaces that group', async () => {
  const g = await graph();
  const root = specimen();
  const first = writeServiceFlow(root, g, 'svc:orders', 'auto');
  assert.ok(first.board && first.group);
  assert.equal(first.group, 'flow-orders-customer');
  const doc = readBoard(root, first.board!)!;
  const inGroup = doc.items.filter((i) => i.group === first.group);
  assert.ok(inGroup.some((i) => i.kind === 'shape' && i.shape === 'frame' && /orders: customer flow/.test(i.label ?? '')));
  assert.equal(inGroup.filter((i) => i.kind === 'shape' && i.shape === 'arrow').length, first.links.length);
  assert.ok(inGroup.filter((i) => i.kind === 'shape' && i.shape === 'rect').length >= 2);
  const again = writeServiceFlow(root, g, 'svc:orders', 'auto');
  assert.equal(again.board, first.board);
  assert.equal(readBoard(root, first.board!)!.items.length, doc.items.length, 'no duplicates after a second generation');
  assert.throws(() => writeServiceFlow(root, g, 'svc:nope', 'auto'), /no service "svc:nope"/);
  assert.throws(() => writeServiceFlow(root, g, 'orders', 'auto', 'architecture'), /whiteboard/);
});

test('POST /api/services/:id/flows through the server: audience validated, honest empty, group on a Space that renders', async () => {
  const root = specimen();
  const server = await createRepoServer(root, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const post = (id: string, body: unknown) => fetch(`${base}/api/services/${encodeURIComponent(id)}/flows`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const ok = await post('svc:payments', { audience: 'auto' });
    assert.equal(ok.status, 200);
    const flow = (await ok.json()) as { board: string; group: string; steps: { label: string }[]; grounded: { routes: number; edgesFromCode: number }; notes: string[] };
    assert.ok(flow.board && flow.group && flow.steps.length > 0);
    assert.equal(flow.grounded.routes, 2);
    const svg = await fetch(`${base}/api/boards/${flow.board}/render.svg?group=${flow.group}`);
    assert.equal(svg.status, 200);
    assert.match(await svg.text(), /POST \/charge/);
    const empty = (await (await post('notifications', {})).json()) as { board: unknown; steps: unknown[]; notes: string[] };
    assert.equal(empty.board, null);
    assert.deepEqual(empty.steps, []);
    assert.ok(empty.notes.length > 0);
    assert.equal((await post('svc:payments', { audience: 'everyone' })).status, 400);
    assert.equal((await post('svc:nope', {})).status, 404);
    assert.equal((await fetch(`${base}/api/services/svc:payments/flows`)).status, 405);
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
