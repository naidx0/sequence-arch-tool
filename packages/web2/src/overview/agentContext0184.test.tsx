import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { agentRuns, type AgentRun } from '../agents/agentRuns';
import { createStore, StoreProvider } from '../state';
import { ChatOverview } from './ChatOverview';
import { assistantTurn } from '../chat/fixtures';

const run = (sessionId: string, agentRef: string, usage?: { used: number; size: number }) => ({ id: `${sessionId}-${agentRef}`, sessionId, agentRef, startedAt: 1, status: 'done', usage } as AgentRun);
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  agentRuns.patch(s => ({ ...s, agents: { a: 'codex', b: 'claude' }, runs: [run('a', 'codex', { used: 24000, size: 200000 }), run('b', 'claude', { used: 7000, size: 100000 })], caps: {}, chatConfig: {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); agentRuns.patch(s => ({ ...s, agents: {}, runs: [] })); });
function draw() {
  const store = createStore({});
  store.dispatch({ type: 'session/index', sessions: [], activeId: 'a' });
  store.dispatch({ type: 'composer/model', model: { model: 'different-api-model', origin: 'api-key' } });
  store.dispatch({ type: 'composer/context-window', tokens: 131072 });
  render(<StoreProvider store={store}><ChatOverview onOpenSurface={() => {}} /></StoreProvider>);
  return store;
}
it('uses the selected agent report, updates live, and never borrows the API denominator', () => {
  draw();
  expect(screen.getByTestId('ov-window').textContent).toBe('24k of 200k');
  act(() => agentRuns.patch(s => ({ ...s, runs: [run('a', 'codex', { used: 30000, size: 200000 })] })));
  expect(screen.getByTestId('ov-window').textContent).toBe('30k of 200k');
});
it('agent switches do not borrow another agent report', () => {
  draw();
  act(() => agentRuns.patch(s => ({ ...s, agents: { ...s.agents, a: 'claude' } })));
  expect(screen.getByTestId('ov-window').textContent).toBe('Not measured');
});
it('chat switches read only that chat and agent', () => {
  const store = draw();
  act(() => store.dispatch({ type: 'session/index', sessions: [], activeId: 'b' }));
  expect(screen.getByTestId('ov-window').textContent).toBe('7k of 100k');
});
it('a completed unmeasured agent turn stays unknown even with historical measured usage', () => {
  agentRuns.patch(s => ({ ...s, runs: [...s.runs, { ...run('a', 'codex'), id: 'new', startedAt: 2 }] }));
  draw();
  expect(screen.getByTestId('ov-window').textContent).toBe('Not measured');
});
it('API-only chats retain their own measured window and unknown stays unknown', () => {
  agentRuns.patch(s => ({ ...s, agents: { a: '' } }));
  const store = draw();
  /* CONTRACT CHANGE (0184, B3): the row names the window it knows even when nothing has
     been sent yet. "Not measured" read as "the window is unknown", and the ring beside the
     row said "Window holds 131,072 tokens". The window is this chat's own, not an agent's. */
  expect(screen.getByTestId('ov-window').textContent).toBe('131.1k, nothing sent yet');
  act(() => store.dispatch({ type: 'session/hydrated', turns: [assistantTurn('answer', 'question', { usage: { inputTokens: 12000, outputTokens: 50 } } as never)] } as never));
  expect(screen.getByTestId('ov-window').textContent).toBe('12k of 131.1k');
});
