import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ARCH_BOARD_ID,
  BOARD_CAPS,
  applyBoardOps,
  createBoard,
  deleteBoard,
  listBoards,
  readBoard,
} from '../boards/boardStore.js';
import { createRepoServer } from '../server/repoServer.js';

/**
 * ROUND 8 — THE BOARDS STORE AND ITS ROUTES.
 *
 * Store-level for the rules that live in the store (ops all-or-nothing, caps,
 * the architecture board's permanence), route-level for the stream, because
 * the stream's whole job is that a write from ANOTHER process (the MCP server,
 * writing the files directly) reaches a listening tab.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const PLAINAPP = path.join(path.resolve(here, '..', '..'), 'test', 'fixtures', 'plainapp');

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-boards-'));
}

test('a project with no folder lists the architecture board and a default whiteboard, and reading writes nothing', () => {
  const root = tmpRoot();
  const index = listBoards(root);
  assert.deepEqual(
    index.boards.map((b) => [b.id, b.kind]),
    [
      [ARCH_BOARD_ID, 'architecture'],
      ['whiteboard', 'whiteboard'],
    ],
  );
  assert.equal(fs.existsSync(path.join(root, '.sequence')), false);
});

test('create, draw, rename, delete; ids come from the name and never collide', () => {
  const root = tmpRoot();
  const a = createBoard(root, { name: 'Payments plan', kind: 'whiteboard' });
  const b = createBoard(root, { name: 'Payments plan' });
  assert.equal(a.id, 'payments-plan');
  assert.equal(b.id, 'payments-plan-2');
  const doc = applyBoardOps(root, a.id, [
    { op: 'put', item: { kind: 'shape', id: 'r1', shape: 'rect', from: { x: 0, y: 0 }, to: { x: 100, y: 60 }, label: 'Ledger' } },
    { op: 'put', item: { kind: 'sticky', id: 'n1', at: { x: 120, y: 0 }, text: 'idempotency keys?', by: 'agent' } },
  ]);
  assert.equal(doc.rev, 1);
  assert.deepEqual(readBoard(root, a.id)?.items.map((i) => i.id), ['r1', 'n1']);
  /* An update keeps the item's place in the z-order. */
  applyBoardOps(root, a.id, [{ op: 'put', item: { kind: 'shape', id: 'r1', shape: 'rect', from: { x: 5, y: 5 }, to: { x: 100, y: 60 } } }]);
  assert.deepEqual(readBoard(root, a.id)?.items.map((i) => i.id), ['r1', 'n1']);
  assert.throws(() => createBoard(root, { name: 'x', kind: 'architecture' }), /one architecture board/);
  assert.throws(() => deleteBoard(root, ARCH_BOARD_ID), /cannot be deleted/);
  deleteBoard(root, a.id);
  assert.equal(readBoard(root, a.id), null);
  assert.equal(listBoards(root).boards.some((x) => x.id === a.id), false);
});

test('ops are all or nothing: one bad op refuses the call with every reason, and the file is untouched', () => {
  const root = tmpRoot();
  applyBoardOps(root, 'whiteboard', [{ op: 'put', item: { kind: 'text', id: 't1', at: { x: 1, y: 2 }, text: 'kept' } }]);
  assert.throws(
    () =>
      applyBoardOps(root, 'whiteboard', [
        { op: 'put', item: { kind: 'text', id: 't2', at: { x: 1, y: 2 }, text: 'never lands' } },
        { op: 'put', item: { kind: 'blob', id: 'b1' } },
        { op: 'put', item: { kind: 'text', id: 't3', at: { x: Number.NaN, y: 0 }, text: '' } },
        { op: 'remove', id: 'ghost' },
      ]),
    (e: Error) => /unknown item kind "blob"/.test(e.message) && /at\.x must be a finite number/.test(e.message) && /no item "ghost"/.test(e.message),
  );
  assert.deepEqual(readBoard(root, 'whiteboard')?.items.map((i) => i.id), ['t1']);
});

