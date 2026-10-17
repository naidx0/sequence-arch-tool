import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { applyBoardOps, validateItem, readBoard, createBoard, type BoardItem } from '../boards/boardStore.js';
import { renderItemsSvg, selectItems } from '../boards/boardRender.js';
import { renderWorkflowSvg } from '../boards/workflowRender.js';
import { createRepoServer } from '../server/repoServer.js';
import { parseByteRange } from '../server/repoServer.js';

/**
 * Inline from the source of truth (S6), video and scenes in Spaces (S8), workflow loops inline (S10).
 * The renderer reads board items only; every claim here is about the SVG bytes a chat would inline.
 */

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-render-'));
}

/** A strict-enough XML check: balanced tags, no duplicate attributes, only the five entities. */
function assertWellFormed(xml: string): void {
  const stack: string[] = [];
  const re = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>|<!--[\s\S]*?-->|[^<]+/g;
  let consumed = 0;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    consumed += m[0].length;
    if (m[2] === undefined) {
      if (!m[0].startsWith('<!--')) assert.doesNotMatch(m[0], /&(?!(?:amp|lt|gt|quot|apos);)/, `bad entity in text: ${m[0].slice(0, 60)}`);
      continue;
    }
    const attrs = [...(m[3] ?? '').matchAll(/\s([\w:-]+)="([^"]*)"/g)];
    const names = attrs.map((a) => a[1]);
    assert.equal(new Set(names).size, names.length, `duplicate attribute on <${m[2]}>: ${names.join(',')}`);
    for (const a of attrs) assert.doesNotMatch(a[2]!, /&(?!(?:amp|lt|gt|quot|apos);)|</, `bad attribute value ${a[1]}`);
    if (m[1]) assert.equal(stack.pop(), m[2], `unbalanced </${m[2]}>`);
    else if (!m[4]) stack.push(m[2]);
  }
  assert.equal(consumed, xml.length, 'markup the checker could not read');
  assert.deepEqual(stack, [], 'unclosed tags');
}

