import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { preloadChatLazies } from '../../test/preloadChat';
import { createStore, StoreProvider } from '../state';
import { V3Chat } from './V3Chat';

/*
 * Composer round (0.1.8.4): the + menu has ONE entry for files and images, and it scrolls inside a
 * max height (the model-menu pattern: a capped shell, an inner .s2-menu-body that scrolls).
 */

beforeAll(preloadChatLazies, 120_000);
beforeEach(() => localStorage.clear());

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

const css = (name: string) => readFileSync(resolve(process.cwd(), 'src/shell2', name), 'utf8');

describe('the + menu: one Add files or images entry', () => {
  it('has exactly one entry for files and images, and no separate Image or Attach row', () => {
    draw();
    fireEvent.click(screen.getByTestId('v3-tools-trigger'));
    const menu = screen.getByRole('menu', { name: 'Add to the message' });
    const rows = Array.from(menu.querySelectorAll('[role="menuitem"]'));
    const adds = rows.filter((r) => /Add files or images/.test(r.textContent ?? ''));
    expect(adds).toHaveLength(1);
    expect(adds[0]!.getAttribute('data-testid')).toBe('v3-tools-attach');
    expect(screen.queryByTestId('s2-tools-image')).toBeNull();
    expect(rows.some((r) => /^(Attach a file|Image)/.test(r.textContent ?? ''))).toBe(false);
  });

  it('the one hidden input accepts images and text files, several at once', () => {
    draw();
    const input = screen.getByTestId('v3-attach-input') as HTMLInputElement;
    const accept = input.accept;
    expect(accept).toContain('image/*');
    expect(accept).toContain('text/*');
    expect(accept).toContain('.log');
    expect(input.multiple).toBe(true);
    expect(screen.queryByTestId('s2-image-input')).toBeNull();
  });
});

describe('the + menu scrolls inside a max height', () => {
  it('the menu is the capped shell and its rows sit in the scrolling body', () => {
    draw();
    fireEvent.click(screen.getByTestId('v3-tools-trigger'));
    const menu = screen.getByRole('menu', { name: 'Add to the message' });
    expect(menu.classList.contains('s2-menu-plus')).toBe(true);
    const body = menu.querySelector(':scope > .s2-menu-body');
    expect(body).toBeTruthy();
    expect(body!.querySelectorAll('[role="menuitem"]').length).toBe(menu.querySelectorAll('[role="menuitem"]').length);
  });

  it('the CSS caps .s2-menu-plus with --s2-menu-max and lets the body scroll', () => {
    const all = css('modelMenu.css').replace(/\r\n/g, '\n');
    const rule = all.match(/\.s2-menu\.s2-menu-plus\s*\{([^}]*)\}/);
    expect(rule, 'a .s2-menu.s2-menu-plus rule').toBeTruthy();
    expect(rule![1]).toMatch(/max-height:\s*var\(--s2-menu-max\)/);
    expect(rule![1]).toMatch(/overflow:\s*hidden/);
    expect(all).toMatch(/\.s2-menu-body\s*\{[^}]*overflow-y:\s*auto/);
  });
});
