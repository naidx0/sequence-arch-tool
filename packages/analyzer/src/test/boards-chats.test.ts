import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ARCH_BOARD_ID,
  applyBoardOps,
  createBoard,
  linkBoard,
  linkableBoards,
  listBoards,
  listBoardsForChat,
  removeBoardFromChat,
} from '../boards/boardStore.js';
import { createRepoServer } from '../server/repoServer.js';

/**
 * SPACES ARE PER CHAT (0.1.8.4). A board records the chats it belongs to
 * (`chats`); a chat lists its own, plus the architecture map, which is the
 * project's. A board from before the field (no `chats`) is "earlier": it is
 * in no chat's list and is offered in the add-from picker. Adding a board to a
 * chat links it (no copy); removing it from a chat unlinks, and only the last
 * chat leaving deletes the drawing.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const PLAINAPP = path.join(path.resolve(here, '..', '..'), 'test', 'fixtures', 'plainapp');
const tmpRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-boards-chats-'));
const ids = (bs: { id: string }[]): string[] => bs.map((b) => b.id);

function writeLegacyIndex(root: string): void {
  const dir = path.join(root, '.sequence', 'boards');
  fs.mkdirSync(dir, { recursive: true });
  const t = '2026-09-01T00:00:00.000Z';
  const mk = (id: string, name: string, kind: string, rev: number) => ({ id, name, kind, rev, createdAt: t, updatedAt: t });
  fs.writeFileSync(
    path.join(dir, 'index.json'),
    JSON.stringify({ version: 1, boards: [mk('architecture', 'Architecture', 'architecture', 3), mk('old-plan', 'Old plan', 'whiteboard', 2)] }),
  );
  fs.writeFileSync(path.join(dir, 'old-plan.json'), JSON.stringify({ version: 1, id: 'old-plan', rev: 2, items: [{ kind: 'text', id: 't', at: { x: 0, y: 0 }, text: 'kept' }] }));
}

test('an index written before the chats field loads, and its board is neither lost nor in any chat', () => {
  const root = tmpRoot();
  writeLegacyIndex(root);
  assert.deepEqual(ids(listBoards(root).boards), [ARCH_BOARD_ID, 'old-plan']);
  assert.deepEqual(ids(listBoardsForChat(root, 'chat-a').boards), [ARCH_BOARD_ID]);
  assert.deepEqual(ids(listBoardsForChat(root, 'chat-b').boards), [ARCH_BOARD_ID]);
  const pick = linkableBoards(root, 'chat-a');
  assert.deepEqual(ids(pick.earlier), ['old-plan']);
  assert.deepEqual(pick.groups, []);
});

test("chat A's list excludes chat B's board; the architecture board is in every list", () => {
  const root = tmpRoot();
  const a = createBoard(root, { name: 'A plan', chat: 'chat-a' });
  const b = createBoard(root, { name: 'B plan', chat: 'chat-b' });
  assert.deepEqual(a.chats, ['chat-a']);
  assert.deepEqual(ids(listBoardsForChat(root, 'chat-a').boards), [ARCH_BOARD_ID, a.id]);
  assert.deepEqual(ids(listBoardsForChat(root, 'chat-b').boards), [ARCH_BOARD_ID, b.id]);
  assert.deepEqual(ids(listBoardsForChat(root, 'chat-c').boards), [ARCH_BOARD_ID]);
  /* A freshly made board is never an "earlier" one, and the picker groups other chats' boards by chat. */
  const pick = linkableBoards(root, 'chat-a');
  assert.deepEqual(pick.earlier, []);
  assert.deepEqual(pick.groups.map((g) => [g.chat, ids(g.boards)]), [['chat-b', [b.id]]]);
});

test('the untouched seeded default board is not offered as an earlier space', () => {
  const root = tmpRoot();
  assert.deepEqual(ids(listBoards(root).boards), [ARCH_BOARD_ID, 'whiteboard']);
  assert.deepEqual(linkableBoards(root, 'chat-a').earlier, []);
});

test('link adds the chat to the same board (no copy); a drawing made after shows in both chats', () => {
  const root = tmpRoot();
  const b = createBoard(root, { name: 'Shared', chat: 'chat-b' });
  const linked = linkBoard(root, b.id, 'chat-a');
  assert.deepEqual(linked.chats, ['chat-b', 'chat-a']);
  assert.equal(listBoards(root).boards.filter((x) => x.name === 'Shared').length, 1);
  applyBoardOps(root, b.id, [{ op: 'put', item: { kind: 'text', id: 't', at: { x: 1, y: 1 }, text: 'both see this' } }]);
  assert.deepEqual(ids(listBoardsForChat(root, 'chat-a').boards), [ARCH_BOARD_ID, b.id]);
  assert.deepEqual(ids(listBoardsForChat(root, 'chat-b').boards), [ARCH_BOARD_ID, b.id]);
  /* Linking twice changes nothing; the write keeps `chats` through an ops write. */
  assert.deepEqual(linkBoard(root, b.id, 'chat-a').chats, ['chat-b', 'chat-a']);
  assert.deepEqual(listBoards(root).boards.find((x) => x.id === b.id)?.chats, ['chat-b', 'chat-a']);
  assert.throws(() => linkBoard(root, ARCH_BOARD_ID, 'chat-a'), /project-wide/);
  assert.throws(() => linkBoard(root, 'ghost', 'chat-a'), /no board/);
});

