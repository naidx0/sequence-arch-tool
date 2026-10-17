import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { test } from 'node:test';
import { createRepoServer } from '../server/repoServer.js';
import { createSession, writeSessionWorktree } from '../server/sessionsStore.js';

test('General Files move without overwriting and confirmed delete preserves contained recovery data', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-file-org-'))), store = path.join(dir, 'user');
  const server = await createRepoServer(null, { userConfigDir: store, webDist: undefined });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number }, base = `http://127.0.0.1:${addr.port}`;
  const root = path.join(store, 'workspace');
  fs.writeFileSync(path.join(root, 'notes.md'), 'original');
  const post = async (route: string, body: unknown) => {
    const r = await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() as Record<string, unknown> };
  };
  try {
    const moved = await post('/api/file-op', { op: 'move', path: 'notes.md', to: 'docs/renamed.md' });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(fs.existsSync(path.join(root, 'notes.md')), false);
    assert.equal(fs.readFileSync(path.join(root, 'docs/renamed.md'), 'utf8'), 'original');
    fs.writeFileSync(path.join(root, 'kept.md'), 'do not overwrite');
    const chat = createSession(dir);
    const worktree = path.join(dir, 'chat-worktree'); fs.mkdirSync(worktree);
    fs.writeFileSync(path.join(worktree, 'kept.md'), 'worktree bytes');
    writeSessionWorktree(dir, chat.id, { id: '12345678', path: worktree, branch: 'sequence/test', baseCommit: 'abc', baseBranch: 'main', createdAt: new Date().toISOString() });
    assert.equal((await post('/api/file-op', { op: 'move', path: 'kept.md', to: 'wrong.md', sessionId: chat.id })).status, 409);
    assert.equal((await post('/api/file-op', { op: 'delete', path: 'kept.md', sessionId: chat.id })).status, 409);
    assert.equal(fs.readFileSync(path.join(root, 'kept.md'), 'utf8'), 'do not overwrite');
    assert.equal(fs.readFileSync(path.join(worktree, 'kept.md'), 'utf8'), 'worktree bytes');
    fs.renameSync(worktree, path.join(dir, 'chat-worktree-missing'));
    assert.equal((await post('/api/file-op', { op: 'delete', path: 'kept.md', sessionId: chat.id })).status, 409);
    assert.equal((await post('/api/file-op', { op: 'delete', path: 'kept.md', sessionId: 'unknown-chat' })).status, 404);
    assert.ok(moved.body.tree);
    assert.equal((await post('/api/file-op', { op: 'move', path: 'docs/renamed.md', to: 'kept.md' })).status, 409);
    assert.equal(fs.readFileSync(path.join(root, 'kept.md'), 'utf8'), 'do not overwrite');
    assert.equal((await post('/api/file-op', { path: 'docs/renamed.md' })).status, 400);
    assert.equal(fs.existsSync(path.join(root, 'docs/renamed.md')), true);
    const deleted = await post('/api/file-op', { op: 'delete', path: 'docs/renamed.md' });
    assert.equal(deleted.status, 200); assert.equal(typeof deleted.body.trashId, 'string');
    assert.equal(deleted.body.recoverable, true); assert.ok(deleted.body.tree);
    assert.equal(fs.existsSync(path.join(root, 'docs/renamed.md')), false);
    const trash = path.join(root, '.sequence', 'trash', String(deleted.body.trashId));
    assert.equal(fs.readFileSync(path.join(trash, 'data'), 'utf8'), 'original');
    assert.equal(JSON.parse(fs.readFileSync(path.join(trash, 'metadata.json'), 'utf8')).path, 'docs/renamed.md');
    for (const bad of ['../outside.md', path.join(dir, 'outside.md'), '.git/config', '.sequence/ai.json', '.env', 'keys/private.pem']) {
      assert.equal((await post('/api/file-op', { op: 'move', path: 'kept.md', to: bad })).status, 403);
      assert.equal((await post('/api/file-op', { op: 'delete', path: bad })).status, 403);
    }
    const outside = path.join(dir, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'protected.md'), 'protected');
    fs.symlinkSync(outside, path.join(root, 'escape'), 'junction');
    assert.equal((await post('/api/file-op', { op: 'move', path: 'kept.md', to: 'escape/protected.md' })).status, 403);
    assert.equal((await post('/api/file-op', { op: 'delete', path: 'escape/protected.md' })).status, 403);
    assert.equal(fs.readFileSync(path.join(outside, 'protected.md'), 'utf8'), 'protected');
    fs.symlinkSync(path.join(root, '.sequence'), path.join(root, 'hidden'), 'junction');
    assert.equal((await post('/api/file-op', { op: 'move', path: 'kept.md', to: 'hidden/new.md' })).status, 403);
    assert.equal((await post('/api/file-op', { op: 'delete', path: 'docs' })).status, 409);
    fs.renameSync(path.join(root, '.sequence/trash'), path.join(root, '.sequence/trash-kept'));
    fs.symlinkSync(outside, path.join(root, '.sequence/trash'), 'junction');
    assert.equal((await post('/api/file-op', { op: 'delete', path: 'kept.md' })).status, 403);
    assert.equal(fs.readFileSync(path.join(root, 'kept.md'), 'utf8'), 'do not overwrite');
  } finally {
    await new Promise<void>(r => { server.close(() => r()); (server as http.Server).closeAllConnections(); });
  }
});
