import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/* The board reuses the agent strip's data (agents/agentActivity.ts): the chip
   on a touched box says the agent's doing line, and the board's status line
   carries the chat's todo count while its agent works. One test per use. */
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AgentLights, chipFor } from './AgentOverlay';
import { agentActivity } from '../agents/agentActivity';
import type { AgentRun, AgentRunStore, AgentRunsState } from '../agents/agentRuns';
import { createAgentStore } from '../agents/agentStream';
import type { AgentEvent, AgentNode } from '../agents/agentTypes';

afterEach(() => {
  document.body.innerHTML = '';
});

function run(over: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'r1',
    sessionId: 'chat-1',
    agentRef: 'codex',
    nodeId: null,
    nodeLabel: null,
    prompt: 'add ping',
    status: 'running',
    startedAt: 1,
    endedAt: null,
    items: [
      { kind: 'plan', id: 'p', startedAt: 1, endedAt: null, entries: [
        { content: 'Read the routes', status: 'completed' },
        { content: 'Add ping', status: 'in_progress' },
        { content: 'Write a note', status: 'pending' },
      ] },
      { kind: 'tool', id: 't', title: 'Edit main.py', toolKind: 'edit', status: 'running', startedAt: 2, endedAt: null, changes: [], diffs: [], output: null },
    ],
    approvals: [],
    error: null,
    ...over,
  } as AgentRun;
}
const state = (runs: AgentRun[]): AgentRunsState => ({ runs, dismissed: new Set(), agents: { 'chat-1': 'codex' } });

/** A run store that only answers get/subscribe, which is all the overlay reads. */
function runsStore(initial: AgentRunsState): AgentRunStore & { set: (s: AgentRunsState) => void } {
  let s = initial;
  const subs = new Set<() => void>();
  return {
    get: () => s,
    subscribe: (fn: () => void) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    set: (next: AgentRunsState) => {
      s = next;
      for (const fn of subs) fn();
    },
  } as unknown as AgentRunStore & { set: (s: AgentRunsState) => void };
}

describe('the agent chip on a touched box says the doing line', () => {
  it('uses the chat agent strip words, and the call kind without them', () => {
    const doing = agentActivity(state([run()]), 'chat-1')!.doing;
    expect(doing).toBe('Editing files');
    const nodes = new Map<string, AgentNode>([['s', { id: 's', kind: 'session' } as AgentNode]]);
    const call = { id: 'c', kind: 'tool_call', parentId: 's', stepKind: 'edit', locations: [{ path: 'orders/app/main.py', fileNodeId: 'f', moduleId: null, serviceId: 'svc:orders', serviceLabel: 'orders', touchedEdgeIds: [], liftedEdges: [] }] } as unknown as AgentNode;
    expect(chipFor(call, nodes, 'svc:orders', doing)).toBe('Main agent: Editing files, main.py');
    expect(chipFor(call, nodes, 'svc:orders')).toBe('Main agent: editing main.py');
    /* No "·" separators (Decision 49). */
    expect(chipFor(call, nodes, 'svc:orders', doing)).not.toContain('\u00b7');
  });
});

describe('the board carries no agent status line (Decision 49: the status bar owns it)', () => {
  it('writes no status on the board root while a run runs', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<div data-testid="board" class="board-scope board"><div data-testid="board-node" data-node-id="svc:orders" class="node"></div></div>';
    document.body.appendChild(root);
    const runs = runsStore(state([run()]));
    render(<AgentLights store={createAgentStore(() => null)} sessionId="chat-1" runs={runs} delayMs={0} />);
    /* The activity module loads with the overlay: wait for it, not for time. */
    await act(async () => {
      await import('../chat/agentComposer.js');
    });
    const board = root.querySelector('[data-testid="board"]')!;
    expect(agentActivity(state([run()]), 'chat-1')!.running).toBe(true);
    expect(board.hasAttribute('data-agent-status')).toBe(false);
    const css = readFileSync(resolve(__dirname, 'board.css'), 'utf8');
    expect(css).not.toMatch(/data-agent-status/);
  });
});

/* Keep the event type import honest for the chip test above (a hook event's
   board hits are what a call's locations are built from). */
export type _E = AgentEvent;
