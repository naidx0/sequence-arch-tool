/* T4: an agent run keeps the repo paths its Read/Grep/find_files/map calls named, for the coverage line. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ManualClock } from '../../../acp/dist/replay/clock.js';
import { readAgentRuns } from '../server/agentChatStore.js';
import { AgentTurnRuntime } from '../server/agentTurnRuntime.js';
import { ensureSessionsMigrated } from '../server/sessionsStore.js';

const call = (sessionUpdate: string, toolCallId: string, extra: Record<string, unknown>) => ({ sessionId: 's', update: { sessionUpdate, toolCallId, ...extra } });

test('a run stores the repo-relative paths its read, search and map calls named; edits, commands and outside paths are not reads', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rp-')));
  try {
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    const chatId = ensureSessionsMigrated(dir).activeId;
    const rt = new AgentTurnRuntime({ clock: new ManualClock(), emit: () => {}, agentRef: 'claude', provider: 'claude', chatId, prompt: 'q', nodeId: null, sessionsRoot: dir, userConfigDir: dir, refine: { root: repo, auto: false }, detectAnswer: false });
    const abs = (p: string) => path.join(repo, p);
    rt.update(call('tool_call', 'c1', { kind: 'read', title: 'Read orders/a.ts', locations: [{ path: abs('orders/a.ts') }], rawInput: { file_path: abs('orders/a.ts') } }));
    rt.update(call('tool_call_update', 'c1', { status: 'completed' }));
    rt.update(call('tool_call', 'c2', { kind: 'read', title: 'Read orders/a.ts again', rawInput: { file_path: abs('orders/a.ts') } }));
    rt.update(call('tool_call', 'c3', { kind: 'search', title: 'Grep foo', rawInput: { pattern: 'foo', path: abs('billing') } }));
    rt.update(call('tool_call', 'c4', { kind: 'other', title: 'mcp__sequence__map', rawInput: { focus: 'svc:payments' } }));
    rt.update(call('tool_call', 'c5', { kind: 'edit', title: 'Edit web/x.ts', locations: [{ path: abs('web/x.ts') }] }));
    rt.update(call('tool_call', 'c6', { kind: 'execute', title: 'ls', rawInput: { command: 'ls inventory' } }));
    rt.update(call('tool_call', 'c7', { kind: 'read', title: 'Read /etc/hosts', locations: [{ path: '/etc/hosts' }] }));
    rt.finish('ended', { stopReason: 'end_turn', text: 'done' });
    const run = readAgentRuns(dir, chatId)[0]!;
    assert.deepEqual([...(run.readPaths ?? [])].sort(), ['billing', 'orders/a.ts', 'svc:payments']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a run with no reads stores no readPaths, and an old record has none', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rp0-')));
  try {
    const chatId = ensureSessionsMigrated(dir).activeId;
    const rt = new AgentTurnRuntime({ clock: new ManualClock(), emit: () => {}, agentRef: 'claude', provider: 'claude', chatId, prompt: 'q', nodeId: null, sessionsRoot: dir, userConfigDir: dir, refine: { root: dir, auto: false }, detectAnswer: false });
    rt.finish('ended', { stopReason: 'end_turn', text: 'hi' });
    assert.equal(readAgentRuns(dir, chatId)[0]!.readPaths, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