const everyKind = (): BoardItem[] => {
  const g = 'all';
  const v = (x: unknown): BoardItem => {
    const r = validateItem(x);
    assert.equal(r.ok, true, JSON.stringify(r));
    return (r as { item: BoardItem }).item;
  };
  return [
    v({ kind: 'shape', id: 'f', group: g, shape: 'frame', from: { x: 0, y: 0 }, to: { x: 700, y: 300 }, label: 'Checkout <flow> & more', stroke: 'accent' }),
    v({ kind: 'shape', id: 'r', group: g, shape: 'rect', from: { x: 20, y: 40 }, to: { x: 180, y: 112 }, label: 'Cart', fill: 'chart1', stroke: 'ink' }),
    v({ kind: 'shape', id: 'e', group: g, shape: 'ellipse', from: { x: 240, y: 40 }, to: { x: 380, y: 120 }, label: 'Pay', fill: 'surface', dash: 'dashed' }),
    v({ kind: 'shape', id: 'd', group: g, shape: 'diamond', from: { x: 440, y: 30 }, to: { x: 580, y: 126 }, label: 'OK?', labelPos: 'bottom' }),
    v({ kind: 'shape', id: 'a', group: g, shape: 'arrow', from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, fromId: 'r', toId: 'e', arrowEnd: 'arrow', label: 'pay' }),
    v({ kind: 'shape', id: 'l', group: g, shape: 'line', from: { x: 20, y: 200 }, to: { x: 200, y: 200 }, dash: 'dotted', arrowStart: 'dot', arrowEnd: 'bar' }),
    v({ kind: 'shape', id: 'p', group: g, shape: 'path', points: [{ x: 240, y: 180 }, { x: 300, y: 240 }, { x: 380, y: 200 }], stroke: 'danger', arrowEnd: 'arrow' }),
    v({ kind: 'stroke', id: 's', group: g, points: [{ x: 420, y: 200 }, { x: 440, y: 230 }, { x: 480, y: 210 }], width: 3, stroke: 'positive' }),
    v({ kind: 'text', id: 't', group: g, at: { x: 500, y: 190 }, text: 'a note\nsecond line', fontSize: 'lg' }),
    v({ kind: 'sticky', id: 'n', group: g, at: { x: 520, y: 140 }, text: 'idempotency keys?', w: 150, h: 80 }),
    v({ kind: 'noderef', id: 'nr', group: g, at: { x: 600, y: 200 }, nodeId: 'svc:orders', label: 'orders', path: 'orders' }),
    v({ kind: 'svg', id: 'sv', group: g, at: { x: 20, y: 240 }, w: 100, h: 50, svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="var(--ink-1)"/></svg>' }),
    v({ kind: 'video', id: 'vid', group: g, at: { x: 140, y: 240 }, w: 200, h: 40, src: '.sequence/media/intro.mp4', poster: '.sequence/media/intro.png', label: 'Intro cut' }),
    v({ kind: 'scene', id: 'sc', group: g, at: { x: 360, y: 240 }, w: 200, h: 40, duration: 4000, title: 'Intro', keyframes: [{ t: 1500, target: 'r', x: 300 }] }),
  ];
};

test('render.svg for a group with every shape kind is well-formed, themed (no raw hex) and deterministic', () => {
  const items = everyKind();
  const a = renderItemsSvg(items);
  const b = renderItemsSvg(items);
  assert.equal(a.svg, b.svg, 'same items, same bytes');
  assertWellFormed(a.svg);
  assert.match(a.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="/);
  assert.match(a.svg, /font-family:var\(--font-sans\)/);
  /* Colours are palette custom properties; a #hex may appear only as a url(#id) reference. */
  const noRefs = a.svg.replace(/url\(#[^)]*\)/g, '').replace(/id="[^"]*"/g, '');
  assert.doesNotMatch(noRefs, /#[0-9a-fA-F]{3,8}\b/, 'raw hex colour in a themed render');
  for (const v of ['--ink-1', '--accent', '--viz-1', '--wont', '--fits', '--surface-2']) assert.ok(a.svg.includes(`var(${v})`), `uses ${v}`);
  assert.ok(a.svg.includes('Checkout &lt;flow&gt; &amp; more'), 'text is escaped');
  assert.ok(a.svg.includes('Intro cut'), 'the video poster box carries its label');
  assert.ok(a.svg.includes('/api/media?path=.sequence%2Fmedia%2Fintro.png'), 'the poster image is the served file');
  assert.match(a.svg, /Intro<\/tspan>/);
  assert.match(a.svg, /4 s \u00b7 1 keyframe/);
  /* The viewBox is tight: the frame is 700x300 and the render adds only padding and stroke slack. */
  assert.ok(a.width > 700 && a.width < 900, `width ${a.width}`);
  assert.ok(a.height > 300 && a.height < 400, `height ${a.height}`);
  assert.equal(a.drawn, items.length);
});

test('ownTheme keeps a raw colour; anchored items are left out and counted', () => {
  const own = validateItem({ kind: 'shape', id: 'x', shape: 'rect', from: { x: 0, y: 0 }, to: { x: 80, y: 40 }, stroke: '#12ab34', ownTheme: true });
  const anchored = validateItem({ kind: 'sticky', id: 'an', anchor: 'svc:orders', at: { x: 0, y: 0 }, text: 'n' });
  assert.ok(own.ok && anchored.ok);
  const r = renderItemsSvg([(own as { item: BoardItem }).item, (anchored as { item: BoardItem }).item]);
  assert.ok(r.svg.includes('stroke="#12ab34"'));
  assert.equal(r.skipped, 1);
  assert.equal(r.drawn, 1);
});

test('selectItems: a group, a list of ids, or nothing', () => {
  const items = everyKind();
  assert.equal(selectItems(items, { group: 'all' }).length, items.length);
  assert.deepEqual(selectItems(items, { items: 'r,e,nope' }).map((i) => i.id), ['r', 'e']);
  assert.deepEqual(selectItems(items, {}), []);
});

test('GET /api/boards/:id/render.svg serves the group; no group, no match and no board are refusals', async () => {
  const repo = tmpRoot();
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
  const meta = createBoard(repo, { name: 'Plan' });
  applyBoardOps(repo, meta.id, [
    { op: 'put', item: { kind: 'shape', id: 'r1', group: 'g1', shape: 'rect', from: { x: 0, y: 0 }, to: { x: 100, y: 60 }, label: 'Ledger' } },
    { op: 'put', item: { kind: 'shape', id: 'r2', group: 'g2', shape: 'rect', from: { x: 0, y: 0 }, to: { x: 100, y: 60 }, label: 'Other' } },
  ]);
  const server = await createRepoServer(repo, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    const ok = await fetch(`${base}/api/boards/${meta.id}/render.svg?group=g1`);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-type') ?? '', /^image\/svg\+xml/);
    const body = await ok.text();
    assertWellFormed(body);
    assert.ok(body.includes('Ledger') && !body.includes('Other'));
    assert.ok((await (await fetch(`${base}/api/boards/${meta.id}/render.svg?items=r2`)).text()).includes('Other'));
    assert.equal((await fetch(`${base}/api/boards/${meta.id}/render.svg`)).status, 400);
    assert.equal((await fetch(`${base}/api/boards/${meta.id}/render.svg?group=none`)).status, 404);
    assert.equal((await fetch(`${base}/api/boards/zzz/render.svg?group=g1`)).status, 404);
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

/* ── video items ─────────────────────────────────────────────────────── */

const vid = (src: unknown, extra: Record<string, unknown> = {}) => ({ kind: 'video', id: 'v1', at: { x: 0, y: 0 }, w: 320, h: 180, src, ...extra });

test('video: an outside-repo path, an absolute path, a bad extension and a missing file are refused', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.sequence', 'media'), { recursive: true });
  fs.writeFileSync(path.join(root, '.sequence', 'media', 'ok.mp4'), 'x');
  fs.writeFileSync(path.join(root, '.sequence', 'media', 'notes.txt'), 'x');
  const outside = path.join(tmpRoot(), 'evil.mp4');
  fs.writeFileSync(outside, 'x');
  const ctx = { roots: [root], mustExist: true };
  const refused = (src: unknown, re: RegExp): void => {
    const r = validateItem(vid(src), ctx);
    assert.equal(r.ok, false, `accepted ${String(src)}`);
    assert.match((r as { error: string }).error, re);
  };
  refused('../evil.mp4', /inside the project/);
  refused('.sequence/media/../../../evil.mp4', /inside the project/);
  refused(outside, /relative to the project/);
  refused('/etc/passwd.mp4', /relative to the project/);
  refused('C:/Users/user/a.mp4', /relative to the project/);
  refused('.sequence/media/notes.txt', /must end in one of/);
  refused('.sequence/media/ok.exe', /must end in one of/);
  refused('.sequence/media/gone.mp4', /no file at/);
  const good = validateItem(vid('.sequence/media/ok.mp4', { label: 'Intro' }), ctx);
  assert.equal(good.ok, true);
  assert.deepEqual((good as { item: BoardItem }).item, { kind: 'video', id: 'v1', at: { x: 0, y: 0 }, w: 320, h: 180, src: '.sequence/media/ok.mp4', label: 'Intro' });
  /* a symlink inside the repo that points outside is outside */
  try {
    fs.symlinkSync(outside, path.join(root, '.sequence', 'media', 'link.mp4'));
    refused('.sequence/media/link.mp4', /outside the project/);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EPERM') throw e;
  }
  /* through the store: all or nothing */
  assert.throws(() => applyBoardOps(root, 'whiteboard', [{ op: 'put', item: vid('../evil.mp4') }]), /inside the project/);
  assert.equal(readBoard(root, 'whiteboard')?.items.length, 0);
  applyBoardOps(root, 'whiteboard', [{ op: 'put', item: vid('.sequence/media/ok.mp4') }]);
  assert.equal(readBoard(root, 'whiteboard')?.items[0]?.kind, 'video');
});

test('parseByteRange: closed, open-ended, suffix and unsatisfiable ranges', () => {
  assert.deepEqual(parseByteRange('bytes=0-9', 100), [0, 9]);
  assert.deepEqual(parseByteRange('bytes=90-', 100), [90, 99]);
  assert.deepEqual(parseByteRange('bytes=-10', 100), [90, 99]);
  assert.deepEqual(parseByteRange('bytes=50-500', 100), [50, 99]);
  assert.equal(parseByteRange('bytes=100-', 100), 'unsatisfiable');
  assert.equal(parseByteRange('bytes=-0', 100), 'unsatisfiable');
  assert.equal(parseByteRange('bytes=5-2', 100), 'unsatisfiable');
  assert.equal(parseByteRange(undefined, 100), null);
  assert.equal(parseByteRange('items=0-1', 100), null);
});

test('GET /api/file?raw=1 on a media file: 200 with Accept-Ranges, 206 for a Range, 416 past the end; .sequence/media is readable, other .sequence files are not', async () => {
  const repo = tmpRoot();
  const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  fs.mkdirSync(path.join(repo, '.sequence', 'media'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'out'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.sequence', 'media', 'intro.mp4'), bytes);
  fs.writeFileSync(path.join(repo, 'out', 'clip.webm'), bytes);
  fs.writeFileSync(path.join(repo, '.sequence', 'media', 'secret.txt'), 'nope');
  fs.writeFileSync(path.join(repo, 'a.ts'), 'x');
  const server = await createRepoServer(repo, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const get = (rel: string, range?: string) => fetch(`${base}/api/file?raw=1&path=${encodeURIComponent(rel)}`, range ? { headers: { range } } : {});
  try {
    for (const rel of ['.sequence/media/intro.mp4', 'out/clip.webm']) {
      const whole = await get(rel);
      assert.equal(whole.status, 200, rel);
      assert.equal(whole.headers.get('accept-ranges'), 'bytes');
      assert.match(whole.headers.get('content-type') ?? '', /^video\//);
      assert.deepEqual(Buffer.from(await whole.arrayBuffer()), bytes);
      const part = await get(rel, 'bytes=10-19');
      assert.equal(part.status, 206, rel);
      assert.equal(part.headers.get('content-range'), 'bytes 10-19/256');
      assert.equal(part.headers.get('content-length'), '10');
      assert.deepEqual(Buffer.from(await part.arrayBuffer()), bytes.subarray(10, 20));
      const tail = await get(rel, 'bytes=-6');
      assert.equal(tail.status, 206);
      assert.deepEqual(Buffer.from(await tail.arrayBuffer()), bytes.subarray(250));
      assert.equal((await get(rel, 'bytes=300-')).status, 416);
    }
    assert.equal((await get('.sequence/media/secret.txt')).status, 403, 'only media types are readable under .sequence/media');
    assert.equal((await get('.sequence/boards/index.json')).status, 403);
    /* GET /api/media: the same jail, binary with Range, and stills for posters */
    fs.writeFileSync(path.join(repo, 'out', 'poster.png'), bytes);
    const media = (rel: string, range?: string) => fetch(`${base}/api/media?path=${encodeURIComponent(rel)}`, range ? { headers: { range } } : {});
    const m206 = await media('out/clip.webm', 'bytes=0-3');
    assert.equal(m206.status, 206);
    assert.equal(m206.headers.get('content-range'), 'bytes 0-3/256');
    assert.equal((await media('out/clip.webm', 'bytes=999-')).status, 416);
    assert.equal((await media('out/poster.png')).headers.get('content-type'), 'image/png');
    assert.equal((await media('.sequence/media/intro.mp4')).status, 200);
    assert.equal((await media('a.ts')).status, 415);
    assert.equal((await media('../escape.mp4')).status, 403);
    assert.equal((await media('.sequence/boards/index.json')).status, 403);
    assert.equal((await media('out/missing.mp4')).status, 404);
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

/* ── scenes ──────────────────────────────────────────────────────────── */

const scene = (extra: Record<string, unknown> = {}) => ({
  kind: 'scene',
  id: 'sc1',
  at: { x: 0, y: 0 },
  w: 480,
  h: 300,
  duration: 4000,
  fps: 30,
  easing: 'ease-in-out',
  title: 'Intro',
  keyframes: [{ t: 1500, target: 'api', x: 300, y: 120, scale: 1.2, opacity: 1, stroke: 'danger', fill: 'surface', text: 'Done', easing: 'ease-out' }],
  ...extra,
});

test('scene: validates the contract, round-trips through the store, tolerates a dangling target', () => {
  const ok = validateItem(scene());
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const root = tmpRoot();
  applyBoardOps(root, 'whiteboard', [{ op: 'put', item: scene() }]);
  assert.deepEqual(readBoard(root, 'whiteboard')?.items[0], { ...scene(), keyframes: scene().keyframes });
  const bad = (x: Record<string, unknown>, re: RegExp): void => {
    const r = validateItem(scene(x));
    assert.equal(r.ok, false, JSON.stringify(x));
    assert.match((r as { error: string }).error, re);
  };
  bad({ duration: 50 }, /duration must be 100-600000/);
  bad({ duration: 600001 }, /duration must be/);
  bad({ fps: 0 }, /fps/);
  bad({ fps: 121 }, /fps/);
  bad({ easing: 'bounce' }, /easing must be one of linear, ease-in, ease-out, ease-in-out/);
  bad({ keyframes: 'x' }, /keyframes must be an array/);
  bad({ keyframes: [{ t: 5000, target: 'a' }] }, /keyframes\[0\]\.t/);
  bad({ keyframes: [{ t: -1, target: 'a' }] }, /keyframes\[0\]\.t/);
  bad({ keyframes: [{ t: 1 }] }, /target/);
  bad({ keyframes: [{ t: 1, target: 'a', scale: 0 }] }, /scale/);
  bad({ keyframes: [{ t: 1, target: 'a', scale: 101 }] }, /scale/);
  bad({ keyframes: [{ t: 1, target: 'a', opacity: 1.5 }] }, /opacity/);
  bad({ keyframes: [{ t: 1, target: 'a', stroke: '#ff0000' }] }, /only allowed with ownTheme/);
  bad({ keyframes: [{ t: 1, target: 'a', stroke: 'chartreuse' }] }, /unknown colour/);
  bad({ keyframes: [{ t: 1, target: 'a', text: 'x'.repeat(501) }] }, /longer than 500/);
  bad({ keyframes: Array.from({ length: 501 }, () => ({ t: 1, target: 'a' })) }, /at most 500/);
  const own = validateItem(scene({ ownTheme: true, keyframes: [{ t: 0, target: 'a', stroke: '#ff0000' }] }));
  assert.equal(own.ok, true);
  assert.equal(validateItem(scene({ keyframes: [] })).ok, true);
});

test('render.svg shows a scene as its stage frame with the title', () => {
  const r = validateItem(scene());
  assert.ok(r.ok);
  const out = renderItemsSvg([(r as { item: BoardItem }).item]);
  assertWellFormed(out.svg);
  assert.match(out.svg, /stroke-dasharray="6 4"/);
  assert.match(out.svg, />Intro<\/tspan>/);
  assert.match(out.svg, /4 s \u00b7 1 keyframe</);
});

/* ── workflow render ─────────────────────────────────────────────────── */

test('renderWorkflowSvg: blocks, a loop frame and its way back, themed and deterministic', () => {
  const doc = {
    id: 'wf1',
    name: 'RSI <loop>',
    blocks: [
      { id: 'b1', kind: 'agent' as const, title: 'Propose a change' },
      { id: 'b2', kind: 'loop' as const, title: 'Improve', maxIterations: 5, span: 3 },
      { id: 'b3', kind: 'agent' as const, title: 'Apply it' },
      { id: 'b4', kind: 'test' as const, title: 'Tests', command: 'pnpm test' },
      { id: 'b5', kind: 'checker' as const, title: 'Check claims' },
      { id: 'b6', kind: 'finish' as const, title: 'Done' },
    ],
  };
  const a = renderWorkflowSvg(doc);
  assert.equal(a.svg, renderWorkflowSvg(doc).svg);
  assertWellFormed(a.svg);
  const flat = a.svg.replace(/<\/tspan><tspan[^>]*>/g, ' ');
  for (const text of ['Start', 'Agent: Propose a change', 'Agent: Apply it', 'Test runner: Tests', 'Checker: Check claims', 'Done', 'repeat up to 5x until the checker passes', 'not passed: again']) {
    assert.ok(flat.includes(text), `missing "${text}"`);
  }
  assert.ok(a.svg.includes('Workflow: RSI &lt;loop&gt;'));
  assert.doesNotMatch(a.svg.replace(/url\(#[^)]*\)/g, '').replace(/id="[^"]*"/g, ''), /#[0-9a-fA-F]{3,8}\b/);
  assert.match(a.svg, /marker-end="url\(#sq-/);
  /* the loop's body is inside its frame: a frame and a dashed back path exist */
  assert.match(a.svg, /stroke-dasharray/);
});

test('GET /api/workflows/:id/render.svg serves a saved workflow; unknown id is 404', async () => {
  const repo = tmpRoot();
  const server = await createRepoServer(repo, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    const made = await fetch(`${base}/api/workflows`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Fix loop', from: 'fresh' }) });
    assert.equal(made.status, 201);
    const doc = (await made.json()) as { id: string };
    const res = await fetch(`${base}/api/workflows/${doc.id}/render.svg`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /^image\/svg\+xml/);
    const svg = await res.text();
    assertWellFormed(svg);
    assert.ok(svg.includes('Start') && svg.includes('Finish'));
    assert.equal((await fetch(`${base}/api/workflows/nope/render.svg`)).status, 404);
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('POST /api/boards/:id/ops saves video and scene items and reads them back', async () => {
  const repo = tmpRoot();
  fs.mkdirSync(path.join(repo, 'out'));
  fs.writeFileSync(path.join(repo, 'out', 'a.mp4'), 'x');
  const server = await createRepoServer(repo, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    const items = [
      { kind: 'video', id: 'v1', at: { x: 0, y: 0 }, w: 320, h: 180, src: 'out/a.mp4', label: 'A' },
      { kind: 'scene', id: 'sc1', at: { x: 0, y: 200 }, w: 480, h: 300, duration: 4000, fps: 30, easing: 'ease-in-out', title: 'Intro', keyframes: [{ t: 1500, target: 'v1', x: 300, scale: 1.2, opacity: 1, stroke: 'danger', fill: 'surface', text: 'Done', easing: 'ease-out' }] },
    ];
    const res = await fetch(`${base}/api/boards/whiteboard/ops`, { method: 'POST', body: JSON.stringify({ ops: items.map((item) => ({ op: 'put', item })) }) });
    assert.equal(res.status, 200, await res.clone().text());
    const doc = (await (await fetch(`${base}/api/boards/whiteboard`)).json()) as { items: unknown[] };
    assert.deepEqual(doc.items, items);
    const bad = await fetch(`${base}/api/boards/whiteboard/ops`, { method: 'POST', body: JSON.stringify({ ops: [{ op: 'put', item: { ...items[0], id: 'v2', src: '../x.mp4' } }] }) });
    assert.equal(bad.status, 400);
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
