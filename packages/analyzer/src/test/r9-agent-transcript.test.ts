import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ManualClock } from '@sequence/acp/dist/replay/clock.js';
import { replaySpawn } from '@sequence/acp/dist/replay/codexReplay.js';
import { persistAgentTranscript, readSessionChat, readSessionIndex, updateSession } from '../server/sessionsStore.js';
import { agentSpecimen, replayFixture, serveAgent, streamTurn } from './support/agentServer.js';

test('server can update the same assistant row, while a client cannot rewrite it', () => {
  const s = agentSpecimen({ id: 'codex', command: 'codex' });
  const row = { role: 'assistant', text: 'partial', at: '2026-10-07T10:00:00Z', agentTurn: { id: 't', agentRef: 'codex', state: 'running' as const } };
  persistAgentTranscript(s.root, s.chatId, row);
  const stale = readSessionChat(s.root, s.chatId);
  persistAgentTranscript(s.root, s.chatId, { ...row, text: 'complete', agentTurn: { ...row.agentTurn, state: 'ended' } });
  assert.equal(readSessionChat(s.root, s.chatId).turns[0]!.text, 'complete');
  updateSession(s.root, s.chatId, { chat: stale });
  assert.equal(readSessionChat(s.root, s.chatId).turns[0]!.text, 'complete');
});
