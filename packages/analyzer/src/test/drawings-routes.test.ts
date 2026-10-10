import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

import { createRepoServer } from '../server/repoServer.js';

/**
 * Lane visual. The REAL routes: /api/drawings saves, lists, reads and versions the svg/html blocks
 * shown in the chat, and GET /api/file draws a linked agent-written file only when the path is
 * repository-relative (an absolute path is refused by the jail, which is why the client sends
 * relative ones).
 */

async function start(repo: string) {
  const server = await createRepoServer(repo, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return { base, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const SVG = '<svg viewBox="0 0 4 4"><title>Flow</title><rect width="2" height="2"/></svg>';

test('save, list, read, version and dedupe through /api/drawings', async () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-drw-')));
  const s = await start(repo);
  try {
    const post = (body: unknown) => fetch(`${s.base}/api/drawings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const a = await post({ chat: 'c1', turn: 't1', kind: 'svg', source: SVG });
    assert.equal(a.status, 201);
    const aj = (await a.json()) as { drawing: { id: string }; name: string };
    assert.equal(aj.drawing.id, 'd1');
    assert.equal(aj.name, '1-flow.svg');
    assert.ok(fs.existsSync(path.join(repo, '.sequence', 'drawings', 'c-c1', '1-flow.svg')));
    assert.equal((await post({ chat: 'c1', kind: 'svg', source: SVG })).status, 200, 'the same text is the same drawing');
    const v2 = await post({ chat: 'c1', turn: 't2', kind: 'svg', source: SVG.replace('2', '3'), id: 'd1' });
    assert.equal(((await v2.json()) as { version: number }).version, 2);
    const list = (await (await fetch(`${s.base}/api/drawings?chat=c1`)).json()) as { drawings: { id: string; versions: unknown[] }[] };
    assert.deepEqual(list.drawings.map((d) => [d.id, d.versions.length]), [['d1', 2]]);
    const one = (await (await fetch(`${s.base}/api/drawings/d1`)).json()) as { source: string; version: number };
    assert.equal(one.version, 2);
    assert.match(one.source, /width="3"/);
    assert.equal((await fetch(`${s.base}/api/drawings/d9`)).status, 404);
    assert.equal((await post({ chat: 'c1', kind: 'svg', source: '' })).status, 400);
  } finally {
    await s.close();
  }
});

test('GET /api/file serves a linked svg by its repo-relative path and refuses an absolute one', async () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-drwf-')));
  fs.mkdirSync(path.join(repo, 'out'));
  fs.writeFileSync(path.join(repo, 'out', 'chart.svg'), SVG);
  const s = await start(repo);
  try {
    const rel = await fetch(`${s.base}/api/file?path=${encodeURIComponent('out/chart.svg')}`);
    assert.equal(rel.status, 200);
    assert.match(await rel.text(), /<svg/);
    const abs = await fetch(`${s.base}/api/file?path=${encodeURIComponent(path.join(repo, 'out', 'chart.svg'))}`);
    assert.equal(abs.status, 403);
  } finally {
    await s.close();
  }
});

test('an oversize non-ASCII drawing is a 413, not a reset connection', async () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-drw413-')));
  const s = await start(repo);
  try {
    const wide = '<svg>' + 'é'.repeat(300_000) + '</svg>'; // 600 KB on the wire, 300 K characters
    const res = await fetch(`${s.base}/api/drawings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat: 'c1', kind: 'svg', source: wide }) });
    assert.equal(res.status, 413);
    const huge = await fetch(`${s.base}/api/drawings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat: 'c1', kind: 'svg', source: 'é'.repeat(700_000) }) });
    assert.equal(huge.status, 413, 'over the body limit too');
  } finally {
    await s.close();
  }
});

test('a chat with its own worktree: linked files resolve THERE (relative or absolute inside it), never in the main checkout or outside', async () => {
  const { createSession, writeSessionWorktree } = await import('../server/sessionsStore.js');
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-drwwt-')));
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, stdio: 'pipe' });
  git('init', '-q');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  const wtParent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-drwwt-tree-')));
  const wt = path.join(wtParent, 'tree');
  git('worktree', 'add', '-q', '-b', 'chat-x', wt); // a worktree git really lists for this repo
  fs.mkdirSync(path.join(repo, 'out'));
  fs.writeFileSync(path.join(repo, 'out', 'chart.svg'), '<svg><desc>STALE main checkout</desc></svg>');
  fs.mkdirSync(path.join(wt, 'out'));
  fs.writeFileSync(path.join(wt, 'out', 'chart.svg'), '<svg><desc>FRESH worktree</desc></svg>');
  const { id } = createSession(repo);
  writeSessionWorktree(repo, id, { id: 'abcd1234', path: wt, branch: 'sequence/x-abcd', baseCommit: 'x', baseBranch: null, createdAt: '' });
  const s = await start(repo);
  try {
    const get = async (p: string, chat?: string) => fetch(`${s.base}/api/file?path=${encodeURIComponent(p)}${chat ? `&chat=${id}` : ''}`);
    assert.match(await (await get('out/chart.svg')).text(), /STALE/, 'without the chat: the main checkout');
    assert.match(await (await get('out/chart.svg', id)).text(), /FRESH/, 'with the chat: its worktree');
    const abs = await get(path.join(wt, 'out', 'chart.svg'), id);
    assert.equal(abs.status, 200, 'an absolute path inside the worktree is cut to a relative one');
    assert.match(await abs.text(), /FRESH/);
    assert.equal((await get(path.join(repo, 'out', 'chart.svg'), id)).status, 403, 'an absolute path elsewhere is still refused');
    assert.equal((await get('/etc/hosts', id)).status, 403);
    assert.equal((await get('../x', id)).status, 403);
  } finally {
    await s.close();
  }
});

test('GET /api/file?chat= does not trust worktree.path from the sessions index: $HOME, a plain folder, secrets are all refused', async () => {
  const { createSession, writeSessionWorktree } = await import('../server/sessionsStore.js');
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-drwhost-')));
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-drwhost-home-')));
  fs.mkdirSync(path.join(home, '.ssh'));
  fs.writeFileSync(path.join(home, '.ssh', 'id_rsa'), 'PRIVATE KEY');
  fs.mkdirSync(path.join(home, '.sequence'));
  fs.writeFileSync(path.join(home, '.sequence', 'ai.json'), '{"apiKey":"sk-secret"}');
  fs.writeFileSync(path.join(home, 'notes.txt'), 'personal notes');
  const { id } = createSession(repo);
  writeSessionWorktree(repo, id, { id: 'abcd1234', path: home, branch: 'sequence/x-abcd', baseCommit: 'x', baseBranch: null, createdAt: '' });
  const s = await start(repo);
  try {
    for (const p of ['.ssh/id_rsa', '.sequence/ai.json', 'notes.txt', path.join(home, 'notes.txt')]) {
      const r = await fetch(`${s.base}/api/file?path=${encodeURIComponent(p)}&chat=${id}`);
      assert.equal(r.status, 403, `${p} must be refused`);
      assert.doesNotMatch(await r.text(), /PRIVATE KEY|sk-secret|personal notes/);
    }
  } finally {
    await s.close();
  }
});

test('a real worktree still refuses its own reserved folders', async () => {
  const { createSession, writeSessionWorktree } = await import('../server/sessionsStore.js');
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-drwres-')));
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, stdio: 'pipe' });
  git('init', '-q');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  const wt = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-drwres-t-'))), 'tree');
  git('worktree', 'add', '-q', '-b', 'chat-y', wt);
  fs.mkdirSync(path.join(wt, '.ssh'));
  fs.writeFileSync(path.join(wt, '.ssh', 'id_rsa'), 'PRIVATE KEY');
  fs.mkdirSync(path.join(wt, '.sequence'));
  fs.writeFileSync(path.join(wt, '.sequence', 'ai.json'), 'sk-secret');
  const { id } = createSession(repo);
  writeSessionWorktree(repo, id, { id: 'abcd1234', path: wt, branch: 'chat-y', baseCommit: 'x', baseBranch: null, createdAt: '' });
  const s = await start(repo);
  try {
    for (const p of ['.ssh/id_rsa', '.sequence/ai.json', '.git']) {
      assert.equal((await fetch(`${s.base}/api/file?path=${encodeURIComponent(p)}&chat=${id}`)).status, 403, p);
    }
    assert.equal((await fetch(`${s.base}/api/file?path=a.txt&chat=${id}`)).status, 200);
  } finally {
    await s.close();
  }
});

test('each save and read names ITS version file, not the newest', async () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-drwname-')));
  const s = await start(repo);
  try {
    const post = async (source: string, id?: string) => (await (await fetch(`${s.base}/api/drawings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat: 'c1', id, kind: 'svg', source, title: 'Flow' }) })).json()) as { name: string; version: number };
    const a = await post(SVG);
    const b = await post(SVG.replace('width="2"', 'width="3"'), 'd1');
    assert.equal(a.name, '1-flow.svg');
    assert.equal(b.name, '1-flow-v2.svg');
    const old = (await (await fetch(`${s.base}/api/drawings/d1?v=1`)).json()) as { name: string; version: number };
    assert.deepEqual([old.version, old.name], [1, '1-flow.svg']);
    const again = await post(SVG, 'd1'); // identical to v1: its own file again
    assert.equal(again.name, '1-flow.svg');
  } finally {
    await s.close();
  }
});
