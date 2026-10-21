/**
 * The overview's Model and Effort rows say what the composer pill and the model menu say.
 * Both read the one resolver in shell2/ModelMenu (agentPillText, resolveAgentEffort).
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { activeAgentModel } from '../agents/activeModel';
import { agentRuns } from '../agents/agentRuns';
import { effortLabelOf } from '../chat/composerModel';
import { agentPillText, resolveAgentEffort } from '../shell2/ModelMenu';
import { createStore, StoreProvider } from '../state';
import { ChatOverview } from './ChatOverview';

vi.mock('../activity/useLiveLoop', () => ({ useLiveLoop: () => ({ blocks: [], activeIndex: -1, iteration: 0, maxIterations: null, status: 'pending' }) }));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  agentRuns.patch((s) => ({ ...s, agents: {}, caps: {}, chatConfig: {} }));
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

/* A model whose stated default effort (medium) is not among the levels it offers: the menu lands on the first level. */
const caps = { models: [{ id: 'm1', name: 'Opus 4.5', efforts: ['low', 'high'], defaultEffort: 'medium', isDefault: true }], efforts: [], commands: [], skills: [] };

describe('the overview agrees with the composer', () => {
  it('the Model row is the pill text of the agent model, not "Connect a model"', () => {
    agentRuns.patch((s) => ({ ...s, agents: { 'chat-1': 'claude' }, caps: { claude: caps } }));
    overview('chat-1');
    const st = agentRuns.get();
    expect(screen.getByTestId('ov-model').textContent).toBe(agentPillText(activeAgentModel(st, 'claude', 'chat-1')));
    expect(screen.getByTestId('ov-model').textContent).not.toMatch(/connect a model/i);
  });

  it('the Effort row is the level the menu slider has lit', () => {
    agentRuns.patch((s) => ({ ...s, agents: { 'chat-1': 'claude' }, caps: { claude: caps } }));
    overview('chat-1');
    const { effort } = resolveAgentEffort(agentRuns.get(), 'claude', 'chat-1');
    expect(effort).toBe('low');
    expect(screen.getByTestId('ov-effort').textContent).toBe(effortLabelOf(effort!));
  });

  it('a chat pick the model does not offer falls back the way the menu does', () => {
    agentRuns.patch((s) => ({ ...s, agents: { 'chat-1': 'claude' }, caps: { claude: caps }, chatConfig: { 'chat-1': { effort: 'max' } } }));
    overview('chat-1');
    expect(screen.getByTestId('ov-effort').textContent).toBe('Low');
  });
});
