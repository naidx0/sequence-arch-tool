import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { describe, expect, it } from 'vitest';

import { AgentRunsList } from '../chat/AgentRunThread';
import { runCallbacks } from '../chat/AgentRunsPane';
import { createStore } from '../state';
import { createAgentRunStore, type AgentRunStore } from './agentRuns';
import { CONTINUE_PROMPT, fromSavedRun } from './savedRuns';

/* T3 gap G10: a turn the app's restart cut off comes back with one Continue,
   which resumes the chat's agent thread and sends "Continue where you left off." */

const cut = (over: Record<string, unknown> = {}) => ({ id: 't1', agentRef: 'claude', prompt: 'refactor the parser', text: 'Reading', status: 'interrupted', continuable: true, startedAt: 1, endedAt: 2, tools: [], ...over });

function Runs({ store }: { store: AgentRunStore }) {
  const st = useSyncExternalStore(store.subscribe, store.get, store.get);
  const cb = runCallbacks(store, createStore({}));
  return <AgentRunsList runs={st.runs} repoRoot={null} onAnswer={() => {}} onRetry={cb.onRetry} />;
}

describe('an interrupted turn', () => {
  it('reads back as a failed run that can be continued; an older one cannot', () => {
    const run = fromSavedRun(cut(), 'chat-1')!;
    expect(run.interrupted).toBe(true);
    expect(run.status).toBe('failed');
    expect(run.retry).toMatchObject({ agentRef: 'claude', sessionId: 'chat-1', question: CONTINUE_PROMPT });
    expect(fromSavedRun(cut({ continuable: undefined }), 'chat-1')!.retry).toBeUndefined();
  });

  it('a canvas-node turn continues on the same node', () => {
    expect(fromSavedRun(cut({ nodeId: 'node:auth' }), 'chat-1')!.retry).toMatchObject({ nodeId: 'node:auth', question: CONTINUE_PROMPT });
  });

  it('a turn still running on the server reads as running, not as a finished answer', () => {
    const run = fromSavedRun(cut({ status: 'running', continuable: undefined }), 'chat-1')!;
    expect([run.status, run.endedAt, run.interrupted, run.retry]).toEqual(['running', null, undefined, undefined]);
  });

  it('shows Continue; one click starts a turn that sends the continue prompt, then Continue is gone', async () => {
    const bodies: Record<string, unknown>[] = [];
    const enc = new TextEncoder();
    const f = async (input: string, init?: RequestInit): Promise<Response> => {
      if (input.startsWith('/api/acp/run-node')) {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        const events = [{ type: 'acp:update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Picking up.' } } }, { type: 'acp:result', stopReason: 'end_turn', text: 'Picking up.' }];
        const body = new ReadableStream<Uint8Array>({ start(c) { for (const e of events) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); c.close(); } });
        return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      return new Response(JSON.stringify({ agents: [{ id: 'claude' }] }), { status: 200 });
    };
    const store = createAgentRunStore({ clock: () => 1000, fetch: f });
    store.hydrate('chat-1', [fromSavedRun(cut(), 'chat-1')!]);
    render(<Runs store={store} />);
    const card = screen.getByTestId('agent-recovery');
    expect(within(card).getByTestId('agent-recovery-why').textContent).toBe('Claude was interrupted by a restart.');
    expect(within(card).queryByTestId('agent-recovery-details')).toBeNull();
    await act(async () => {
      fireEvent.click(within(card).getByTestId('agent-recovery-continue'));
    });
    await waitFor(() => expect(store.get().runs.at(-1)?.status).toBe('done'));
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ agentRef: 'claude', chatId: 'chat-1' });
    expect(JSON.stringify(bodies[0])).toContain(CONTINUE_PROMPT);
    expect(screen.queryAllByTestId('agent-recovery-continue')).toHaveLength(0);
    expect(within(card).getByTestId('agent-recovery-retried').textContent).toBe('Continuing below');
  });

  it('an older cut-off turn says so and offers nothing', () => {
    const store = createAgentRunStore({ clock: () => 1000 });
    store.hydrate('chat-1', [fromSavedRun(cut({ continuable: undefined }), 'chat-1')!]);
    render(<Runs store={store} />);
    expect(screen.getByTestId('agent-recovery-why').textContent).toBe('Interrupted by a restart.');
    expect(screen.queryByTestId('agent-recovery-continue')).toBeNull();
  });
});
