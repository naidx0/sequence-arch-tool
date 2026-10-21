import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { preloadChatLazies } from '../../test/preloadChat';
import { COMPOSER_PLACEHOLDER, CONNECT_AGENT_LABEL, composerPlaceholder } from '../chat/composerModel';
import { createStore, StoreProvider } from '../state';
import { V3Chat } from './V3Chat';

/* Composer round (0.1.8.4), item 5: a calmer chat box. Every change is locked here. */

beforeAll(preloadChatLazies, 120_000);
beforeEach(() => localStorage.clear());

const chat2 = readFileSync(resolve(process.cwd(), 'src/shell2/chat2.css'), 'utf8').replace(/\r\n/g, '\n');

function draw() {
  const store = createStore({});
  render(
    <StoreProvider store={store}>
      <div className="v3-chat-col">
        <V3Chat />
      </div>
    </StoreProvider>,
  );
  return store;
}

describe('the placeholder matches the state', () => {
  it('is the plain question by default and keeps the locked sentence', () => {
    expect(composerPlaceholder({ busy: false, agent: false, noModel: false })).toBe(COMPOSER_PLACEHOLDER);
  });
  it('says follow-ups queue while a turn runs', () => {
    expect(composerPlaceholder({ busy: true, agent: false, noModel: false })).toBe('Type a follow-up to queue it');
    expect(composerPlaceholder({ busy: true, agent: true, noModel: false })).toBe('Type a follow-up to queue it');
  });
  it('asks for a task in an agent chat, and for a connection when there is nothing to send to', () => {
    expect(composerPlaceholder({ busy: false, agent: true, noModel: false })).toBe('Give the agent a task');
    expect(composerPlaceholder({ busy: false, agent: false, noModel: true })).toBe('Connect an agent or model to send');
  });
  it('every sentence is short and plain: at most 42 characters, no dash', () => {
    for (const busy of [true, false])
      for (const agent of [true, false])
        for (const noModel of [true, false]) {
          const p = composerPlaceholder({ busy, agent, noModel });
          expect(p.length).toBeLessThanOrEqual(42);
          expect(p).not.toMatch(/[\u2014\u2013\u00b7]/);
        }
  });
  it('the field shows it', () => {
    draw();
    const field = screen.getByTestId('composer-field') as HTMLTextAreaElement;
    expect([COMPOSER_PLACEHOLDER, 'Connect an agent or model to send']).toContain(field.placeholder);
    expect(CONNECT_AGENT_LABEL).toBeTruthy();
  });
});

describe('the + button has one accurate name', () => {
  it('is named for the menu it opens, once', () => {
    draw();
    const plus = screen.getByTestId('v3-tools-trigger');
    expect(plus.getAttribute('aria-label')).toBe('Add to the message');
    expect(plus.getAttribute('title')).toBe('Add to the message');
    fireEvent.click(plus);
    expect(screen.getByRole('menu', { name: 'Add to the message' })).toBeTruthy();
  });
});

describe('the send button says why it is off', () => {
  it('a disabled send explains itself in its tooltip; its name stays Send', () => {
    draw();
    const send = screen.getByTestId('composer-send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(send.getAttribute('aria-label')).toBe('Send');
    expect(send.getAttribute('title')).toBe('Write a message to send');
  });
});

describe('the row is spaced from tokens, not raw pixels', () => {
  it('.s2-cb uses the spacing scale for its gap and padding', () => {
    const at = chat2.indexOf('\n.s2-cb {');
    const rule = chat2.slice(chat2.indexOf('{', at), chat2.indexOf('}', at));
    expect(rule).toMatch(/gap:\s*var\(--sp-6\)/);
    expect(rule).toMatch(/padding:\s*var\(--sp-6\) var\(--sp-8\) var\(--sp-10\) var\(--sp-10\)/);
  });
});