test('caps: text, points, coordinates, ops per call', () => {
  const root = tmpRoot();
  const long = 'x'.repeat(BOARD_CAPS.text + 1);
  assert.throws(() => applyBoardOps(root, 'whiteboard', [{ op: 'put', item: { kind: 'sticky', id: 's', at: { x: 0, y: 0 }, text: long } }]), /longer than 500/);
  const points = Array.from({ length: BOARD_CAPS.points + 1 }, (_, i) => ({ x: i, y: i }));
  assert.throws(() => applyBoardOps(root, 'whiteboard', [{ op: 'put', item: { kind: 'stroke', id: 'k', points, width: 2 } }]), /at most 2000 points/);
  assert.throws(() => applyBoardOps(root, 'whiteboard', [{ op: 'put', item: { kind: 'text', id: 'f', at: { x: 2e6, y: 0 }, text: 'far' } }]), /outside/);
  const ops = Array.from({ length: BOARD_CAPS.opsPerCall + 1 }, (_, i) => ({ op: 'remove' as const, id: `x${i}` }));
  assert.throws(() => applyBoardOps(root, 'whiteboard', ops), /at most 200 ops/);
});

async function startServer(repo: string): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(repo, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

test('routes: list, create, ops, rename, delete; a refused op is a 400 with its reason', async () => {
  const dir = tmpRoot();
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  const { base, close } = await startServer(repo);
  try {
    const created = await fetch(`${base}/api/boards`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Sketch', kind: 'whiteboard' }) });
    assert.equal(created.status, 201);
    const meta = (await created.json()) as { id: string };
    const ops = await fetch(`${base}/api/boards/${meta.id}/ops`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ops: [{ op: 'put', item: { kind: 'text', id: 't', at: { x: 0, y: 0 }, text: 'hi' } }] }),
    });
    assert.equal(ops.status, 200);
    const bad = await fetch(`${base}/api/boards/${meta.id}/ops`, { method: 'POST', body: JSON.stringify({ ops: [{ op: 'put', item: { kind: 'nope', id: 'z' } }] }) });
    assert.equal(bad.status, 400);
    assert.match(((await bad.json()) as { error: string }).error, /unknown item kind/);
    const renamed = await fetch(`${base}/api/boards/${meta.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Renamed' }) });
    assert.equal(((await renamed.json()) as { name: string }).name, 'Renamed');
    const list = (await (await fetch(`${base}/api/boards`)).json()) as { boards: { id: string; name: string }[] };
    assert.deepEqual(list.boards.map((b) => b.name), ['Architecture', 'Whiteboard', 'Renamed']);
    assert.equal((await fetch(`${base}/api/boards/${ARCH_BOARD_ID}`, { method: 'DELETE' })).status, 409);
    assert.equal((await fetch(`${base}/api/boards/${meta.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(`${base}/api/boards/${meta.id}`)).status, 404);
  } finally {
    await close();
  }
});

test('the stream: a write made straight to the files (as the MCP process does) reaches a listening tab', async () => {
  const dir = tmpRoot();
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  const { base, close } = await startServer(repo);
  const ac = new AbortController();
  try {
    const res = await fetch(`${base}/api/boards/events`, { signal: ac.signal });
    assert.equal(res.headers.get('content-type')?.startsWith('text/event-stream'), true);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const until = async (pred: (s: string) => boolean, ms: number): Promise<boolean> => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const r = await Promise.race([reader.read(), new Promise<null>((ok) => setTimeout(() => ok(null), ms))]);
        if (!r || r.done) break;
        buf += dec.decode(r.value);
        if (pred(buf)) return true;
      }
      return pred(buf);
    };
    assert.equal(await until((s) => s.includes('"hello"'), 3000), true, 'the stream opens with hello');
    buf = '';
    /* Another process: the store, called directly, never through the server. */
    applyBoardOps(repo, ARCH_BOARD_ID, [{ op: 'put', item: { kind: 'sticky', id: 'n', at: { x: 0, y: 0 }, text: 'from the agent', by: 'agent' } }]);
    assert.equal(await until((s) => s.includes('"type":"boards"'), 4000), true, `no change event; got ${JSON.stringify(buf)}`);
  } finally {
    ac.abort();
    await close();
  }
});
