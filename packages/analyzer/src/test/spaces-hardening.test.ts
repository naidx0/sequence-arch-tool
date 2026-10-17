import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import type { ArchGraph } from '@sequence/schema';
import { BOARD_CAPS, readBoard, validateItem, type BoardItem } from '../boards/boardStore.js';
import { workflowItems } from '../boards/workflowRender.js';
import { planServiceFlow, writeServiceFlow } from '../boards/serviceFlow.js';
import { createRepoServer } from '../server/repoServer.js';

/** Review round: the reserved-folder case hole, media path rules, flows on messy scans, loops on rows. */

const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));

async function serve(repo: string) {
  const server = await createRepoServer(repo, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  return {
    base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

test('reserved folders are judged case-insensitively where the file system is: .SEQUENCE, .Sequence and .GIT are never served by /api/file or /api/media', async () => {
  const repo = tmp('seq-case-');
  const SECRET = 'sk-this-must-never-be-served';
  fs.mkdirSync(path.join(repo, '.sequence', 'media'), { recursive: true });
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.sequence', 'ai.json'), JSON.stringify({ key: SECRET }));
  fs.writeFileSync(path.join(repo, '.sequence', 'secret.mp4'), SECRET);
  fs.writeFileSync(path.join(repo, '.git', 'config'), SECRET);
  fs.writeFileSync(path.join(repo, '.git', 'x.mp4'), SECRET);
  fs.writeFileSync(path.join(repo, 'a.ts'), 'x');
  const { base, close } = await serve(repo);
  try {
    /* Control: the exact spelling is refused, so a refusal below means the check ran. */
    assert.equal((await fetch(`${base}/api/file?path=${encodeURIComponent('.sequence/ai.json')}`)).status, 403);
    for (const rel of ['.SEQUENCE/ai.json', '.Sequence/ai.json', '.sEqUeNcE/ai.json', '.GIT/config', '.Git/config']) {
      const res = await fetch(`${base}/api/file?path=${encodeURIComponent(rel)}`);
      const body = await res.text();
      assert.ok(!body.includes(SECRET), `${rel} leaked the secret`);
      if (process.platform === 'win32' || process.platform === 'darwin') assert.equal(res.status, 403, `${rel} on a case-insensitive file system`);
      else assert.equal(res.status, 404);
    }
    for (const rel of ['.SEQUENCE/secret.mp4', '.Sequence/secret.mp4', '.GIT/x.mp4', '.git/x.mp4', '.sequence/secret.mp4']) {
      for (const method of ['GET', 'HEAD']) {
        const res = await fetch(`${base}/api/media?path=${encodeURIComponent(rel)}`, { method });
        const body = await res.text();
        assert.ok(!body.includes(SECRET), `${method} ${rel} leaked the secret`);
        assert.notEqual(res.status, 200, `${method} ${rel}`);
        assert.notEqual(res.status, 206, `${method} ${rel}`);
      }
    }
  } finally {
    await close();
  }
});

test('/api/media: HEAD answers headers with no body; a path with an alternate data stream is refused', async () => {
  const repo = tmp('seq-head-');
  fs.mkdirSync(path.join(repo, 'out'));
  fs.writeFileSync(path.join(repo, 'out', 'c.mp4'), Buffer.alloc(100, 1));
  const { base, close } = await serve(repo);
  try {
    const head = await fetch(`${base}/api/media?path=out/c.mp4`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), '100');
    assert.equal(head.headers.get('accept-ranges'), 'bytes');
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    const headRange = await fetch(`${base}/api/media?path=out/c.mp4`, { method: 'HEAD', headers: { range: 'bytes=0-9' } });
    assert.equal(headRange.status, 206);
    for (const rel of ['out/c.mp4:secret', 'out/c.mp4::$DATA']) {
      assert.equal((await fetch(`${base}/api/media?path=${encodeURIComponent(rel)}`)).status, 400, rel);
    }
  } finally {
    await close();
  }
});

const vid = (src: unknown) => ({ kind: 'video', id: 'v', at: { x: 0, y: 0 }, w: 320, h: 180, src });

test('checkMediaPath mirrors the serving rules: hard links, .sequence outside media, other reserved folders and streams are refused', () => {
  const root = tmp('seq-media-rules-');
  for (const d of ['.sequence/media', '.sequence/boards', '.git', 'out']) fs.mkdirSync(path.join(root, d), { recursive: true });
  for (const f of ['.sequence/media/ok.mp4', '.sequence/boards/x.mp4', '.git/x.mp4', 'out/real.mp4', 'out/solo.mp4']) fs.writeFileSync(path.join(root, f), 'x');
  let linked = true;
  try {
    fs.linkSync(path.join(root, 'out', 'real.mp4'), path.join(root, 'out', 'alias.mp4'));
  } catch {
    linked = false;
  }
  const ctx = { roots: [root], mustExist: true };
  const refused = (src: string, re: RegExp): void => {
    const r = validateItem(vid(src), ctx);
    assert.equal(r.ok, false, `accepted ${src}`);
    assert.match((r as { error: string }).error, re, src);
  };
  assert.equal(validateItem(vid('.sequence/media/ok.mp4'), ctx).ok, true);
  assert.equal(validateItem(vid('out/solo.mp4'), ctx).ok, true, 'a plain clip outside .sequence is fine');
  refused('.sequence/boards/x.mp4', /reserved folder/);
  refused('.SEQUENCE/boards/x.mp4', /reserved folder/);
  refused('.sequence/x.mp4', /reserved folder/);
  refused('.git/x.mp4', /reserved folder/);
  refused('.GIT/x.mp4', /reserved folder/);
  refused('.ssh/id.mp4', /reserved folder/);
  refused('out/real.mp4:stream', /must not contain ":"/);
  refused('out/real.mp4::$DATA', /must not contain ":"/);
  if (linked) {
    refused('out/alias.mp4', /hard link/);
    refused('out/real.mp4', /hard link/);
  }
});

const scene = (extra: Record<string, unknown> = {}) => ({ kind: 'scene', id: 'sc1', at: { x: 0, y: 0 }, w: 480, h: 300, duration: 4000, keyframes: [{ t: 10, target: 'a' }], ...extra });

test('scene: a keyframe may not target its own scene, and an unknown key is refused with the allowed ones named', () => {
  const self = validateItem(scene({ keyframes: [{ t: 10, target: 'sc1' }] }));
  assert.equal(self.ok, false);
  assert.match((self as { error: string }).error, /target is the scene itself/);
  const odd = validateItem(scene({ keyframes: [{ t: 10, target: 'a', rotation: 90, colour: 'red' }] }));
  assert.equal(odd.ok, false);
  assert.match((odd as { error: string }).error, /keyframes\[0\]: unknown keys "rotation", "colour"; a keyframe takes t, target, x, y, scale, opacity, stroke, fill, text, easing/);
  assert.equal(validateItem(scene()).ok, true);
});

/* ── workflow rows ───────────────────────────────────────────────────── */

const blk = (i: number, kind: 'agent' | 'checker' | 'test' | 'loop' | 'finish', extra: Record<string, unknown> = {}) => ({ id: `b${i}`, kind, title: `T${i}`, ...extra });

test('workflow render: a loop that would wrap a row starts the next one, so its frame is one box and its way back is drawn', () => {
  const blocks = [blk(1, 'agent'), blk(2, 'agent'), blk(3, 'agent'), blk(4, 'agent'), blk(5, 'loop', { span: 3, maxIterations: 4 }), blk(6, 'agent'), blk(7, 'test'), blk(8, 'checker'), blk(9, 'finish')];
  const items = workflowItems({ id: 'w', name: 'n', blocks: blocks as never });
  const frame = items.find((i) => i.id === 'wf-loop-b5') as BoardItem & { from: { x: number; y: number }; to: { x: number; y: number } };
  const members = ['wf-b6', 'wf-b7', 'wf-b8'].map((id) => items.find((i) => i.id === id) as BoardItem & { from: { x: number; y: number }; to: { x: number; y: number } });
  assert.equal(new Set(members.map((m) => m.from.y)).size, 1, 'the body is on one row');
  for (const m of members) assert.ok(m.from.x >= frame.from.x && m.to.x <= frame.to.x && m.from.y >= frame.from.y && m.to.y <= frame.to.y, `${m.id} is inside the frame`);
  const back = items.find((i) => i.id === 'wf-back-b5');
  assert.ok(back, 'the way back is drawn');
  /* the frame covers no block that is not in the body */
  for (const o of items.filter((i) => i.kind === 'shape' && ['rect', 'diamond', 'ellipse'].includes((i as { shape: string }).shape) && !['wf-b6', 'wf-b7', 'wf-b8'].includes(i.id))) {
    const b = o as BoardItem & { from: { x: number; y: number }; to: { x: number; y: number } };
    assert.ok(!(b.from.x >= frame.from.x && b.to.x <= frame.to.x && b.from.y >= frame.from.y && b.to.y <= frame.to.y), `${b.id} sits inside the loop frame`);
  }
  /* a body longer than a row widens the rows instead of splitting */
  const long = [blk(1, 'loop', { span: 8 }), ...Array.from({ length: 8 }, (_, i) => blk(i + 2, i % 3 === 2 ? 'checker' : 'agent')), blk(20, 'finish')];
  const li = workflowItems({ id: 'w', name: 'n', blocks: long as never });
  const ys = new Set(['wf-b2', 'wf-b3', 'wf-b4', 'wf-b5', 'wf-b6', 'wf-b7', 'wf-b8', 'wf-b9'].map((id) => (li.find((i) => i.id === id) as unknown as { from: { y: number } }).from.y));
  assert.equal(ys.size, 1);
  assert.ok(li.find((i) => i.id === 'wf-back-b1'));
});

/* ── flows on messy scans ────────────────────────────────────────────── */

function fakeGraph(root: string, routes: ArchGraph['routes'], label = 'web'): ArchGraph {
  return { version: 2, scannedAt: '', repoRoot: root, repoName: 'x', nodes: [{ id: `svc:${label}`, kind: 'service', label, path: label }], edges: [], warnings: [], routes };
}

test('flows: routes from test, spec and fixture files are left out, duplicates merge, ambiguous paths carry their file, edgesFromCode counts the arrows that remain', () => {
  const root = tmp('seq-flow-messy-');
  fs.mkdirSync(path.join(root, 'web'));
  fs.writeFileSync(path.join(root, 'web', 'orders.js'), ["router.get('/', list);", "router.get('/:id', one);", "router.post('/', make);", "router.get('/', list);"].join('\n'));
  fs.writeFileSync(path.join(root, 'web', 'pay.js'), ["router.get('/:id', one);", "app.get('/cart', (q, r) => r.redirect('/checkout'));", "app.get('/checkout', (q, r) => r.send(1));"].join('\n'));
  const g = fakeGraph(root, [
    { service: 'web', method: 'GET', path: '/', file: 'web/orders.js', line: 1 },
    { service: 'web', method: 'GET', path: '/:id', file: 'web/orders.js', line: 2 },
    { service: 'web', method: 'POST', path: '/', file: 'web/orders.js', line: 3 },
    { service: 'web', method: 'GET', path: '/', file: 'web/orders.js', line: 4 },
    { service: 'web', method: 'GET', path: '/:id', file: 'web/pay.js', line: 1 },
    { service: 'web', method: 'GET', path: '/cart', file: 'web/pay.js', line: 2 },
    { service: 'web', method: 'GET', path: '/checkout', file: 'web/pay.js', line: 3 },
    { service: 'web', method: 'GET', path: '/mock-only', file: 'web/__tests__/api.js', line: 1 },
    { service: 'web', method: 'GET', path: '/spec-only', file: 'web/cart.spec.ts', line: 1 },
    { service: 'web', method: 'GET', path: '/fixture-only', file: 'web/test/fixtures/app.js', line: 1 },
    { service: 'web', method: 'GET', path: '/mocked', file: 'web/mocks/server.js', line: 1 },
  ]);
  const plan = planServiceFlow(g, root, 'web', 'customer');
  const pages = plan.steps.filter((s) => s.method).map((s) => s.label);
  assert.ok(!pages.some((l) => /only|mocked/.test(l)), `test routes leaked: ${pages.join(' | ')}`);
  assert.equal(pages.filter((l) => l.startsWith('GET / (')).length, 1, 'the duplicate GET / merged');
  assert.ok(pages.includes('GET /:id (web/orders.js)') && pages.includes('GET /:id (web/pay.js)'), `ambiguous labels carry their file: ${pages.join(' | ')}`);
  assert.ok(plan.notes.some((n) => /Left out 4 routes registered in test, spec or fixture files/.test(n)), plan.notes.join(' | '));
  assert.ok(plan.notes.some((n) => /Merged 1 route registered twice/.test(n)));
  assert.equal(plan.grounded.edgesFromCode, plan.links.filter((l) => l.basis === 'code').length);
  assert.equal(plan.grounded.edgesFromCode, 1, 'only /cart -> /checkout is in the code');
  assert.equal(plan.grounded.routes, pages.length);
});

test('flows: a service whose routes the scanner cannot read gets exactly that note, and only-test routes say so', () => {
  const root = tmp('seq-flow-none-');
  const none = planServiceFlow(fakeGraph(root, []), root, 'web', 'auto');
  assert.deepEqual(none.steps, []);
  assert.deepEqual(none.notes, ["The scanner found no routes it can read in this service's code, so there is no flow to ground. Nothing was drawn."]);
  const onlyTests = planServiceFlow(fakeGraph(root, [{ service: 'web', method: 'GET', path: '/x', file: 'web/x.test.js', line: 1 }]), root, 'web', 'auto');
  assert.deepEqual(onlyTests.steps, []);
  assert.match(onlyTests.notes.join(' '), /only routes registered in test, spec or fixture files \(1\)/);
});

test('flows: steps and arrows are capped with a note, and a large group is written in batches of at most 200 ops', () => {
  const root = tmp('seq-flow-big-');
  fs.mkdirSync(path.join(root, 'web'));
  const lines: string[] = [];
  const routes: NonNullable<ArchGraph['routes']> = [];
  for (let i = 0; i < 48; i += 1) {
    routes.push({ service: 'web', method: i % 2 ? 'POST' : 'GET', path: `/shop/item${i}`, file: 'web/app.js', line: lines.length + 1 });
    lines.push(`app.${i % 2 ? 'post' : 'get'}('/shop/item${i}', (req, res) => {`, '  if (!req.a) return res.status(400).end();', '  if (!req.b) return res.status(404).end();', '  if (!req.c) return res.status(422).end();', `  res.redirect('/done${i}');`, '});');
  }
  fs.writeFileSync(path.join(root, 'web', 'app.js'), lines.join('\n'));
  const g = fakeGraph(root, routes);
  const plan = planServiceFlow(g, root, 'web', 'auto');
  assert.ok(plan.steps.length <= 60, `steps ${plan.steps.length}`);
  assert.ok(plan.links.length <= 150, `links ${plan.links.length}`);
  assert.ok(plan.notes.some((n) => /Capped at 60 steps/.test(n)), plan.notes.join(' | '));
  assert.equal(plan.grounded.edgesFromCode, plan.links.filter((l) => l.basis === 'code').length);
  const ids = new Set(plan.steps.map((s) => s.id));
  for (const l of plan.links) assert.ok(ids.has(l.from) && ids.has(l.to));
  const w = writeServiceFlow(root, g, 'web', 'auto');
  const inGroup = readBoard(root, w.board!)!.items.filter((i) => i.group === w.group);
  assert.ok(inGroup.length > BOARD_CAPS.opsPerCall, `the group is bigger than one batch (${inGroup.length})`);
  const again = writeServiceFlow(root, g, 'web', 'auto');
  assert.equal(readBoard(root, again.board!)!.items.length, inGroup.length, 'regeneration replaces, in batches too');
});
