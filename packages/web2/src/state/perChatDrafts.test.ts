/* ══════════════════════════════════════════════════════════════════════════
   THE HALF-WRITTEN SENTENCE BELONGS TO THE CHAT IT WAS TYPED IN
   packages/web2/src/state/perChatDrafts.test.ts

   Owner, 2026-09-21: "study codex's logic, its open source ... look at how
   their session rail works, switching chats, new chats, all of the above and
   then import that logic on our format just in our UI style."

   Codex's picker captures the outgoing thread's input state before resuming
   the target and restores the target's after — `input_states: HashMap<ThreadId,
   InputState>` in `codex-rs/tui/src/app/session_picker.rs`.

   ── SEQUENCE HAD SHIPPED BOTH OF THE WRONG ANSWERS ────────────────────────

   It used to CARRY the draft across a switch, which put one thread's sentence
   in another thread's field — the owner's "press new chat, still can't type" —
   and left a reader one keystroke from asking the wrong repository a question.
   That was fixed by CLEARING, which is safe and throws work away: leave a
   thread mid-sentence to check something next door, come back, and it is gone.

   Per-chat is the only version where neither happens.

   ── AND THE PART THAT WAS WRONG THE FIRST TIME ────────────────────────────

   The first implementation put the swap on `session/browse`, which reads like
   the switch. It is not the one a reader takes: `optimisticSwitch` — what a
   rail row click calls — dispatches `session/index`, and only `createNewChat`
   and the catalogue soft-open dispatch `browse`. So drafts were captured on
   two paths out of three and restored on none that mattered, and it took a
   real browser to say so: type in A, switch to B, return, field empty.

   These cases drive the actions the product actually dispatches.
   ══════════════════════════════════════════════════════════════════════════ */

import { describe, expect, it } from 'vitest';

import { createStore } from './index';
import type { SessionIndexEntry } from '@sequence/api-types';

const A = 'session-a';
const B = 'session-b';

function entry(id: string): SessionIndexEntry {
  return {
    id,
    title: id,
    createdAt: '2026-09-21T09:00:00.000Z',
    updatedAt: '2026-09-21T09:00:00.000Z',
  };
}

const LIST = [entry(A), entry(B)];

/** The switch a rail row click performs (`optimisticSwitch`). */
function switchTo(store: ReturnType<typeof createStore>, id: string) {
  store.dispatch({ type: 'session/index', sessions: LIST, activeId: id });
}

function freshOn(id: string) {
  const store = createStore({});
  switchTo(store, id);
  return store;
}

describe('a draft belongs to its chat', () => {
  it('comes back when the reader returns', () => {
    const store = freshOn(A);
    store.dispatch({ type: 'composer/draft', text: 'why is the gateway hot?' });

    switchTo(store, B);
    expect(
      store.getState().composer.draft,
      'B must never open holding a sentence written in A',
    ).toBe('');

    store.dispatch({ type: 'composer/draft', text: 'what calls runAskPipeline?' });
    switchTo(store, A);

    expect(store.getState().composer.draft).toBe('why is the gateway hot?');
    switchTo(store, B);
    expect(store.getState().composer.draft).toBe('what calls runAskPipeline?');
  });

  it('is not remembered when there was nothing to remember', () => {
    const store = freshOn(A);
    /* Whitespace is not a sentence. An entry here means "this chat has words
       waiting in it", and a map of empty strings could not answer that. */
    store.dispatch({ type: 'composer/draft', text: '   ' });
    switchTo(store, B);

    expect(store.getState().composer.drafts[A]).toBeUndefined();
  });

  it('is forgotten once it has been sent', () => {
    const store = freshOn(A);
    store.dispatch({ type: 'composer/draft', text: 'ship it' });
    store.dispatch({ type: 'turn/send', at: 1 });

    expect(store.getState().composer.draft).toBe('');
    expect(
      store.getState().composer.drafts[A],
      'a sent sentence must not reappear the next time the reader comes back',
    ).toBeUndefined();

    switchTo(store, B);
    switchTo(store, A);
    expect(store.getState().composer.draft).toBe('');
  });

  it('survives a list refresh that is not a switch', () => {
    /*
     * `session/index` fires on every rename, pin and poll as well as on a
     * switch. Running the swap for those would save the live draft under its
     * own chat on any keystroke that raced a refresh — and, worse, restore a
     * stale copy over what the reader is in the middle of typing.
     */
    const store = freshOn(A);
    store.dispatch({ type: 'composer/draft', text: 'half a thought' });

    const renamed = [{ ...entry(A), title: 'Gateway heat' }, entry(B)];
    store.dispatch({ type: 'session/index', sessions: renamed, activeId: A });

    expect(store.getState().composer.draft).toBe('half a thought');
  });

  it('does not leak through a switch made by creating a chat', () => {
    /* `createNewChat` dispatches `session/browse` rather than going through
       `optimisticSwitch`, so the rule has to hold on that path too. */
    const store = freshOn(A);
    store.dispatch({ type: 'composer/draft', text: 'unsent words in A' });

    store.dispatch({ type: 'session/browse', activeId: B, turns: [], browseRepoPath: null });

    expect(store.getState().composer.draft).toBe('');
    expect(store.getState().composer.drafts[A]).toBe('unsent words in A');
  });
});
