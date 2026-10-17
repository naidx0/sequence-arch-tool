import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { recordAgentRun, type StoredAgentRun } from '../server/agentChatStore.js';
import { createSession, updateSession } from '../server/sessionsStore.js';
import { searchChats } from '../server/sessionsSearch.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PLAINAPP = path.join(path.resolve(here, '..', '..'), 'test', 'fixtures', 'plainapp');

function freshRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-sessions-search-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  return repo;
}

function run(id: string, prompt: string, text: string): StoredAgentRun {
  return { id, agentRef: 'claude', prompt, text, status: 'done', error: null, stopReason: null, startedAt: 1000, endedAt: 2000, model: null, nodeId: null, tools: [] };
}

/** Chat A mentions the phrase only in a title-less user turn; chat B only in an agent reply body. */
function seed(repo: string): { a: string; b: string } {
  const a = createSession(repo).id;
  const b = createSession(repo).id;
  updateSession(repo, a, { chat: { version: 1, sessionId: a, turns: [{ role: 'user', text: 'tell me about the zebra migration plan', at: '2026-01-01T00:00:00.000Z' }] } });
  recordAgentRun(repo, b, run('r1', 'what is the status', 'The quokka ledger reconciliation finished with two warnings.'));
  return { a, b };
}

test('searchChats: finds a phrase that only appears in the body of a chat, with a snippet, and not in others', () => {
  const repo = freshRepo();
  const { a, b } = seed(repo);
  const hitB = searchChats(repo, 'QUOKKA ledger', { limit: 10, maxBytes: 1 << 20 });
  assert.deepStrictEqual(hitB.hits.map((h) => h.chatId), [b]);
  assert.ok(hitB.hits[0]!.snippet.toLowerCase().includes('quokka ledger reconciliation'));
  const hitA = searchChats(repo, 'zebra', { limit: 10, maxBytes: 1 << 20 });
  assert.deepStrictEqual(hitA.hits.map((h) => h.chatId), [a]);
  assert.deepStrictEqual(searchChats(repo, 'nothing-like-this-xyz', { limit: 10, maxBytes: 1 << 20 }).hits, []);
});

test('searchChats: negative control, the per-chat cap hides words past it, and an exhausted budget says truncated', () => {
  const repo = freshRepo();
  const { b } = seed(repo);
  assert.deepStrictEqual(searchChats(repo, 'quokka', { limit: 10, maxBytes: 10 }).hits, [], 'the cap must stop the scan');
  let t = 0;
  const slow = searchChats(repo, 'quokka', { limit: 10, maxBytes: 1 << 20, budgetMs: 5, now: () => (t += 10) });
  assert.strictEqual(slow.truncated, true);
  assert.ok(!slow.hits.some((h) => h.chatId === b) || slow.hits.length <= 1);
});

test('GET /api/sessions/search returns the chat whose body matches', async () => {
  const repo = freshRepo();
  const { b } = seed(repo);
  const server = await createRepoServer(repo, { webDist: undefined });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    const res = await fetch(`${base}/api/sessions/search?q=quokka`);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { hits: { chatId: string; snippet: string }[] };
    assert.deepStrictEqual(body.hits.map((h) => h.chatId), [b]);
    const short = (await (await fetch(`${base}/api/sessions/search?q=q`)).json()) as { hits: unknown[] };
    assert.deepStrictEqual(short.hits, []);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
