import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentRunsList } from '../chat/AgentRunThread';
import { EditUndoBar, rewoundNote } from '../chat/EditFromHere';
import type { SnapshotTurn, TurnsClient } from '../review/turnsClient';
import { StoreProvider, createStore } from '../state';
import { agentRuns, createAgentRunStore, type AgentRun } from './agentRuns';
import { cutTurnId, editFromHere, filesFromSnapshot, snapshotForRun, undoEdit } from './editFromHere';
import { editUndo } from './editUndo';
import { fromSavedRun } from './savedRuns';

/* Edit from here: the page, the server call and the files, in the order the user feels them. */

const saved = (n: number): AgentRun =>
  fromSavedRun({ id: `s${n}`, agentRef: 'codex', prompt: `ask ${n}`, text: `answer ${n}`, status: 'done', startedAt: 10_000 * n, endedAt: 10_000 * n + 500 }, 'chat-1')!;
const seeded = () => {
  const store = createAgentRunStore();
  store.hydrate('chat-1', [saved(1), saved(2), saved(3)]);
  return store;
};
const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status });

afterEach(() => {
  vi.unstubAllGlobals();
  agentRuns.truncateFrom(agentRuns.get().runs[0]?.id ?? '');
});

describe('the store', () => {
  it('truncateFrom drops the run and every later run of that chat only, and says how many stay', () => {
    const store = seeded();
    store.hydrate('chat-2', [{ ...saved(9), sessionId: 'chat-2', id: 'other' }]);
    const second = store.get().runs.find((r) => r.prompt === 'ask 2')!;
    const out = store.truncateFrom(second.id)!;
    expect(out.keep).toBe(1);
    expect(out.removed.map((r) => r.prompt)).toEqual(['ask 2', 'ask 3']);
    expect(store.get().runs.map((r) => r.prompt).sort()).toEqual(['ask 1', 'ask 9']);
  });

  it('a running run cannot be edited from', () => {
    const store = seeded();
    const first = store.get().runs[0]!;
    store.patch((s) => ({ ...s, runs: s.runs.map((r) => (r.id === store.get().runs[2]!.id ? { ...r, status: 'running' as const } : r)) }));
    expect(store.truncateFrom(first.id)).toBeNull();
  });
});

describe('editFromHere', () => {
  it('tells the server how many runs stay, then removes the run and the later ones, and hands back the text', async () => {
    const store = seeded();
    const calls: { url: string; body: unknown }[] = [];
    const fetch = async (url: string, init?: RequestInit) => (calls.push({ url, body: JSON.parse(String(init?.body)) }), json(200, { kept: 1, dropped: 2, agents: ['codex'] }));
    const run = store.get().runs[1]!;
    const r = await editFromHere({ store, run, fetch });
    expect(r).toMatchObject({ ok: true, prompt: 'ask 2', filesReverted: 0 });
    expect(calls).toEqual([{ url: '/api/sessions/chat-1/rewind', body: { fromTurnId: 's2' } }]);
    expect(store.get().runs.map((x) => x.prompt)).toEqual(['ask 1']);
  });

  it('a server refusal leaves the chat exactly as it was', async () => {
    const store = seeded();
    const r = await editFromHere({ store, run: store.get().runs[1]!, fetch: async () => json(404, { error: 'session not found' }) });
    expect(r).toEqual({ ok: false, error: 'session not found' });
    expect(store.get().runs).toHaveLength(3);
  });

  it('puts the files back through the snapshot revert when asked, after the thread is cut', async () => {
    const store = seeded();
    const order: string[] = [];
    const turns = { revert: async (_s: string, seq: number) => (order.push(`revert ${seq}`), { outcome: 'ok', status: 200, body: { seq, files: ['a.txt', 'b.txt'] } }) } as unknown as TurnsClient;
    const r = await editFromHere({ store, run: store.get().runs[1]!, revertFilesTo: 4, turns, fetch: async () => (order.push('rewind'), json(200, {})) });
    expect(order).toEqual(['rewind', 'revert 4']);
    expect(r).toMatchObject({ ok: true, prompt: 'ask 2', filesReverted: 2 });
  });

  it('picks the snapshot taken as the message began, and lists what was written from then on', () => {
    const turns: SnapshotTurn[] = [
      { seq: 1, at: 10_100, files: ['a.txt'] },
      { seq: 2, at: 20_100, files: ['b.txt', 'a.txt'] },
      { seq: 3, at: 30_100, files: [], noUndo: 'No undo point for this turn' },
    ];
    expect(snapshotForRun(turns, { startedAt: 20_000 })?.seq).toBe(2);
    expect(snapshotForRun(turns, { startedAt: 30_000 })).toBeNull();
    expect(filesFromSnapshot(turns, turns[1]!)).toEqual(['a.txt', 'b.txt']);
  });

  it('says what happened to the agent thread on the next turn', () => {
    expect(rewoundNote({ rewound: 'rolled-back', resumeNote: null })).toMatch(/forgot the later messages/);
    expect(rewoundNote({ rewound: 'reseeded', resumeNote: 'no rollback' })).toMatch(/started again from the kept chat \(no rollback\)/);
    expect(rewoundNote({ rewound: undefined, resumeNote: null })).toBeNull();
  });
});

