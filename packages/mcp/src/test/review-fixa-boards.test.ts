/**
 * Review finding: boards an agent creates had no chats, so they never appeared in that chat's Spaces.
 * The app tells the MCP process its chat in SEQUENCE_CHAT; create_board sends it, and a draw on the seeded
 * default whiteboard links that board to the chat.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listBoardsForChat, listBoards, DEFAULT_WHITEBOARD_ID } from '@sequence/analyzer';
import { createBoardTool, drawTool } from '../boardTools.js';

const text = { op: 'add' as const, type: 'text' as const, x: 10, y: 10, text: 'hello' };

function repo(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-mcp-chat-boards-')));
}

test('create_board links the new board to the chat named in SEQUENCE_CHAT', () => {
  const dir = repo();
  try {
    const r = createBoardTool({ repoPath: dir, name: 'Checkout redesign' }, { SEQUENCE_CHAT: 'chat-a' });
    assert.equal(r.isError, undefined);
    const id = (JSON.parse(r.content[0]!.text) as { created: { id: string } }).created.id;
    assert.ok(listBoardsForChat(dir, 'chat-a').boards.some((b) => b.id === id), 'it appears in that chat');
    assert.ok(!listBoardsForChat(dir, 'chat-b').boards.some((b) => b.id === id), 'and not in another');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('create_board without a chat stays unlinked (a session started outside the app)', () => {
  const dir = repo();
  try {
    const r = createBoardTool({ repoPath: dir, name: 'Loose' }, {});
    const id = (JSON.parse(r.content[0]!.text) as { created: { id: string } }).created.id;
    assert.equal(listBoards(dir).boards.find((b) => b.id === id)?.chats, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a draw on the seeded default whiteboard links it to the chat', async () => {
  const dir = repo();
  try {
    assert.ok(!listBoardsForChat(dir, 'chat-a').boards.some((b) => b.id === DEFAULT_WHITEBOARD_ID), 'not there before the draw');
    const r = await drawTool({ repoPath: dir, board: DEFAULT_WHITEBOARD_ID, ops: [text] }, undefined, { SEQUENCE_CHAT: 'chat-a' });
    assert.equal(r.isError, undefined, r.content[0]!.text);
    assert.ok(listBoardsForChat(dir, 'chat-a').boards.some((b) => b.id === DEFAULT_WHITEBOARD_ID), 'it is in the chat now');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a draw with no chat leaves the default whiteboard unlinked', async () => {
  const dir = repo();
  try {
    const r = await drawTool({ repoPath: dir, board: DEFAULT_WHITEBOARD_ID, ops: [text] }, undefined, {});
    assert.equal(r.isError, undefined, r.content[0]!.text);
    assert.equal(listBoards(dir).boards.find((b) => b.id === DEFAULT_WHITEBOARD_ID)?.chats, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
