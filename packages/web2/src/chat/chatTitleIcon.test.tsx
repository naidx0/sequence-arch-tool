import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { SessionIndexEntry } from '@sequence/api-types';
import type { SessionsClient } from '../sessions/sessionsClient';
import { createStore, StoreProvider } from '../state';
import { ChatTitle, chatTitleOf } from './ChatTitle';
import { chatBrandFor, chatIconFor } from './chatIcon';

/* Round 9, Jaden: "It just says Claude at the top of the chat... rename the
   chat to whatever's happening in the chat" and "Get rid of the chat icon
   completely". */

const entry = (over: Partial<SessionIndexEntry> & { agentThreads?: Record<string, unknown> } = {}) =>
  ({ id: 's1', title: '', createdAt: '', updatedAt: '', ...over }) as SessionIndexEntry;

describe('chatIconFor: a chat wears its model brand, never a chat bubble', () => {
  const cases: [string, Parameters<typeof chatBrandFor>[0], Parameters<typeof chatBrandFor>[1], string][] = [
    ['live claude agent', entry(), { agents: { s1: 'claude' } }, 'claude'],
    ['kept claude thread', entry({ agentThreads: { claude: {} } }), {}, 'claude'],
    ['sonnet model', entry(), { model: 'claude-sonnet-4-6' }, 'claude'],
    ['opus model', entry(), { model: 'opus' }, 'claude'],
    ['live codex agent', entry(), { agents: { s1: 'codex' } }, 'codex'],
    ['gpt model', entry(), { model: 'gpt-5.2' }, 'codex'],
    ['local ollama model', entry(), { model: 'qwen3:8b' }, 'sequence'],
    ['nothing known', entry(), {}, 'sequence'],
  ];
  it.each(cases)('%s', (_name, session, ctx, brand) => {
    expect(chatBrandFor(session, ctx)).toBe(brand);
    const { container } = render(<>{chatIconFor(session, ctx)}</>);
    const icon = container.querySelector('[data-testid="chat-icon"]')!;
    expect(icon.getAttribute('data-brand')).toBe(brand);
    /* A brand mark is drawn (svg), whatever the brand. */
    expect(icon.querySelector('svg, .s2-brand')).not.toBeNull();
  });
  it('the live agent outranks the model', () => {
    expect(chatBrandFor(entry(), { agents: { s1: 'codex' }, model: 'claude-opus' })).toBe('codex');
  });
});

describe('ChatTitle: the header names the chat, not the agent', () => {
  it('reads "New chat" for no title and for an id-shaped one', () => {
    expect(chatTitleOf(null)).toBe('New chat');
    expect(chatTitleOf(entry({ title: '  ' }))).toBe('New chat');
    expect(chatTitleOf(entry({ title: 'session-1759-abc' }))).toBe('New chat');
    expect(chatTitleOf(entry({ title: 'Fix the gateway retry' }))).toBe('Fix the gateway retry');
  });

  function mount(sessions: SessionIndexEntry[], update = vi.fn()) {
    const store = createStore({});
    store.dispatch({ type: 'session/index', sessions, activeId: 's1' });
    const client = { update } as unknown as SessionsClient;
    render(
      <StoreProvider store={store}>
        <ChatTitle client={client} />
      </StoreProvider>,
    );
    return store;
  }

  it('shows the stored title and never the agent name', () => {
    mount([entry({ title: 'Wire the stall line' })]);
    expect(screen.getByTestId('chat-title').textContent).toBe('Wire the stall line');
    expect(screen.queryByText(/^Claude$|^Codex$|^Sequence$/)).toBeNull();
  });

  it('renames inline: click, type, Enter saves through the sessions client', async () => {
    const update = vi.fn().mockResolvedValue({ outcome: 'ok', body: { ok: true, index: { sessions: [entry({ title: 'Better name', titleEdited: true })] } } });
    const store = mount([entry({ title: 'Old name' })], update);
    fireEvent.click(screen.getByTestId('chat-title'));
    const field = screen.getByTestId('chat-title-input') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'Better name' } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
    });
    expect(update).toHaveBeenCalledWith('s1', { title: 'Better name' });
    expect(screen.getByTestId('chat-title').textContent).toBe('Better name');
    expect(store.getState().session.sessions[0]!.title).toBe('Better name');
  });

  it('Escape puts the name back without a write', () => {
    const update = vi.fn();
    mount([entry({ title: 'Keep me' })], update);
    fireEvent.click(screen.getByTestId('chat-title'));
    const field = screen.getByTestId('chat-title-input');
    fireEvent.change(field, { target: { value: 'nope' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByTestId('chat-title').textContent).toBe('Keep me');
  });

  it.each(['outcome', 'transport'])('reverts a failed %s rename and shows the real error', async kind => {
    const update = kind === 'outcome' ? vi.fn().mockResolvedValue({ outcome: 'error', status: 500, message: 'Rename refused' })
      : vi.fn().mockRejectedValue(new Error('Rename refused'));
    const store = mount([entry({ title: 'Old name' })], update);
    fireEvent.click(screen.getByTestId('chat-title'));
    const field = screen.getByTestId('chat-title-input');
    fireEvent.change(field, { target: { value: 'Phantom name' } });
    await act(async () => { fireEvent.keyDown(field, { key: 'Enter' }); });
    expect(store.getState().session.sessions[0]!.title).toBe('Old name');
    expect(screen.getByTestId('chat-title').textContent).toBe('Old name');
    expect(screen.getByRole('alert').textContent).toContain('Rename refused');
  });

  it('a pending rename response cannot overwrite another session or its active selection', async () => {
    let resolve!: (result: unknown) => void;
    const update = vi.fn(() => new Promise(r => { resolve = r; }));
    const store = mount([entry({ title: 'Old name' }), entry({ id: 's2', title: 'Other chat' })], update);
    fireEvent.click(screen.getByTestId('chat-title'));
    const field = screen.getByTestId('chat-title-input');
    fireEvent.change(field, { target: { value: 'New name' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    act(() => store.dispatch({ type: 'session/index', sessions: store.getState().session.sessions, activeId: 's2' }));
    await act(async () => resolve({ outcome: 'ok', body: { index: { sessions: [entry({ title: 'New name' }), entry({ id: 's2', title: 'Stale other title' })] } } }));
    expect(store.getState().session.activeId).toBe('s2');
    expect(screen.getByTestId('chat-title').textContent).toBe('Other chat');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