describe('the card', () => {
  it('Edit from here opens a row, nothing happens until Edit, then the later messages go and the text is back in the composer', async () => {
    agentRuns.hydrate('chat-1', [saved(1), saved(2), saved(3)]);
    const fetchMock = vi.fn(async (url: string) => (String(url).includes('/rewind') ? json(200, { kept: 1, dropped: 2, agents: [] }) : json(200, { sessionId: 'chat-1', turns: [] })));
    vi.stubGlobal('fetch', fetchMock);
    const app = createStore({});
    const runs = agentRuns.get().runs.filter((r) => r.sessionId === 'chat-1');
    render(
      <StoreProvider store={app}>
        <AgentRunsList runs={runs} repoRoot={null} onAnswer={() => {}} />
      </StoreProvider>,
    );
    const links = screen.getAllByTestId('edit-from-here');
    expect(links).toHaveLength(3);
    fireEvent.click(links[1]!);
    expect(screen.getByTestId('edit-from-here-row')).toBeTruthy();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/rewind'))).toBe(false);
    await act(async () => {
      fireEvent.click(screen.getByTestId('edit-from-here-go'));
    });
    await waitFor(() => expect(app.getState().composer.draft).toBe('ask 2'));
    expect(agentRuns.get().runs.filter((r) => r.sessionId === 'chat-1').map((r) => r.prompt)).toEqual(['ask 1']);
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/rewind'))!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ fromTurnId: 's2' });
  });
});


describe('which turn the server cuts at', () => {
  it('is the server id of the message, not its position in the page list', () => {
    const store = seeded();
    const runs = store.get().runs;
    expect(cutTurnId(runs, runs[1]!)).toBe('s2');
  });

  it('a message that failed before the server had a turn names the next saved turn, and nothing when there is none', () => {
    const store = seeded();
    const [a, b, c] = store.get().runs as [AgentRun, AgentRun, AgentRun];
    const early = { ...b, turnId: undefined };
    expect(cutTurnId([a, early, c], early)).toBe('s3');
    const last = { ...c, turnId: undefined };
    expect(cutTurnId([a, b, last], last)).toBeNull();
  });

  it('a live run learns the server id from the acp:turn-id event', () => {
    const store = createAgentRunStore();
    store.hydrate('chat-1', [saved(1)]);
    const run = store.get().runs[0]!;
    store.apply(run.id, { type: 'acp:turn-id', turnId: 'server-turn-9' });
    expect(store.get().runs[0]!.turnId).toBe('server-turn-9');
  });

  it('saved turns carry their server id, so after a reload the same cut is named', () => {
    expect(saved(4).turnId).toBe('s4');
  });

  it('files come back from the snapshot taken for that turn, even when the clocks disagree', () => {
    const turns: SnapshotTurn[] = [
      { seq: 1, at: 500_000, chatTurnId: 's1', files: ['a.txt'] },
      { seq: 2, at: 1_000, chatTurnId: 's2', files: ['b.txt'] },
    ];
    expect(snapshotForRun(turns, { startedAt: 500_000 }, 's2')?.seq).toBe(2);
    expect(snapshotForRun(turns, { startedAt: 0 }, 's9')).toBeNull();
  });
});

