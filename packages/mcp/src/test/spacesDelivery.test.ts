import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyBoardOps, createBoard, listBoards, readBoard } from '@sequence/analyzer';
import { findComponent } from '@sequence/schema/dist/visual/index.js';
import { drawTool } from '../boardTools.js';
import { visualTool } from '../visualTools.js';

const specimen = () => fs.mkdtempSync(path.join(os.tmpdir(), 'seq-spaces-delivery-'));
const scan = async (): Promise<never> => { throw Error('No scanner in this test'); };
test('draw writes and delivers only to its project and linked chat; person saves do not deliver', async () => {
  const a = specimen();
  const b = specimen();
  try {
    const board = createBoard(a, { name: 'Target', chat: 'one' });
    createBoard(b, { name: 'Target', chat: 'one' });
    const ops = [{ op: 'add' as const, type: 'rect' as const, id: 'box', x: 10, y: 20 }];
    const refused = await drawTool({ repoPath: a, board: board.id, ops }, scan, { SEQUENCE_CHAT: 'two' });
    assert.equal(refused.isError, true);
    assert.equal(readBoard(a, board.id)!.rev, 0);
    const result = await drawTool({ repoPath: a, board: board.id, ops }, scan, { SEQUENCE_CHAT: 'one' });
    assert.equal(result.isError, undefined);
    assert.deepEqual(listBoards(a).boards.find((m) => m.id === board.id)!.delivery, { chat: 'one', rev: 1 });
    assert.deepEqual(JSON.parse(result.content[0]!.text).destination, { project: a, chat: 'one', surface: 'whiteboard', board: board.id, saved: true, opened: false });
    applyBoardOps(a, board.id, [{ op: 'remove', id: 'box' }]);
    assert.deepEqual(listBoards(a).boards.find((m) => m.id === board.id)!.delivery, { chat: 'one', rev: 1 });
    assert.equal(readBoard(b, board.id)!.rev, 0);
  } finally { fs.rmSync(a, { recursive: true, force: true }); fs.rmSync(b, { recursive: true, force: true }); }
});

test('visual on an explicit Space publishes delivery and refuses an unlinked chat', () => {
  const root = specimen();
  try {
    const board = createBoard(root, { name: 'Chart', chat: 'one' });
    const args = { repoPath: root, board: board.id, component: 'bar', spec: findComponent('bar')!.example as Record<string, unknown> };
    const result = visualTool(args, { SEQUENCE_CHAT: 'one' });
    assert.equal(result.isError, undefined);
    assert.deepEqual(listBoards(root).boards.find((m) => m.id === board.id)!.delivery, { chat: 'one', rev: 1 });
    assert.match(result.content[0]!.text, /"saved":true,"opened":false/);
    const before = fs.readFileSync(path.join(root, '.sequence/boards', `${board.id}.json`), 'utf8');
    const refused = visualTool(args, { SEQUENCE_CHAT: 'two' });
    assert.equal(refused.isError, true);
    assert.equal(fs.readFileSync(path.join(root, '.sequence/boards', `${board.id}.json`), 'utf8'), before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
