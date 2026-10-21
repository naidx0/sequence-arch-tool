import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionIndexEntry } from '@sequence/api-types';

import { agentRuns, type AgentRun } from '../agents/agentRuns';
import { createSessionsClient } from '../sessions/sessionsClient';
import { workspaceKeyOf } from '../sessions/workspaceEvents';
import { createStore, StoreProvider } from '../state';
import { SessionPanel } from './SessionPanel';

/* The page is in workspace A. A chat of workspace B keeps running there, and its row in the sidebar must say so. A chat
   id both workspaces use ('shared') must never carry B's run onto A's row. */

const A = '/tmp/seq-xws-Qx9/home/shopfront';
const B = '/tmp/seq-xws-Qx9/home/plainapp';
const chat = (id: string, title: string): SessionIndexEntry => ({ id, title, createdAt: '2026-10-06T09:00:00Z', updatedAt: '2026-10-06T09:00:00Z' }) as SessionIndexEntry;
const run = (over: Partial<AgentRun>): AgentRun =>
  ({ id: 'r', sessionId: 'b1', agentRef: 'codex', nodeId: null, nodeLabel: null, prompt: 'go', status: 'running', startedAt: 1, endedAt: null, items: [], approvals: [], error: null, ...over }) as AgentRun;

function mount() {
  const a = [chat('shared', 'Shopfront chat')];
  const b = [chat('b1', 'Plainapp chat'), chat('b2', 'Quiet plainapp chat')];
  const f = (async (input: RequestInfo | URL) =>
    String(input) === '/api/sessions'
      ? new Response(JSON.stringify({ index: { version: 1, activeId: 'shared', sessions: a }, scope: 'workspace', repos: [{ path: B, name: 'plainapp', index: { version: 1, activeId: 'b1', sessions: b } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response('{}', { status: 404 })) as typeof fetch;
  const seed = createStore({}).getState();
  const store = createStore({ hydrate: { ...seed, repo: { phase: 'attached', repo: { root: A, repoName: 'shopfront' } } as typeof seed.repo } });
  store.dispatch({ type: 'session/index', sessions: a, activeId: 'shared' });
  render(<StoreProvider store={store}><SessionPanel client={createSessionsClient(f)} /></StoreProvider>);
}

const rowOf = (id: string) => {
  const r = screen.getAllByTestId('s2-session').find((el) => el.getAttribute('data-session-id') === id);
  if (!r) throw new Error(`no row for ${id}`);
  return r;
};

beforeEach(() => {
  localStorage.clear();
  agentRuns.patch((s) => ({ ...s, runs: [] }));
  agentRuns.setWorkspace(workspaceKeyOf(A), workspaceKeyOf(A));
});
afterEach(() => agentRuns.patch((s) => ({ ...s, runs: [] })));

describe('the sidebar rows of another workspace', () => {
  it("a chat of B running in the background says so while the page shows A; B's quiet chat and A's same-id chat do not", async () => {
    mount();
    /* a folder other than the open one is folded until it is clicked */
    fireEvent.click((await screen.findByText('plainapp')).closest('button')!);
    await waitFor(() => rowOf('b1'));
    act(() => agentRuns.patch((s) => ({ ...s, runs: [run({ id: 'rb', sessionId: 'b1', ws: workspaceKeyOf(B) }), run({ id: 'rs', sessionId: 'shared', ws: workspaceKeyOf(B) })] })));
    await waitFor(() => expect(rowOf('b1').getAttribute('data-agent-run')).toBe('running'));
    expect(rowOf('b2').getAttribute('data-agent-run')).toBeNull();
    expect(rowOf('shared').getAttribute('data-agent-run')).toBeNull();
  });
});

describe('after a switch A -> B the rows follow the workspace now shown', () => {
  /* The page switched in place: B is now the open workspace, A is "another workspace". A's chat that kept running while
     the reader was in A is under A's section and says so; B's own chat that shares its id with it does not. */
  function mountShowing(root: string, otherPath: string, own: SessionIndexEntry[], other: SessionIndexEntry[], activeId: string) {
    const f = (async (input: RequestInfo | URL) =>
      String(input) === '/api/sessions'
        ? new Response(JSON.stringify({ index: { version: 1, activeId, sessions: own }, scope: 'workspace', repos: [{ path: otherPath, name: otherPath.split('/').pop(), index: { version: 1, activeId: other[0].id, sessions: other } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response('{}', { status: 404 })) as typeof fetch;
    const seed = createStore({}).getState();
    const store = createStore({ hydrate: { ...seed, repo: { phase: 'attached', repo: { root, repoName: 'now' } } as typeof seed.repo } });
    store.dispatch({ type: 'session/index', sessions: own, activeId });
    render(<StoreProvider store={store}><SessionPanel client={createSessionsClient(f)} /></StoreProvider>);
  }

  it("A's running chat shows its mark under A once B is shown; the same id in B stays unmarked", async () => {
    agentRuns.setWorkspace(workspaceKeyOf(B), workspaceKeyOf(A));
    mountShowing(B, A, [chat('shared', 'Plainapp chat'), chat('b2', 'Quiet plainapp chat')], [chat('a1', 'Shopfront chat'), chat('a2', 'Quiet shopfront chat')], 'shared');
    fireEvent.click((await screen.findByText('shopfront')).closest('button')!);
    await waitFor(() => rowOf('a1'));
    act(() => agentRuns.patch((s) => ({ ...s, runs: [run({ id: 'ra', sessionId: 'a1', ws: workspaceKeyOf(A) }), run({ id: 'ras', sessionId: 'shared', ws: workspaceKeyOf(A) })] })));
    await waitFor(() => expect(rowOf('a1').getAttribute('data-agent-run')).toBe('running'));
    expect(rowOf('a2').getAttribute('data-agent-run')).toBeNull();
    expect(rowOf('shared').getAttribute('data-agent-run')).toBeNull();
    expect(rowOf('b2').getAttribute('data-agent-run')).toBeNull();
  });
});