describe('undoing an edit', () => {
  it('asks the server to put the turns back, returns the runs to the chat, and clears the offer', async () => {
    const store = seeded();
    const removed = store.truncateFrom(store.get().runs[1]!.id)!.removed;
    const undo = { sessionId: 'chat-1', removed, prompt: 'ask 2', prevDraft: 'my draft', filesReverted: 0, at: Date.now() };
    editUndo.set(undo);
    const urls: string[] = [];
    const r = await undoEdit({ store, undo, fetch: async (u) => (urls.push(u), json(200, { restored: 2 })) });
    expect(r).toEqual({ ok: true });
    expect(urls).toEqual(['/api/sessions/chat-1/rewind/undo']);
    expect(store.get().runs.map((x) => x.prompt)).toEqual(['ask 1', 'ask 2', 'ask 3']);
    expect(editUndo.get()).toBeNull();
  });

  it('a server that has nothing to undo (a message was sent) says so and the runs stay gone', async () => {
    const store = seeded();
    const removed = store.truncateFrom(store.get().runs[1]!.id)!.removed;
    const undo = { sessionId: 'chat-1', removed, prompt: 'ask 2', prevDraft: '', filesReverted: 0, at: Date.now() };
    const r = await undoEdit({ store, undo, fetch: async () => json(409, { error: 'There is nothing to undo' }) });
    expect(r).toEqual({ ok: false, error: 'There is nothing to undo' });
    expect(store.get().runs).toHaveLength(1);
  });
});

describe('the card: drafts and undo', () => {
  const setup = (draft: string) => {
    agentRuns.hydrate('chat-1', [saved(1), saved(2), saved(3)]);
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (calls.push(String(url)), String(url).includes('/rewind') ? json(200, { kept: 1, dropped: 2, agents: [] }) : json(200, { sessionId: 'chat-1', turns: [] }))));
    const app = createStore({});
    app.dispatch({ type: 'composer/draft', text: draft });
    const runs = agentRuns.get().runs.filter((r) => r.sessionId === 'chat-1');
    const ui = render(
      <StoreProvider store={app}>
        <AgentRunsList runs={runs} repoRoot={null} onAnswer={() => {}} />
        <EditUndoBar sessionId="chat-1" />
      </StoreProvider>,
    );
    return { app, calls, ui };
  };

  it('an unsent draft is asked about first: the row says it will be replaced and the button says so', () => {
    setup('half a thought');
    fireEvent.click(screen.getAllByTestId('edit-from-here')[1]!);
    expect(screen.getByTestId('edit-from-here-draft').textContent).toMatch(/draft you have not sent/);
    expect(screen.getByTestId('edit-from-here-go').textContent).toBe('Replace my draft and edit');
  });

  it('no draft, no question', () => {
    setup('');
    fireEvent.click(screen.getAllByTestId('edit-from-here')[1]!);
    expect(screen.queryByTestId('edit-from-here-draft')).toBeNull();
    expect(screen.getByTestId('edit-from-here-go').textContent).toBe('Edit');
  });

  it('after the edit, Undo brings the runs back and the old draft returns to the composer', async () => {
    const { app, calls } = setup('half a thought');
    fireEvent.click(screen.getAllByTestId('edit-from-here')[1]!);
    await act(async () => {
      fireEvent.click(screen.getByTestId('edit-from-here-go'));
    });
    await waitFor(() => expect(app.getState().composer.draft).toBe('ask 2'));
    const go = await screen.findByTestId('edit-undo-go');
    await act(async () => {
      fireEvent.click(go);
    });
    await waitFor(() => expect(calls.some((c) => c.endsWith('/rewind/undo'))).toBe(true));
    await waitFor(() => expect(agentRuns.get().runs.filter((r) => r.sessionId === 'chat-1').map((r) => r.prompt)).toEqual(['ask 1', 'ask 2', 'ask 3']));
    expect(app.getState().composer.draft).toBe('half a thought');
    expect(screen.queryByTestId('edit-undo')).toBeNull();
  });
});
