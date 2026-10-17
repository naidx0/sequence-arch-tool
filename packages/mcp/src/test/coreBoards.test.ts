import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readBoard } from '@sequence/analyzer';
import { createServer } from '../index.js';

test('a default core session lists, creates and draws on its repository without the all-tools setting; reopens persisted marks', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-core-boards-'));
  const connect = async () => {
    const server = createServer({ tools: 'core', repo });
    const [c, s] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'core-boards-test', version: '0.0.0' });
    await Promise.all([server.connect(s), client.connect(c)]);
    return { client, close: async () => { await client.close(); await server.close(); } };
  };
  const first = await connect();
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await first.client.callTool({ name, arguments: args });
    assert.notEqual(r.isError, true, JSON.stringify(r.content));
    return JSON.parse((r.content as { text: string }[])[0]!.text);
  };
  try {
    const listed = await call('list_boards', {});
    assert.ok(listed.boards.some((b: { id: string }) => b.id === 'architecture'));
    const made = await call('create_board', { name: 'Own completion specimen' });
    const board = made.created.id;
    await call('draw', { board, ops: [{ op: 'add', id: 'note', type: 'sticky', x: 24, y: 36, text: 'Authorized drawing' }] });
    const stored = readBoard(repo, board)!;
    assert.equal(stored.items.length, 1);
    const item = stored.items[0]!;
    assert.equal(item.kind, 'text');
    if (item.kind !== 'text') throw new Error('note');
    assert.deepEqual(item.at, { x: 24, y: 36 });
    assert.equal(item.by, 'agent');
    const before = JSON.stringify(stored);
    const refused = await first.client.callTool({ name: 'draw', arguments: { board: 'not-a-board', ops: [{ op: 'add', type: 'text', text: 'Must refuse' }] } });
    assert.equal(refused.isError, true);
    assert.equal(JSON.stringify(readBoard(repo, board)), before);
    assert.equal(readBoard(repo, 'not-a-board'), null);
    /* Default architecture drawing requires no scan, provider or node anchor. */
    await call('draw', { ops: [{ op: 'add', id: 'arch-text', type: 'text', x: 40, y: 80, text: 'Explanation, not scan evidence' }] });
    assert.equal(readBoard(repo, 'architecture')!.items[0]!.id, 'arch-text');
    await first.close();
    const second = await connect();
    try {
      const result = await second.client.callTool({ name: 'list_boards', arguments: {} });
      assert.notEqual(result.isError, true);
      const index = JSON.parse((result.content as { text: string }[])[0]!.text);
      assert.equal(index.boards.find((b: { id: string }) => b.id === board).items, 1);
      const { tools } = await second.client.listTools();
      for (const name of ['scan_repo', 'export_diagram', 'whiteboard', 'design_suggest']) assert.equal(tools.some(t => t.name === name), false, name);
    } finally { await second.close(); }
  } finally {
    await first.close();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
