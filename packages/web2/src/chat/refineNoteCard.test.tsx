import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionIndexEntry } from '@sequence/api-types';
import { createAgentRunStore } from '../agents/agentRuns';
import { createStore, StoreProvider } from '../state';
import { AgentChatLayer } from './AgentChatLayer';

import { RefineNoteCard } from './RefineNoteCard';
import { AgentMapSetting } from '../settings/AgentMapSetting';

/*
 * THE NOTE CARD (analyzer harness/refineCards.ts). Drawn only when a person has
 * a decision to make; Accept adds, Dismiss is remembered, Undo takes it out,
 * and nothing is sent until a button is pressed.
 */

const PENDING = { id: 'n1', state: 'pending', tip: '"add a test for the missing file case" was reported not done before: no test runner is set up in this package. Check that first.', why: { kinds: ['ask_not_done'], turns: ['t1'], asks: ['add a test for the missing file case'] } };

function server(initial: unknown[]) {
  const calls: string[] = [];
  let cards = initial;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.endsWith('/cards')) return new Response(JSON.stringify({ auto: false, cards }), { status: 200 });
    if (init?.method === 'POST') {
      cards = [];
      return new Response('{}', { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

afterEach(() => undefined);

describe('the note card', () => {
  it('draws nothing when there is nothing to decide, and sends nothing', async () => {
    const s = server([]);
    render(<RefineNoteCard sessionId="s" lastEndedKey="t1" fetchImpl={s.fetchImpl} lookAfterMs={0} />);
    await waitFor(() => expect(s.calls).toEqual(['GET /api/harness/refine/cards']));
    expect(screen.queryByTestId('refine-note')).toBeNull();
  });

  it('a proposed note shows its sentence and nothing is applied until Accept', async () => {
    const s = server([PENDING]);
    render(<RefineNoteCard sessionId="s" lastEndedKey="t1" fetchImpl={s.fetchImpl} lookAfterMs={0} />);
    const tip = await screen.findByTestId('refine-note-tip');
    expect(tip.textContent).toContain('no test runner is set up');
    expect(screen.getByTestId('refine-note').getAttribute('data-state')).toBe('pending');
    expect(s.calls.filter((c) => c.startsWith('POST'))).toEqual([]);
    fireEvent.click(screen.getByTestId('refine-note-why-btn'));
    expect(screen.getByTestId('refine-note-why').textContent).toContain('the agent said it did not do this');
    expect(screen.getByTestId('refine-note-why').textContent).toContain('add a test for the missing file case');
  });

  it('Accept posts accept, then offers Undo, which posts rollback', async () => {
    const s = server([PENDING]);
    render(<RefineNoteCard sessionId="s" lastEndedKey="t1" fetchImpl={s.fetchImpl} lookAfterMs={0} />);
    const accept = await screen.findByTestId('refine-note-accept');
    await act(async () => {
      fireEvent.click(accept);
    });
    expect(s.calls).toContain('POST /api/harness/refine/n1/accept');
    expect((await screen.findByTestId('refine-note')).getAttribute('data-state')).toBe('accepted');
    await act(async () => {
      fireEvent.click(screen.getByTestId('refine-note-undo'));
    });
    expect(s.calls).toContain('POST /api/harness/refine/n1/rollback');
    await waitFor(() => expect(screen.queryByTestId('refine-note')).toBeNull());
  });

  it('Dismiss posts deny and the card goes', async () => {
    const s = server([PENDING]);
    render(<RefineNoteCard sessionId="s" lastEndedKey="t1" fetchImpl={s.fetchImpl} lookAfterMs={0} />);
    const dismiss = await screen.findByTestId('refine-note-dismiss');
    await act(async () => {
      fireEvent.click(dismiss);
    });
    expect(s.calls).toContain('POST /api/harness/refine/n1/deny');
    await waitFor(() => expect(screen.queryByTestId('refine-note')).toBeNull());
  });

  it('a note that has not stopped the failure says so with the tracker’s numbers, and offers Remove or Keep', async () => {
    const s = server([{ ...PENDING, state: 'flagged', summary: 'No change: matching asks failed 33% before and 25% since.' }]);
    render(<RefineNoteCard sessionId="s" lastEndedKey="t1" fetchImpl={s.fetchImpl} lookAfterMs={0} />);
    expect((await screen.findByTestId('refine-note')).textContent).toContain('No change: matching asks failed 33% before and 25% since.');
    expect(screen.getByTestId('refine-note-undo').textContent).toBe('Remove');
    await act(async () => {
      fireEvent.click(screen.getByTestId('refine-note-keep'));
    });
    expect(s.calls).toContain('POST /api/harness/refine/n1/keep');
  });

  it('one decision per turn: after Dismiss, Keep or Undo the next waiting note does not pop up at once; it waits for the next turn to end', async () => {
    const SECOND = { ...PENDING, id: 'n2', tip: 'A second waiting note.' };
    let cards: unknown[] = [PENDING, SECOND];
    const calls: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/cards')) return new Response(JSON.stringify({ auto: false, cards }), { status: 200 });
      cards = cards.filter((c) => !url.includes(`/${(c as { id: string }).id}/`));
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    render(<RefineNoteCard sessionId="s" lastEndedKey="t1" fetchImpl={fetchImpl} lookAfterMs={0} />);
    const dismiss = await screen.findByTestId('refine-note-dismiss');
    await act(async () => {
      fireEvent.click(dismiss);
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('refine-note')).toBeNull();
    expect(calls.filter((c) => c.startsWith('GET'))).toHaveLength(1);
  });

  it('a server that cannot be reached draws no card and no error', async () => {
    const fetchImpl = (async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    render(<RefineNoteCard sessionId="s" lastEndedKey="t1" fetchImpl={fetchImpl} lookAfterMs={0} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('refine-note')).toBeNull();
  });
});

describe('the note card is per chat', () => {
  it('a chat with no turn yet draws no card and asks for none, however many notes the project has', async () => {
    const s = server([PENDING]);
    render(<RefineNoteCard sessionId="new-chat" lastEndedKey={null} fetchImpl={s.fetchImpl} lookAfterMs={0} />);
    await new Promise((r) => setTimeout(r, 40));
    expect(screen.queryByTestId('refine-note')).toBeNull();
    expect(s.calls).toEqual([]);
  });

  it('going from the chat that has the card to another chat takes the card away, and a new chat does not get it back', async () => {
    const s = server([PENDING]);
    const view = render(<RefineNoteCard sessionId="a" lastEndedKey="t1" fetchImpl={s.fetchImpl} lookAfterMs={0} />);
    expect(await screen.findByTestId('refine-note-tip')).toBeTruthy();
    view.rerender(<RefineNoteCard sessionId="b" lastEndedKey={null} fetchImpl={s.fetchImpl} lookAfterMs={0} />);
    await new Promise((r) => setTimeout(r, 40));
    expect(screen.queryByTestId('refine-note')).toBeNull();
    expect(s.calls.filter((c) => c.startsWith('GET'))).toHaveLength(1);
  });
});

describe('the Auto switch', () => {
  it('is off by default and saves only autoRefine', async () => {
    const puts: unknown[] = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ includeArchitectureMap: true, allBoardTools: false, autoRefine: true, map: null }), { status: 200 });
      }
      return new Response(JSON.stringify({ includeArchitectureMap: true, allBoardTools: false, autoRefine: false, map: null }), { status: 200 });
    };
    render(<AgentMapSetting fetchImpl={fetchImpl as typeof fetch} />);
    const box = (await screen.findByTestId('settings-auto-refine-toggle')) as HTMLInputElement;
    await waitFor(() => expect(box.disabled).toBe(false));
    expect(box.checked).toBe(false);
    /* The switch is stored per user, not per repo: the copy says so, and says what Auto never adds. */
    expect(box.closest('label')?.textContent).toContain('Applies to every project.');
    expect(box.closest('label')?.textContent).toContain("a note in the agent's words still waits for you");
    await act(async () => {
      fireEvent.click(box);
    });
    expect(puts).toEqual([{ autoRefine: true }]);
    await waitFor(() => expect(box.checked).toBe(true));
  });
});

