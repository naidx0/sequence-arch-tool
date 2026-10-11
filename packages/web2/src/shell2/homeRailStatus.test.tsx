import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createStore } from '../state';
import { V3App } from '../v3/V3App';
import { LIVE_PILLS } from '../app/chromeTabModel';
import css from './shell2.css?raw';

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
});
afterEach(() => vi.unstubAllGlobals());

/** Every declaration block written for exactly this selector, in source order (later rules win the cascade). */
function rules(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`(?:^|\\n)${escaped} \\{([^}]+)\\}`, 'g'))].map((m) => m[1]).join('\n');
}

it('keeps dense projects and chats in the scroller, with a nonshrinking Settings footer', () => {
  /* The sidebar card is as tall as its slot; the sections scroll inside it. */
  expect(rules('.s2-panel')).toContain('min-height: 0;');
  expect(rules('.s2-panel')).toContain('overflow: hidden;');
  expect(rules('.s2-groups')).toContain('min-height: 0;');
  expect(rules('.s2-groups')).toContain('overflow-y: auto;');
  expect(rules('.s2-panel-foot')).toContain('flex: none;');
});

it('keeps the names on the home screen too, while no surface is open (round 13)', () => {
  expect(/@container s2main[^}]+\{\s*\.s2-surfaces\.is-compact/.test(css)).toBe(false);
  render(<V3App appStore={createStore({})} />);
  expect(screen.getByTestId('s2-surfaces').classList.contains('is-compact')).toBe(false);
  for (const id of LIVE_PILLS) {
    const close = screen.queryByTestId(`v3-tab-close-${id}`);
    if (close) fireEvent.click(close);
  }
  expect(screen.getByTestId('s2-surfaces').classList.contains('is-compact')).toBe(false);
  for (const id of LIVE_PILLS) expect(screen.getByTestId(`s2-tab-${id}`).querySelector('.s2-seg-l')?.textContent).toBeTruthy();
});

it('keeps the names in a narrow window, which has no home screen of its own', () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 });
  render(<V3App appStore={createStore({})} />);
  for (const id of LIVE_PILLS) {
    const close = screen.queryByTestId(`v3-tab-close-${id}`);
    if (close) fireEvent.click(close);
  }
  expect(screen.getByTestId('s2-surfaces').classList.contains('is-compact')).toBe(false);
});

it('shows a surface opened by a host command from narrow Chat immediately', async () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 });
  render(<V3App appStore={createStore({})} />);
  const { requestHostCommand } = await import('../app/hostCommands');
  // Command identifiers come from the same entry point as the palette and shortcuts.
  act(() => requestHostCommand('files.open'));
  expect(screen.getByTestId('s2-narrow-stage').getAttribute('aria-selected')).toBe('true');
  expect(screen.getByTestId('s2-surfaces').classList.contains('is-compact')).toBe(false);
});

it('round 13 (O7): the sidebar has no Skills and instructions door; Skills is a Settings tab', () => {
  const store = createStore({});
  render(<V3App appStore={store} />);
  expect(screen.queryByTestId('s2-rail-skills')).toBeNull();
  /* The sidebar keeps Open project and Settings. */
  expect(screen.getByTestId('v3-rail-settings')).toBeTruthy();
  expect(screen.getByTestId('v3-rail-open-project')).toBeTruthy();
});
