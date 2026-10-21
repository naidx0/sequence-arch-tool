import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { UIAction } from '@sequence/genui';

import { chatQueueKey, promptQueue } from '../composer/promptQueue';
import { GENUI_ACTION_EVENT, GENUI_TURN_EVENT, type GenUIActionDetail } from '../genui/chatActions';
import { createStore, StoreProvider, type Store } from '../state';
import { V3Chat } from './V3Chat';

/* A click on a generated card reaches the mounted chat: one click is one turn. */

const action = (name = 'fix', elementId = 'b'): UIAction => ({ kind: 'ui.action', surfaceId: 's', name, params: {}, elementId, state: {}, at: 1 });
const click = (over: Partial<GenUIActionDetail> = {}, a: UIAction = action()): void => {
  const detail: GenUIActionDetail = { action: a, prompt: `[ui.action] clicked ${a.name}`, ...over };
  act(() => {
    window.dispatchEvent(new CustomEvent(GENUI_ACTION_EVENT, { detail }));
  });
};
const userTexts = (store: Store): string[] => store.getState().session.turns.flatMap((t) => (t.role === 'user' && 'text' in t ? [t.text] : []));

function draw(store: Store): void {
  render(
    <StoreProvider store={store}>
      <div className="v3-chat-col">
        <V3Chat />
      </div>
    </StoreProvider>,
  );
}

function runningStore(): Store {
  const store = createStore({});
  store.dispatch({ type: 'composer/draft', text: 'why is the gateway hot?' });
  store.dispatch({ type: 'turn/send', at: 1 });
  return store;
}

describe('a click on a generated card reaches the agent', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.setAttribute('data-platform', 'win');
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('one click is exactly one user turn', () => {
    const store = createStore({});
    draw(store);
    click();
    expect(userTexts(store).filter((t) => t === '[ui.action] clicked fix')).toHaveLength(1);
  });

  it('a double click sends once', () => {
    const store = createStore({});
    draw(store);
    click();
    click();
    expect(userTexts(store).filter((t) => t === '[ui.action] clicked fix')).toHaveLength(1);
  });

  it('the spinner clears at turn end: the chat announces busy, then idle', () => {
    const store = runningStore();
    const seen: boolean[] = [];
    const on = (e: Event): void => void seen.push((e as CustomEvent<{ busy: boolean }>).detail.busy);
    window.addEventListener(GENUI_TURN_EVENT, on);
    draw(store);
    expect(seen.at(-1)).toBe(true);
    fireEvent.click(screen.getByTestId('composer-stop'));
    window.removeEventListener(GENUI_TURN_EVENT, on);
    expect(seen.at(-1)).toBe(false);
  });

  it('while busy, a whileBusy action steers (queues here: no agent run) and any other is dropped', () => {
    const store = runningStore();
    draw(store);
    const key = chatQueueKey(null, store.getState().session.activeId ?? 'none');
    click({ whileBusy: true }, action('pause', 'p'));
    click({}, action('merge', 'm'));
    expect(promptQueue.items(key).map((i) => i.text)).toEqual(['[ui.action] clicked pause']);
    for (const i of promptQueue.items(key)) promptQueue.remove(key, i.id);
  });
});
