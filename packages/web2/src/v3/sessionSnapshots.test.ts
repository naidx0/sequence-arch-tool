import { beforeEach, describe, expect, it } from 'vitest';

import type { SessionsClient } from '../sessions/sessionsClient';
import { createStore } from '../state/store';
import { activateSession, clearSessionPads, softLoadSession, warmSnapshot } from './sessionActions';
import { resetSnapshotsForTest } from './sessionSnapshots';

/*
 * SPEED LANE: a chat seen before is drawn in the click, not after two round trips. Each case here
 * fails on the code before sessionSnapshots.ts (the old activateSession kept the old transcript on
 * screen until activate AND read had both come back).
 */

const memory = (id: string, texts: string[]) => ({
  version: 2 as const,
  sessionId: id,
  turns: texts.map((text, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', text, at: new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString() })),
});

function makeClient(chats: Record<string, string[]>, opts: { hold?: boolean } = {}) {
  const reads: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const client = {
    activate: async (id: string) => ({ outcome: 'ok', body: { index: { version: 1, activeId: id, sessions: Object.keys(chats).map((s) => ({ id: s, title: s, createdAt: 'x', updatedAt: 'x' })) } } }),
    readSession: async (id: string) => {
      reads.push(id);
      if (opts.hold) await gate;
      return { outcome: 'ok', body: { chat: memory(id, chats[id]!) } };
    },
  } as unknown as SessionsClient;
  return { client, reads, release: () => release() };
}

/** The reader's own change to the open chat: one more turn than the disk has. */
function addLocalTurn(store: ReturnType<typeof createStore>, text: string) {
  const s = store.getState().session;
  const last = s.turns[s.turns.length - 1]!;
  store.dispatch({ type: 'session/browse', activeId: s.activeId, turns: [...s.turns, { ...last, id: `local:${text}` as never, text }] });
}

const texts = (store: ReturnType<typeof createStore>) => store.getState().session.turns.map((t) => t.text);

describe('chat switch snapshots', () => {
  beforeEach(() => resetSnapshotsForTest());

  it('draws a chat it has seen in the same tick as the click, before any network answer', async () => {
    const chats = { a: ['qa', 'aa'], b: ['qb', 'ab'] };
    const seen = makeClient(chats);
    const store = createStore();
    await softLoadSession(store, 'a', undefined, seen.client);
    await softLoadSession(store, 'b', undefined, seen.client);
    expect(texts(store)).toEqual(['qb', 'ab']);

    const held = makeClient(chats, { hold: true });
    void activateSession(store, 'a', held.client);
    /* No await: the reads are still held. */
    expect(texts(store)).toEqual(['qa', 'aa']);
    expect(store.getState().session.activeId).toBe('a');
    expect(store.getState().session.hydrating).toBe(false);
    held.release();
  });

  it('shows what the reader saw on leaving, not what the disk had when it was first read', async () => {
    const chats = { a: ['qa', 'aa'], b: ['qb', 'ab'] };
    const c = makeClient(chats);
    const store = createStore();
    await softLoadSession(store, 'a', undefined, c.client);
    addLocalTurn(store, 'a new local question');
    const live = texts(store);
    await activateSession(store, 'b', c.client);
    const held = makeClient({ ...chats, a: ['qa', 'aa'] }, { hold: true });
    void activateSession(store, 'a', held.client);
    expect(texts(store)).toEqual(live);
    held.release();
  });

  it('an agreeing read leaves the drawn turns alone; a differing read swaps them and keeps the draft', async () => {
    const chats: Record<string, string[]> = { a: ['qa', 'aa'], b: ['qb', 'ab'] };
    const c = makeClient(chats);
    const store = createStore();
    await softLoadSession(store, 'a', undefined, c.client);
    await activateSession(store, 'b', c.client);

    const agree = makeClient(chats, { hold: true });
    const first = activateSession(store, 'a', agree.client);
    const drawn = store.getState().session.turns;
    agree.release();
    await first;
    /* The same array: the revalidation found nothing to change, so nothing re-rendered. */
    expect(store.getState().session.turns).toBe(drawn);

    await activateSession(store, 'b', c.client);
    const grown = makeClient({ ...chats, a: ['qa', 'aa', 'qa2', 'aa2'] }, { hold: true });
    const second = activateSession(store, 'a', grown.client);
    expect(texts(store)).toEqual(['qa', 'aa']);
    store.dispatch({ type: 'composer/draft', text: 'half a thought' });
    grown.release();
    await second;
    expect(texts(store)).toEqual(['qa', 'aa', 'qa2', 'aa2']);
    expect(store.getState().composer.draft).toBe('half a thought');
  });

  it('a read from a server still behind the reader (the leave-flush has not landed) does not replace their newer copy', async () => {
    const chats = { a: ['qa', 'aa'], b: ['qb', 'ab'] };
    const c = makeClient(chats);
    const store = createStore();
    await softLoadSession(store, 'a', undefined, c.client);
    addLocalTurn(store, 'newer than disk');
    const newer = texts(store);
    await activateSession(store, 'b', c.client);
    await activateSession(store, 'a', c.client); /* disk still has only qa, aa */
    expect(texts(store)).toEqual(newer);
  });

  it('a failed read after an agreeing one does not blank the chat on screen', async () => {
    const chats = { a: ['qa', 'aa'], b: ['qb', 'ab'] };
    const c = makeClient(chats);
    const store = createStore();
    await softLoadSession(store, 'a', undefined, c.client);
    await activateSession(store, 'b', c.client);
    await activateSession(store, 'a', c.client);
    const down = { readSession: async () => ({ outcome: 'error', status: 503, message: 'down' }) } as unknown as SessionsClient;
    await softLoadSession(store, 'a', undefined, down);
    expect(texts(store)).toEqual(['qa', 'aa']);
  });

  it('a read that comes back after the reader has moved on that chat does not replace it', async () => {
    const chats = { a: ['qa', 'aa'], b: ['qb', 'ab'] };
    const c = makeClient(chats);
    const store = createStore();
    await softLoadSession(store, 'a', undefined, c.client);
    await activateSession(store, 'b', c.client);
    const held = makeClient({ ...chats, a: ['qa', 'aa', 'other'] }, { hold: true });
    const pending = activateSession(store, 'a', held.client);
    addLocalTurn(store, 'typed while it loaded');
    const mine = texts(store);
    held.release();
    await pending;
    expect(texts(store)).toEqual(mine);
  });

  it('warmSnapshot reads a chat once so its first click is a memory switch', async () => {
    const chats = { a: ['qa', 'aa'], b: ['qb', 'ab'] };
    const c = makeClient(chats);
    const store = createStore();
    await softLoadSession(store, 'a', undefined, c.client);
    warmSnapshot(store, 'b', c.client);
    warmSnapshot(store, 'b', c.client);
    await new Promise((r) => setTimeout(r, 0));
    expect(c.reads.filter((id) => id === 'b')).toHaveLength(1);
    const held = makeClient(chats, { hold: true });
    void activateSession(store, 'b', held.client);
    expect(texts(store)).toEqual(['qb', 'ab']);
    held.release();
  });

  it('leaving a chat mid-turn forgets its older copy, so coming back never shows it without a loading cue', async () => {
    const chats = { a: ['qa', 'aa'], b: ['qb', 'ab'] };
    const c = makeClient(chats);
    const store = createStore();
    await softLoadSession(store, 'a', undefined, c.client);
    addLocalTurn(store, 'my new question');
    const s = store.getState().session;
    store.dispatch({ type: 'session/index', sessions: s.sessions, activeId: 'a' });
    store.dispatch({ type: 'composer/draft', text: 'ask again' });
    store.dispatch({ type: 'turn/send', at: 1 });
    expect(store.getState().session.inFlight).not.toBeNull();
    await activateSession(store, 'b', c.client);
    const held = makeClient(chats, { hold: true });
    void activateSession(store, 'a', held.client);
    /* Not the older ['qa','aa'] drawn as if current: the old transcript of b stays under a loading state. */
    expect(texts(store)).not.toEqual(['qa', 'aa']);
    expect(store.getState().session.hydrating).toBe(true);
    held.release();
  });

  it('a deleted chat is forgotten: its pads are cleared and a 404 read does not keep its copy on screen', async () => {
    const chats = { a: ['qa', 'aa'], b: ['qb', 'ab'] };
    const c = makeClient(chats);
    const store = createStore();
    await softLoadSession(store, 'a', undefined, c.client);
    await activateSession(store, 'b', c.client);
    clearSessionPads('a');
    const held = makeClient(chats, { hold: true });
    void activateSession(store, 'a', held.client);
    expect(texts(store)).not.toEqual(['qa', 'aa']);
    held.release();

    await softLoadSession(store, 'b', undefined, c.client);
    await activateSession(store, 'a', c.client);
    await activateSession(store, 'b', c.client);
    const gone = { activate: c.client.activate, readSession: async () => ({ outcome: 'error', status: 404, message: 'session not found' }) } as unknown as SessionsClient;
    await activateSession(store, 'a', gone);
    expect(texts(store)).toEqual([]);
    const again = makeClient(chats, { hold: true });
    void activateSession(store, 'a', again.client);
    expect(texts(store)).not.toEqual(['qa', 'aa']);
    again.release();
  });

  it('a slow read for a chat the reader already left does not pull them back', async () => {
    const chats = { a: ['qa', 'aa'], b: ['qb', 'ab'] };
    const store = createStore();
    const slow = makeClient(chats, { hold: true });
    const fast = makeClient(chats);
    const first = activateSession(store, 'a', slow.client);
    await activateSession(store, 'b', fast.client);
    expect(store.getState().session.activeId).toBe('b');
    slow.release();
    await first;
    expect(store.getState().session.activeId).toBe('b');
    expect(texts(store)).toEqual(['qb', 'ab']);
  });
});

describe('warm reads are capped', () => {
  it('has at most two reads in flight, however many rows ask', async () => {
    resetSnapshotsForTest();
    const chats = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => [id, [`q${id}`, `a${id}`]]));
    const held = makeClient(chats, { hold: true });
    const store = createStore();
    for (const id of Object.keys(chats)) warmSnapshot(store, id, held.client);
    expect(held.reads.length).toBe(2);
    held.release();
  });
});
