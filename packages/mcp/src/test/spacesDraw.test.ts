/**
 * Spaces for agents: the draw result names {board, group} and the inline preview address, a video
 * clip and a native scene are drawable, and visual can place its chart on a Space.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readBoard, createBoard } from '@sequence/analyzer';
import { drawTool } from '../boardTools.js';
import { visualTool } from '../visualTools.js';

process.env.SEQUENCE_USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-mcp-userdir-'));

const repo = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'seq-mcp-spaces-'));
const noGraph = async () => {
  throw new Error('no scan needed on a whiteboard');
};
const data = (r: { content: { text: string }[]; isError?: boolean }) => {
  assert.ok(!r.isError, r.content[0]!.text);
  return JSON.parse(r.content[0]!.text) as Record<string, unknown>;
};

test('draw: a compose result names {board, group} and an inline preview; loose items preview by ids', async () => {
  const dir = repo();
  const out = data(
    await drawTool(
      { repoPath: dir, board: 'whiteboard', ops: [{ op: 'compose', text: 'Checkout', layout: 'row', items: [{ type: 'rect', text: 'Cart' }, { type: 'rect', text: 'Pay' }], connect: [[0, 1]], group: 'checkout-1' }] },
      noGraph,
    ),
  );
  assert.deepEqual(out.board, { id: 'whiteboard', name: 'Whiteboard', kind: 'whiteboard' });
  assert.equal(out.group, 'checkout-1');
  assert.equal(out.preview, 'inline preview: /api/boards/whiteboard/render.svg?group=checkout-1; open on surface: board whiteboard');
  const loose = data(await drawTool({ repoPath: dir, board: 'whiteboard', ops: [{ op: 'add', type: 'rect', x: 0, y: 500, text: 'Solo', id: 'solo' }] }, noGraph));
  assert.equal(loose.group, undefined);
  assert.equal(loose.preview, 'inline preview: /api/boards/whiteboard/render.svg?items=solo; open on surface: board whiteboard');
});

test('draw: a video clip is placed from a project-relative path; outside paths, bad extensions and missing files are refused with nothing drawn', async () => {
  const dir = repo();
  fs.mkdirSync(path.join(dir, '.sequence', 'media'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.sequence', 'media', 'intro.mp4'), 'x');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  const ok = data(await drawTool({ repoPath: dir, board: 'whiteboard', ops: [{ op: 'add', type: 'video', id: 'v1', x: 0, y: 0, src: '.sequence/media/intro.mp4', text: 'Intro cut' }] }, noGraph));
  assert.deepEqual(ok.added, ['v1']);
  assert.deepEqual(readBoard(dir, 'whiteboard')!.items[0], { kind: 'video', id: 'v1', by: 'agent', at: { x: 0, y: 0 }, w: 320, h: 180, src: '.sequence/media/intro.mp4', label: 'Intro cut' });
  for (const [src, re] of [
    ['../escape.mp4', /inside the project/],
    ['/etc/x.mp4', /relative to the project/],
    ['notes.txt', /must end in one of/],
    ['.sequence/media/none.mp4', /no file at/],
  ] as const) {
    const r = await drawTool({ repoPath: dir, board: 'whiteboard', ops: [{ op: 'add', type: 'video', id: 'v2', x: 0, y: 0, src }] }, noGraph);
    assert.equal(r.isError, true, src);
    assert.match(r.content[0]!.text, re);
  }
  assert.equal(readBoard(dir, 'whiteboard')!.items.length, 1, 'refusals drew nothing');
});

test('draw: a clip rendered in a linked chat worktree is copied to the base project the app serves', async () => {
  const base = repo();
  const wt = repo();
  fs.mkdirSync(path.join(base, '.git', 'worktrees', 'w1'), { recursive: true });
  fs.writeFileSync(path.join(base, '.git', 'worktrees', 'w1', 'commondir'), '../..');
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(base, '.git', 'worktrees', 'w1').replace(/\\/g, '/')}
`);
  fs.mkdirSync(path.join(wt, '.sequence', 'media'), { recursive: true });
  fs.writeFileSync(path.join(wt, '.sequence', 'media', 'clip.webm'), 'x');
  const r = await drawTool({ repoPath: wt, board: 'whiteboard', ops: [{ op: 'add', type: 'video', id: 'v', x: 0, y: 0, src: '.sequence/media/clip.webm' }] }, noGraph);
  assert.ok(!r.isError, r.content[0]!.text);
  assert.ok(fs.existsSync(path.join(base, '.sequence', 'media', 'clip.webm')), 'copied to the base project');
  assert.equal(readBoard(base, 'whiteboard')!.items[0]!.kind, 'video');
});

test('draw: a scene takes object or compact keyframes, round-trips, and update merges fields', async () => {
  const dir = repo();
  const out = data(
    await drawTool(
      {
        repoPath: dir,
        board: 'whiteboard',
        ops: [
          { op: 'add', type: 'rect', id: 'api', x: 20, y: 20, text: 'API' },
          { op: 'add', type: 'scene', id: 'sc1', x: 0, y: 200, w: 480, h: 300, text: 'Intro', duration: 4000, keyframes: [{ t: 0, target: 'api', x: 20 }, [1500, 'api', 300, 120, 1.2, 0.5], { t: 4000, target: 'api', text: 'Done', stroke: 'danger' }] },
        ],
      },
      noGraph,
    ),
  );
  assert.deepEqual(out.added, ['api', 'sc1']);
  const sc = readBoard(dir, 'whiteboard')!.items.find((i) => i.id === 'sc1')!;
  assert.deepEqual(sc, {
    kind: 'scene',
    id: 'sc1',
    by: 'agent',
    at: { x: 0, y: 200 },
    w: 480,
    h: 300,
    duration: 4000,
    title: 'Intro',
    keyframes: [{ t: 0, target: 'api', x: 20 }, { t: 1500, target: 'api', x: 300, y: 120, scale: 1.2, opacity: 0.5 }, { t: 4000, target: 'api', stroke: 'danger', text: 'Done' }],
  });
  /* update merges: only the duration changes, the keyframes and title stay (the last keyframe still fits) */
  data(await drawTool({ repoPath: dir, board: 'whiteboard', ops: [{ op: 'update', id: 'sc1', duration: 6000 }] }, noGraph));
  const after = readBoard(dir, 'whiteboard')!.items.find((i) => i.id === 'sc1') as unknown as { duration: number; title: string; keyframes: unknown[]; w: number };
  assert.equal(after.duration, 6000);
  assert.equal(after.title, 'Intro');
  assert.equal(after.keyframes.length, 3);
  /* a keyframe past the duration, a bad target type, a missing duration */
  const late = await drawTool({ repoPath: dir, board: 'whiteboard', ops: [{ op: 'update', id: 'sc1', duration: 1000 }] }, noGraph);
  assert.equal(late.isError, true);
  assert.match(late.content[0]!.text, /keyframes\[1\]\.t must be between 0 and the scene duration/);
  const nod = await drawTool({ repoPath: dir, board: 'whiteboard', ops: [{ op: 'add', type: 'scene', id: 's2', x: 0, y: 0 }] }, noGraph);
  assert.match(nod.content[0]!.text, /a scene needs duration/);
  /* a keyframe naming an item that is not there is tolerated */
  const dangling = await drawTool({ repoPath: dir, board: 'whiteboard', ops: [{ op: 'add', type: 'scene', id: 's3', x: 0, y: 600, duration: 1000, keyframes: [{ t: 10, target: 'gone' }] }] }, noGraph);
  assert.ok(!dangling.isError, dangling.content[0]!.text);
});

