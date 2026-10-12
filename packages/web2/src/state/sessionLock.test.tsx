import { describe, expect, it } from 'vitest';

import { createStore } from './store';

/*
 * THE SESSION LOCK — "how can we lock that chat session like cursor, where the
 * chat controls the other tabs — while the other chats can be used as well by
 * hands not just chat."                              — the owner, 2026-09-14
 *
 * The behaviour it turns on is tested where it lives (App.tsx follows a work
 * row's own `opens`). What is tested HERE is the contract underneath it, and
 * the part that carries the second half of his sentence: the lock is
 * PER-SESSION state, so it cannot reach into a conversation you are not in.
 */

describe('the session lock is a per-session decision', () => {
  it('is OFF until someone turns it on', () => {
    /*
     * A surface that moves on its own before anyone asked is the app taking the
     * wheel. Defaulting this to true would make every existing session start
     * driving the moment it shipped.
     */
    expect(createStore().getState().composer.sessionLocked).toBe(false);
  });

  it('turns on and off, and changes NOTHING else', () => {
    const store = createStore();
    const before = store.getState();
    store.dispatch({ type: 'composer/session-lock', locked: true });
    const after = store.getState();

    expect(after.composer.sessionLocked).toBe(true);
    /*
     * The lock decides WHO presses an affordance that already exists on every
     * work row — it does not open anything itself. If turning it on moved a
     * surface, the control would be doing two things and only saying one.
     */
    expect(after.shell).toBe(before.shell);
    expect(after.session).toBe(before.session);
    expect(after.canvas).toBe(before.canvas);

    store.dispatch({ type: 'composer/session-lock', locked: false });
    expect(store.getState().composer.sessionLocked).toBe(false);
  });

  it('does not touch the draft, the chips or the mode', () => {
    // It sits on the same row as the mode control; a reader toggling it must
    // not lose what they were typing.
    const store = createStore();
    store.dispatch({ type: 'composer/draft', text: 'half a question' });
    store.dispatch({ type: 'composer/session-lock', locked: true });
    expect(store.getState().composer.draft).toBe('half a question');
    expect(store.getState().composer.permission).toBe(
      createStore().getState().composer.permission,
    );
  });
});
