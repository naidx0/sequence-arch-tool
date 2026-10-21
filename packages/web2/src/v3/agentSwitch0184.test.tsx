import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentRuns, type AgentRun } from '../agents/agentRuns';
import { createStore } from '../state';
import { V3App } from './V3App';

let posts: string[];
beforeEach(() => {
  localStorage.clear();
  posts = [];
  agentRuns.patch(() => ({ runs: [], dismissed: new Set(), agents: { a: 'claude', b: 'claude' }, chatConfig: {} }));
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') posts.push(url);
    if (url === '/api/acp/agents') return Response.json({ agents: [{ id: 'claude', label: 'Claude' }, { id: 'codex', label: 'Codex' }] });
    if (url === '/api/onboarding/providers') return Response.json({ providers: [{ id: 'codex', state: 'ready' }, { id: 'claude', state: 'ready' }] });
    return new Promise<Response>(() => {});
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); agentRuns.patch(() => ({ runs: [], dismissed: new Set() })); });

function mount() {
  const store = createStore({});
  store.dispatch({ type: 'session/index', sessions: ['a', 'b'].map(id => ({ id, title: id, pinned: false, updatedAt: '2026-01-01' })), activeId: 'a' });
  const view = render(<V3App appStore={store} />);
  return { store, ...view };
}
async function send(text: string) {
  const field = screen.getByTestId('composer-field');
  fireEvent.change(field, { target: { value: text } });
  await act(async () => { fireEvent.keyDown(field, { key: 'Enter' }); });
}
const run = (id: string, patch: Partial<AgentRun> = {}): AgentRun => ({ id, sessionId: 'a', agentRef: 'claude', nodeId: null, nodeLabel: null, prompt: 'fake turn', status: 'running', startedAt: Date.now() + 1000, endedAt: null, items: [], approvals: [], error: null, ...patch });
const add = (r: AgentRun) => act(() => agentRuns.patch(s => ({ ...s, runs: [...s.runs, r] })));
const end = (id: string, patch: Partial<AgentRun> = {}) => act(() => agentRuns.patch(s => ({ ...s, runs: s.runs.map(r => r.id === id ? { ...r, status: 'done', ...patch } : r) })));

