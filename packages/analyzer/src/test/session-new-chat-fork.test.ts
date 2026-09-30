/**
 * New-chat board isolation + empty board seed — locking tests for Phase 0.2.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  createSession,
  forkSession,
  readSessionBoard,
  readSessionChat,
  readSessionCanvas,
  updateSession,
} from '../server/sessionsStore.js';

function tmpRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'seq-session-'));
}

test('createSession seeds empty board.seqd so New Chat has no prior architecture', () => {
  const repo = tmpRepo();
  const created = createSession(repo, { mode: 'work' });
  const board = readSessionBoard(repo, created.id);
  assert.ok(board && board.trim());
  const parsed = JSON.parse(board!) as { nodes: unknown[]; edges: unknown[]; grounded: { graphId: string } };
  assert.equal(parsed.nodes.length, 0);
  assert.equal(parsed.edges.length, 0);
  assert.equal(parsed.grounded.graphId, `scratch:${created.id}`);
});

test('forkSession copies board + canvas, leaves empty transcript, sets clonedFromId', () => {
  const repo = tmpRepo();
  const source = createSession(repo, { mode: 'work' });
  const richBoard = JSON.stringify({
    version: 1,
    kind: 'service-flow',
    title: 'Prior board',
    grounded: { graphId: `scratch:${source.id}` },
    nodes: [{ id: 'n1', label: 'A', kind: 'service' }],
    edges: [],
  });
  updateSession(repo, source.id, {
    boardSeqd: richBoard,
    canvas: {
      version: 1,
      sessionId: source.id,
      blocks: [{ id: 'b1', type: 'markdown', title: 'Note', payload: 'hi' }],
    },
    chat: {
      version: 1,
      sessionId: source.id,
      turns: [{ role: 'user', text: 'hello', at: new Date().toISOString() }],
    },
  });

  const forked = forkSession(repo, source.id, { mode: 'work' });
  assert.ok(forked);
  assert.notEqual(forked!.id, source.id);

  const board = JSON.parse(readSessionBoard(repo, forked!.id)!) as {
    nodes: unknown[];
    grounded: { graphId: string };
  };
  assert.equal(board.nodes.length, 1);
  assert.equal(board.grounded.graphId, `scratch:${forked!.id}`);

  const canvas = readSessionCanvas(repo, forked!.id);
  assert.equal(canvas.blocks?.length ?? 0, 1);

  const chat = readSessionChat(repo, forked!.id);
  assert.equal(chat.turns.length, 0);

  const entry = forked!.index.sessions.find((s) => s.id === forked!.id);
  assert.equal(entry?.clonedFromId, source.id);
});
