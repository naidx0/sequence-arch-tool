import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { createStore, StoreProvider, type Store } from '../state';
import { V3App } from './V3App';

/**
 * THE COMPOSER STOPS TAKING INPUT — the owner's report, 2026-09-17, built from
 * the shape he described rather than a shape that was convenient to build:
 *
 *   "it's not letting me type in the chat box anymore … press new chat, still
 *    can't type"
 *
 * The run-up he gave: he pasted a prompt, dismissed the goalbar, and a turn was
 * running / had just finished with a file-edit proposal pending. So each step
 * below is one of those, in that order, and the assertion at the end is the
 * only thing that matters — a character typed into the field appears in the
 * field.
 */

function proposalStore(): Store {
  const store = createStore({});
  store.dispatch({
    type: 'session/index',
    sessions: [{ id: 's-type', title: 'Session 7316', pinned: false, updatedAt: '2026-01-01' }],
    activeId: 's-type',
  } as never);
  store.dispatch({ type: 'composer/draft', text: 'make the gateway idempotent' });
  store.dispatch({ type: 'turn/send', at: 1 });
  store.dispatch({
    type: 'turn/event',
    at: 2,
    event: {
      type: 'edit:proposal',
      title: 'Guard the gateway',
      files: [{ path: 'src/gateway.ts', content: 'export const guard = true;\n' }],
    },
  } as never);
  return store;
}

function type(field: HTMLTextAreaElement, text: string): void {
  fireEvent.change(field, { target: { value: text } });
}

describe('owner report — the chat box stops accepting input', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.setAttribute('data-platform', 'win');
  });

  it('takes a pasted prompt and then more typing, with a proposal pending', () => {
    const store = proposalStore();
    store.dispatch({ type: 'turn/stopped', at: 3 } as never);
    render(<V3App appStore={store} />);

    const field = screen.getByTestId('composer-field') as HTMLTextAreaElement;
    expect(field.disabled).toBe(false);
    expect(field.readOnly).toBe(false);

    fireEvent.paste(field, { clipboardData: { getData: () => 'pasted prompt' } });
    type(field, 'pasted prompt');
    expect(field.value).toBe('pasted prompt');

    type(field, 'pasted prompt more');
    expect(field.value).toBe('pasted prompt more');
  });

  it('still takes typing after the goalbar is dismissed', () => {
    const store = proposalStore();
    store.dispatch({ type: 'turn/stopped', at: 3 } as never);
    render(<V3App appStore={store} />);
    const dismiss = screen.queryByTestId('v3-goalbar-dismiss');
    if (dismiss) fireEvent.click(dismiss);

    const field = screen.getByTestId('composer-field') as HTMLTextAreaElement;
    type(field, 'after dismiss');
    expect(field.value).toBe('after dismiss');
  });

  it('NEVER LETS THE FIELD AND THE STORE DISAGREE about what is in the draft', () => {
    /*
     * The field is controlled. `onSend` used to blank it by hand
     * (`textareaRef.current.value = ''`) on top of dispatching, and
     * `composerPropsFrom.onSend` does NOT always clear the draft — a
     * whitespace-only draft returns before it dispatches anything. The box was
     * then empty while the store still held the words, React saw an unchanged
     * `value` prop and wrote nothing, and the next Send sent text nobody could
     * see. A blank box the reader cannot type meaningfully into is exactly what
     * was reported.
     */
    const store = createStore({});
    render(<V3App appStore={store} />);
    const field = screen.getByTestId('composer-field') as HTMLTextAreaElement;

    type(field, '   ');
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(field.value).toBe(store.getState().composer.draft);
    expect(field.value).toBe('   ');

    /* And it still takes a real character on top of that. */
    type(field, '   hello');
    expect(field.value).toBe('   hello');
    expect(store.getState().composer.draft).toBe('   hello');
  });

  it('still takes typing after a queue mid-turn, and after New Chat', () => {
    const store = proposalStore();
    render(<V3App appStore={store} />);
    const field = screen.getByTestId('composer-field') as HTMLTextAreaElement;

    /* A turn is in flight, so Enter queues. This is the path that imperatively
       blanked the textarea. */
    type(field, 'a follow-up while it runs');
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(field.value).toBe('');

    type(field, 'and another');
    expect(field.value).toBe('and another');

    fireEvent.click(screen.getByRole('button', { name: 'New Chat' }));
    const after = screen.getByTestId('composer-field') as HTMLTextAreaElement;
    expect(after.disabled).toBe(false);
    /*
     * NOTE FOR THE NEXT READER. `session/browse` (state/store.ts) empties the
     * turns, the in-flight turn, the queue, the canvas and `filesFocus` and
     * does NOT touch `composer.draft`, so whatever was in the box before New
     * Chat is still in it after. That is the other half of the owner's report
     * — "press new chat, still can't type" — and the fix is one line in a
     * reducer this seat does not own. What IS asserted here is the invariant
     * this file exists for: whatever the draft is, the field shows it and
     * accepts more.
     */
    expect(after.value).toBe(store.getState().composer.draft);
    type(after, 'after new chat');
    expect(after.value).toBe('after new chat');
  });
});
