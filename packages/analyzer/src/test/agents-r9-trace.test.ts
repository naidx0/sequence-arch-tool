import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ManualClock } from '../../../acp/dist/replay/clock.js';

import { AgentEventHub } from '../server/agentEvents.js';
import { AgentTurnRuntime } from '../server/agentTurnRuntime.js';
import { readAgentRuns } from '../server/agentChatStore.js';
import { RunNodeEventFeed } from '../server/runNodeAgentEvents.js';
import { ensureSessionsMigrated } from '../server/sessionsStore.js';

/* Round 9 (asks 29, 30): a failed step says why, a finished one says what it printed,
   the stop carries the turn's tokens, and the tokens are kept with the chat. */

const ROOT = path.resolve('/repo');
function feedOf() {
  const hub = new AgentEventHub({ getGraph: () => null, getRoot: () => ROOT, now: () => 1 });
  const feed = new RunNodeEventFeed({ sink: hub, sessionId: 'chat-1', source: 'acp', root: ROOT, title: 'fix it' });
  return { hub, feed };
}
const tool = (sessionUpdate: string, toolCallId: string, extra: Record<string, unknown> = {}) => ({ sessionId: 't', update: { sessionUpdate, toolCallId, ...extra } });

test('a failed tool carries its own error text; a done tool its first output line', () => {
  const { hub, feed } = feedOf();
  feed.start();
  feed.update(tool('tool_call', 'c1', { kind: 'execute', title: 'npm test' }));
  feed.update(tool('tool_call_update', 'c1', { status: 'failed', content: [{ type: 'content', content: { type: 'text', text: '\nnpm ERR! missing script: test\nmore' } }] }));
  feed.update(tool('tool_call', 'c2', { kind: 'read', title: 'Read a.ts' }));
  feed.update(tool('tool_call_update', 'c2', { status: 'completed', rawOutput: 'export const a = 1;\nexport const b = 2;' }));
  feed.update(tool('tool_call', 'c3', { kind: 'execute', title: 'false' }));
  feed.update(tool('tool_call_update', 'c3', { status: 'failed' }));
  const ends = hub.log().filter((e) => e.kind === 'tool_end');
  assert.equal(ends[0]!.error, 'npm ERR! missing script: test');
  assert.equal(ends[1]!.result, 'export const a = 1;');
  assert.equal(ends[2]!.status, 'failed');
  assert.equal(ends[2]!.error, undefined);
});

test('the stop event carries the turn usage; a failed turn names why on the stop and on the steps it cut short', () => {
  const { hub, feed } = feedOf();
  feed.start();
  feed.update(tool('tool_call', 'c1', { kind: 'execute', title: 'sleep 999' }));
  const usage = { input: 1000, output: 400, cacheRead: 700, cacheWrite: 0, thought: 0, total: 1400 };
  feed.end(false, usage, 'Session expired. Run claude /login.');
  const log = hub.log();
  const cut = log.find((e) => e.kind === 'tool_end')!;
  assert.equal(cut.status, 'failed');
  assert.equal(cut.error, 'Session expired. Run claude /login.');
  const stop = log.at(-1)!;
  assert.deepEqual(stop.usage, usage);
  assert.equal(stop.tokens, 1400);
  assert.equal(stop.error, 'Session expired. Run claude /login.');
});

test('a turn that ends well with no usage report has no usage, not zero', () => {
  const { hub, feed } = feedOf();
  feed.start();
  feed.end(true, null);
  assert.equal(hub.log().at(-1)!.usage, undefined);
});

test('a hook failure carries the tool error text', () => {
  const hub = new AgentEventHub({ getGraph: () => null, getRoot: () => ROOT, now: () => 1 });
  const ev = hub.normalize({ hook_event_name: 'PostToolUseFailure', session_id: 's', tool_name: 'Bash', tool_use_id: 'u1', tool_input: { command: 'pytest' }, error: 'Command exited with code 2\nstderr...' });
  assert.equal(ev?.status, 'failed');
  assert.equal(ev?.error, 'Command exited with code 2');
});

test("the turn's tokens are summed from codex requests, sent as they change, and recorded with the chat", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-usage-'));
  try {
    const sent: Record<string, unknown>[] = [];
    const clock = new ManualClock();
    const rt = new AgentTurnRuntime({
      clock,
      emit: (e) => sent.push(e),
      agentRef: 'codex',
      provider: 'codex',
      chatId: 'chat-1',
      prompt: 'hi',
      nodeId: null,
      sessionsRoot: null,
      userConfigDir: dir,
      detectAnswer: false,
    });
    const codex = (last: Record<string, number>) => ({ sessionId: 's', update: { sessionUpdate: 'usage_update', used: 1, size: 2, _meta: { codex: { last } } } });
    rt.update(codex({ inputTokens: 100, cachedInputTokens: 60, outputTokens: 20, totalTokens: 120 }));
    rt.update(codex({ inputTokens: 50, cachedInputTokens: 50, outputTokens: 10, totalTokens: 60 }));
    const live = sent.filter((e) => e.type === 'acp:usage');
    assert.equal(live.length, 2);
    assert.equal((live[1]!.usage as { total: number }).total, 180);
    rt.finish('ended', { stopReason: 'end_turn', text: 'ok' });
    const last = sent.filter((e) => e.type === 'acp:usage').at(-1)!;
    assert.deepEqual(last.usage, { input: 150, output: 30, cacheRead: 110, cacheWrite: 0, thought: 0, total: 180 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the agent's final usage is what is recorded in the chat's saved run", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-usage-store-')));
  try {
    const chatId = ensureSessionsMigrated(root).activeId;
    const clock = new ManualClock();
    const rt = new AgentTurnRuntime({ clock, emit: () => {}, agentRef: 'claude', provider: 'claude', chatId, prompt: 'hello', nodeId: null, sessionsRoot: root, userConfigDir: root, detectAnswer: false });
    rt.finish('ended', { stopReason: 'end_turn', text: 'hi', usage: { input: 1000, output: 400, cacheRead: 700, cacheWrite: 0, thought: 0, total: 1400 } });
    const runs = readAgentRuns(root, chatId);
    assert.equal(runs.length, 1);
    assert.deepEqual(runs[0]!.usage, { input: 1000, output: 400, cacheRead: 700, cacheWrite: 0, thought: 0, total: 1400 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
