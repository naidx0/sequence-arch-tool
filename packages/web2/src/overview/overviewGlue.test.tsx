/**
 * The overview's two join points: the live workflow loop (activity/useLiveLoop) and the agent's effort (agents/chatConfig).
 */
import { act, cleanup, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LiveLoop as ActivityLoop } from '../activity/liveLoopModel';
import { agentRuns } from '../agents/agentRuns';
import { createStore, StoreProvider } from '../state';
import { ChatOverview } from './ChatOverview';
import { adaptLiveLoop, useLiveLoop } from './useLiveLoop';

let feed: ActivityLoop;
let asked: string | null | undefined;
vi.mock('../activity/useLiveLoop', () => ({
  useLiveLoop: (id: string | null | undefined) => {
    asked = id;
    return feed;
  },
}));

const block = (id: string, state: ActivityLoop['blocks'][number]['state']) => ({ id, title: `Step ${id}`, kind: 'agent', state });
const loopOf = (over: Partial<ActivityLoop>): ActivityLoop => ({ blocks: [], activeIndex: -1, iteration: 0, maxIterations: null, status: 'pending', ...over });

beforeEach(() => {
  feed = loopOf({});
  asked = undefined;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  agentRuns.patch((s) => ({ ...s, agents: {}, caps: {}, chatConfig: {} }));
});

describe('adaptLiveLoop', () => {
  it('maps running to active, keeps pending and done, and shows a failed block as failed', () => {
    const out = adaptLiveLoop(
      loopOf({ status: 'running', iteration: 1, maxIterations: 3, blocks: [block('a', 'done'), block('b', 'running'), block('c', 'pending'), block('d', 'failed')] }),
    )!;
    expect(out.steps.map((s) => [s.id, s.label, s.state])).toEqual([
      ['a', 'Step a', 'done'],
      ['b', 'Step b', 'active'],
      ['c', 'Step c', 'pending'],
      ['d', 'Step d', 'failed'],
    ]);
    expect(out.round).toBe(0);
    expect(adaptLiveLoop(loopOf({ status: 'running', iteration: 3, blocks: [block('a', 'running')] }))!.round).toBe(2);
  });

  it('is null with nothing to show: no blocks, or a run that finished cleanly', () => {
    expect(adaptLiveLoop(loopOf({}))).toBeNull();
    expect(adaptLiveLoop(loopOf({ status: 'completed', blocks: [block('a', 'done')] }))).toBeNull();
    expect(adaptLiveLoop(loopOf({ status: 'failed', blocks: [block('a', 'failed')] }))).not.toBeNull();
  });

  it('the hook watches the chat id it is given', () => {
    feed = loopOf({ status: 'running', blocks: [block('a', 'running')] });
    const { result } = renderHook(() => useLiveLoop('chat-7'));
    expect(asked).toBe('chat-7');
    expect(result.current?.steps).toHaveLength(1);
  });
});

function overview(chat = 'chat-1') {
  const store = createStore({});
  act(() => store.dispatch({ type: 'session/index', sessions: [{ id: chat, title: chat, createdAt: '2026-10-01', updatedAt: '2026-10-01', pinned: false }], activeId: chat } as never));
  return render(
    <StoreProvider store={store}>
      <ChatOverview onOpenSurface={() => {}} />
    </StoreProvider>,
  );
}

describe('the overview shows the live loop', () => {
  it('draws the steps, the one it is on, the pass, and a failed step in words', () => {
    feed = loopOf({ status: 'running', iteration: 2, maxIterations: 4, blocks: [block('a', 'done'), block('b', 'running'), block('c', 'failed')] });
    overview('chat-1');
    expect(asked).toBe('chat-1');
    const loop = screen.getByTestId('ov-loop');
    const rows = within(loop).getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('data-status'))).toEqual(['done', 'active', 'failed']);
    expect(rows[2]!.textContent).toContain('failed');
    expect(loop.textContent).toContain('pass 2');
  });

  it('draws nothing when no loop is running', () => {
    overview();
    expect(screen.queryByTestId('ov-loop')).toBeNull();
  });
});

describe('the overview shows the agent effort', () => {
  it('reads the chat pick, then the model default, and says nothing without an agent', () => {
    overview('chat-1');
    expect(screen.queryByTestId('ov-effort')).toBeNull();
    cleanup();
    agentRuns.patch((s) => ({
      ...s,
      agents: { 'chat-1': 'claude' },
      caps: { claude: { models: [{ id: 'm1', name: 'M1', efforts: ['low', 'high'], defaultEffort: 'low', isDefault: true }], efforts: [], commands: [], skills: [] } },
    }));
    overview('chat-1');
    expect(screen.getByTestId('ov-effort').textContent).toBe('Low');
    cleanup();
    agentRuns.patch((s) => ({ ...s, chatConfig: { 'chat-1': { effort: 'high' } } }));
    overview('chat-1');
    expect(screen.getByTestId('ov-effort').textContent).toBe('High');
    /* Another chat's pick is not this chat's. */
    cleanup();
    overview('chat-2');
    expect(screen.queryByTestId('ov-effort')).toBeNull();
  });
});
