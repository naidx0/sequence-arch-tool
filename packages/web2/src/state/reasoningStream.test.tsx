import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createStore, REASONING_TAIL_CHARS } from './store';
import { V3App } from '../v3/V3App';
import type { AssistantTurn } from './types';

/*
 * THE THINKING REACHES THE READER — owner, 2026-09-22.
 *
 * "I kind of like seeing the thinking behind the agent ... Why is it calling
 * what it's calling? Instead of just seeing a working symbol."
 *
 * The provider had read the model's thinking channel since 2026-09-18 and
 * handed it to a callback nothing listened to. Bastion turns 5 and 11 were the
 * result: a model that thought and wrote nothing, shown as an empty bubble.
 */
function running() {
  const store = createStore();
  store.dispatch({ type: 'composer/draft', text: 'explain the harness' });
  store.dispatch({ type: 'turn/send', at: 1 });
  return store;
}

describe('the reasoning frame', () => {
  it('accumulates apart from the answer', () => {
    const store = running();
    store.dispatch({ type: 'turn/event', event: { type: 'reasoning', text: 'We need to ' }, at: 2 });
    store.dispatch({ type: 'turn/event', event: { type: 'reasoning', text: 'read the README.' }, at: 3 });
    store.dispatch({ type: 'turn/event', event: { type: 'delta', text: 'The README says' }, at: 4 });
    const live = store.getState().session.inFlight!;
    expect(live.reasoning).toBe('We need to read the README.');
    expect(live.text).toBe('The README says');
  });

  it('keeps only the tail of a very long think', () => {
    const store = running();
    store.dispatch({ type: 'turn/event', event: { type: 'reasoning', text: 'a'.repeat(REASONING_TAIL_CHARS) }, at: 2 });
    store.dispatch({ type: 'turn/event', event: { type: 'reasoning', text: 'END' }, at: 3 });
    const r = store.getState().session.inFlight!.reasoning!;
    expect(r.length).toBe(REASONING_TAIL_CHARS);
    expect(r.endsWith('END')).toBe(true);
  });

  it('counts as progress, so a long think is not a stalled provider', () => {
    const store = running();
    store.dispatch({ type: 'turn/event', event: { type: 'reasoning', text: 'hm' }, at: 50 });
    expect(store.getState().session.inFlight!.lastActivityAt).toBe(50);
  });

  it('stays on the committed turn — a turn that only thought is not empty', () => {
    const store = running();
    store.dispatch({ type: 'turn/event', event: { type: 'reasoning', text: 'Looking for the entry point.' }, at: 2 });
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: '' }, at: 3 });
    const turns = store.getState().session.turns;
    const last = turns[turns.length - 1] as AssistantTurn;
    expect(last.role).toBe('assistant');
    expect(last.reasoning).toBe('Looking for the entry point.');
    expect(last.text).toBe('');
  });

  it('a turn with no thinking carries no field', () => {
    const store = running();
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'done' }, at: 3 });
    const turns = store.getState().session.turns;
    expect('reasoning' in turns[turns.length - 1]!).toBe(false);
  });
});

describe('the fold shows it', () => {
  it('live: the thinking is in the sparkle fold while it streams', () => {
    const store = running();
    store.dispatch({ type: 'turn/event', event: { type: 'reasoning', text: 'I should call read_file on the README.' }, at: 2 });
    render(<V3App appStore={store} />);
    expect(screen.getByTestId('v3-thinking-fold').textContent).toContain('Thinking');
    expect(screen.getByTestId('v3-thinking').textContent).toContain('I should call read_file on the README.');
  });

  it('committed: a closed Thought fold that opens on press', () => {
    const store = running();
    store.dispatch({ type: 'turn/event', event: { type: 'reasoning', text: 'Checked the gateway first.' }, at: 2 });
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'The gateway fans out.' }, at: 3 });
    render(<V3App appStore={store} />);
    const fold = screen.getByTestId('v3-turn-thought');
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(fold);
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    expect(fold.parentElement!.textContent).toContain('Checked the gateway first.');
  });
});

describe('the clock keeps time while the thinking streams (2026-09-22)', () => {
  it('frames every 100ms do not stop the elapsed timer', async () => {
    const { vi } = await import('vitest');
    const { act } = await import('@testing-library/react');
    vi.useFakeTimers();
    try {
      const store = running();
      render(<V3App appStore={store} />);
      const first = screen.getByTestId('v3-thinking-elapsed').textContent;
      for (let i = 0; i < 40; i++) {
        act(() => {
          store.dispatch({ type: 'turn/event', event: { type: 'reasoning', text: 'x' }, at: Date.now() });
          vi.advanceTimersByTime(100);
        });
      }
      expect(screen.getByTestId('v3-thinking-elapsed').textContent).not.toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a click on the thinking folds it', () => {
  it('live: clicking the text closes the fold, and the header opens it again', () => {
    const store = running();
    store.dispatch({ type: 'turn/event', event: { type: 'reasoning', text: 'A long line of thought.' }, at: 2 });
    render(<V3App appStore={store} />);
    const trigger = screen.getByTestId('v3-thinking-fold');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByTestId('v3-thinking-body'));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('committed: clicking the open thought closes it', () => {
    const store = running();
    store.dispatch({ type: 'turn/event', event: { type: 'reasoning', text: 'Checked the gateway.' }, at: 2 });
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'Done.' }, at: 3 });
    render(<V3App appStore={store} />);
    const trigger = screen.getByTestId('v3-turn-thought');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByTestId('v3-turn-thought-body'));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
