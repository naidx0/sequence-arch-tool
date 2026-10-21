import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionIndexEntry } from '@sequence/api-types';

import { agentRuns, type AgentRun } from '../agents/agentRuns';
import { chatRunMarks } from '../agents/railRuns';
import { createSessionsClient } from '../sessions/sessionsClient';
import { createStore, StoreProvider } from '../state';
import { SessionPanel } from './SessionPanel';

/*
 * Owner: several chats running agents in the background at once. The sidebar
 * said "working" only for the chat on screen, and only for Sequence's own
 * ask (session.inFlight), never for an agent run: a chat whose agent was
 * still going, or had finished while the reader was in another chat, looked
 * exactly like a chat nobody had touched (e2e/multi-chat.mjs found it).
 */

const run = (over: Partial<AgentRun>): AgentRun =>
  ({ id: 'r', sessionId: 'b', agentRef: 'codex', nodeId: null, nodeLabel: null, prompt: 'go', status: 'running', startedAt: 1, endedAt: null, items: [], approvals: [], error: null, ...over }) as AgentRun;

describe('chatRunMarks', () => {
  it('a running run marks its chat running, whichever chat is open', () => {
    expect(chatRunMarks([run({ sessionId: 'b' }), run({ id: 'r2', sessionId: 'a' })], 'a', () => 0)).toEqual({ a: 'running', b: 'running' });
  });
  it('a run that ended after the reader last had its chat open is unseen; the open chat never is', () => {
    const runs = [run({ sessionId: 'b', status: 'done', endedAt: 50 }), run({ id: 'r2', sessionId: 'a', status: 'done', endedAt: 50 })];
    expect(chatRunMarks(runs, 'a', () => 0)).toEqual({ b: 'unseen' });
  });
  it('opening the chat after it ended clears the mark', () => {
    expect(chatRunMarks([run({ status: 'done', endedAt: 50 })], 'a', (id) => (id === 'b' ? 60 : 0))).toEqual({});
  });
  it('a failed run is news too; history read back from disk is not', () => {
    expect(chatRunMarks([run({ status: 'failed', endedAt: 50 })], 'a', () => 0)).toEqual({ b: 'unseen' });
    expect(chatRunMarks([run({ status: 'done', endedAt: 50, restored: true })], 'a', () => 0)).toEqual({});
  });
  it('a running run waiting on the person (an approval or a question) needs attention', () => {
    const asks = run({ approvals: [{ requestId: 'q', decision: null }] as never });
    expect(chatRunMarks([asks], 'a', () => 0)).toEqual({ b: 'attention' });
    expect(chatRunMarks([run({ questions: [{ requestId: 'q', settled: false, questions: [] }] as never })], 'a', () => 0)).toEqual({ b: 'attention' });
    expect(chatRunMarks([run({ approvals: [{ requestId: 'q', decision: 'allow' }] as never })], 'a', () => 0)).toEqual({ b: 'running' });
  });
  it('a newer running run wins over an older finished one in the same chat', () => {
    expect(chatRunMarks([run({ status: 'done', endedAt: 50 }), run({ id: 'r2' })], 'a', () => 0)).toEqual({ b: 'running' });
  });
});

const chat = (id: string, title: string): SessionIndexEntry => ({ id, title, createdAt: '2026-10-06T09:00:00Z', updatedAt: '2026-10-06T09:00:00Z' }) as SessionIndexEntry;

function mount() {
  const sessions = [chat('a', 'Open chat'), chat('b', 'Codex chat'), chat('c', 'Quiet chat')];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input) === '/api/sessions' && (init?.method ?? 'GET') === 'GET'
      ? new Response(JSON.stringify({ index: { version: 1, activeId: 'a', sessions }, scope: 'workspace', repos: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response('{}', { status: 404 })) as typeof fetch;
  const store = createStore({});
  store.dispatch({ type: 'session/index', sessions, activeId: 'a' });
  render(
    <StoreProvider store={store}>
      <SessionPanel client={createSessionsClient(f)} />
    </StoreProvider>,
  );
}

const rowOf = (id: string) => {
  const r = screen.getAllByTestId('s2-session').find((el) => el.getAttribute('data-session-id') === id);
  if (!r) throw new Error(`no row for ${id}`);
  return r;
};

beforeEach(() => {
  localStorage.clear();
  agentRuns.patch((s) => ({ ...s, runs: [] }));
});

describe('the sidebar shows agent runs in every chat', () => {
  it('a background chat whose agent is running says so; a quiet one does not', async () => {
    mount();
    await waitFor(() => rowOf('b'));
    act(() => agentRuns.patch((s) => ({ ...s, runs: [run({ sessionId: 'b' })] })));
    await waitFor(() => expect(rowOf('b').getAttribute('data-agent-run')).toBe('running'));
    expect(rowOf('b').querySelector('[aria-label="Working"]')).toBeTruthy();
    expect(rowOf('c').getAttribute('data-agent-run')).toBeNull();
  });
  it('a background chat whose agent waits for an approval says it needs the reader', async () => {
    mount();
    await waitFor(() => rowOf('b'));
    act(() => agentRuns.patch((s) => ({ ...s, runs: [run({ sessionId: 'b', approvals: [{ requestId: 'q', decision: null }] as never })] })));
    await waitFor(() => expect(rowOf('b').getAttribute('data-agent-run')).toBe('attention'));
    expect(rowOf('b').querySelector('[data-testid="s2-attention"]')).toBeTruthy();
  });
  it('when it finishes while another chat is open, its row keeps a finished mark', async () => {
    mount();
    await waitFor(() => rowOf('b'));
    act(() => agentRuns.patch((s) => ({ ...s, runs: [run({ sessionId: 'b' })] })));
    act(() => agentRuns.patch((s) => ({ ...s, runs: [run({ sessionId: 'b', status: 'done', endedAt: Date.now() + 1000 })] })));
    await waitFor(() => expect(rowOf('b').getAttribute('data-agent-run')).toBe('unseen'));
    expect(rowOf('b').querySelector('[data-testid="s2-unseen"]')).toBeTruthy();
    expect(rowOf('a').getAttribute('data-agent-run')).toBeNull();
  });
});
