import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { searchChats } from '../server/sessionsSearch.js';
import { createSession, updateSession } from '../server/sessionsStore.js';

/* P12 check: 200 chats x 200 turns. Recall: 20 planted phrases, 20/20 found. Speed: p95 a fraction of the same search without the raw prefilter, measured in the same run (it was a fixed 150 ms, which a loaded machine misses). */

const CHATS = 200;
const TURNS = 200;
const FILLER = 'the quick brown fox reconciles the ledger while the build waits for review and nothing else happens here';

test('searchChats over 200 chats x 200 turns finds every planted phrase, p95 well under the unfiltered search', () => {
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
  /* A fixed ms bound is a claim about an idle machine, and load stretches it, so the speed claim is made against a BASELINE MEASURED IN THIS RUN. The baseline is the same search forced down the path
     the prefilter exists to avoid: a needle with a character the raw-file check refuses (PLAIN) parses and walks
     every chat. The claim is that the prefiltered search is a fraction of that, which load stretches in both. */
  const time = (phrase: string): { ms: number; hits: { chatId: string }[] } => {
    const t0 = performance.now();
    const r = searchChats(repo, phrase, { limit: 50, maxBytes: 2 * 1024 * 1024, budgetMs: 10_000 });
    return { ms: performance.now() - t0, hits: r.hits };
  };
  const times: number[] = [];
  let found = 0;
  for (const [phrase, id] of planted) {
    const r = time(phrase);
    times.push(r.ms);
    if (r.hits.some((h) => h.chatId === id)) found++;
  }
  assert.strictEqual(found, 20, `recall ${found}/20`);
  times.sort((a, b) => a - b);
  const p95 = times[Math.ceil(times.length * 0.95) - 1]!;
  /* The baseline needs a planted phrase the prefilter refuses: the same text with a '!' on the end of its word. */
  const bangId = ids[0]!;
  const bangTurns = Array.from({ length: TURNS }, (_, t) => ({ role: t % 2 ? 'assistant' : 'user', text: `${FILLER} 0:${t}`, at: '2026-01-01T00:00:00.000Z' }));
  bangTurns[TURNS - 1]!.text += ' zxq!marker';
  updateSession(repo, bangId, { chat: { version: 1, sessionId: bangId, turns: bangTurns } });
  const unfiltered: number[] = [];
  for (let k = 0; k < 7; k++) {
    const r = time('zxq!marker');
    assert.ok(r.hits.some((h) => h.chatId === bangId), 'the unfiltered baseline finds its planted phrase');
    unfiltered.push(r.ms);
  }
  unfiltered.sort((a, b) => a - b);
  const baseline = unfiltered[3]!; // median
  /* Positive control: the baseline really is the slow path. If the two paths cost the same the ratio below could
     not tell a working prefilter from a missing one. */
  const plainMedian = times[Math.floor(times.length / 2)]!;
  assert.ok(baseline > plainMedian * 1.5, `control: the unfiltered path (${baseline.toFixed(1)} ms) is not clearly slower than the prefiltered one (${plainMedian.toFixed(1)} ms)`);
  assert.ok(p95 < baseline * 0.75, `p95 ${p95.toFixed(1)} ms is not well under the unfiltered search (${baseline.toFixed(1)} ms): the raw prefilter stopped saving the parse`);
  assert.strictEqual(searchChats(repo, 'nothing-planted-here-xyz', { limit: 50, maxBytes: 1 << 21, budgetMs: 10_000 }).hits.length, 0);
});
