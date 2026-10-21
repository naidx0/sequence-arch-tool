import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AgentsPanel } from './AgentsPanel.js';
import { createAgentStore } from './agentStream.js';
import type { AgentEvent } from './agentTypes.js';

/* The agents window: the trace of a turn says what the turn is doing now,
   and what it did. No agent, no server, no binary. */

let seq = 0;
const ev = (e: Partial<AgentEvent> & Pick<AgentEvent, 'kind'>): AgentEvent => ({
  id: `e${++seq}`,
  at: 1000 + seq * 100,
  source: 'acp',
  sessionId: 'chat',
  paths: [],
  status: 'done',
  ...e,
});

describe('the trace in the agents window', () => {
  it('a running turn names the step in flight', () => {
    const store = createAgentStore(() => null);
    store.apply(ev({ kind: 'session_start', status: 'running' }));
    store.apply(ev({ kind: 'tool_start', tool: 'Read', toolKind: 'read', toolUseId: 'a', status: 'running', title: 'Read a.ts', paths: ['a.ts'] }));
    render(<AgentsPanel store={store} />);
    const status = screen.getByTestId('agents-trace-status');
    expect(status.textContent).toBe('Reading a.ts');
    expect(status.getAttribute('data-kind')).toBe('step');
  });

  it('a turn that is working but has no step open says so', () => {
    const store = createAgentStore(() => null);
    store.apply(ev({ kind: 'tool_start', tool: 'Read', toolKind: 'read', toolUseId: 'a', status: 'running', title: 'Read a.ts' }));
    store.apply(ev({ kind: 'tool_end', tool: 'Read', toolKind: 'read', toolUseId: 'a', title: 'Read a.ts' }));
    render(<AgentsPanel store={store} />);
    const status = screen.getByTestId('agents-trace-status');
    expect(status.textContent).toBe('Working on it');
    expect(status.getAttribute('data-kind')).toBe('working');
  });

  it('a finished turn names what it did, counted from its own steps', () => {
    const store = createAgentStore(() => null);
    for (const e of [
      ev({ kind: 'tool_start', tool: 'Grep', toolKind: 'search', toolUseId: 'a', status: 'running', title: 'Grep foo' }),
      ev({ kind: 'tool_end', tool: 'Grep', toolKind: 'search', toolUseId: 'a', title: 'Grep foo' }),
      ev({ kind: 'tool_start', tool: 'Read', toolKind: 'read', toolUseId: 'b', status: 'running', title: 'Read a.ts' }),
      ev({ kind: 'tool_end', tool: 'Read', toolKind: 'read', toolUseId: 'b', title: 'Read a.ts' }),
      ev({ kind: 'tool_start', tool: 'Bash', toolKind: 'execute', toolUseId: 'c', status: 'running', title: 'Bash: pnpm test' }),
      ev({ kind: 'tool_end', tool: 'Bash', toolKind: 'execute', toolUseId: 'c', title: 'Bash: pnpm test' }),
      ev({ kind: 'stop' }),
    ])
      store.apply(e);
    render(<AgentsPanel store={store} />);
    const status = screen.getByTestId('agents-trace-status');
    expect(status.textContent).toBe('searched 1 time, read 1 file, ran 1 command');
    expect(status.getAttribute('data-kind')).toBe('done');
  });
});
