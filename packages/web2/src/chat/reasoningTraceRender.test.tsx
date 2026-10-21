import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetToolDetailForTest, writeToolDetail } from '../settings/toolDetailPreference';
import { createStore } from '../state/store';
import { V3App } from '../v3/V3App';

/* ══════════════════════════════════════════════════════════════════════════
   THE FOCUSED-MODE TRACE RENDER
   packages/web2/src/chat/reasoningTraceRender.test.tsx

   Drives the real store and the real app the way reasoningStream.test.tsx
   does: reasoning frames go in through `turn/event`, so every step on screen
   traces to a frame the provider actually sent. The contract it locks is the
   AI-Traces port's visible shape — a fold that OPENS ONTO STEPS, not onto a
   wall of text, and stays shut at more than a few steps until the reader
   asks for the rest.
   ══════════════════════════════════════════════════════════════════════════ */

const ONE_TURN_OF_THINKING = [
  'The request lands on ask, so I trace the ask pipeline before answering.',
  'Read the router first: gateway/app/routes.py decides where /ask goes.',
  'Then follow the orders handler into payments to see the call order.',
  'The digest cuts at 300 edges, so I should name which packages read zero.',
  'Write the answer with the file:line citations the graph actually has.',
  'Keep it under 150 words and end with the coverage caveat.',
  'If the premise check comes back unverifiable, say so instead of guessing.',
  'Draft the closing question so the reader can steer the next turn.',
].join('\n\n');

function thinkingStore(text: string, answer = 'The gateway fans out to three services.') {
  const store = createStore();
  store.dispatch({ type: 'composer/draft', text: 'trace the ask path' });
  store.dispatch({ type: 'turn/send', at: 1 });
  store.dispatch({ type: 'turn/event', event: { type: 'reasoning', text }, at: 2 });
  store.dispatch({ type: 'turn/event', event: { type: 'result', text: answer }, at: 3 });
  return store;
}

async function openThought() {
  const fold = await screen.findByTestId('v3-turn-thought');
  expect(fold.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(fold);
  expect(fold.getAttribute('aria-expanded')).toBe('true');
  return fold;
}

function steps() {
  return screen.getAllByTestId('reasoning-step');
}

beforeEach(() => {
  localStorage.clear();
  resetToolDetailForTest();
});

describe('the committed thought opens onto steps, not a wall', () => {
  it('the trace renders one structured step per paragraph', async () => {
    render(<V3App appStore={thinkingStore(ONE_TURN_OF_THINKING)} />);
    await openThought();
    expect(await screen.findByTestId('reasoning-trace')).toBeTruthy();
    fireEvent.click(screen.getByTestId('reasoning-more'));
    expect(steps().length).toBe(8);
    expect(steps().map((el) => el.textContent)).toEqual(ONE_TURN_OF_THINKING.split('\n\n'));
    expect(steps()[0]!.textContent).toContain('The request lands on ask');
    expect(steps()[1]!.textContent).toContain('Read the router first');
  });

  it('more than a few steps stay collapsed until the reader expands them inline', async () => {
    render(<V3App appStore={thinkingStore(ONE_TURN_OF_THINKING)} />);
    await openThought();
    await screen.findByTestId('reasoning-trace');
    expect(steps().length).toBe(6);
    const more = screen.getByTestId('reasoning-more');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(more.textContent).toContain('2');
    fireEvent.click(more);
    expect(screen.getByTestId('reasoning-more').getAttribute('aria-expanded')).toBe('true');
    expect(steps().length).toBe(8);
    expect(screen.getByTestId('v3-turn-thought').getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByTestId('reasoning-more'));
    expect(steps()).toHaveLength(6);
    expect(screen.getByTestId('v3-turn-thought').getAttribute('aria-expanded')).toBe('true');
  });

  it('a short think renders whole, with no more control', async () => {
    render(<V3App appStore={thinkingStore('Checked the gateway first.') } />);
    await openThought();
    await screen.findByTestId('reasoning-trace');
    expect(steps().length).toBe(1);
    expect(screen.queryByTestId('reasoning-more')).toBeNull();
  });

  it('a named model wears its mark on the thought fold, not the spark', async () => {
    const store = createStore();
    store.dispatch({ type: 'composer/model', model: { model: 'claude-sonnet-4', origin: 'api-key' } });
    store.dispatch({ type: 'composer/draft', text: 'trace the ask path' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({ type: 'turn/event', event: { type: 'reasoning', text: 'Checked the gateway first.' }, at: 2 });
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'The gateway fans out to three services.' }, at: 3 });
    render(<V3App appStore={store} />);
    const fold = await screen.findByTestId('v3-turn-thought');
    expect(fold.querySelector('[data-brand="claude"]')).toBeTruthy();
    expect(fold.querySelector('[data-icon="spark"]')).toBeNull();
  });

  it('a thought keeps the answering model after the composer switches', async () => {
    const store = createStore();
    store.dispatch({ type: 'composer/model', model: { model: 'claude-sonnet-4', origin: 'api-key' } });
    store.dispatch({ type: 'composer/draft', text: 'trace the ask path' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({ type: 'turn/event', event: { type: 'reasoning', text: 'Checked the gateway first.' }, at: 2 });
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'The gateway fans out to three services.' }, at: 3 });
    store.dispatch({ type: 'composer/model', model: { model: 'gpt-5', origin: 'api-key' } });
    render(<V3App appStore={store} />);
    const fold = await screen.findByTestId('v3-turn-thought');
    expect(fold.querySelector('[data-brand="claude"]')).toBeTruthy();
    expect(fold.querySelector('[data-brand="openai"]')).toBeNull();
  });

  it('a heading the model wrote labels its step', async () => {
    render(<V3App appStore={thinkingStore('Orient.\n\n## The gateway\n\nIt fans out.')} />);
    await openThought();
    await screen.findByTestId('reasoning-trace');
    const labelled = screen.getAllByTestId('reasoning-step').some((el) => el.textContent!.includes('The gateway'));
    expect(labelled).toBe(true);
  });
});

