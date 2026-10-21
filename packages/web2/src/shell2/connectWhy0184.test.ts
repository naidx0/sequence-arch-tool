/* ══════════════════════════════════════════════════════════════════════════
   0.1.8.4: A REFUSED CONNECT SAYS WHY IN ITS OWN SENTENCE
   packages/web2/src/shell2/connectWhy0184.test.ts

   Driving the stub-CLI build, Connect on a Codex that was on PATH but not whole drew "Could not connect Codex." and
   nothing else; the reason (found the command, not the program it starts) was behind Details, paths and all. The
   sentence now carries the reason when it is short and path-free, and says what kind of refusal it was when it is not.
   ══════════════════════════════════════════════════════════════════════════ */

import { describe, expect, it } from 'vitest';

import { connectWhy } from './ConnectAgents';

describe('connectWhy', () => {
  it('a short, path-free reason is in the sentence, and the agent name is not said twice', () => {
    expect(connectWhy('Codex', 'Codex is not installed', 'install')).toBe('Could not connect Codex: it is not installed.');
    expect(connectWhy('Claude Code', 'Claude Code needs its bridge, claude-agent-acp (npm install -g claude-agent-acp)', 'adapter')).toBe('Could not connect Claude Code: it needs its bridge, claude-agent-acp (npm install -g claude-agent-acp).');
  });

  it('a reason with a program path stays behind Details, and the sentence says the kind of refusal', () => {
    const e = 'found C:\\Users\\a\\bin\\codex.cmd but not the package it starts (C:\\Users\\a\\bin\\node_modules\\@openai\\codex\\bin\\codex.js)';
    expect(connectWhy('Codex', e, 'install')).toBe('Could not connect Codex: Sequence found it but could not start it. Details has what the server saw.');
    expect(connectWhy('Codex', '/usr/local/bin/codex: not found', 'unknown')).toBe('Could not connect Codex.');
  });

  it('no reason at all is the plain sentence, never an invented cause', () => {
    expect(connectWhy('Codex', undefined, undefined)).toBe('Could not connect Codex.');
    expect(connectWhy('Codex', '   ', 'unknown')).toBe('Could not connect Codex.');
    expect(connectWhy('Codex', 'x'.repeat(200), undefined)).toBe('Could not connect Codex.');
  });
});
