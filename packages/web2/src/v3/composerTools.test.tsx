import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { preloadChatLazies } from '../../test/preloadChat';
import type { ComponentsClient, ComponentsListing } from '../components/componentsClient';
import { createStore, StoreProvider } from '../state';
import { V3Chat } from './V3Chat';

/*
 * Composer round (0.1.8.4): be-ambitious (a prompt tool), REA and RSI-Anything (components) are picked from
 * Components, not from the + menu's top level. Picking each runs the handler it ran before.
 */

beforeAll(preloadChatLazies, 120_000);

const REA = 'security/reverse-engineer-anything';
const RSI = 'ml/rsi-anything';

const LISTING: ComponentsListing = {
  enabled: true,
  mode: 'approve',
  groups: [
    { id: 'security', name: 'Security', blurb: 'Reverse engineering.', components: [{ id: REA, name: 'Reverse Engineer Anything', blurb: 'Take a binary apart.', installed: true, inWorkspace: true }] },
    { id: 'ml', name: 'Machine learning', blurb: 'ML workflows.', components: [{ id: RSI, name: 'Rsi Anything', blurb: 'Propose, predict, select, evaluate.', installed: true, inWorkspace: true }] },
  ],
};

const client = (listing: ComponentsListing | null = LISTING): ComponentsClient => ({
  list: async () => listing,
  setSettings: async () => true,
  setWorkspace: async () => true,
  answerOffer: async () => true,
});

const calls: Array<{ url: string; method: string; body: string }> = [];
beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', body: String(init?.body ?? '') });
      if (String(url).includes('/api/skills/be-ambitious/run')) {
        return new Response(JSON.stringify({ slug: 'be-ambitious', prompt: 'Deeper prompt.' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 404 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function draw(draft = '') {
  const store = createStore({});
  if (draft) store.dispatch({ type: 'composer/draft', text: draft });
  render(
    <StoreProvider store={store}>
      <div className="v3-chat-col">
        <V3Chat componentsClient={client()} />
      </div>
    </StoreProvider>,
  );
  return store;
}

async function openPicker() {
  fireEvent.click(screen.getByTestId('v3-tools-trigger'));
  fireEvent.click(await screen.findByTestId('v3-tools-components'));
  return screen.findByTestId('components-picker');
}

describe('be-ambitious, REA and RSI live in Components', () => {
  it('none of the three is a top-level + menu row', async () => {
    draw('a draft');
    fireEvent.click(screen.getByTestId('v3-tools-trigger'));
    await screen.findByTestId('v3-tools-components');
    const menu = screen.getByRole('menu', { name: 'Add to the message' });
    expect(screen.queryByTestId('v3-tools-rewrite')).toBeNull();
    const text = menu.textContent ?? '';
    expect(text).not.toMatch(/be-ambitious/i);
    expect(text).not.toMatch(/Reverse Engineer|Rsi Anything|RSI/);
  });

  it('all three appear in the picker', async () => {
    draw('a draft');
    const picker = await openPicker();
    expect(within(picker, 'v3-tools-rewrite').textContent).toContain('be-ambitious');
    const ids = Array.from(picker.querySelectorAll('[data-component]')).map((e) => e.getAttribute('data-component'));
    expect(ids).toContain(REA);
    expect(ids).toContain(RSI);
  });

  it('picking be-ambitious runs the rewrite and sends nothing; it needs a draft', async () => {
    const store = draw('find out why checkout got slower');
    await openPicker();
    fireEvent.click(screen.getByTestId('v3-tools-rewrite'));
    await waitFor(() => expect(store.getState().composer.draft).toBe('Deeper prompt.'));
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.url)).toEqual(['/api/skills/be-ambitious/run']);
  });

  it('be-ambitious is disabled with no draft', async () => {
    draw('');
    await openPicker();
    expect((screen.getByTestId('v3-tools-rewrite') as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([REA, RSI])('picking %s adds its component chip, as before', async (id) => {
    const store = draw();
    const picker = await openPicker();
    fireEvent.click(picker.querySelector(`[data-component="${id}"]`)!);
    expect(store.getState().composer.chips.find((c) => c.kind === 'component')).toMatchObject({ ref: id });
  });
});

function within(root: HTMLElement, testId: string): HTMLElement {
  const el = root.querySelector(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`no ${testId} in the picker`);
  return el as HTMLElement;
}

describe('a component opens its definition from the picker', () => {
  it('the details button shows a short definition; Use adds the chip', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url) === `/api/components/${RSI}`
          ? new Response(JSON.stringify({ id: RSI, name: 'Rsi Anything', blurb: 'b', source: 'Gen-Verse/RSI-Anything', body: 'x'.repeat(9000) }), { status: 200, headers: { 'content-type': 'application/json' } })
          : new Response('{}', { status: 404 }),
      ),
    );
    const store = draw();
    const picker = await openPicker();
    fireEvent.click(picker.querySelector(`[data-details="${RSI}"]`)!);
    const excerpt = await screen.findByTestId('component-detail-excerpt');
    expect((excerpt.textContent ?? '').length).toBeLessThan(2000);
    fireEvent.click(screen.getByTestId('component-detail-use'));
    expect(store.getState().composer.chips.find((c) => c.kind === 'component')).toMatchObject({ ref: RSI, label: 'Rsi Anything' });
  });
});
