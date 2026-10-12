import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { AgentEventHub } from '../server/agentEvents.js';
import { RunNodeEventFeed } from '../server/runNodeAgentEvents.js';

/* A run-node turn's ACP updates folded into the agent-event store. */

const ROOT = path.resolve('/repo');
const WT = path.resolve('/data/wt/abcd1234');

function feedOf() {
  const hub = new AgentEventHub({ getGraph: () => null, getRoot: () => ROOT, now: () => 1 });
  const feed = new RunNodeEventFeed({ sink: hub, sessionId: 'chat-1', source: 'acp', root: WT, title: 'fix it' });
  return { hub, feed, rows: () => hub.log().map((e) => [e.kind, e.status, e.tool ?? null, e.toolUseId ?? null, e.paths.join(',')]) };
}
const tool = (sessionUpdate: string, toolCallId: string, extra: Record<string, unknown> = {}) => ({ sessionId: 't', update: { sessionUpdate, toolCallId, ...extra } });

test('tool durations use their own start; empty-answer stop is failed and names its reason', () => {
  let now = 0;
  const hub = new AgentEventHub({ getGraph: () => null, getRoot: () => ROOT, now: () => now });
  const feed = new RunNodeEventFeed({ sink: hub, sessionId: 'timing', source: 'acp', root: ROOT, now: () => now });
  feed.start(); now = 10;
  feed.update(tool('tool_call', 'a', { kind: 'execute' }));
  now = 40_010;
  feed.update(tool('tool_call_update', 'a', { status: 'completed' }));
  feed.end(false, null, 'Ended without an answer (end_turn)');
  assert.equal(hub.log().find(e => e.kind === 'tool_end')!.durationMs, 40_000);
  assert.deepEqual([hub.log().at(-1)!.status, hub.log().at(-1)!.error], ['failed', 'Ended without an answer (end_turn)']);
});

test("a failed tool ends failed; paths are relative to the turn's worktree; other updates are not events", () => {
  const { hub, feed, rows } = feedOf();
  feed.start();
  feed.update(tool('tool_call', 'c1', { kind: 'edit', title: 'Edit a.ts', status: 'in_progress', locations: [{ path: path.join(WT, 'src', 'a.ts') }] }));
  feed.update({ sessionId: 't', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } } });
  feed.update(tool('tool_call_update', 'c1', { status: 'failed' }));
  feed.end(true);
  assert.deepEqual(rows(), [
    ['session_start', 'running', null, null, ''],
    ['tool_start', 'running', 'Edit', 'c1', 'src/a.ts'],
    ['tool_end', 'failed', 'Edit', 'c1', 'src/a.ts'],
    ['stop', 'done', null, null, ''],
  ]);
  assert.ok(hub.log().every((e) => e.sessionId === 'chat-1' && e.source === 'acp'));
});

test('a turn that fails closes its open tools failed, then stops failed; nothing after the end is recorded', () => {
  const { feed, rows } = feedOf();
  feed.start();
  feed.update(tool('tool_call', 'c1', { kind: 'execute', title: 'npm test' }));
  feed.end(false);
  feed.update(tool('tool_call', 'c2', { kind: 'read' }));
  assert.deepEqual(rows(), [
    ['session_start', 'running', null, null, ''],
    ['tool_start', 'running', 'Bash', 'c1', ''],
    ['tool_end', 'failed', 'Bash', 'c1', ''],
    ['stop', 'failed', null, null, ''],
  ]);
});
