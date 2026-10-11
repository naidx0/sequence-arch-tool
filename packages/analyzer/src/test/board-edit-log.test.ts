import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { BOARD_EDIT_CAPS, EditLogError, appendBoardEdits, boardEditLogEnabled, boardEditLogPath, readBoardEdits } from '../boards/boardEditLog.js';
import { applyBoardOps, createBoard, listBoards, readBoard } from '../boards/boardStore.js';
import { createRepoServer } from '../server/repoServer.js';

/**
 * THE BOARD EDIT LOG. It is a local file of what a person did, so what is
 * pinned here is: it is written where promised, it holds no words and no
 * points, it can be switched off, and nothing in it can leave the machine.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-editlog-'));

test('events append to .sequence/board-edits.jsonl, oldest first, and read back', () => {
  const root = tmpRoot();
  assert.equal(appendBoardEdits(root, [{ t: 1000, board: 'whiteboard', kind: 'move', data: { dx: 12.3456789, dy: -4, id: 'r1' } }]), 1);
  assert.equal(appendBoardEdits(root, [{ t: 2000, board: 'whiteboard', kind: 'snap-accepted', data: { shape: 'rect', strokes: 4, confidence: 0.93 } }]), 1);
  assert.equal(boardEditLogPath(root), path.join(root, '.sequence', 'board-edits.jsonl'));
  const events = readBoardEdits(root);
  assert.deepEqual(events.map((e) => e.kind), ['move', 'snap-accepted']);
  assert.equal(events[0]!.data!.dx, 12.346, 'numbers are rounded to the thousandth');
});

test('the log refuses text bodies, points and unknown kinds, and keeps strings short', () => {
  const root = tmpRoot();
  assert.throws(() => appendBoardEdits(root, [{ t: 1, board: 'w', kind: 'rename', data: { points: [1, 2] } }]), EditLogError);
  assert.throws(() => appendBoardEdits(root, [{ t: 1, board: 'w', kind: 'telemetry' }]), EditLogError);
  assert.throws(() => appendBoardEdits(root, [{ t: 'now', board: 'w', kind: 'move' }]), EditLogError);
  assert.throws(() => appendBoardEdits(root, 'not a list'), EditLogError);
  assert.throws(() => appendBoardEdits(root, Array.from({ length: BOARD_EDIT_CAPS.batch + 1 }, () => ({ t: 1, board: 'w', kind: 'move' }))), EditLogError);
  appendBoardEdits(root, [{ t: 1, board: 'w', kind: 'rename', data: { to: 'x'.repeat(500) } }]);
  assert.equal((readBoardEdits(root)[0]!.data!.to as string).length, 80);
  assert.equal(fs.existsSync(boardEditLogPath(tmpRoot())), false, 'a refused request writes nothing');
});

test('it can be switched off: an empty .sequence/board-edits.off, or SEQUENCE_BOARD_EDIT_LOG=0', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.sequence'), { recursive: true });
  fs.writeFileSync(path.join(root, '.sequence', 'board-edits.off'), '');
  assert.equal(boardEditLogEnabled(root), false);
  assert.equal(appendBoardEdits(root, [{ t: 1, board: 'w', kind: 'move' }]), 0);
  assert.equal(fs.existsSync(boardEditLogPath(root)), false);

  const other = tmpRoot();
  process.env.SEQUENCE_BOARD_EDIT_LOG = '0';
  try {
    assert.equal(appendBoardEdits(other, [{ t: 1, board: 'w', kind: 'move' }]), 0);
  } finally {
    delete process.env.SEQUENCE_BOARD_EDIT_LOG;
  }
});

test('a log past its cap rolls to board-edits.1.jsonl instead of growing without end', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.sequence'), { recursive: true });
  fs.writeFileSync(boardEditLogPath(root), 'x'.repeat(BOARD_EDIT_CAPS.fileBytes + 1));
  appendBoardEdits(root, [{ t: 1, board: 'w', kind: 'add' }]);
  assert.ok(fs.existsSync(path.join(root, '.sequence', 'board-edits.1.jsonl')));
  assert.equal(readBoardEdits(root).length, 1);
});

test('nothing in the module can send it anywhere: no network import', () => {
  const src = fs.readFileSync(path.join(here, '..', '..', 'src', 'boards', 'boardEditLog.ts'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /from 'node:(http|https|net|dgram|tls|http2)'|fetch\(|XMLHttpRequest|WebSocket/);
  assert.doesNotMatch(code, /from 'node:child_process'/);
});

test('stroke points keep their pen times when sane, and drop them when not', () => {
  const root = tmpRoot();
  const meta = createBoard(root, { name: 'Sketch' });
  applyBoardOps(root, meta.id, [
    {
      op: 'put',
      item: { kind: 'stroke', id: 's1', width: 2, points: [{ x: 0, y: 0, t: 0 }, { x: 5, y: 5, t: 16.6 }, { x: 9, y: 9, t: -3 }, { x: 12, y: 9, t: 9e9 }, { x: 14, y: 9 }] },
    },
  ]);
  const stroke = readBoard(root, meta.id)!.items[0] as { points: { x: number; y: number; t?: number }[] };
  assert.deepEqual(stroke.points.map((p) => p.t), [0, 17, undefined, undefined, undefined]);
});

test('a diamond is a shape the store keeps, and the route ids "events" and "edit-log" never name a board', () => {
  const root = tmpRoot();
  const meta = createBoard(root, { name: 'Sketch' });
  const doc = applyBoardOps(root, meta.id, [{ op: 'put', item: { kind: 'shape', id: 'd1', shape: 'diamond', from: { x: 0, y: 0 }, to: { x: 80, y: 60 } } }]);
  assert.equal((doc.items[0] as { shape: string }).shape, 'diamond');
  assert.notEqual(createBoard(root, { name: 'Edit log' }).id, 'edit-log');
  assert.notEqual(createBoard(root, { name: 'Events' }).id, 'events');
  assert.ok(listBoards(root).boards.length >= 4);
});

test('POST and GET /api/boards/edit-log over the real server', async () => {
  const repo = tmpRoot();
  const server = await createRepoServer(repo, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    const post = await fetch(`${base}/api/boards/edit-log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [{ t: Date.now(), board: 'whiteboard', kind: 'snap-undone', data: { shape: 'ellipse' } }] }),
    });
    assert.equal(post.status, 200);
    assert.deepEqual(await post.json(), { written: 1 });
    const got = (await (await fetch(`${base}/api/boards/edit-log`)).json()) as { enabled: boolean; events: { kind: string }[] };
    assert.equal(got.enabled, true);
    assert.deepEqual(got.events.map((e) => e.kind), ['snap-undone']);
    const bad = await fetch(`${base}/api/boards/edit-log`, { method: 'POST', body: JSON.stringify({ events: [{ t: 1, board: 'w', kind: 'nope' }] }) });
    assert.equal(bad.status, 400);
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
