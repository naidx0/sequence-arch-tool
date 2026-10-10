import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { AcpAgentClient } from '@sequence/acp';

import { createAcpSessionCache } from '../server/acpSessionCache.js';
import { ensureSessionsMigrated, forkSession, readAgentThread, readSessionIndex, writeAgentThread } from '../server/sessionsStore.js';

/**
 * S1 — where a chat keeps its agent's thread, and the teardown gate.
 */

function tmp(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-s1-store-')));
}

test('a chat records its agent thread without moving updatedAt, reads it back, and forgets it', () => {
  const root = tmp();
  try {
    const index = ensureSessionsMigrated(root);
    const id = index.activeId;
    const before = index.sessions.find((s) => s.id === id)!.updatedAt;
    assert.strictEqual(readAgentThread(root, id, 'codex'), null);
    assert.strictEqual(writeAgentThread(root, id, 'codex', { id: 'thread-1', kind: 'codex' }, '2026-10-06T00:00:00.000Z'), true);
    assert.deepStrictEqual(readAgentThread(root, id, 'codex'), { id: 'thread-1', kind: 'codex', at: '2026-10-06T00:00:00.000Z' });
    assert.strictEqual(readAgentThread(root, id, 'claude'), null, 'per agent');
    assert.strictEqual(readSessionIndex(root)!.sessions.find((s) => s.id === id)!.updatedAt, before, 'opening a thread is not activity');
    writeAgentThread(root, id, 'codex', null);
    assert.strictEqual(readAgentThread(root, id, 'codex'), null);
    assert.strictEqual('agentThreads' in readSessionIndex(root)!.sessions.find((s) => s.id === id)!, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a fork never shares its source\'s agent thread (two runtimes on one thread)', () => {
  const root = tmp();
  try {
    const id = ensureSessionsMigrated(root).activeId;
    writeAgentThread(root, id, 'codex', { id: 'thread-1', kind: 'codex' });
    const fork = forkSession(root, id)!;
    assert.strictEqual(readAgentThread(root, fork.id, 'codex'), null);
    assert.strictEqual(readAgentThread(root, id, 'codex')?.id, 'thread-1');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('recording a thread for a chat that does not exist writes nothing, and never creates a session store', () => {
  const root = tmp();
  try {
    assert.strictEqual(writeAgentThread(root, 'nope', 'codex', { id: 't', kind: 'codex' }), false);
    assert.strictEqual(fs.existsSync(path.join(root, '.sequence')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('teardown gate: a key\'s next runtime is not created until the old one has exited', async () => {
  const cache = createAcpSessionCache({ ttlMs: 0 });
  let releaseExit!: () => void;
  const exited = new Promise<void>((r) => (releaseExit = r));
  const order: string[] = [];
  const client = (name: string, slowExit: boolean): AcpAgentClient => ({
    start: async () => {},
    newSession: async () => name,
    prompt: async () => ({ stopReason: 'end_turn', text: name }),
    dispose: async () => {
      order.push(`dispose ${name}`);
      if (slowExit) await exited;
      order.push(`exited ${name}`);
    },
  });
  await cache.run('k', async () => ({ client: client('a', true), sessionId: 'a' }), (c) => c.prompt('x'));
  void cache.dispose('k');
  const second = cache.run(
    'k',
    async () => {
      order.push('create b');
      return { client: client('b', false), sessionId: 'b' };
    },
    (c) => c.prompt('y'),
  );
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(order, ['dispose a'], 'b waits while a is still exiting');
  releaseExit();
  const r = await second;
  assert.strictEqual(r.text, 'b');
  assert.deepStrictEqual(order, ['dispose a', 'exited a', 'create b']);
  await cache.disposeAll();
});
