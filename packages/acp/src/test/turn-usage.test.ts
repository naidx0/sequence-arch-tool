/**
 * ROUND 9 (ask 30): token usage per turn, as the agent reports it. Pure; fake
 * ACP notifications, no agent binary.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TurnUsageMeter, usageFromPrompt } from '../turnUsage.js';

const codexUsage = (last: Record<string, number>) => ({ sessionId: 's', update: { sessionUpdate: 'usage_update', used: 10, size: 100, _meta: { codex: { total: null, last } } } });

test("ACP's prompt response usage is read into input, output, cache and thought", () => {
  const u = usageFromPrompt({ totalTokens: 1500, inputTokens: 1000, outputTokens: 400, thoughtTokens: 60, cachedReadTokens: 700, cachedWriteTokens: 100 });
  assert.deepEqual(u, { input: 1000, output: 400, cacheRead: 700, cacheWrite: 100, thought: 60, total: 1500 });
});

test('no usage, a bad usage and an all-zero usage are null, never a guess', () => {
  assert.equal(usageFromPrompt(undefined), null);
  assert.equal(usageFromPrompt(null), null);
  assert.equal(usageFromPrompt('lots'), null);
  assert.equal(usageFromPrompt({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }), null);
  assert.equal(usageFromPrompt({ inputTokens: 'many' }), null);
});

test('a missing total is the sum of input and output', () => {
  assert.equal(usageFromPrompt({ inputTokens: 10, outputTokens: 5 })?.total, 15);
});

test("codex's requests are summed across the turn; Claude's context-only usage_update adds nothing", () => {
  const m = new TurnUsageMeter();
  assert.equal(m.current(), null);
  assert.equal(m.update({ sessionId: 's', update: { sessionUpdate: 'usage_update', used: 50, size: 200000 } }), false);
  assert.equal(m.current(), null);
  assert.equal(m.update(codexUsage({ inputTokens: 100, cachedInputTokens: 80, outputTokens: 20, reasoningOutputTokens: 5, totalTokens: 120 })), true);
  assert.equal(m.update(codexUsage({ inputTokens: 150, cachedInputTokens: 100, outputTokens: 30, totalTokens: 180 })), true);
  assert.deepEqual(m.current(), { input: 250, output: 50, cacheRead: 180, cacheWrite: 0, thought: 5, total: 300 });
  assert.equal(m.update({ sessionId: 's', update: { sessionUpdate: 'agent_message_chunk' } }), false);
});

test("the agent's own final report wins over the running sum", () => {
  const m = new TurnUsageMeter();
  m.update(codexUsage({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }));
  const final = usageFromPrompt({ inputTokens: 9, outputTokens: 3, totalTokens: 12 });
  assert.equal(m.current(final)?.total, 12);
});