test('visual with board: the chart is also placed on the Space in its own group, and a new version replaces it in place', () => {
  const dir = repo();
  createBoard(dir, { name: 'Plan' });
  const spec = { x: ['a', 'b', 'c'], series: [{ name: 'rps', values: [1, 2, 3] }] };
  const first = visualTool({ repoPath: dir, component: 'line', spec, title: 'Load', board: 'Plan' }, {});
  assert.ok(!first.isError, first.content[0]!.text);
  assert.match(first.content[0]!.text, /On Space \{"board":"plan","group":"visual-d1"\}\. Destination /);
  const destination = JSON.parse(first.content[0]!.text.match(/Destination (\{[^\n]+?\})\. inline preview:/)![1]!);
  assert.deepEqual(destination, { project: dir, chat: null, surface: 'whiteboard', board: 'plan', saved: true, opened: false });
  assert.match(first.content[0]!.text, /inline preview: \/api\/boards\/plan\/render\.svg\?group=visual-d1; open on surface: board plan/);
  const item = readBoard(dir, 'plan')!.items[0]!;
  assert.equal(item.kind, 'svg');
  assert.equal(item.group, 'visual-d1');
  const second = visualTool({ repoPath: dir, component: 'line', spec: { ...spec, series: [{ name: 'rps', values: [3, 2, 1] }] }, title: 'Load', id: 'd1', board: 'plan' }, {});
  assert.ok(!second.isError, second.content[0]!.text);
  const items = readBoard(dir, 'plan')!.items;
  assert.equal(items.length, 1, 'v2 replaces the item');
  assert.deepEqual((items[0] as { at: unknown }).at, (item as { at: unknown }).at, 'and keeps its place');
  const bad = visualTool({ repoPath: dir, component: 'line', spec, board: 'nope' }, {});
  assert.equal(bad.isError, true);
  assert.match(bad.content[0]!.text, /no board "nope"/);
});

/* ── review round: schema fields reach the store through the real MCP client; staging is safe ── */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../index.js';

