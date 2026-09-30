/**
 * MOVING AND REMOVING PROJECTS — the two edits the owner asked for.
 *
 * Owner walk, 2026-09-21: "apart from starting a new chat in that folder, you
 * should be able to move the folder, compress the folder ... you can also be
 * able to delete it if you don't want to. Like, I just delete the folder, just
 * delete it from that workspace."
 *
 * Both are edits to a list that is HIS, which only became true when the list
 * stopped being a recency cache that pruned itself (see
 * `project-list-durable.test.ts`). These lock the two properties that make them
 * safe: a removal touches no folder, and a reorder cannot lose a project that
 * the caller could not see when it made the drag.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createRepoServer } from '../server/repoServer.js';
import { addRecent, readRecentRaw } from '../server/store.js';

function freshDir(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sequence-${name}-`));
}

async function startServer(): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(null, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * The store the running server actually writes. `isolate-user-store.js` points
 * the whole process at a scratch home, so this is that home's own list — and
 * the tests below read it back to check the FILE, not only the response.
 *
 * ONE HOME FOR THE WHOLE PROCESS means one list for every test in this file,
 * so each test empties it first. A test that inherits another's projects is
 * asserting about a specimen it does not own, and the first two written here
 * failed on exactly that — reading four projects where they had added three.
 */
async function storeDir(): Promise<string> {
  const { userStoreDir } = await import('../server/store.js');
  const dir = userStoreDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'recent.json'), '[]');
  return dir;
}

test('DELETE /api/recent takes a project out of the list and leaves the folder', async () => {
  const store = await storeDir();
  const keep = freshDir('keep');
  const drop = freshDir('drop');
  addRecent(store, keep);
  addRecent(store, drop);

  const { base, close } = await startServer();
  try {
    const res = await fetch(`${base}/api/recent`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: drop }),
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { recent: { path: string }[] };

    assert.ok(
      !body.recent.some((r) => r.path === drop),
      'the removed project is gone from the answer',
    );
    assert.ok(
      body.recent.some((r) => r.path === keep),
      'and the one he did not name is still there',
    );
    assert.deepStrictEqual(readRecentRaw(store), [keep], 'the file agrees, not just the response');

    /*
     * THE POINT OF THE WHOLE ROUTE. He calls this "delete", and the thing it
     * must never do is the thing that word means everywhere else.
     */
    assert.ok(fs.existsSync(drop), 'removing a project from the workspace does not touch the folder');
  } finally {
    await close();
  }
});

test('DELETE /api/recent refuses a body that names nothing', async () => {
  await storeDir();
  const { base, close } = await startServer();
  try {
    for (const body of ['{}', '{"path":""}', 'not json']) {
      const res = await fetch(`${base}/api/recent`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body,
      });
      assert.strictEqual(res.status, 400, `a body of ${body} is not a removal`);
    }
  } finally {
    await close();
  }
});

test('PUT /api/recent keeps a project the caller could not see', async () => {
  const store = await storeDir();
  const visible = freshDir('visible');
  const other = freshDir('other');
  const unplugged = freshDir('unplugged');
  addRecent(store, visible);
  addRecent(store, other);
  addRecent(store, unplugged);

  /*
   * THE DRIVE COMES OUT. `readRecent` now declines to list this, so the rail
   * does not draw it, so the order the rail sends cannot possibly mention it.
   * That is the whole hazard: a drag made in good faith about two projects,
   * carrying no opinion at all about a third.
   */
  fs.rmSync(unplugged, { recursive: true, force: true });

  const { base, close } = await startServer();
  try {
    const res = await fetch(`${base}/api/recent`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order: [other, visible] }),
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { recent: { path: string }[] };

    assert.deepStrictEqual(
      body.recent.map((r) => r.path),
      [other, visible],
      'the rail shows what he dragged',
    );
    assert.ok(
      readRecentRaw(store).includes(unplugged),
      'and the project he never mentioned is still his — a drag is not a delete',
    );
  } finally {
    await close();
  }
});

test('PUT /api/recent will not attach something by naming it', async () => {
  const store = await storeDir();
  const held = freshDir('held');
  const stranger = freshDir('stranger');
  addRecent(store, held);

  const { base, close } = await startServer();
  try {
    await fetch(`${base}/api/recent`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order: [stranger, held] }),
    });

    /*
     * Reordering is not a back door onto the list. Attaching is a separate act
     * with its own jail check, and a route that takes an arbitrary path and
     * files it under "his projects" would be that check's way around itself.
     */
    assert.deepStrictEqual(
      readRecentRaw(store),
      [held],
      'a path that was never his does not become his by appearing in an order',
    );
  } finally {
    await close();
  }
});

test('PUT /api/recent refuses a body without an order array', async () => {
  await storeDir();
  const { base, close } = await startServer();
  try {
    for (const body of ['{}', '{"order":"a,b"}', 'not json']) {
      const res = await fetch(`${base}/api/recent`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body,
      });
      assert.strictEqual(res.status, 400, `a body of ${body} is not an order`);
    }
  } finally {
    await close();
  }
});