describe('the note card in a chat that never used an agent', () => {
  const entry = { id: 'b1', title: 'New chat', createdAt: '', updatedAt: '' } as SessionIndexEntry;
  afterEach(() => vi.unstubAllGlobals());

  it('with zero agent runs and a pending card from the server, the card renders after a built-in turn ends', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).endsWith('/cards')) return new Response(JSON.stringify({ auto: false, cards: [PENDING] }), { status: 200 });
      return new Response(JSON.stringify({ runs: [] }), { status: 200 });
    });
    const store = createStore({});
    store.dispatch({ type: 'session/index', sessions: [entry], activeId: 'b1' });
    render(
      <StoreProvider store={store}>
        <AgentChatLayer empty={false} runs={createAgentRunStore()} />
      </StoreProvider>,
    );
    store.dispatch({ type: 'composer/draft', text: 'where is the parser?' });
    store.dispatch({ type: 'turn/send', at: 1 });
    /* While the built-in turn streams, no card (one decision per turn). */
    await act(async () => await new Promise((r) => setTimeout(r, 900)));
    expect(screen.queryByTestId('refine-note')).toBeNull();
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'It is in parser.ts.' }, at: 2 });
    expect(await screen.findByTestId('refine-note-tip', {}, { timeout: 3000 })).toBeTruthy();
  });
});
