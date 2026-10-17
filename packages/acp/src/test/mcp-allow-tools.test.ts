/**
 * A server's own vetted tools (REA's read-only set) are pre-approved in the claude session, nothing else is.
 * The options object is what session/new carries as `_meta.claudeCode.options`; reading it needs no process.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AcpClient } from '../client.js';

const options = (mcpServers: { name: string; command: string; args: string[]; allowTools?: string[] }[], accessMode: 'plan' | 'propose' = 'plan') =>
  (new AcpClient({ command: 'claude-agent-acp', cwd: process.cwd(), accessMode, mcpServers }) as unknown as { claudeOptions(): Record<string, unknown> | undefined }).claudeOptions();

test('a server naming its vetted tools gets exactly those in allowedTools', () => {
  const o = options([{ name: 'rea', command: 'node', args: ['rea.mjs', 'mcp'], allowTools: ['mcp__rea__open_binary', 'mcp__rea__inspect_artifact'] }]);
  assert.deepEqual(o?.allowedTools, ['mcp__rea__open_binary', 'mcp__rea__inspect_artifact']);
  assert.equal(o?.permissionMode, 'plan', 'the access mode is still there');
});

test('with the board server too, both are allowed; the board keeps its wildcard', () => {
  const o = options([
    { name: 'sequence', command: 'node', args: ['board.js'] },
    { name: 'rea', command: 'node', args: ['rea.mjs'], allowTools: ['mcp__rea__binary_session'] },
  ]);
  assert.deepEqual(o?.allowedTools, ['mcp__sequence__*', 'mcp__rea__binary_session']);
});

test('negative controls: a server with no allowTools adds nothing, and nothing configured adds no allowedTools at all', () => {
  assert.equal(options([{ name: 'rea', command: 'node', args: ['rea.mjs'] }])?.allowedTools, undefined);
  assert.equal(options([])?.allowedTools, undefined);
});
