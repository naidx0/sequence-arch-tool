import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { searchChats } from '../server/sessionsSearch.js';
import { createSession, updateSession } from '../server/sessionsStore.js';

/* P12 check: 200 chats x 200 turns. Recall: 20 planted phrases, 20/20 found. Speed: p95 under 150 ms. */

const CHATS = 200;
const TURNS = 200;
const FILLER = 'the quick brown fox reconciles the ledger while the build waits for review and nothing else happens here';

test('searchChats over 200 chats x 200 turns finds every planted phrase, p95 under 150 ms', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-search-bench-'));
  const ids: string[] = [];
  for (let i = 0; i < CHATS; i++) ids.push(createSession(repo).id);
  const planted = new Map<string, string>();
  for (let n = 0; n < 20; n++) planted.set(`zxq${String(n).padStart(2, '0')}marker`, ids[(n * 9 + 3) % CHATS]!);
  const byChat = new Map<string, string[]>();
  for (const [phrase, id] of planted) byChat.set(id, [...(byChat.get(id) ?? []), phrase]);
  ids.forEach((id, c) => {
    const turns = Array.from({ length: TURNS }, (_, t) => ({ role: t % 2 ? 'assistant' : 'user', text: `${FILLER} ${c}:${t}`, at: '2026-01-01T00:00:00.000Z' }));
    const marks = byChat.get(id) ?? [];
    marks.forEach((m, k) => (turns[TURNS - 1 - k]!.text = `${turns[TURNS - 1 - k]!.text} ${m}`));
    updateSession(repo, id, { chat: { version: 1, sessionId: id, turns } });
  });
  const times: number[] = [];
  let found = 0;
  for (const [phrase, id] of planted) {
    const t0 = performance.now();
    const r = searchChats(repo, phrase, { limit: 50, maxBytes: 2 * 1024 * 1024, budgetMs: 10_000 });
    times.push(performance.now() - t0);
    if (r.hits.some((h) => h.chatId === id)) found++;
  }
  assert.strictEqual(found, 20, `recall ${found}/20`);
  times.sort((a, b) => a - b);
  const p95 = times[Math.ceil(times.length * 0.95) - 1]!;
  assert.ok(p95 < 150, `p95 ${p95.toFixed(1)} ms`);
  assert.strictEqual(searchChats(repo, 'nothing-planted-here-xyz', { limit: 50, maxBytes: 1 << 21, budgetMs: 10_000 }).hits.length, 0);
});
