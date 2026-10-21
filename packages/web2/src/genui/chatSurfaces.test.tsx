// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionIndexEntry } from '@sequence/api-types';
import type { UIOp } from '@sequence/genui';

import { createStore, StoreProvider, type Store } from '../state';
/* The lazy half, loaded up front: a cold dynamic import in a test runner outlasts waitFor's default second. */
import './chatSurfacesImpl';
import { V3Chat } from '../v3/V3Chat';
import type { SavedSurface } from './surfaceStore';

/* The agent's live cards in the open chat: an events stream per open chat, a card at the running turn,
   a saved card back at its turn after a reload. The server is a fake EventSource and a fake fetch. */

const A = 'session-a';
const B = 'session-b';
const entry = (id: string): SessionIndexEntry => ({ id, title: id, createdAt: '2026-09-21T09:00:00.000Z', updatedAt: '2026-09-21T09:00:00.000Z' });
const LIST = [entry(A), entry(B)];

class FakeES {
  static all: FakeES[] = [];
  onmessage: ((m: { data: string }) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeES.all.push(this);
  }
  close(): void {
    this.closed = true;
  }
  send(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

const OPS: UIOp[] = [
  { op: 'add', path: '/actions/go', value: { description: 'Go' } },
  { op: 'el', id: 'card', type: 'Card', props: { title: 'Upgrade auth' }, children: ['acts'] },
  { op: 'el', id: 'acts', type: 'Actions', children: ['go'] },
  { op: 'el', id: 'go', type: 'Button', props: { label: 'Open PR', action: { name: 'go' }, variant: 'primary' } },
] as unknown as UIOp[];

let posted: { chat: string; turn: string; surface: string }[] = [];
let asked: string[] = [];
let savedRows: SavedSurface[] = [];

function runningStore(): { store: Store; turnId: string } {
  const store = createStore({});
  store.dispatch({ type: 'session/index', sessions: LIST, activeId: A });
  store.dispatch({ type: 'composer/draft', text: 'draw the upgrade' });
  store.dispatch({ type: 'turn/send', at: 1 });
  return { store, turnId: store.getState().session.inFlight!.turnId };
}

function draw(store: Store) {
  return render(
    <StoreProvider store={store}>
      <div className="v3-chat-col">
        <V3Chat />
      </div>
    </StoreProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  FakeES.all = [];
  posted = [];
  asked = [];
  savedRows = [];
  vi.stubGlobal('EventSource', FakeES);
  vi.stubGlobal('fetch', (async (url: string, init?: RequestInit) => {
    asked.push(String(url));
    if (String(url).startsWith('/api/genui/surfaces') && init?.method === 'POST') {
      posted.push(JSON.parse(String(init.body)));
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (String(url).startsWith('/api/genui/surfaces')) return { ok: true, status: 200, json: async () => ({ surfaces: savedRows }) };
    return { ok: false, status: 404, json: async () => ({}) };
  }) as unknown as typeof fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const events = (): FakeES[] => FakeES.all.filter((e) => e.url.startsWith('/api/genui/events'));

describe('the open chat draws the agent\'s live cards', () => {
  it('a chat never checked for saved cards loads no card code and asks for none while it mounts and settles', async () => {
    const store = createStore({});
    store.dispatch({ type: 'session/index', sessions: LIST, activeId: A });
    draw(store);
    await new Promise((r) => setTimeout(r, 80));
    expect(asked.filter((u) => u.startsWith('/api/genui/surfaces'))).toEqual([]);
    expect(FakeES.all).toHaveLength(0);
  });

  it('a chat marked as holding saved cards reads them once the page is idle, without a stream', async () => {
    localStorage.setItem(`sequence.genui.surfaces.${A}`, '1');
    const store = createStore({});
    store.dispatch({ type: 'session/index', sessions: LIST, activeId: A });
    draw(store);
    expect(asked.filter((u) => u.startsWith('/api/genui/surfaces'))).toEqual([]);
    await waitFor(() => expect(asked.filter((u) => u.startsWith('/api/genui/surfaces'))).toHaveLength(1));
    expect(FakeES.all).toHaveLength(0);
  });

  it('a chat marked as having none stays unloaded, and a saved card marks the chat', async () => {
    localStorage.setItem(`sequence.genui.surfaces.${A}`, '0');
    const { store } = runningStore();
    draw(store);
    await waitFor(() => expect(events()).toHaveLength(1));
    await act(async () => {
      events()[0]!.send({ kind: 'ui.ops', surfaceId: 's1', ops: OPS });
      events()[0]!.send({ kind: 'ui.end', surfaceId: 's1' });
    });
    await waitFor(() => expect(localStorage.getItem(`sequence.genui.surfaces.${A}`)).toBe('1'));
  });

  it('opens its own events stream while a turn runs and draws the card at that turn', async () => {
    const { store, turnId } = runningStore();
    draw(store);
    await waitFor(() => expect(events()).toHaveLength(1));
    expect(events()[0]!.url).toBe(`/api/genui/events?session=${A}`);
    await act(async () => {
      events()[0]!.send({ kind: 'ui.ops', surfaceId: 's1', ops: OPS });
    });
    const card = await screen.findByText('Upgrade auth');
    expect(card.closest('[data-testid="genui-turn-surface"]')?.getAttribute('data-turn')).toBe(turnId);
  });

  it('a settled surface is saved with its chat and turn', async () => {
    const { store, turnId } = runningStore();
    draw(store);
    await waitFor(() => expect(events()).toHaveLength(1));
    await act(async () => {
      events()[0]!.send({ kind: 'ui.ops', surfaceId: 's1', ops: OPS });
      events()[0]!.send({ kind: 'ui.end', surfaceId: 's1' });
    });
    await waitFor(() => expect(posted).toEqual([{ chat: A, turn: turnId, surface: 's1', spec: expect.anything() }].map((p) => expect.objectContaining(p))));
  });

  it('a reload draws the saved card at its turn: still, buttons off', async () => {
    const { store, turnId } = runningStore();
    savedRows = [
      {
        chat: A,
        turn: turnId,
        surface: 's1',
        saved: 1,
        title: 'Upgrade auth',
        spec: {
          root: 'card',
          state: {},
          actions: { go: { description: 'Go' } },
          meta: {},
          elements: {
            card: { type: 'Card', props: { title: 'Upgrade auth' }, children: ['acts'] },
            acts: { type: 'Actions', props: {}, children: ['go'] },
            go: { type: 'Button', props: { label: 'Open PR', action: { name: 'go' }, variant: 'primary' } },
          },
        },
      },
    ];
    draw(store);
    const card = await screen.findByText('Upgrade auth');
    expect(card.closest('[data-testid="genui-turn-surface"]')?.getAttribute('data-turn')).toBe(turnId);
    const button = screen.getByText('Open PR').closest('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('This turn has finished');
  });

  it('a late join to a long card shows the saved copy, not an empty card', async () => {
    const { store, turnId } = runningStore();
    const spec = {
      root: 'card',
      state: {},
      actions: {},
      meta: {},
      elements: { card: { type: 'Card', props: { title: 'Saved long card' }, children: [] } },
    };
    savedRows = [{ chat: A, turn: turnId, surface: 'big', saved: 1, title: 'Saved long card', spec } as unknown as SavedSurface];
    draw(store);
    await waitFor(() => expect(events()).toHaveLength(1));
    await screen.findByText('Saved long card');
    await act(async () => {
      events()[0]!.send({ kind: 'ui.ops', surfaceId: 'big', ops: OPS });
    });
    await screen.findByText('Upgrade auth');
    await act(async () => {
      events()[0]!.send({ kind: 'ui.reset', surfaceId: 'big', reason: 'replay-unavailable' });
    });
    await screen.findByText('Saved long card');
    expect(screen.queryByText('Upgrade auth')).toBeNull();
    expect(screen.queryByText('This card is still being drawn')).toBeNull();
  });

  it('a late join to a long card with no saved copy shows a calm skeleton until the pass ends', async () => {
    const { store, turnId } = runningStore();
    draw(store);
    await waitFor(() => expect(events()).toHaveLength(1));
    await act(async () => {
      events()[0]!.send({ kind: 'ui.reset', surfaceId: 'big', reason: 'replay-unavailable' });
    });
    const note = await screen.findByText('This card is still being drawn');
    expect(note.closest('[data-testid="genui-turn-surface"]')?.getAttribute('data-turn')).toBe(turnId);
    await act(async () => {
      events()[0]!.send({ kind: 'ui.end', surfaceId: 'big' });
    });
    expect(screen.queryByText('This card is still being drawn')).toBeNull();
  });

  it('a card that starts a new pass after a reset is drawn live', async () => {
    const { store } = runningStore();
    draw(store);
    await waitFor(() => expect(events()).toHaveLength(1));
    await act(async () => {
      events()[0]!.send({ kind: 'ui.reset', surfaceId: 'big', reason: 'replay-unavailable' });
      events()[0]!.send({ kind: 'ui.ops', surfaceId: 'big', ops: OPS });
    });
    expect(await screen.findByText('Upgrade auth')).toBeTruthy();
    expect(screen.queryByText('This card is still being drawn')).toBeNull();
  });

  it('switching chats closes the stream, and the other chat gets its own', async () => {
    const { store } = runningStore();
    draw(store);
    await waitFor(() => expect(events()).toHaveLength(1));
    const first = events()[0]!;
    await act(async () => {
      store.dispatch({ type: 'session/index', sessions: LIST, activeId: B });
    });
    expect(first.closed).toBe(true);
    expect(events().filter((e) => !e.closed).length).toBeLessThanOrEqual(1);
  });

  it('a page with no EventSource still draws a busy chat', async () => {
    vi.stubGlobal('EventSource', undefined);
    const { store } = runningStore();
    expect(() => draw(store)).not.toThrow();
    expect(screen.getByTestId('composer-stop')).toBeTruthy();
  });

  it('unmounting closes the stream', async () => {
    const { store } = runningStore();
    const view = draw(store);
    await waitFor(() => expect(events()).toHaveLength(1));
    view.unmount();
    expect(events().every((e) => e.closed)).toBe(true);
  });
});