describe('empty and garbage reasoning render nothing, and never crash', () => {
  it('no reasoning frames at all: no fold', () => {
    render(<V3App appStore={thinkingStore('', 'Done.')} />);
    expect(screen.queryByTestId('v3-turn-thought')).toBeNull();
    expect(screen.queryByTestId('reasoning-trace')).toBeNull();
  });

  it('whitespace reasoning: no fold body', () => {
    render(<V3App appStore={thinkingStore('\n\n   \n\t', 'It flows.')} />);
    expect(screen.queryByTestId('v3-turn-thought')).toBeNull();
  });
});

describe('the live fold shows the same trace while the think streams', () => {
  it('reasoning frames mid-turn render as steps with the in-flight tail marked, under default short renders', async () => {
    const store = createStore();
    store.dispatch({ type: 'composer/draft', text: 'trace the ask path' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({ type: 'turn/event', event: { type: 'reasoning', text: ONE_TURN_OF_THINKING }, at: 2 });
    render(<V3App appStore={store} />);
    const fold = await screen.findByTestId('v3-thinking-fold');
    expect(fold.getAttribute('aria-expanded')).toBe('false'); // Focused: collapsed till asked
    expect(screen.getByTestId('v3-thinking-body').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByTestId('v3-thinking-body').hasAttribute('inert')).toBe(true);
    fireEvent.click(fold);
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    await screen.findByTestId('reasoning-trace');
    expect(steps().length).toBeGreaterThan(0);
    expect(screen.getByTestId('v3-thinking-fold-label').textContent).toContain('Thinking');
    fireEvent.click(screen.getByTestId('reasoning-more'));
    expect(steps()).toHaveLength(8);
    expect(steps().filter((el) => el.getAttribute('data-open') === 'true')).toHaveLength(1);
    expect(steps()[7]!.getAttribute('data-open')).toBe('true');
    expect(fold.getAttribute('aria-expanded')).toBe('true');
  });

  it('Detailed preserves the open live fold and the complete raw reasoning', async () => {
    writeToolDetail('detailed');
    const store = createStore();
    store.dispatch({ type: 'composer/draft', text: 'trace the ask path' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({ type: 'turn/event', event: { type: 'reasoning', text: 'First, orient.\n\nThen follow the caller.' }, at: 2 });
    render(<V3App appStore={store} />);
    expect((await screen.findByTestId('v3-thinking-fold')).getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByTestId('reasoning-trace')).toBeNull();
    expect(screen.getByTestId('v3-thinking-body').textContent).toBe('First, orient.\n\nThen follow the caller.');
    expect(screen.getByTestId('v3-thinking-body').hasAttribute('inert')).toBe(false);
  });
});
