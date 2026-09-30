import { describe, expect, it } from 'vitest';

import { createStore } from './store';
import { foldTranscript } from '../chat/transcriptModel';
import type { AskEvent } from './types';

/*
 * THE MOUNT — the frame arrives, the state moves, the transcript shows it.
 *
 * The server refuses an invalid list and the component renders a valid one;
 * neither proves the wire between them is connected. This file exists for the
 * reason `sendPayload.test.tsx` does: the pieces either side of a seam can both
 * be green while nothing crosses it.
 */

function started() {
  const store = createStore();
  store.dispatch({ type: 'composer/draft', text: 'refactor the parser' });
  store.dispatch({ type: 'turn/send', at: 1_000 } as never);
  return store;
}

function feed(store: ReturnType<typeof createStore>, event: AskEvent) {
  store.dispatch({ type: 'turn/event', event, at: 2_000 } as never);
}

const FIRST: AskEvent = {
  type: 'todo:list',
  items: [
    { id: 's1', title: 'Read the parser', status: 'active' },
    { id: 's2', title: 'Add the guard', status: 'pending' },
  ],
} as AskEvent;

describe('the work list crosses the wire', () => {
  it('a todo:list frame lands on the in-flight turn', () => {
    const store = started();
    feed(store, FIRST);
    expect(store.getState().session.inFlight?.todos).toEqual([
      { id: 's1', title: 'Read the parser', status: 'active' },
      { id: 's2', title: 'Add the guard', status: 'pending' },
    ]);
  });

  it('a second frame REPLACES the first — it never merges', () => {
    // The server's `update_todos` replaces. A client that merged would drift
    // away from the list the server carries into the next round's prompt, and
    // the screen would then disagree with the model about what has been done.
    const store = started();
    feed(store, FIRST);
    feed(store, {
      type: 'todo:list',
      items: [{ id: 's1', title: 'Read the parser', status: 'done' }],
    } as AskEvent);
    expect(store.getState().session.inFlight?.todos).toEqual([
      { id: 's1', title: 'Read the parser', status: 'done' },
    ]);
  });

  it('adds NO work row — the list is the progress display', () => {
    const store = started();
    const before = store.getState().session.inFlight?.work.length ?? 0;
    feed(store, FIRST);
    expect(store.getState().session.inFlight?.work.length).toBe(before);
  });

  it('the transcript carries it as its own item, above the answer', () => {
    const store = started();
    feed(store, FIRST);
    const state = store.getState();
    const items = foldTranscript(state.session.turns, state.session.inFlight, {});
    const kinds = items.map((i) => i.kind);
    const todoAt = kinds.indexOf('todos');
    expect(todoAt).toBeGreaterThanOrEqual(0);
    // Above the prose it belongs to: a reader checks progress while the turn
    // runs, and scrolling past the answer to find it defeats the point.
    const proseAt = kinds.indexOf('prose');
    if (proseAt >= 0) expect(todoAt).toBeLessThan(proseAt);
  });

  it('a turn that declared none produces no item at all', () => {
    const store = started();
    const state = store.getState();
    const items = foldTranscript(state.session.turns, state.session.inFlight, {});
    expect(items.some((i) => i.kind === 'todos')).toBe(false);
  });
});
