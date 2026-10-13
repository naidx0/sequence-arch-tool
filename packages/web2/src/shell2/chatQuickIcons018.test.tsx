import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '../state';
import { V3App } from '../v3/V3App';
import cssRaw from './shell2.css?raw';

/*
 * 0.1.8 G8 (owner: "make it easier to orient ... the three dots at the top of the chat space should be the quick icons to
 * click: undo, working trees, find ... Command K is already bottom left, you don't need it anywhere else").
 */
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
});

describe('the chat header quick icons (G8)', () => {
  it('Undo, Working tree and Find in files are icon buttons in the chat header, named and with tooltips', () => {
    render(<V3App appStore={createStore({})} />);
    const header = document.querySelector<HTMLElement>('.s2-ch')!;
    const names = ['Undo', 'Working tree', 'Find in files'];
    for (const name of names) {
      const b = within(header).getByRole('button', { name });
      expect(b.className).toContain('s2-ibtn');
      expect(b.getAttribute('title')).toMatch(new RegExp(`^${name}: `));
      expect(b.querySelector('svg')).not.toBeNull();
    }
    /* In reading order, before the More button. */
    const order = Array.from(header.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'));
    expect(order.indexOf('Undo')).toBeLessThan(order.indexOf('Working tree'));
    expect(order.indexOf('Working tree')).toBeLessThan(order.indexOf('Find in files'));
    expect(order.indexOf('Find in files')).toBeLessThan(order.indexOf('More options'));
  });

  it('each opens its overlay; Undo is the rewind', () => {
    const store = createStore({});
    render(<V3App appStore={store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(store.getState().shell.overlay?.kind).toBe('rewind');
    fireEvent.click(screen.getByRole('button', { name: 'Working tree' }));
    expect(store.getState().shell.overlay?.kind).toBe('review');
  });

  it('Find in files opens the Files space with its find field focused, not an overlay (G9)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input), 'http://localhost').pathname;
        const tree = path === '/api/tree';
        const body = tree ? { name: 'r', path: '', type: 'dir', children: [{ name: 'a.ts', path: 'a.ts', type: 'file' }] } : { error: 'not served in this test' };
        return new Response(JSON.stringify(body), { status: tree ? 200 : 404, headers: { 'content-type': 'application/json' } });
      }),
    );
    const store = createStore({});
    render(<V3App appStore={store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find in files' }));
    expect(store.getState().shell.overlay).toBeNull();
    const input = await screen.findByTestId('files-find-project');
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it('the More menu no longer repeats them or carries "All commands"; exactly one Commands entry is visible, with the chord', () => {
    render(<V3App appStore={createStore({})} />);
    fireEvent.click(screen.getByTestId('s2-chat-more'));
    const menu = screen.getByRole('menu', { name: 'More options' });
    expect(within(menu).queryByText(/All commands/)).toBeNull();
    for (const id of ['overlay.search', 'overlay.review', 'overlay.rewind', 'commands']) expect(screen.queryByTestId(`s2-chat-menu-${id}`)).toBeNull();
    /* The one visible entry is the sidebar's bottom-left Commands row. */
    const entries = screen.getAllByText(/^Commands$/);
    expect(entries).toHaveLength(1);
    expect(screen.getByTestId('s2-rail-commands').textContent).toMatch(/(Ctrl\+K|⌘K)/);
  });

  it('no new button type: the group has a wrapper rule only, and the title keeps a readable floor beside the icons', () => {
    const css = cssRaw.replace(/\r\n/g, '\n');
    expect(css).not.toMatch(/\.s2-chat-quick (button|\.s2-ibtn)/);
    expect(css).toMatch(/\.s2-ch \.r9-title \{[^}]*max-width: max\(calc\(100% - 48px\), min\(100%, 160px\)\);/);
  });
});
