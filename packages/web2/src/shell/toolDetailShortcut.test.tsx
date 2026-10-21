import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readToolDetail, resetToolDetailForTest, TOOL_DETAIL_KEY } from '../settings/toolDetailPreference';
import { createStore, StoreProvider } from '../state';
import { V3App } from '../v3/V3App';
import { KeysHost } from './KeysHost';
import { SHELL_COMMANDS } from './shellModel';
import { SHORTCUTS, matchShortcut, shortcutById, shortcutChord } from './shortcuts';

const ev = (key: string, mods: Partial<{ meta: boolean; ctrl: boolean; shift: boolean; alt: boolean }> = {}) => ({
  key,
  metaKey: !!mods.meta,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
});

beforeEach(() => {
  localStorage.clear();
  resetToolDetailForTest();
  vi.stubGlobal('navigator', { ...navigator, platform: 'Win32' });
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the Focused or Detailed shortcut', () => {
  it('is Ctrl/Cmd+Shift+D, owned by the keys host, and collides with no other row', () => {
    const row = shortcutById('tool-detail');
    expect(row.owner).toBe('keys');
    expect(shortcutChord(row, false)).toBe('Ctrl+Shift+D');
    expect(shortcutChord(row, true)).toBe('⌘⇧D');
    /* The chord is a property of the whole table: no other modified row shares it, whoever owns it. */
    const chord = (s: (typeof SHORTCUTS)[number]) => `${s.key.toLowerCase()}|${!!s.meta}|${!!s.ctrl}|${!!s.shift}`;
    const mine = SHORTCUTS.filter((s) => (s.meta || s.ctrl) && chord(s) === chord(row)).map((s) => s.id);
    expect(mine).toEqual(['tool-detail']);
    expect(matchShortcut(ev('D', { ctrl: true, shift: true }), 'other', 'keys', false)?.id).toBe('tool-detail');
    expect(matchShortcut(ev('d', { ctrl: true }), 'other', 'keys', false)).toBeNull();
  });

  it('flips the preference from the page, and cancels the key default', () => {
    render(
      <StoreProvider store={createStore({})}>
        <KeysHost />
      </StoreProvider>,
    );
    expect(readToolDetail()).toBe('focused');
    expect(fireEvent.keyDown(window, { key: 'D', ctrlKey: true, shiftKey: true })).toBe(false);
    expect(readToolDetail()).toBe('detailed');
    expect(localStorage.getItem(TOOL_DETAIL_KEY)).toBe('detailed');
    fireEvent.keyDown(window, { key: 'D', ctrlKey: true, shiftKey: true });
    expect(readToolDetail()).toBe('focused');
  });

  it('is in the command palette beside its chord, and the row does the same flip', () => {
    const cmd = SHELL_COMMANDS.find((c) => c.id === 'pane.detail');
    expect(cmd?.shortcut).toBe('tool-detail');
    render(<V3App appStore={createStore({})} />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.click(document.querySelector('[data-command="pane.detail"]')!);
    expect(readToolDetail()).toBe('detailed');
  });
});
