import { describe, expect, it } from 'vitest';

import type { SessionsClient } from '../sessions/sessionsClient';
import { createStore } from '../state/store';
import { activateSession } from './sessionActions';

/*
 * Owner: "switching between different chats is giving me a lot of latency".
 * A same-workspace switch ran PUT /active and THEN GET /api/sessions/<id>, one
 * round trip after the other. The read names its chat, so it goes out with the
 * activate.
 */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  return { opened, open };
}

function client(order: string[], activateGate: Promise<void>): SessionsClient {
  return {
    activate: async (id: string) => {
      order.push('activate:start');
      await activateGate;
      order.push('activate:end');
      return { outcome: 'ok', body: { index: { version: 1, activeId: id, sessions: [{ id, title: 'B', createdAt: 'x', updatedAt: 'x' }] } } };
    },
    readSession: async (id: string) => {
      order.push('read:start');
      return { outcome: 'ok', body: { chat: { version: 1, sessionId: id, turns: [{ role: 'user', text: 'hello from B' }] } } };
    },
  } as unknown as SessionsClient;
}

describe('activateSession', () => {
  it('starts reading the chat before the activate has answered', async () => {
    const order: string[] = [];
    const g = gate();
    const store = createStore();
    const done = activateSession(store, 'chat-b', client(order, g.opened));
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['read:start', 'activate:start']);
    g.open();
    expect(await done).toEqual({ outcome: 'ok' });
  });

  it('paints the transcript and ends hydrating even when the read lands first', async () => {
    const order: string[] = [];
    const g = gate();
    const store = createStore();
    const done = activateSession(store, 'chat-b', client(order, g.opened));
    /* The read has landed; the activate has not. */
    await new Promise((r) => setTimeout(r, 0));
    expect(store.getState().session.turns.map((t) => t.text)).toEqual(['hello from B']);
    g.open();
    await done;
    const s = store.getState().session;
    expect(s.activeId).toBe('chat-b');
    expect(s.hydrating).toBe(false);
    expect(s.turns.map((t) => t.text)).toEqual(['hello from B']);
  });

  it('a refused activate is still reported', async () => {
    const store = createStore();
    const c = {
      activate: async () => ({ outcome: 'error', message: 'nope' }),
      readSession: async (id: string) => ({ outcome: 'ok', body: { chat: { version: 1, sessionId: id, turns: [] } } }),
    } as unknown as SessionsClient;
    expect(await activateSession(store, 'chat-b', c)).toEqual({ outcome: 'error', message: 'nope' });
  });
});
