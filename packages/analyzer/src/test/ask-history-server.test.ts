import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRepoServer } from '../server/repoServer.js';
import { startMockProvider, type MockProvider } from './mock-provider.js';
import {
  buildAskHistory,
  droppedCount,
  extractiveSummary,
  historyBudgetTokens,
  resetHistorySummaryMemory,
  DROP_STEP,
} from '../server/askHistory.js';
import { approxTokens, estimateTokens } from '../llm/tokenBudget.js';
import { compactSessionTurns } from '../llm/compaction.js';
import { hostedContextWindow } from '../llm/modelWindows.js';

/**
 * 019-10 (audit P1-3): CONTEXT USED TO FORGET AFTER 20 TURNS.
 *
 * The history now comes from the stored transcript, is sized from the model's
 * window, and what does not fit is carried as a cached summary. These tests
 * read what a (fake) provider was actually handed.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const PLAINAPP = path.join(path.resolve(here, '..', '..'), 'test', 'fixtures', 'plainapp');
const FAKE_KEY = 'sk-ant-test-HISTORY-42';
const FACT = 'The staging database password hint is PURPLE-ELEPHANT-7.';

function tmpRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-history-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  return repo;
}

type Turn = { role: 'user' | 'assistant'; text: string };

function writeChat(repo: string, id: string, turns: Turn[]): void {
  const dir = path.join(repo, '.sequence', 'sessions', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'chat.json'), JSON.stringify({ version: 2, sessionId: id, turns }));
}

/** Every string in a captured provider request, joined: the prompt, whatever the wire shape. */
function promptText(body: unknown): string {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(body);
  return out.join('\n');
}

const isSummaryCall = (text: string): boolean => text.includes('condensing the EARLIER part of a conversation');

/** The fake model: summarizes by quoting the user's lines, so a fact in the input survives into the summary. */
function fakeModel(counter?: { summaries: number }): (body: unknown) => { text: string } {
  return (body) => {
    const text = promptText(body);
    if (isSummaryCall(text)) {
      if (counter) counter.summaries += 1;
      const facts = text.split('\n').filter((l) => l.includes('PURPLE-ELEPHANT-7'));
      return { text: `Summary of earlier chat. ${facts.length > 0 ? FACT : 'Nothing notable.'}` };
    }
    return { text: 'ok' };
  };
}

