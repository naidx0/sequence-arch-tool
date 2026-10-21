import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AgentTree, type ChatLike } from './AgentsPanel.js';
import { createAgentStore } from './agentStream.js';
import type { AgentEvent } from './agentTypes.js';

/* The chat headers in the agents window: the run count is the number of runs
   listed under it. No agent, no server, no binary. */

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

describe('the chat headers in the agents window', () => {
  it('a chat that has not run yet says so: the count is the runs listed', () => {
    const store = createAgentStore(() => null);
    store.apply(ev({ kind: 'session_start', sessionId: 'a', status: 'running' }));
    store.apply(ev({ kind: 'session_start', sessionId: 'b', status: 'running' }));
    const chats = [{ id: 'a', title: 'Fix orders' }, { id: 'b', title: 'Refactor billing' }] as ChatLike[];
    render(<AgentTree state={store.get()} now={Date.now()} store={store} sessions={chats} />);
    const metas = screen.getAllByTestId('agents-chat-meta').map((m) => m.textContent);
    /* Both chats have an open agent session and no run at all: the header
       says "0 runs", never "1 run" for a chat that has not run. */
    expect(metas).toEqual(['0 runs, running', '0 runs, running']);
  });

  it('a chat with one run says one run', () => {
    const store = createAgentStore(() => null);
    store.apply(ev({ kind: 'session_start', sessionId: 'a', status: 'running' }));
    store.apply(ev({ kind: 'session_start', sessionId: 'b', status: 'running' }));
    store.apply(ev({ kind: 'tool_start', sessionId: 'a', tool: 'Read', toolKind: 'read', toolUseId: 'r', status: 'running', title: 'Read a.ts' }));
    store.apply(ev({ kind: 'tool_end', sessionId: 'a', tool: 'Read', toolKind: 'read', toolUseId: 'r', title: 'Read a.ts' }));
    store.apply(ev({ kind: 'stop', sessionId: 'a' }));
    const chats = [{ id: 'a', title: 'Fix orders' }, { id: 'b', title: 'Refactor billing' }] as ChatLike[];
    render(<AgentTree state={store.get()} now={Date.now()} store={store} sessions={chats} />);
    const metas = screen.getAllByTestId('agents-chat-meta').map((m) => m.textContent);
    expect(metas).toContain('1 run, idle');
  });
});
