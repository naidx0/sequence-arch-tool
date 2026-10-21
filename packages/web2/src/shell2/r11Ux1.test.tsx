import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '../state';
import { V3App } from '../v3/V3App';
import { seedOpenArchitecture } from './legacyDefaultTabs.testSupport';

/** 0.1.8.1 C1: a plain click switches the stage; these cases open surfaces BESIDE each other, which is Ctrl/Cmd+click. */
const BESIDE = { ctrlKey: true } as const;

/* Round 11, UX audit (lane ux1): the folded sidebar leaves a rail, the surface
   bar shows that it scrolls, the palette holds every door, and the doors the
   palette alone held are in the sidebar and the chat's more menu. */

beforeEach(() => {
  localStorage.clear();
  seedOpenArchitecture();
  localStorage.setItem('v3.railCollapsed', '0');
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
});
afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
});

const openTab = (id: string) => fireEvent.click(screen.getByTestId(`s2-tab-${id}`), BESIDE);

describe('a second surface folds the sidebar to a rail', () => {
  it('keeps New chat and Settings in reach, and the sidebar peeks back from it', () => {
    render(<V3App appStore={createStore({})} />);
    expect(screen.queryByTestId('s2-iconrail')).toBeNull();
    expect(screen.getByTestId('s2-panel')).toBeTruthy();
    openTab('files');
    expect(screen.queryByTestId('s2-panel')).toBeNull();
    const rail = screen.getByTestId('s2-iconrail');
    expect(rail.querySelector('[data-testid="s2-iconrail-new-chat"]')).toBeTruthy();
    expect(rail.querySelector('[data-testid="s2-iconrail-settings"]')).toBeTruthy();
    expect(rail.querySelector('[aria-label="Show sidebar"]')).toBeTruthy();
    fireEvent.click(screen.getByTestId('s2-iconrail-expand'));
    expect(screen.getByTestId('s2-panel')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('s2-panel')).toBeNull();
  });
  it('does not show the rail while the sidebar fits, or when the reader hid it', () => {
    localStorage.setItem('v3.railCollapsed', '1');
    render(<V3App appStore={createStore({})} />);
    expect(screen.queryByTestId('s2-iconrail')).toBeNull();
  });
});

describe('the surface bar shows that it scrolls', () => {
  it('round 14: no arrow circle, even with more to scroll to; the bar itself is the thing to drag', () => {
    render(<V3App appStore={createStore({})} />);
    const bar = screen.getByTestId('s2-surfaces') as HTMLElement;
    Object.defineProperty(bar, 'scrollWidth', { configurable: true, value: 800 });
    Object.defineProperty(bar, 'clientWidth', { configurable: true, value: 300 });
    act(() => void fireEvent(window, new Event('resize')));
    /* The positive control: the bar knows it has more (it is the drag target now), and says so. */
    expect(bar.getAttribute('data-scrollable')).toBe('true');
    expect(screen.getByTestId('s2-surfaces-wrap').getAttribute('data-more')).toBe('end');
    expect(screen.queryByTestId('s2-surfaces-more-end')).toBeNull();
    expect(screen.queryByTestId('s2-surfaces-more-start')).toBeNull();
    expect(document.querySelector('.s2-surfaces-more')).toBeNull();
  });
  it('shows no scroll cue when everything fits', () => {
    render(<V3App appStore={createStore({})} />);
    expect(screen.getByTestId('s2-surfaces').getAttribute('data-scrollable')).toBeNull();
    expect(screen.queryByTestId('s2-surfaces-more-end')).toBeNull();
  });
});

describe('the palette is a door to every surface', () => {
  const rows = () => Array.from(document.querySelectorAll('[data-testid="command-row"] > span:first-child')).map((e) => e.textContent);
  it('lists the surfaces, New chat and the project doors in the words of the UI', () => {
    render(<V3App appStore={createStore({})} />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    for (const want of ['New chat', 'Open Architecture', 'Open Files', 'Open Spaces', 'Open Terminal', 'Open Agents', 'Open a project', 'Close project', 'Search this project', 'Review the working tree', 'Rewind an edit', 'What can I do here?', 'Open Chats']) {
      expect(rows()).toContain(want);
    }
    /* A command with a shortcut shows it. */
    const key = document.querySelector('[data-command="chat.new"] [data-testid="command-key"]');
    expect(key?.textContent).toMatch(/Ctrl\+N|⌘N/);
  });
  it.each([
    ['surface.files', 'files'],
    ['surface.terminal', 'terminal'],
    ['surface.agents', 'agents'],
    ['canvas.whiteboard', 'whiteboard'],
  ])('%s opens the %s surface', (command, tab) => {
    render(<V3App appStore={createStore({})} />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.click(document.querySelector(`[data-command="${command}"]`)!);
    expect(screen.getByTestId(`s2-tab-${tab}`).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Ctrl+K and the palette-only doors are visible', () => {
  it('the sidebar search button names the shortcut, and its Commands row opens the palette', () => {
    render(<V3App appStore={createStore({})} />);
    expect(screen.getByTestId('s2-search-toggle').getAttribute('title')).toMatch(/(Ctrl\+K|⌘K)/);
    expect(screen.getByTestId('s2-rail-commands').textContent).toMatch(/Commands/);
    expect(screen.getByTestId('s2-rail-commands').textContent).toMatch(/(Ctrl\+K|⌘K)/);
    fireEvent.click(screen.getByTestId('s2-rail-commands'));
    expect(screen.getByTestId('command-surface')).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId('command-field'), { key: 'Escape' });
  });
  it('the chat header has quick icons for search, review and rewind, the more menu holds help, and each opens its overlay', () => {
    const store = createStore({});
    render(<V3App appStore={store} />);
    /* 0.1.8 G8: the three doors are header icons; there is no "All commands" row (the sidebar's Commands entry and Ctrl+K are the way). */
    /* G9: Find in files is no longer an overlay; it opens the Files space (chatQuickIcons018.test.tsx drives that). */
    fireEvent.click(screen.getByTestId('s2-chat-quick-overlay.search'));
    expect(store.getState().shell.overlay).toBeNull();
    for (const [id, kind] of [
      ['overlay.review', 'review'],
      ['overlay.rewind', 'rewind'],
    ] as const) {
      fireEvent.click(screen.getByTestId(`s2-chat-quick-${id}`));
      expect(store.getState().shell.overlay?.kind).toBe(kind);
      act(() => store.dispatch({ type: 'shell/overlay', overlay: null }));
    }
    fireEvent.click(screen.getByTestId('s2-chat-more'));
    expect(screen.queryByTestId('s2-chat-menu-commands')).toBeNull();
    fireEvent.click(screen.getByTestId('s2-chat-menu-overlay.help'));
    expect(store.getState().shell.overlay?.kind).toBe('help');
  });
});