async function withServer<T>(repo: string, mock: MockProvider, fn: (ask: (body: Record<string, unknown>) => Promise<void>) => Promise<T>): Promise<T> {
  const server = await createRepoServer(repo, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    await fetch(`${base}/api/ai-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', baseUrl: mock.baseUrl, model: 'claude-test', apiKey: FAKE_KEY }),
    });
    return await fn(async (body) => {
      const res = await fetch(`${base}/api/ask/stream`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intents: [{ id: 'impact', subject: 'backend', subjectNodeId: 'svc:backend' }], ...body }),
      });
      await res.text();
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** The PRIOR CHAT section as the provider received it. */
function historySection(requestBody: unknown): string {
  const text = promptText(requestBody);
  const start = text.indexOf('--- PRIOR CHAT');
  assert.ok(start >= 0, 'the prompt carries a PRIOR CHAT section');
  const rest = text.slice(start);
  const end = rest.search(/\n\n--- (?!EARLIER)/);
  return end < 0 ? rest : rest.slice(0, end);
}

const sixTurns: Turn[] = [
  { role: 'user', text: 'We are renaming the billing service to ledger.' },
  { role: 'assistant', text: 'Understood: billing becomes ledger.' },
  { role: 'user', text: 'Keep the public API paths unchanged.' },
  { role: 'assistant', text: 'Paths stay as they are.' },
  { role: 'user', text: 'Which tests cover the rename?' },
  { role: 'assistant', text: 'billing.test.ts covers it.' },
];

test('slice 1: two windows on one thread send byte-identical history whatever body.history says', async () => {
  const repo = tmpRepo();
  writeChat(repo, 'chat-a', sixTurns);
  const mock = await startMockProvider(fakeModel());
  try {
    await withServer(repo, mock, async (ask) => {
      await ask({ question: 'And the migrations?', threadId: 'chat-a', history: [] });
      await ask({ question: 'And the migrations?', threadId: 'chat-a', history: [{ role: 'user', text: 'STALE-WINDOW-TURN' }, { role: 'assistant', text: 'STALE-REPLY' }] });
    });
  } finally {
    await mock.close();
  }
  const [first, second] = mock.requests.map((r) => historySection(r.body));
  assert.strictEqual(first, second, 'identical bytes');
  assert.match(first!, /renaming the billing service to ledger/, 'built from the stored transcript');
  assert.doesNotMatch(first!, /STALE-WINDOW-TURN/);
  assert.doesNotMatch(promptText(mock.requests[1]!.body), /STALE-REPLY/, 'the window-local history never reaches the model');
});

test('slice 1: a thread with no stored transcript falls back to body.history', async () => {
  const repo = tmpRepo();
  const mock = await startMockProvider(fakeModel());
  try {
    await withServer(repo, mock, async (ask) => {
      await ask({ question: 'next', threadId: 'never-saved', history: [{ role: 'user', text: 'FALLBACK-TURN-ONE' }, { role: 'assistant', text: 'FALLBACK-REPLY' }] });
    });
  } finally {
    await mock.close();
  }
  assert.match(historySection(mock.requests[0]!.body), /FALLBACK-TURN-ONE/);
});

test('slice 1: the stored copy of the question being asked is not history', async () => {
  const repo = tmpRepo();
  writeChat(repo, 'chat-b', [...sixTurns, { role: 'user', text: 'And the migrations?' }]);
  const mock = await startMockProvider(fakeModel());
  try {
    await withServer(repo, mock, async (ask) => {
      await ask({ question: 'And the migrations?', threadId: 'chat-b' });
    });
  } finally {
    await mock.close();
  }
  assert.doesNotMatch(historySection(mock.requests[0]!.body), /And the migrations\?/);
});

function longChat(): Turn[] {
  const filler = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(160); /* ~9k chars */
  const turns: Turn[] = [
    { role: 'user', text: `Remember this for later. ${FACT}` },
    { role: 'assistant', text: 'Noted.' },
  ];
  for (let i = 0; i < 30; i++) {
    turns.push({ role: 'user', text: `Filler question ${i}. ${filler}` });
    turns.push({ role: 'assistant', text: `Filler answer ${i}.` });
  }
  return turns;
}

test('slice 3: a fact from turn 1 is in the prompt at turn 31 through the summary, and the summarizer runs once', async () => {
  const repo = tmpRepo();
  writeChat(repo, 'chat-long', longChat());
  const counter = { summaries: 0 };
  const mock = await startMockProvider(fakeModel(counter));
  try {
    await withServer(repo, mock, async (ask) => {
      await ask({ question: 'What was the password hint?', threadId: 'chat-long' });
      await ask({ question: 'What was the password hint?', threadId: 'chat-long' });
    });
  } finally {
    await mock.close();
  }
  const asks = mock.requests.filter((r) => !isSummaryCall(promptText(r.body)));
  assert.strictEqual(asks.length, 2);
  const section = historySection(asks[0]!.body);
  assert.match(section, /EARLIER IN THIS CHAT: \d+ turns summarized/);
  assert.match(section, /PURPLE-ELEPHANT-7/, 'the fact is recalled from the summary');
  assert.doesNotMatch(section, /Remember this for later/, 'turn 1 itself was dropped from the verbatim window');
  assert.match(section, /Filler answer 29\./, 'the newest turns are verbatim');
  assert.strictEqual(counter.summaries, 1, 'one summarizer call for the same dropped set');
  assert.strictEqual(historySection(asks[0]!.body), historySection(asks[1]!.body));
  assert.ok(fs.existsSync(path.join(repo, '.sequence', 'sessions', 'chat-long', 'history-summary.json')), 'cached in the session folder');
});

test('slice 3: with no usable model the extractive summary still carries the first ask', async () => {
  const repo = tmpRepo();
  writeChat(repo, 'chat-nomodel', longChat());
  const mock = await startMockProvider((body) => (isSummaryCall(promptText(body)) ? { status: 500 } : { text: 'ok' }));
  try {
    await withServer(repo, mock, async (ask) => {
      await ask({ question: 'What was the password hint?', threadId: 'chat-nomodel' });
    });
  } finally {
    await mock.close();
  }
  const asks = mock.requests.filter((r) => !isSummaryCall(promptText(r.body)));
  const section = historySection(asks[0]!.body);
  assert.match(section, /EARLIER IN THIS CHAT/);
  assert.match(section, /PURPLE-ELEPHANT-7/, 'extractive fallback keeps the first ask');
});

/* ── unit level ─────────────────────────────────────────────────────── */

function unitRoot(id: string, turns: Turn[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-history-unit-'));
  writeChat(root, id, turns);
  return root;
}

const baseInput = { requestHistory: undefined, requestDropped: 0, question: 'q', model: 'claude-test' } as const;

test('slice 2: no fixed 20-turn cut: 60 short turns are all verbatim on a hosted model', async () => {
  const turns: Turn[] = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', text: `short turn ${i}` }));
  const root = unitRoot('t60', turns);
  const out = await buildAskHistory({ ...baseInput, sessionsRoot: root, threadId: 't60', contextWindow: undefined });
  assert.strictEqual(out.keptTurns, 60);
  assert.strictEqual(out.summarizedTurns, 0);
  assert.ok(out.lines.some((l) => l === 'User: short turn 0'));
  assert.ok(!out.lines.some((l) => l.includes('EARLIER IN THIS CHAT')));
});

test('slice 2: the budget follows the model window', () => {
  assert.ok(hostedContextWindow('claude-sonnet-4-5') === 200_000);
  assert.ok(historyBudgetTokens(undefined, 'claude-sonnet-4-5') > historyBudgetTokens(undefined, 'gpt-4o'));
  assert.ok(historyBudgetTokens(4096, 'whatever') < historyBudgetTokens(undefined, 'gpt-4o'));
  assert.strictEqual(historyBudgetTokens(null, 'local'), Math.floor(4096 * 0.25), 'an unprobed local model counts as Ollama default');
  assert.ok(historyBudgetTokens(1_000_000, 'x') <= 64_000, 'a huge window is capped');
});

test('slice 2: droppedCount keeps newest turns and moves in steps', () => {
  const costs = Array.from({ length: 40 }, () => 100);
  assert.strictEqual(droppedCount(costs, 4000), 0);
  const d = droppedCount(costs, 1500);
  assert.strictEqual(d % DROP_STEP, 0);
  assert.ok(40 - d <= 15 && 40 - d >= 1, 'kept never exceeds the budget');
  assert.strictEqual(droppedCount([5000], 100), 0, 'the newest turn is always kept');
});

test('slice 3: the summary is rolled forward from the cached shorter one, not rebuilt', async () => {
  resetHistorySummaryMemory();
  const root = unitRoot('roll', longChat());
  const prompts: string[] = [];
  const summarize = async (p: string): Promise<string> => {
    prompts.push(p);
    return `SUMMARY#${prompts.length}`;
  };
  const input = { ...baseInput, sessionsRoot: root, threadId: 'roll', contextWindow: 4096 as number | null, summarize };
  const a = await buildAskHistory(input);
  assert.strictEqual(a.summaryKind, 'model');
  /* Chunked to fit a 4k window: several folds, the last one cached as the summary of the whole set. */
  const folds = prompts.length;
  assert.ok(folds >= 1);
  /* Same transcript again: cache, no call. */
  resetHistorySummaryMemory();
  const again = await buildAskHistory(input);
  assert.strictEqual(again.summaryKind, 'cache');
  assert.strictEqual(prompts.length, folds, 'no further call for the same dropped set');
  /* Grow the transcript by enough turns to move the boundary one step. */
  const grown = longChat();
  for (let i = 0; i < DROP_STEP; i++) grown.push({ role: i % 2 === 0 ? 'user' : 'assistant', text: `later turn ${i} ${'z'.repeat(2000)}` });
  writeChat(root, 'roll', grown);
  const b = await buildAskHistory(input);
  assert.ok(prompts.length > folds, 'the grown set is summarized');
  assert.ok(prompts.length - folds < folds, 'rolled forward from the cached summary, not rebuilt from the start');
  assert.match(prompts[folds]!, /SUMMARY SO FAR/);
  assert.ok(prompts[folds]!.split(String.fromCharCode(10)).includes(`SUMMARY#${folds}`), 'the previous summary is folded in');
  assert.strictEqual(b.summaryKind, 'model');
});

