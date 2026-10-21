import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { SpecStream, type UISpec } from '@sequence/genui';

import { loadAuthConfig } from '../server/auth.js';
import { GENUI_CHAT_MAX_SURFACES, genuiDir, listSurfaces, saveSurface } from '../server/genuiStore.js';
import { createRepoServer } from '../server/repoServer.js';

/** Persisted surfaces: the final spec of a (chat, turn, surface), kept with the chat, nothing invalid stored. */

function spec(title = 'Upgrade auth', text = 'Running tests'): UISpec {
  const s = new SpecStream();
  s.push(`{"op":"el","id":"card","type":"Card","props":{"title":${JSON.stringify(title)}},"children":["t"]}\n{"op":"el","id":"t","type":"Text","props":{"text":${JSON.stringify(text)}}}\n`);
  s.end();
  return s.spec;
}
const tmp = (): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-genui-store-')));

async function start(repo: string, auth = false) {
  const server = await createRepoServer(repo, {
    webDist: undefined,
    ...(auth ? { authConfig: loadAuthConfig({ GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's', SESSION_SECRET: 'sess-genui-store', PUBLIC_BASE_URL: 'https://app.example.com' } as NodeJS.ProcessEnv) } : {}),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { base, close: () => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }) };
}
const post = (base: string, body: unknown) => fetch(`${base}/api/genui/surfaces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('a settled surface is saved with its chat, listed back as the same spec, and the newest settle of a (turn, surface) wins', async () => {
  const repo = tmp();
  const s = await start(repo);
  try {
    const first = await post(s.base, { chat: 'chat-1', turn: 't1', surface: 'main', spec: spec('Upgrade auth', 'Running tests') });
    assert.equal(first.status, 201);
    assert.equal((await post(s.base, { chat: 'chat-1', turn: 't2', surface: 'main', spec: spec('Second turn') })).status, 201);
    const again = await post(s.base, { chat: 'chat-1', turn: 't1', surface: 'main', spec: spec('Upgrade auth', '42 of 42 passed') });
    assert.equal(again.status, 200, 'the same (turn, surface) is replaced, not duplicated');
    const list = (await (await fetch(`${s.base}/api/genui/surfaces?chat=chat-1`)).json()) as { surfaces: { turn: string; surface: string; title: string; spec: UISpec }[] };
    assert.deepEqual(list.surfaces.map((r) => [r.turn, r.surface, r.title]).sort(), [['t1', 'main', 'Upgrade auth'], ['t2', 'main', 'Second turn']]);
    assert.equal(list.surfaces.find((r) => r.turn === 't1')!.spec.elements.t!.props.text, '42 of 42 passed');
    assert.deepEqual(list.surfaces.find((r) => r.turn === 't1')!.spec, spec('Upgrade auth', '42 of 42 passed'), 'the stored spec is the settled spec, byte for byte');
    assert.ok(fs.existsSync(path.join(repo, '.sequence', 'genui', 'c-chat-1.json')));
    assert.deepEqual(((await (await fetch(`${s.base}/api/genui/surfaces?chat=other`)).json()) as { surfaces: unknown[] }).surfaces, [], 'another chat has none');
  } finally {
    await s.close();
  }
});

test('nothing invalid is stored: an unknown component, an unfinished or empty spec, a bad id and an over-limit spec are refused and change nothing', async () => {
  const repo = tmp();
  const s = await start(repo);
  try {
    const bad = spec();
    bad.elements.t = { type: 'Marquee', props: {} };
    assert.equal((await post(s.base, { chat: 'c', turn: 't', surface: 'main', spec: bad })).status, 422, 'out of the catalog');
    const dangling = spec();
    dangling.elements.card!.children = ['t', 'gone'];
    assert.equal((await post(s.base, { chat: 'c', turn: 't', surface: 'main', spec: dangling })).status, 422, 'a missing child is a streaming state, not a settled one');
    assert.equal((await post(s.base, { chat: 'c', turn: 't', surface: 'main', spec: { root: null, elements: {}, state: {}, actions: {}, meta: {} } })).status, 422, 'empty');
    assert.equal((await post(s.base, { chat: 'c', turn: 't', surface: 'main', spec: 'nope' })).status, 400);
    assert.equal((await post(s.base, { chat: 'Bad Chat', turn: 't', surface: 'main', spec: spec() })).status, 400);
    assert.equal((await post(s.base, { chat: 'c', turn: '../x', surface: 'main', spec: spec() })).status, 400);
    const big = spec();
    for (let i = 0; i < 201; i++) big.elements[`x${i}`] = { type: 'Text', props: { text: 'x' } };
    big.elements.card!.children = ['t', ...Array.from({ length: 201 }, (_, i) => `x${i}`)];
    assert.equal((await post(s.base, { chat: 'c', turn: 't', surface: 'main', spec: big })).status, 422, '203 elements');
    assert.deepEqual(listSurfaces(repo, 'c'), []);
    assert.equal(fs.existsSync(path.join(repo, '.sequence', 'genui', 'c-c.json')), false);
  } finally {
    await s.close();
  }
});

test('a turn keeps at most 8 surfaces; a chat keeps its newest 300', () => {
  const repo = tmp();
  for (let i = 0; i < 8; i++) saveSurface(repo, { chat: 'c', turn: 't', surface: `s${i}`, spec: spec(`S${i}`) });
  assert.throws(() => saveSurface(repo, { chat: 'c', turn: 't', surface: 's8', spec: spec() }), /at most 8 surfaces/);
  saveSurface(repo, { chat: 'c', turn: 't', surface: 's0', spec: spec('S0 again') });
  assert.equal(listSurfaces(repo, 'c').length, 8, 'an update to a held surface is not a ninth');
  const many = tmp();
  for (let i = 0; i < GENUI_CHAT_MAX_SURFACES + 5; i++) saveSurface(many, { chat: 'c', turn: `t${i}`, surface: 'main', spec: spec(`T${i}`), at: i });
  const kept = listSurfaces(many, 'c');
  assert.equal(kept.length, GENUI_CHAT_MAX_SURFACES);
  assert.equal(kept[0]!.turn, 't5', 'the oldest five went');
});

test('the file is not trusted on read: a hand-edited row that is not a spec is dropped, the rest survive', () => {
  const repo = tmp();
  saveSurface(repo, { chat: 'c', turn: 't1', surface: 'main', spec: spec('Good') });
  const file = path.join(genuiDir(repo), 'c-c.json');
  const j = JSON.parse(fs.readFileSync(file, 'utf8')) as { surfaces: Record<string, unknown>[] };
  j.surfaces.push({ turn: 't2', surface: 'main', saved: 1, spec: { root: 'x', elements: { x: 'not an element' }, state: {}, actions: {}, meta: {} } });
  j.surfaces.push({ turn: '../../etc', surface: 'main', saved: 2, spec: spec() });
  j.surfaces.push('junk' as unknown as Record<string, unknown>);
  fs.writeFileSync(file, JSON.stringify(j));
  assert.deepEqual(listSurfaces(repo, 'c').map((r) => r.turn), ['t1']);
  fs.writeFileSync(file, '{not json');
  assert.deepEqual(listSurfaces(repo, 'c'), []);
});

test('under hosted auth the saved surfaces need a session', async () => {
  const s = await start(tmp(), true);
  try {
    assert.equal((await fetch(`${s.base}/api/genui/surfaces?chat=c`)).status, 401);
    assert.equal((await post(s.base, { chat: 'c', turn: 't', surface: 'main', spec: spec() })).status, 401);
  } finally {
    await s.close();
  }
});

test('review: a link in the path is refused BEFORE any folder is created through it', () => {
  const repo = tmp();
  const outside = tmp();
  try {
    try {
      fs.symlinkSync(outside, path.join(repo, '.sequence'), 'junction');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EPERM') return; // symlinks not permitted here
      throw e;
    }
    assert.throws(() => saveSurface(repo, { chat: 'chat-1', turn: 't1', surface: 'main', spec: spec() }), /link/);
    assert.deepEqual(fs.readdirSync(outside), [], 'nothing was created behind the link');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('review: a held lock is a quick 503, not a five second stall of the event loop', () => {
  const repo = tmp();
  try {
    fs.mkdirSync(path.join(genuiDir(repo), 'c-chat-1.lock'), { recursive: true });
    const t0 = Date.now();
    assert.throws(() => saveSurface(repo, { chat: 'chat-1', turn: 't1', surface: 'main', spec: spec() }), /busy/);
    assert.ok(Date.now() - t0 < 1500, `blocked for ${Date.now() - t0} ms`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('review: a stale lock left by a crashed writer is taken over', () => {
  const repo = tmp();
  try {
    const lock = path.join(genuiDir(repo), 'c-chat-1.lock');
    fs.mkdirSync(lock, { recursive: true });
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, old, old);
    assert.equal(saveSurface(repo, { chat: 'chat-1', turn: 't1', surface: 'main', spec: spec() }).created, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