test('linking an earlier board claims it for the chat and takes it out of the earlier list', () => {
  const root = tmpRoot();
  writeLegacyIndex(root);
  linkBoard(root, 'old-plan', 'chat-a');
  assert.deepEqual(ids(listBoardsForChat(root, 'chat-a').boards), [ARCH_BOARD_ID, 'old-plan']);
  assert.deepEqual(ids(listBoardsForChat(root, 'chat-b').boards), [ARCH_BOARD_ID]);
  assert.deepEqual(linkableBoards(root, 'chat-b').earlier, []);
  assert.deepEqual(linkableBoards(root, 'chat-b').groups.map((g) => g.chat), ['chat-a']);
});

test('removing from a chat unlinks while another chat holds it, and deletes with the last one', () => {
  const root = tmpRoot();
  const b = createBoard(root, { name: 'Shared', chat: 'chat-b' });
  linkBoard(root, b.id, 'chat-a');
  applyBoardOps(root, b.id, [{ op: 'put', item: { kind: 'text', id: 't', at: { x: 1, y: 1 }, text: 'drawn' } }]);
  assert.deepEqual(removeBoardFromChat(root, b.id, 'chat-a'), { deleted: false });
  assert.deepEqual(ids(listBoardsForChat(root, 'chat-a').boards), [ARCH_BOARD_ID]);
  assert.deepEqual(ids(listBoardsForChat(root, 'chat-b').boards), [ARCH_BOARD_ID, b.id]);
  assert.equal(fs.existsSync(path.join(root, '.sequence', 'boards', `${b.id}.json`)), true, 'the drawing stays for the chat still holding it');
  assert.throws(() => removeBoardFromChat(root, b.id, 'chat-a'), /not in this chat/);
  assert.deepEqual(removeBoardFromChat(root, b.id, 'chat-b'), { deleted: true });
  assert.equal(listBoards(root).boards.some((x) => x.id === b.id), false);
  assert.equal(fs.existsSync(path.join(root, '.sequence', 'boards', `${b.id}.json`)), false);
  assert.throws(() => removeBoardFromChat(root, ARCH_BOARD_ID, 'chat-a'), /cannot be deleted/);
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

test('routes: create from a chat, list per chat, the picker, link, unlink, and delete with the last chat', async () => {
  const dir = tmpRoot();
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  const { base, close } = await startServer(repo);
  const post = (u: string, body: unknown) => fetch(`${base}${u}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const list = async (chat: string) => ((await (await fetch(`${base}/api/boards?chat=${chat}`)).json()) as { boards: { id: string }[] }).boards.map((b) => b.id);
  try {
    const made = (await (await post('/api/boards', { name: 'Sketch', kind: 'whiteboard', chat: 'chat-b' })).json()) as { id: string; chats: string[] };
    assert.deepEqual(made.chats, ['chat-b']);
    assert.deepEqual(await list('chat-b'), [ARCH_BOARD_ID, made.id]);
    assert.deepEqual(await list('chat-a'), [ARCH_BOARD_ID]);
    const pick = (await (await fetch(`${base}/api/boards/linkable?chat=chat-a`)).json()) as { groups: { chat: string; boards: { id: string }[] }[]; earlier: unknown[] };
    assert.deepEqual(pick.groups.map((g) => [g.chat, ids(g.boards)]), [['chat-b', [made.id]]]);
    assert.equal((await post(`/api/boards/${made.id}/link`, { chat: 'chat-a' })).status, 200);
    assert.deepEqual(await list('chat-a'), [ARCH_BOARD_ID, made.id]);
    const unlink = await fetch(`${base}/api/boards/${made.id}?chat=chat-a`, { method: 'DELETE' });
    assert.deepEqual(await unlink.json(), { ok: true, deleted: false });
    assert.deepEqual(await list('chat-b'), [ARCH_BOARD_ID, made.id]);
    const last = await fetch(`${base}/api/boards/${made.id}?chat=chat-b`, { method: 'DELETE' });
    assert.deepEqual(await last.json(), { ok: true, deleted: true });
    assert.equal((await fetch(`${base}/api/boards/${made.id}`)).status, 404);
    /* No chat given: the whole project list, as before (the MCP and old clients). */
    assert.deepEqual(ids(((await (await fetch(`${base}/api/boards`)).json()) as { boards: { id: string }[] }).boards), [ARCH_BOARD_ID, 'whiteboard']);
  } finally {
    await close();
  }
});

test('review: removing from a chat never deletes an earlier board that no chat holds', () => {
  const root = tmpRoot();
  writeLegacyIndex(root);
  assert.throws(() => removeBoardFromChat(root, 'old-plan', 'chat-a'), /not in this chat/);
  assert.equal(listBoards(root).boards.some((x) => x.id === 'old-plan'), true, 'the earlier board is still there');
  assert.equal(fs.existsSync(path.join(root, '.sequence', 'boards', 'old-plan.json')), true);
});