async function viaClient(dir: string) {
  const server = createServer({ tools: 'core', repo: dir });
  const [c, s] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'spaces-test', version: '0.0.0' });
  await Promise.all([server.connect(s), client.connect(c)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

test('through the MCP client: poster, fps and easing are in the draw schema and persist', async () => {
  const dir = repo();
  fs.mkdirSync(path.join(dir, '.sequence', 'media'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.sequence', 'media', 'a.mp4'), 'x');
  fs.writeFileSync(path.join(dir, '.sequence', 'media', 'a.png'), 'x');
  const { client, close } = await viaClient(dir);
  try {
    const draw = (await client.listTools()).tools.find((t) => t.name === 'draw')!;
    const props = ((draw.inputSchema as unknown as { properties: { ops: { items: { properties: Record<string, unknown> } } } }).properties.ops.items.properties);
    for (const k of ['poster', 'fps', 'easing', 'src', 'keyframes', 'duration']) assert.ok(k in props, `${k} is in the listed schema`);
    assert.ok(Buffer.byteLength(JSON.stringify(draw)) <= 2048, 'the listing entry stays under 2 KB');
    const res = (await client.callTool({
      name: 'draw',
      arguments: {
        repoPath: dir,
        board: 'whiteboard',
        ops: [
          { op: 'add', type: 'video', id: 'v', x: 0, y: 0, src: '.sequence/media/a.mp4', poster: '.sequence/media/a.png', text: 'Clip' },
          { op: 'add', type: 'scene', id: 'sc', x: 0, y: 300, duration: 2000, fps: 24, easing: 'ease-in', text: 'S', keyframes: [{ t: 100, target: 'v', x: 5 }] },
        ],
      },
    })) as { content: { text: string }[]; isError?: boolean };
    assert.ok(!res.isError, res.content[0]!.text);
    const items = readBoard(dir, 'whiteboard')!.items as unknown as Record<string, unknown>[];
    assert.equal(items.find((i) => i.id === 'v')!.poster, '.sequence/media/a.png');
    const sc = items.find((i) => i.id === 'sc')!;
    assert.equal(sc.fps, 24);
    assert.equal(sc.easing, 'ease-in');
  } finally {
    await close();
  }
});

function linkedWorktree(): { base: string; wt: string } {
  const base = repo();
  const wt = repo();
  fs.mkdirSync(path.join(base, '.git', 'worktrees', 'w1'), { recursive: true });
  fs.writeFileSync(path.join(base, '.git', 'worktrees', 'w1', 'commondir'), '../..');
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(base, '.git', 'worktrees', 'w1').split(path.sep).join('/')}\n`);
  fs.mkdirSync(path.join(wt, '.sequence', 'media'), { recursive: true });
  return { base, wt };
}

test('staging: nothing is copied when another op of the call is refused; a changed clip is refreshed; a link out of the worktree is refused', async () => {
  const { base, wt } = linkedWorktree();
  const clip = path.join(wt, '.sequence', 'media', 'c.mp4');
  fs.writeFileSync(clip, 'first');
  const bad = await drawTool({ repoPath: wt, board: 'whiteboard', ops: [{ op: 'add', type: 'video', id: 'v', x: 0, y: 0, src: '.sequence/media/c.mp4' }, { op: 'add', type: 'rect', id: 'r', x: 0, y: 0, stroke: 'not-a-colour' }] }, noGraph);
  assert.equal(bad.isError, true);
  assert.equal(fs.existsSync(path.join(base, '.sequence', 'media', 'c.mp4')), false, 'a refused call copied nothing');
  const ok = await drawTool({ repoPath: wt, board: 'whiteboard', ops: [{ op: 'add', type: 'video', id: 'v', x: 0, y: 0, src: '.sequence/media/c.mp4' }] }, noGraph);
  assert.ok(!ok.isError, ok.content[0]!.text);
  assert.equal(fs.readFileSync(path.join(base, '.sequence', 'media', 'c.mp4'), 'utf8'), 'first');
  /* the clip is re-rendered in the worktree: the next draw refreshes the project's copy */
  fs.writeFileSync(clip, 'second, longer');
  fs.utimesSync(clip, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
  const again = await drawTool({ repoPath: wt, board: 'whiteboard', ops: [{ op: 'update', id: 'v', x: 10 }] }, noGraph);
  assert.ok(!again.isError, again.content[0]!.text);
  assert.equal(fs.readFileSync(path.join(base, '.sequence', 'media', 'c.mp4'), 'utf8'), 'second, longer');
  /* a symlink in the worktree that points outside it */
  const outside = path.join(repo(), 'secret.mp4');
  fs.writeFileSync(outside, 'secret');
  let linked = true;
  try {
    fs.symlinkSync(outside, path.join(wt, '.sequence', 'media', 'out.mp4'));
  } catch {
    linked = false;
  }
  if (linked) {
    const r = await drawTool({ repoPath: wt, board: 'whiteboard', ops: [{ op: 'add', type: 'video', id: 'v3', x: 0, y: 0, src: '.sequence/media/out.mp4' }] }, noGraph);
    assert.equal(r.isError, true);
    assert.match(r.content[0]!.text, /resolves outside the project/);
    assert.equal(fs.existsSync(path.join(base, '.sequence', 'media', 'out.mp4')), false);
  }
});