describe('scheduled switching in the mounted chat', () => {
  it('persists 20 future turns, ignores restored rows and rerenders, and cancels from the chip', async () => {
    mount();
    await send('/switch codex 20');
    await waitFor(() => expect(screen.getByTestId('switch-countdown').textContent).toContain('20 successful turns'));
    expect(localStorage.getItem('sequence.chatAgentPicks.v1')).toContain('switchRule');
    add(run('old', { status: 'done', restored: true }));
    add(run('ok'));
    end('ok');
    end('ok');
    expect(screen.getByTestId('switch-countdown').textContent).toContain('19 successful turns');
    add(run('failed')); end('failed', { status: 'failed' });
    add(run('abort')); end('abort', { stopped: true });
    add(run('compact', { operation: 'compact' })); end('compact');
    expect(screen.getByTestId('switch-countdown').textContent).toContain('19 successful turns');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel scheduled agent switch' }));
    expect(screen.queryByTestId('switch-countdown')).toBeNull();
    expect(agentRuns.get().agents?.a).toBe('claude');
    expect(posts).toEqual([]);
  });
  it('switches at exactly zero between turns and keeps the transcript untouched', async () => {
    const { store } = mount();
    const transcript = store.getState().session.turns;
    await send('/switch codex 2');
    await waitFor(() => expect(screen.getByTestId('switch-countdown').textContent).toContain('2 successful turns'));
    add(run('one')); end('one');
    expect(agentRuns.get().agents?.a).toBe('claude');
    add(run('two')); end('two');
    await waitFor(() => expect(agentRuns.get().agents?.a).toBe('codex'));
    expect(agentRuns.get().agents?.b).toBe('claude');
    expect(screen.queryByTestId('switch-countdown')).toBeNull();
    expect(store.getState().session.turns).toBe(transcript);
    expect(posts).toEqual([]);
  });
  it('missing and unknown targets are explicit refusals; immediate switch clears the scheduled rule', async () => {
    mount();
    await send('/switch');
    expect((screen.getByTestId('composer-field') as HTMLTextAreaElement).value).toBe('/switch ');
    await send('/switch ');
    expect(screen.getByTestId('switch-notice').textContent).toContain('Use /switch');
    await send('/switch missing');
    await waitFor(() => expect(screen.getByTestId('switch-notice').textContent).toContain('not connected'));
    expect(agentRuns.get().agents?.a).toBe('claude');
    await send('/switch codex 20');
    await waitFor(() => expect(screen.getByTestId('switch-countdown')).toBeTruthy());
    await send('/switch claude');
    await waitFor(() => expect(screen.queryByTestId('switch-countdown')).toBeNull());
    expect(agentRuns.get().agents?.a).toBe('claude');
  });
  it('chat changes and remounts keep independent countdowns without replaying completed turns', async () => {
    const { store, unmount } = mount();
    await send('/switch codex 20');
    await waitFor(() => expect(screen.getByTestId('switch-countdown')).toBeTruthy());
    add(run('one')); end('one');
    act(() => store.dispatch({ type: 'session/index', sessions: store.getState().session.sessions, activeId: 'b' }));
    expect(screen.queryByTestId('switch-countdown')).toBeNull();
    act(() => store.dispatch({ type: 'session/index', sessions: store.getState().session.sessions, activeId: 'a' }));
    expect(screen.getByTestId('switch-countdown').textContent).toContain('19 successful turns');
    unmount();
    render(<V3App appStore={store} />);
    expect(screen.getByTestId('switch-countdown').textContent).toContain('19 successful turns');
    end('one');
    expect(screen.getByTestId('switch-countdown').textContent).toContain('19 successful turns');
  });
  it('a literal command in prose and a palette replacement cannot change the agent', async () => {
    mount();
    const field = screen.getByTestId('composer-field') as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'Explain /switch' } });
    fireEvent.select(field, { target: { selectionStart: 15, selectionEnd: 15 } });
    expect(screen.queryByText('Switch agent', { exact: true })).toBeNull();
    expect(agentRuns.get().agents?.a).toBe('claude');
    fireEvent.change(field, { target: { value: '/switch' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(field.value).toBe('/switch ');
    expect(agentRuns.get().chatConfig?.a?.switchRule).toBeUndefined();
    expect(posts).toEqual([]);
  });
  it('built-in successful turns count; failures and stopped turns do not', async () => {
    agentRuns.patch(s => ({ ...s, agents: { a: '' } }));
    const { store } = mount();
    await send('/switch codex 3');
    await waitFor(() => expect(screen.getByTestId('switch-countdown')).toBeTruthy());
    const start = () => act(() => {
      store.dispatch({ type: 'composer/draft', text: 'fake built-in turn' });
      store.dispatch({ type: 'turn/send', at: Date.now() + 1000 });
    });
    start();
    act(() => store.dispatch({ type: 'turn/event', at: Date.now() + 2000, event: { type: 'result', text: 'Fake successful answer' } as never }));
    expect(screen.getByTestId('switch-countdown').textContent).toContain('2 successful turns');
    start();
    act(() => store.dispatch({ type: 'turn/event', at: Date.now() + 2000, event: { type: 'error', error: 'Fake failure' } as never }));
    start();
    act(() => { store.dispatch({ type: 'turn/stopping', at: Date.now() }); store.dispatch({ type: 'turn/stopped', at: Date.now() }); });
    expect(screen.getByTestId('switch-countdown').textContent).toContain('2 successful turns');
    expect(posts).toEqual([]);
  });
  it('scheduling during a running turn excludes that already-started turn', async () => {
    mount();
    add(run('already-running', { startedAt: Date.now() - 100 }));
    await send('/switch codex 20');
    await waitFor(() => expect(screen.getByTestId('switch-countdown')).toBeTruthy());
    end('already-running');
    expect(screen.getByTestId('switch-countdown').textContent).toContain('20 successful turns');
    add(run('future')); end('future');
    expect(screen.getByTestId('switch-countdown').textContent).toContain('19 successful turns');
  });
});
