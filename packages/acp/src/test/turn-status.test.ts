/**
 * ROUND 9: A TURN IS ANSWERED WHEN THE AGENT HAS SAID ITS PIECE, AND A
 * STALL IS NEVER SILENT. Pure pieces on a ManualClock; nothing sleeps, no
 * agent binary runs.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ManualClock } from '../replay/clock.js';
import { ANSWER_QUIET_AFTER_COST_MS, ANSWER_QUIET_MS, QUIET_AFTER_MS, TurnAnswerDetector, TurnLog, TurnStatusTracker, tickStatus } from '../turnStatus.js';

const text = (t: string) => ({ sessionId: 's', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } } });
const tool = (id: string, status = 'in_progress', kind = 'execute', title = 'npm test') => ({ sessionId: 's', update: { sessionUpdate: 'tool_call', toolCallId: id, status, kind, title } });
const toolEnd = (id: string, status = 'completed') => ({ sessionId: 's', update: { sessionUpdate: 'tool_call_update', toolCallId: id, status } });
const usage = (cost?: unknown) => ({ sessionId: 's', update: { sessionUpdate: 'usage_update', used: 10, size: 100, ...(cost !== undefined ? { cost } : {}) } });

test('answered: the agent wrote, no tool is open, and it went quiet (the bridge still holds the turn)', () => {
  const clock = new ManualClock();
  let answered = 0;
  const d = new TurnAnswerDetector({ clock, onAnswered: () => answered++ });
  d.update(tool('t1'));
  d.update(toolEnd('t1'));
  d.update(text('Done: the tests pass.'));
  clock.advance(ANSWER_QUIET_MS - 1);
  assert.equal(answered, 0);
  clock.advance(1);
  assert.equal(answered, 1);
  assert.equal(d.answered, true);
  /* Once only, whatever the background helpers do after. */
  d.update(text('more'));
  clock.advance(ANSWER_QUIET_MS * 2);
  assert.equal(answered, 1);
});

test('answered: the cost report shortens the wait', () => {
  const clock = new ManualClock();
  let answered = 0;
  const d = new TurnAnswerDetector({ clock, onAnswered: () => answered++ });
  d.update(text('Here is the answer.'));
  d.update(usage({ amount: 0.02, currency: 'USD' }));
  clock.advance(ANSWER_QUIET_AFTER_COST_MS);
  assert.equal(answered, 1);
});

test('not answered: words before a tool call, a tool still running, or a question waiting', () => {
  const clock = new ManualClock();
  let answered = 0;
  const d = new TurnAnswerDetector({ clock, onAnswered: () => answered++ });
  d.update(text('Let me run the tests.'));
  d.update(tool('t1'));
  clock.advance(ANSWER_QUIET_MS * 10);
  assert.equal(answered, 0, 'a running tool is work, not an answer');
  d.update(toolEnd('t1'));
  clock.advance(ANSWER_QUIET_MS * 10);
  assert.equal(answered, 0, 'no words after the tool: the agent has not answered yet');
  d.update(text('All green.'));
  const resume = d.pause();
  clock.advance(ANSWER_QUIET_MS * 10);
  assert.equal(answered, 0, 'paused while a person is asked');
  resume();
  clock.advance(ANSWER_QUIET_MS);
  assert.equal(answered, 1);
});

test('not answered: the turn ended first (stop disarms it)', () => {
  const clock = new ManualClock();
  let answered = 0;
  const d = new TurnAnswerDetector({ clock, onAnswered: () => answered++ });
  d.update(text('hi'));
  d.stop();
  clock.advance(ANSWER_QUIET_MS * 2);
  assert.equal(answered, 0);
  assert.equal(clock.pending, 0);
});

test('status: queued, waiting, a tool for N s, quiet, answered', () => {
  const clock = new ManualClock(1_000);
  const s = new TurnStatusTracker({ clock, queued: true });
  assert.equal(s.snapshot().phase, 'queued');
  clock.advance(4_000);
  assert.equal(s.snapshot().forMs, 4_000);
  s.started();
  s.sent();
  assert.equal(s.snapshot().phase, 'waiting');
  s.update(tool('t1', 'in_progress', 'execute', 'pnpm build'));
  clock.advance(12_000);
  const t = s.snapshot();
  assert.equal(t.phase, 'tool');
  assert.equal(t.forMs, 12_000);
  assert.deepEqual(t.tool, { kind: 'execute', title: 'pnpm build' });
  assert.equal(t.openTools, 1);
  s.update(toolEnd('t1'));
  s.update(text('ok'));
  assert.equal(s.snapshot().phase, 'writing');
  clock.advance(QUIET_AFTER_MS);
  const q = s.snapshot();
  assert.equal(q.phase, 'quiet');
  assert.equal(q.quietMs, QUIET_AFTER_MS);
  s.answered();
  assert.equal(s.snapshot().phase, 'answered');
});

test('status: a question to the person is its own phase', () => {
  const clock = new ManualClock();
  const s = new TurnStatusTracker({ clock });
  s.sent();
  const done = s.asked();
  clock.advance(QUIET_AFTER_MS * 3);
  assert.equal(s.snapshot().phase, 'approval');
  done();
  assert.equal(s.snapshot().phase, 'waiting');
});

test('tickStatus emits on its interval and stops cleanly', () => {
  const clock = new ManualClock();
  const s = new TurnStatusTracker({ clock });
  const seen: string[] = [];
  const stop = tickStatus(s, clock, (x) => seen.push(x.phase), 5_000);
  clock.advance(15_000);
  assert.equal(seen.length, 3);
  stop();
  clock.advance(15_000);
  assert.equal(seen.length, 3);
  assert.equal(clock.pending, 0);
});

test('turn log: phases and tool kinds, never the words or a tool title', () => {
  const clock = new ManualClock(5_000);
  const log = new TurnLog({ turnId: 't', chatId: 'c', agentRef: 'claude', provider: 'claude' }, clock);
  log.add('queued');
  clock.advance(100);
  log.add('started');
  log.update(text('secret words in the chat'));
  log.update(tool('t1', 'in_progress', 'execute', 'cat ~/.ssh/id_rsa'));
  log.update(toolEnd('t1'));
  log.add('approval', { decision: 'allow' });
  clock.advance(900);
  const rec = log.finish('ended', { stopReason: 'end_turn' });
  assert.equal(rec.ms, 1_000);
  assert.equal(rec.outcome, 'ended');
  assert.equal(rec.tools, 1);
  assert.equal(rec.approvals, 1);
  assert.equal(rec.updates, 3);
  const json = JSON.stringify(rec);
  assert.ok(!json.includes('secret words'), 'no message text in the log');
  assert.ok(!json.includes('id_rsa'), 'no tool title in the log');
  assert.deepEqual(
    rec.entries.map((e) => e.ev),
    ['queued', 'started', 'tool', 'tool-end', 'approval'],
  );
});
