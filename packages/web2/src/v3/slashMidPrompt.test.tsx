import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { preloadChatLazies } from '../../test/preloadChat';
import { createStore, StoreProvider } from '../state';
import { V3Chat } from './V3Chat';

/*
 * A slash command typed inside a sentence. The owner, 2026-10-20: "/ commands
 * aren't able to be typed in the middle of prompts". The palette opens on a
 * whole word after whitespace; a path never opens it; picking a text-producing
 * row writes into the sentence and keeps the prose around it.
 */

beforeAll(preloadChatLazies, 120_000);

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url) === '/api/skills') {
        return new Response(JSON.stringify({ skills: [{ slug: 'review', name: 'Review', description: 'Reviews the change' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function draw() {
  const store = createStore({});
  render(
    <StoreProvider store={store}>
      <div className="v3-chat-col">
        <V3Chat componentsClient={{ list: async () => ({ enabled: true, mode: 'approve', groups: [] }), setSettings: async () => true, setWorkspace: async () => true, answerOffer: async () => true }} />
      </div>
    </StoreProvider>,
  );
  return { store };
}

const type = (field: HTMLElement, text: string) => act(() => void fireEvent.change(field, { target: { value: text } }));
const fieldValue = () => (screen.getByTestId('composer-field') as HTMLTextAreaElement).value;

describe('slash commands inside a sentence', () => {
  it('opens the palette after whitespace and inserts the row where the command was', async () => {
    const { store } = draw();
    const field = screen.getByTestId('composer-field');
    type(field, 'please run /rev');
    const palette = await screen.findByTestId('v3-slash');
    const row = [...palette.querySelectorAll('[data-testid="v3-slash-item"]')].find((b) => b.getAttribute('data-command') === 'review');
    expect(row).toBeTruthy();
    fireEvent.mouseDown(row!);
    expect(fieldValue()).toBe('please run Review: ');
    expect(store.getState().composer.draft).toBe('please run Review: ');
  });

  it('does not open on a path glued to a word, or with prose after the token', async () => {
    draw();
    const field = screen.getByTestId('composer-field');
    type(field, 'look at packages/web2/src');
    expect(screen.queryByTestId('v3-slash')).toBeNull();
    type(field, 'look at /packages/web2 please');
    expect(screen.queryByTestId('v3-slash')).toBeNull();
  });

  it('never offers a mode or a goal inside the sentence', async () => {
    draw();
    const field = screen.getByTestId('composer-field');
    type(field, 'please /');
    const palette = await screen.findByTestId('v3-slash');
    const names = [...palette.querySelectorAll('[data-testid="v3-slash-item"]')].map((b) => b.getAttribute('data-command'));
    expect(names).not.toContain('plan');
    expect(names).not.toContain('goal');
    expect(names).toContain('review');
  });
});
