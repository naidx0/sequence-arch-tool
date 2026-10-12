import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ManualClock } from '@sequence/acp/dist/replay/clock.js';
import { replaySpawn } from '@sequence/acp/dist/replay/codexReplay.js';
import { AgentTurnActivity, safeAgentFailure, usageTokens, writeAgentDiagnostic } from '../server/agentTurnActivity.js';
import { readSessionChat } from '../server/sessionsStore.js';
import { agentSpecimen, replayFixture, serveAgent, streamTurn } from './support/agentServer.js';

test('heartbeat reasons and silence thresholds follow real events; long approvals never mark the turn hung', () => {
  const s = agentSpecimen({ id: 'codex', command: 'codex' }), clock = new ManualClock();
  const events: Record<string, unknown>[] = [];
  const activity = new AgentTurnActivity({ dir: s.store, id: 'metadata-only', clock, emit: e => events.push(e) });
  activity.queue(); assert.equal(events.at(-1)!.reason, 'queued');
  clock.advance(50_000); assert.equal(events.at(-1)!.stalled, false);
  activity.active();
  activity.update({ update: { sessionUpdate: 'tool_call', toolCallId: 'private tool', kind: 'execute', title: 'secret=PRIVATE' } });
  clock.advance(30_000); assert.equal(events.at(-1)!.stalled, false);
  clock.advance(10_000); assert.deepEqual([events.at(-1)!.reason, events.at(-1)!.toolMs, events.at(-1)!.stalled], ['tool', 40_000, true]);
  activity.permission(true); clock.advance(60_000); assert.equal(events.at(-1)!.reason, 'approval'); assert.equal(events.at(-1)!.stalled, false);
  activity.permission(false);
  activity.update({ update: { sessionUpdate: 'tool_call_update', toolCallId: 'private tool', status: 'completed', rawOutput: 'PRIVATE' } });
  clock.advance(10_000); assert.equal(events.at(-1)!.reason, 'quiet'); assert.equal(events.at(-1)!.stalled, false);
  activity.diagnostic({ event: 'stderr', bytes: 12 }); activity.diagnostic({ event: 'processExit', exitCode: 7 });
  activity.end('error'); assert.equal(clock.pending, 0);
  const file = fs.readdirSync(path.join(s.store, 'logs')).find(f => f.endsWith('.jsonl'))!;
  const log = fs.readFileSync(path.join(s.store, 'logs', file), 'utf8');
  assert.ok(log.includes('"exitCode":7')); assert.ok(log.includes('"bytes":12'));
  assert.ok(!log.includes('PRIVATE')); assert.ok(!log.includes('private tool'));
});

test('failure redaction keeps useful prose and removes credential forms', () => {
  assert.equal(safeAgentFailure(new Error('module missing; token=PRIVATE; password=PRIVATE; Bearer PRIVATE; sk-privateToken')), 'module missing; token=[redacted]; password=[redacted]; [redacted]; [redacted]');
});

test('missing cache usage remains unavailable; zero is retained only when reported', () => {
  assert.deepEqual(usageTokens({ inputTokens: 5, outputTokens: 2 }, 'turn'), { inputTokens: 5, outputTokens: 2, cachedReadTokens: null, cachedWriteTokens: null, scope: 'turn' });
  assert.equal(usageTokens({ inputTokens: 5, outputTokens: 2, cachedReadTokens: 0 }, 'turn')!.cachedReadTokens, 0);
});

test('delta diagnostics aggregate at heartbeat/terminal and only literal metadata fields reach disk', () => {
  const s = agentSpecimen({ id: 'codex', command: 'codex' }), clock = new ManualClock();
  const a = new AgentTurnActivity({ dir: s.store, id: 'metadata-only', clock, emit: () => {} });
  for (let i = 0; i < 1000; i++) a.update({ update: { sessionUpdate: 'agent_message_chunk', content: { text: 'PRIVATE' } } });
  const file = path.join(s.store, 'logs', fs.readdirSync(path.join(s.store, 'logs'))[0]!);
  assert.equal(fs.readFileSync(file, 'utf8').trim().split('\n').length, 1, 'no disk append per token');
  a.end('ended');
  writeAgentDiagnostic(s.store, { event: 'waiting', reason: 'PRIVATE', prompt: 'PRIVATE', stderr: 'PRIVATE', frames: { agent_message_chunk: 1000, PRIVATE: 99 }, exitCode: 7 });
  const log = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(log, /PRIVATE/); assert.match(log, /"agent_message_chunk":1000/); assert.match(log, /"exitCode":7/);
});
