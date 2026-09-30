import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { createStore, StoreProvider, type Store } from '../state';
import { V3App } from './V3App';
import { V3Chat } from './V3Chat';

/**
 * STOP — the owner's first ask on the 2026-09-17 walk of the installed app:
 * "have a way so we can stop chats if they're running."
 *
 * There was none. The foot drew ONE button, and mid-stream it turned into
 * "Queue", so the only gesture available while a turn ran added more work to
 * it. `composerPropsFrom` has exposed `onStop` — which aborts the live turn and
 * dispatches `turn/stopping` / `turn/stopped` — since the seat was wired.
 *
 * NEW FILE rather than more cases in `V3App.test.tsx`: that file describes the
 * shell, and this describes one control's contract — that nothing can run
 * without a way to end it.
 */

function runningStore(): Store {
  const store = createStore({});
  store.dispatch({ type: 'composer/draft', text: 'why is the gateway hot?' });
  store.dispatch({ type: 'turn/send', at: 1 });
  return store;
}

function drawChat(store: Store): void {
  render(
    <StoreProvider store={store}>
      <div className="v3-chat-col">
        <V3Chat />
      </div>
    </StoreProvider>,
  );
}

describe('the composer offers Stop while a turn is in flight', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.setAttribute('data-platform', 'win');
  });

  it('shows Stop, not Send, the moment a turn is running', () => {
    const store = runningStore();
    expect(store.getState().session.inFlight).not.toBeNull();
    drawChat(store);

    const stop = screen.getByTestId('composer-stop');
    expect(stop.getAttribute('aria-label')).toBe('Stop');
    expect(stop.textContent).toMatch(/Stop/);
    expect(screen.queryByTestId('composer-send')).toBeNull();
  });

  it('STOP ACTUALLY STOPS — it aborts the live turn rather than decorating', () => {
    /*
     * The assertion that matters. A Stop that renders and does nothing is worse
     * than no Stop: the reader presses it, the tokens keep burning, and they
     * have no idea whether it was heard. `turn/stopped` clearing `inFlight` is
     * the store's own terminal for an ended turn, and it is what the abort
     * path dispatches.
     */
    const store = runningStore();
    drawChat(store);

    fireEvent.click(screen.getByTestId('composer-stop'));

    expect(store.getState().session.inFlight).toBeNull();
    /* And the control goes back to being Send, because there is nothing left
       to stop. */
    expect(screen.getByTestId('composer-send')).toBeTruthy();
    expect(screen.queryByTestId('composer-stop')).toBeNull();
  });

  it('keeps Queue as a SECOND button, only when there are words to queue', () => {
    const store = runningStore();
    drawChat(store);
    /* A turn is running and the field is empty — nothing to queue. */
    expect(screen.queryByTestId('composer-queue')).toBeNull();

    fireEvent.change(screen.getByTestId('composer-field'), {
      target: { value: 'and check the cache too' },
    });
    expect(screen.getByTestId('composer-queue')).toBeTruthy();
    /* Stop does not go away to make room for it — that is the whole point. */
    expect(screen.getByTestId('composer-stop')).toBeTruthy();
  });

  it('ENTER STILL QUEUES, which is the behaviour Stop must not cost', () => {
    const store = runningStore();
    drawChat(store);
    const field = screen.getByTestId('composer-field');
    fireEvent.change(field, { target: { value: 'and check the cache too' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(store.getState().session.queued).toBe('and check the cache too');
    expect(store.getState().session.inFlight).not.toBeNull();
    expect(screen.getByTestId('composer-stop')).toBeTruthy();
  });

  it('is reachable in the whole app, not only in the isolated column', () => {
    const store = runningStore();
    render(<V3App appStore={store} />);
    expect(screen.getByTestId('composer-stop')).toBeTruthy();
    fireEvent.click(screen.getByTestId('composer-stop'));
    expect(store.getState().session.inFlight).toBeNull();
  });
});
