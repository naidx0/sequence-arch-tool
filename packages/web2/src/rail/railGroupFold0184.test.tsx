import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetProfiles } from '../chat/agentProfiles';
import { createSessionsClient } from '../sessions/sessionsClient';
import { SessionPanel } from '../shell2/SessionPanel';
import { StoreProvider } from '../state/connect';
import { createStore } from '../state/store';
import cssRaw from './sectionRail.css?raw';

/*
 * 0.1.8.4 (owner: "I like how it is all sub-sectioned, but those sections should be expandable"): each Components
 * group heading is a button that folds its own group. Groups fold independently; a filter opens the groups it matches.
 */

beforeEach(() => {
  resetProfiles();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const comp = (p: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${p}-${i}`, name: `${p.toUpperCase()} ${i}`, blurb: `${p} blurb` }));
const LISTING = {
  enabled: true,
  mode: 'approve',
  groups: [
    { id: 'core', name: 'Core', blurb: '', components: comp('core', 6) },
    { id: 'ml', name: 'Machine learning', blurb: '', components: [...comp('ml', 2), { id: 'rsi-anything', name: 'rsi-anything', blurb: 'loop', }] },
    { id: 'empty', name: 'Nothing here', blurb: '', components: [] },
  ],
};
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
const f = vi.fn(async (input: RequestInfo | URL) => (String(input) === '/api/components' ? json(LISTING) : new Response('{}', { status: 404 }))) as unknown as typeof fetch;

async function mountOpen() {
  const store = createStore({});
  const client = createSessionsClient((async () => new Response('{}', { status: 404 })) as typeof fetch);
  render(
    <StoreProvider store={store}>
      <SessionPanel client={client} skillsSource={async () => null} railFetch={f} />
    </StoreProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Components' }));
  await screen.findAllByTestId('rail-group-head');
}
const head = (id: string) => document.querySelector(`[data-group="${id}"] [data-testid="rail-group-head"]`) as HTMLElement;
const rowsOf = (id: string) => [...document.querySelectorAll(`[data-group="${id}"] [data-testid="rail-component"]`)];

describe('Components groups fold (0.1.8.4)', () => {
  it('every heading is a button with aria-expanded and aria-controls naming a panel that exists; all start open', async () => {
    await mountOpen();
    for (const id of ['core', 'ml']) {
      const h = head(id);
      expect(h.tagName).toBe('BUTTON');
      expect(h.getAttribute('type')).toBe('button');
      expect(h.getAttribute('aria-expanded')).toBe('true');
      const panel = document.getElementById(h.getAttribute('aria-controls')!);
      expect(panel).toBeTruthy();
      expect(panel!.closest(`[data-group="${id}"]`)).toBeTruthy();
    }
    expect(rowsOf('core')).toHaveLength(6);
    expect(rowsOf('ml')).toHaveLength(3);
  });

  it('a click folds only its own group and a second click opens it; the count stays on the heading', async () => {
    await mountOpen();
    fireEvent.click(head('core'));
    expect(head('core').getAttribute('aria-expanded')).toBe('false');
    expect(rowsOf('core')).toHaveLength(0);
    expect(head('core').textContent).toBe('Core6');
    expect(head('ml').getAttribute('aria-expanded')).toBe('true');
    expect(rowsOf('ml')).toHaveLength(3);
    fireEvent.click(head('core'));
    expect(head('core').getAttribute('aria-expanded')).toBe('true');
    expect(rowsOf('core')).toHaveLength(6);
  });

  it('is keyboard operable: Enter and Space on the focused heading are the native button activation', async () => {
    await mountOpen();
    const h = head('ml');
    h.focus();
    expect(document.activeElement).toBe(h);
    /* A real <button> turns Enter and Space into a click; jsdom does not, so the contract checked is the element type
       plus no handler that swallows the keys. */
    expect(h.tagName).toBe('BUTTON');
    const down = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    h.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    h.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
  });

  it('a filter opens the groups it matches even when they were folded, and only shows matching groups', async () => {
    await mountOpen();
    fireEvent.click(head('ml'));
    expect(rowsOf('ml')).toHaveLength(0);
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Filter components' }), { target: { value: 'rsi' } });
    expect(head('ml').getAttribute('aria-expanded')).toBe('true');
    expect(rowsOf('ml').map((r) => r.getAttribute('data-component'))).toEqual(['rsi-anything']);
    expect(document.querySelector('[data-group="core"]')).toBeNull();
    /* clearing the filter hands the group back to its own fold state */
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter components' }), { target: { value: '' } });
    expect(head('ml').getAttribute('aria-expanded')).toBe('false');
  });

  it('a filter that matches nothing shows the empty note and no group buttons', async () => {
    await mountOpen();
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Filter components' }), { target: { value: 'zzz' } });
    expect(screen.getByTestId('rail-empty').textContent).toBe('No component matches \u201Czzz\u201D.');
    expect(screen.queryAllByTestId('rail-group-head')).toHaveLength(0);
  });

  it('the heading wears a fold chevron and a focus ring, and the group heading is not the component popover button', async () => {
    await mountOpen();
    expect(head('core').querySelector('svg[data-icon]')).toBeTruthy();
    expect(/\.rail-group-head:focus-visible\s*\{[^}]*outline/.test(cssRaw)).toBe(true);
    expect(head('core').hasAttribute('aria-haspopup')).toBe(false);
    /* the component rows keep their own popover aria-expanded */
    expect(rowsOf('core')[0]!.getAttribute('aria-expanded')).toBe('false');
    expect(rowsOf('core')[0]!.getAttribute('aria-haspopup')).toBe('dialog');
  });
});
