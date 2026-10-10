import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentRunsList, useAgentRuns } from '../chat/AgentRunThread';
import { AgentToasts } from '../chat/AgentToasts';
import { createAgentRunStore, type AgentRunStore } from './agentRuns';
import { AskAgentMenuItem, DEFAULT_NODE_QUESTION, HANDED_OFF_NOTE } from './askAgent.js';
import { askAgentAboutNode } from './askAgentRun';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A run-node event stream the test writes to as the "server". */
function sseStub() {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
  });
  const enc = new TextEncoder();
  return {
    response: () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    push: (e: unknown) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)),
    end: () => ctrl.close(),
  };
}

const sseOf = (...events: unknown[]) => {
  const s = sseStub();
  for (const e of events) s.push(e);
  s.end();
  return s.response();
};

/** The chat side of a run: its cards and its toasts, reading one store. */
function ChatSide({ runs }: { runs: AgentRunStore }) {
  const state = useAgentRuns(runs);
  return (
    <div data-testid="chat-side">
      <AgentRunsList runs={state.runs} repoRoot={null} onAnswer={(r, q, d) => void runs.answer(r, q, d)} />
      <AgentToasts store={runs} repoRoot={null} />
    </div>
  );
}

describe('Ask an agent about this', () => {
  it('runs the first registered agent streamed and interactive, in the mode acpPermissionModeFor gives', async () => {
    const calls: { url: string; body?: Record<string, unknown> }[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return url === '/api/acp/agents'
        ? json({ agents: [{ id: 'claude' }, { id: 'codex' }] })
        : sseOf({ type: 'acp:result', stopReason: 'end_turn', text: 'payments is used by…' });
    });
    const r = await askAgentAboutNode({ nodeId: 'svc:payments' }, f);
    expect(r).toEqual({ ok: true, text: 'payments is used by…' });
    expect(calls[1]).toEqual({
      url: '/api/acp/run-node?stream=1',
      body: {
        agentRef: 'claude',
        prompt: DEFAULT_NODE_QUESTION,
        contextNodeId: 'svc:payments',
        permissionMode: 'propose',
        sessionKey: 'ask-node::svc:payments::claude',
        interactivePermissions: true,
      },
    });
    /* Plan intent and Auto-edit access go through the same map the composer uses. */
    await askAgentAboutNode({ nodeId: 'n', agentRef: 'a', intent: 'plan', access: 'full' }, f);
    expect(calls[2].body?.permissionMode).toBe('plan');
    await askAgentAboutNode({ nodeId: 'n', agentRef: 'a', access: 'autoEdit' }, f);
    expect(calls[3].body?.permissionMode).toBe('autoEdit');
  });

  it('says so when no agent is registered, and passes the server refusal through', async () => {
    expect((await askAgentAboutNode({ nodeId: 'n' }, async () => json({ agents: [] }))).ok).toBe(false);
    const refused = await askAgentAboutNode({ nodeId: 'svc:nope', agentRef: 'x' }, async () => json({ error: '"contextNodeId" svc:nope is not a node' }, 400));
    expect(refused).toEqual({ ok: false, text: '"contextNodeId" svc:nope is not a node' });
  });

  it('the menu row hands the run to chat and answers at once, so the menu can close', async () => {
    const s = sseStub();
    const f = vi.fn(async (url: string) => (url === '/api/acp/agents' ? json({ agents: [{ id: 'codex' }] }) : s.response()));
    const runs = createAgentRunStore({ fetch: f });
    const onDone = vi.fn();
    render(<AskAgentMenuItem nodeId="svc:orders" nodeLabel="orders" access="autoEdit" onDone={onDone} fetchImpl={f} runs={runs} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ask an agent about this' }));
    /* Synchronously: before the agent has said a word. */
    expect(onDone).toHaveBeenCalledWith({ ok: true, text: HANDED_OFF_NOTE, handedOff: true });
    expect(runs.get().runs).toHaveLength(1);
    expect(runs.get().runs[0]).toMatchObject({ nodeId: 'svc:orders', nodeLabel: 'orders', status: 'running' });
    await waitFor(() => expect(f.mock.calls.some(([u]) => String(u).startsWith('/api/acp/run-node'))).toBe(true));
    const run = f.mock.calls.find(([u]) => String(u).startsWith('/api/acp/run-node')) as unknown as [string, RequestInit];
    expect(JSON.parse(String(run[1].body))).toMatchObject({ contextNodeId: 'svc:orders', permissionMode: 'autoEdit', interactivePermissions: true });
    /* No approval card is drawn in the menu any more. */
    expect(screen.queryByTestId('chat-edit-approval')).toBeNull();
    await act(async () => {
      s.push({ type: 'acp:result', stopReason: 'end_turn', text: 'done' });
      s.end();
    });
    await waitFor(() => expect(runs.get().runs[0].status).toBe('done'));
  });

  it('an approval shows in chat AND as a toast; Deny on the toast settles both', async () => {
    const s = sseStub();
    const answers: unknown[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/acp/agents') return json({ agents: [{ id: 'codex' }] });
      if (url === '/api/acp/permission') {
        answers.push(JSON.parse(String(init?.body)));
        return json({ ok: true });
      }
      return s.response();
    });
    const runs = createAgentRunStore({ fetch: f });
    render(
      <>
        <AskAgentMenuItem nodeId="svc:orders" fetchImpl={f} runs={runs} />
        <ChatSide runs={runs} />
      </>,
    );
    fireEvent.click(screen.getByRole('menuitem'));
    await waitFor(() => expect(f.mock.calls.some(([u]) => String(u).startsWith('/api/acp/run-node'))).toBe(true));
    await act(async () =>
      s.push({
        type: 'acp:permission',
        requestId: 'req-7',
        pending: true,
        decision: null,
        toolKind: 'edit',
        title: 'Edit hello.txt',
        proposal: { proposalId: 'req-7', title: 'Edit hello.txt', rationale: null, files: [{ path: 'hello.txt', diff: '+hello\n', decision: 'pending' }] },
      }),
    );
    const card = await screen.findByTestId('agent-card-approval');
    expect(card.getAttribute('data-status')).toBe('waiting');
    const toast = await screen.findByTestId('agent-toast');
    expect(toast.textContent).toMatch(/codex needs approval/);
    expect(toast.textContent).toMatch(/Edit hello\.txt/);

    await act(async () => fireEvent.click(within(toast).getByTestId('agent-deny')));
    await waitFor(() => expect(answers).toEqual([{ requestId: 'req-7', decision: 'deny' }]));
    /* Both show it is being answered: the toast's buttons are off, and so are the card's. */
    expect((within(screen.getByTestId('agent-toast')).getByTestId('agent-deny') as HTMLButtonElement).disabled).toBe(true);
    expect((within(card).getByTestId('agent-allow') as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      s.push({ type: 'acp:permission', requestId: 'req-7', pending: false, decision: 'deny', answeredBy: 'person' });
      s.push({ type: 'acp:result', stopReason: 'end_turn', text: 'declined' });
      s.end();
    });
    await waitFor(() => expect(screen.getByTestId('agent-card-approval').getAttribute('data-status')).toBe('denied'));
    /* The approval toast is gone (a finished toast may stand in its place). */
    expect(screen.queryAllByTestId('agent-toast').some((t) => /needs approval/.test(t.textContent ?? ''))).toBe(false);
    fireEvent.click(within(screen.getByTestId('agent-card-approval')).getByTestId('agent-card-toggle'));
    expect(screen.getByTestId('agent-approval-answer').textContent).toBe('Denied by you');
  });

  it('an unanswered approval that times out folds as a timeout, not as the person', async () => {
    const s = sseStub();
    const f = vi.fn(async (url: string) => (url === '/api/acp/agents' ? json({ agents: [{ id: 'codex' }] }) : s.response()));
    const runs = createAgentRunStore({ fetch: f });
    render(
      <>
        <AskAgentMenuItem nodeId="n" fetchImpl={f} runs={runs} />
        <ChatSide runs={runs} />
      </>,
    );
    fireEvent.click(screen.getByRole('menuitem'));
    await waitFor(() => expect(f.mock.calls.some(([u]) => String(u).startsWith('/api/acp/run-node'))).toBe(true));
    await act(async () => {
      s.push({ type: 'acp:permission', requestId: 'req-9', pending: true, decision: null, toolKind: 'execute', title: 'Run rm -rf build', proposal: { proposalId: 'req-9', title: 'Run rm -rf build', rationale: null, files: [] } });
    });
    const card = await screen.findByTestId('agent-card-approval');
    expect(card.textContent).toMatch(/Run rm -rf build/);
    fireEvent.click(within(card).getByTestId('agent-card-toggle'));
    expect(screen.getByTestId('agent-approval-command-text').textContent).toBe('rm -rf build');
    await act(async () => {
      s.push({ type: 'acp:permission', requestId: 'req-9', pending: false, decision: 'deny', answeredBy: 'timeout' });
      s.push({ type: 'acp:result', stopReason: 'end_turn', text: '' });
      s.end();
    });
    await waitFor(() => expect(screen.getByTestId('agent-approval-folded').dataset.answeredBy).toBe('timeout'));
    expect(screen.getByTestId('agent-card-approval').querySelector('[data-testid="agent-card-status"]')?.textContent).toBe('denied, timed out');
  });
});
