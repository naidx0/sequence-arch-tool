/* T4: Codex tool shapes, kind-only matching, and the chat's worktree as the root of the paths. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ManualClock } from '../../../acp/dist/replay/clock.js';
import { readAgentRuns } from '../server/agentChatStore.js';
import { AgentTurnRuntime } from '../server/agentTurnRuntime.js';
import { readPathsOf } from '../server/agentReadPaths.js';
import { ensureSessionsMigrated } from '../server/sessionsStore.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(os.tmpdir(), 'rp-codex-root');
const abs = (...p: string[]) => path.join(ROOT, ...p);

test('an edit is not a read, whatever its title says; matching is by tool kind', () => {
  assert.deepEqual(readPathsOf({ kind: 'edit', title: 'Edit sitemap.map', locations: [{ path: abs('z', 'x.ts') }] }, ROOT), []);
  assert.deepEqual(readPathsOf({ kind: 'execute', title: 'Run map', rawInput: { path: abs('a.ts') } }, ROOT), []);
  assert.deepEqual(readPathsOf({ kind: 'other', title: 'Format map.ts', rawInput: { path: abs('a.ts') } }, ROOT), []);
  assert.deepEqual(readPathsOf({ kind: 'read', title: 'Read a.ts', rawInput: { file_path: abs('a.ts') } }, ROOT), ['a.ts']);
});

test('Codex: a commandExecution counts only what its own commandActions say it read, searched or listed; the command string is never parsed', () => {
  const item = (commandActions: unknown[], cwd = ROOT) => ({
    sessionUpdate: 'tool_call',
    kind: 'execute',
    title: 'Run rg -n foo orders',
    rawInput: { type: 'commandExecution', command: 'rg -n foo orders', cwd, commandActions },
  });
  assert.deepEqual(readPathsOf(item([{ type: 'search', command: 'rg -n foo orders', query: 'foo', path: 'orders' }]), ROOT), ['orders']);
  assert.deepEqual(readPathsOf(item([{ type: 'read', command: 'cat orders/a.ts', name: 'a.ts', path: abs('orders', 'a.ts') }]), ROOT), ['orders/a.ts']);
  assert.deepEqual(readPathsOf(item([{ type: 'listFiles', command: 'ls billing', path: 'billing' }]), ROOT), ['billing']);
  /* the real recorded fixture: a command Codex could not classify */
  const fixture = path.resolve(here, '..', '..', '..', 'acp', 'src', 'test', 'fixtures', 'replay', 'codex', 'command-approval.jsonl');
  const recorded = fs.readFileSync(fixture, 'utf8').split('\n').filter((l) => l.includes('"item/started"') && l.includes('commandExecution'))[0]!;
  const real = JSON.parse(recorded).msg.params.item as Record<string, unknown>;
  assert.deepEqual(readPathsOf({ sessionUpdate: 'tool_call', kind: 'execute', title: `Run ${String(real.command)}`, rawInput: real }, ROOT), []);
  /* a command with no actions, and a path that leaves the repo */
  assert.deepEqual(readPathsOf(item([]), ROOT), []);
  assert.deepEqual(readPathsOf(item([{ type: 'read', command: 'cat ../x', path: '../x' }]), ROOT), []);
});

test('Codex MCP: the Sequence map and find_files name a service or a path in rawInput.arguments; a query names nothing', () => {
  const mcp = (tool: string, args: Record<string, unknown>, kind = 'read') => ({
    sessionUpdate: 'tool_call',
    kind,
    title: `sequence.${tool}`,
    rawInput: { type: 'mcpToolCall', server: 'sequence', tool, arguments: args },
  });
  assert.deepEqual(readPathsOf(mcp('map', { budget: 1000, focus: 'svc:orders' }), ROOT), ['svc:orders']);
  assert.deepEqual(readPathsOf(mcp('find_files', { query: 'where is checkout', path: 'web' }, 'other'), ROOT), ['web']);
  assert.deepEqual(readPathsOf(mcp('find_files', { query: 'where is checkout' }), ROOT), []);
  assert.deepEqual(readPathsOf({ sessionUpdate: 'tool_call', kind: 'read', title: 'other.lookup', rawInput: { type: 'mcpToolCall', arguments: { path: 'web' } } }, ROOT), []);
});

test("in a chat's worktree the paths are relative to the worktree, not the repo", () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rp-wt-')));
  try {
    const wt = path.join(dir, 'wt');
    const chatId = ensureSessionsMigrated(dir).activeId;
    const rt = new AgentTurnRuntime({
      clock: new ManualClock(),
      emit: () => {},
      agentRef: 'claude',
      provider: 'claude',
      chatId,
      prompt: 'q',
      nodeId: null,
      sessionsRoot: dir,
      userConfigDir: dir,
      refine: { root: path.join(dir, 'repo'), auto: false },
      pathRoot: wt,
      detectAnswer: false,
    });
    rt.update({ sessionId: 's', update: { sessionUpdate: 'tool_call', toolCallId: 'c1', kind: 'read', title: 'Read', locations: [{ path: path.join(wt, 'orders', 'a.ts') }] } });
    rt.finish('ended', { stopReason: 'end_turn', text: 'done' });
    assert.deepEqual(readAgentRuns(dir, chatId)[0]!.readPaths, ['orders/a.ts']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
