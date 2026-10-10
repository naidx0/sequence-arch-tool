import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createStore } from '../state';
import { V3App } from '../v3/V3App';
import html from '../../index.html?raw';

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
});
afterEach(() => vi.unstubAllGlobals());
function command(id: string) {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  fireEvent.click(document.querySelector(`[data-command="${id}"]`)!);
}
it('reveals both palette canvas opens from narrow Chat, including a previous fullscreen pane', () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 872 });
  render(<V3App appStore={createStore({})} />);
  command('canvas.whiteboard');
  expect(screen.getByTestId('s2-narrow-stage').getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByTestId('s2-pane-full-whiteboard'));
  fireEvent.click(screen.getByTestId('s2-narrow-chat'));
  command('canvas.board');
  expect(screen.getByTestId('s2-narrow-stage').getAttribute('aria-selected')).toBe('true');
  expect(document.querySelector('[data-surface-pane="architecture"]')).toBeTruthy();
});
it('reveals Chat before focusing its composer from fullscreen Workspace', () => {
  render(<V3App appStore={createStore({})} />);
  fireEvent.click(screen.getByTestId('s2-pane-full-architecture'));
  command('composer.focus');
  expect(screen.getByTestId('s2-chat').hidden).toBe(false);
  expect(document.activeElement).toBe(screen.getByTestId('composer-field'));
});
it('focuses and traps the modal immediately while lazy Settings loads, then restores its opener', () => {
  render(<V3App appStore={createStore({})} />);
  const opener = screen.getByTestId('v3-rail-settings');
  opener.focus();
  fireEvent.click(opener);
  const modal = screen.getByTestId('v3-overlay-settings');
  expect(modal.contains(document.activeElement)).toBe(true);
  const close = modal.querySelector<HTMLButtonElement>('.v3-overlay-close')!;
  close.focus();
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
  expect(modal.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(document.activeElement).toBe(opener);
});
it('resolves saved system light before paint, with a dark negative control', () => {
  const script = html.split('<script>')[1].split('</script>')[0];
  localStorage.setItem('seq.theme', 'system');
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  act(() => new Function(script)());
  expect(document.documentElement.dataset.theme).toBe('light');
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  act(() => new Function(script)());
  expect(document.documentElement.dataset.theme).toBe('dark');
});