test('slice 3: the extractive summary is deterministic and keeps the first ask', () => {
  const turns = [
    { role: 'user' as const, content: `First ask. ${FACT}` },
    { role: 'assistant' as const, content: 'Sure. More words follow here.' },
    ...Array.from({ length: 200 }, (_, i) => ({ role: 'user' as const, content: `user line ${i} ${'q'.repeat(300)}` })),
  ];
  const a = extractiveSummary(turns);
  assert.strictEqual(a, extractiveSummary(turns));
  assert.match(a, /PURPLE-ELEPHANT-7/);
  assert.ok(a.length <= 4000);
  assert.match(a, /middle messages not shown/);
});

test('slice 3: compaction hands the summarizer whole multi-line turns', async () => {
  let seen: { role: string; content: string }[] = [];
  const turns = [
    { id: '0', role: 'user' as const, content: 'line one\nline two\nline three' },
    { id: '1', role: 'assistant' as const, content: 'reply a\nreply b' },
    { id: '2', role: 'user' as const, content: 'tail turn that is kept' },
  ];
  await compactSessionTurns({
    turns,
    recentTailCount: 1,
    contextThresholdTokens: Math.max(1, approxTokens(turns.map((t) => `${t.role}: ${t.content}`).join('\n')) - 1),
    summarizer: async (input) => {
      seen = input.turns;
      return { summary: 's' };
    },
  }).catch(() => undefined);
  assert.strictEqual(seen.length, 2, 'two eligible turns, not five lines');
  assert.deepStrictEqual(seen.map((t) => t.role), ['user', 'assistant']);
  assert.strictEqual(seen[0]!.content, 'line one\nline two\nline three');
});

test('slice 4: the estimate corrects chars/4 where it is known to be wrong', () => {
  const ascii = 'const x = foo(bar, baz); // path/to/file.ts'.repeat(40);
  assert.ok(estimateTokens(ascii) >= approxTokens(ascii) * 1.2 && estimateTokens(ascii) <= approxTokens(ascii) * 1.3, 'ASCII reads the measured quarter above chars/4');
  const cjk = '这是一个关于系统架构的问题'.repeat(40);
  assert.ok(estimateTokens(cjk) > approxTokens(cjk) * 3, 'CJK is far above chars/4');
  assert.ok(estimateTokens('😀'.repeat(10)) >= 20, 'one astral character costs two tokens');
  assert.strictEqual(estimateTokens(''), 0);
});
