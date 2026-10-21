import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetToolDetailForTest, writeToolDetail } from '../settings/toolDetailPreference';
import { createStore } from '../state/store';
import { V3App } from './V3App';

function thinking() {
  const store = createStore();
  store.dispatch({ type: 'composer/draft', text: 'explain the harness' });
  store.dispatch({ type: 'turn/send', at: 1 });
  store.dispatch({ type: 'turn/event', event: { type: 'reasoning', text: 'Reading the gateway first.' }, at: 2 });
  store.dispatch({ type: 'turn/event', event: { type: 'delta', text: 'The gateway fans out.' }, at: 3 });
  return store;
}

beforeEach(() => {
  localStorage.clear();
  resetToolDetailForTest();
});

describe('the live thought follows Focused and Detailed', () => {
  it('Focused: starts collapsed as one "Thought for" line, and expands on press', async () => {
    render(<V3App appStore={thinking()} />);
    const fold = await screen.findByTestId('v3-thinking-fold');
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('v3-thinking-fold-label').textContent).toMatch(/^Thought for /);
    fireEvent.click(fold);
    expect(fold.getAttribute('aria-expanded')).toBe('true');
  });

  it('Detailed: starts open, as before', async () => {
    writeToolDetail('detailed');
    render(<V3App appStore={thinking()} />);
    expect((await screen.findByTestId('v3-thinking-fold')).getAttribute('aria-expanded')).toBe('true');
  });

  it('a press survives a mode change: the reader choice wins over the default', async () => {
    render(<V3App appStore={thinking()} />);
    const fold = await screen.findByTestId('v3-thinking-fold');
    fireEvent.click(fold);
    writeToolDetail('detailed');
    expect(screen.getByTestId('v3-thinking-fold').getAttribute('aria-expanded')).toBe('true');
  });
});
