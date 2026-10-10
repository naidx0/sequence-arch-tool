import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createStore } from '../state';
import { V3App } from '../v3/V3App';
import { requestHostCommand } from '../app/hostCommands';

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
it('toggles Chat and the sidebar through actual palette commands', () => {
  render(<V3App appStore={createStore({})} />);
  command('pane.chat');
  expect(screen.getByTestId('s2-chat').hidden).toBe(true);
  command('pane.chat');
  expect(screen.getByTestId('s2-chat').hidden).toBe(false);
  command('pane.rail');
  expect(localStorage.getItem('v3.railCollapsed')).toBe('1');
  command('pane.rail');
  expect(localStorage.getItem('v3.railCollapsed')).toBe('0');
});
it('resets the live and persisted pane widths', () => {
  localStorage.setItem('v3.chatW', '700');
  localStorage.setItem('s2.split', '0.75');
  render(<V3App appStore={createStore({})} />);
  command('pane.reset');
  expect(localStorage.getItem('v3.chatW')).toBe('420');
  expect(localStorage.getItem('s2.split')).toBe('0.5');
  expect(screen.getByTestId('s2-chat').style.width).toBe('420px');
});
it('takes Sessions and host rail focus directly to a reachable rail, not a dead overlay', () => {
  localStorage.setItem('v3.railCollapsed', '1');
  const store = createStore({});
  render(<V3App appStore={store} />);
  act(() => store.dispatch({ type: 'shell/overlay', overlay: { kind: 'sessions' } }));
  expect(store.getState().shell.overlay).toBeNull();
  expect(localStorage.getItem('v3.railCollapsed')).toBe('0');
  command('pane.rail');
  act(() => requestHostCommand('rail.focus'));
  expect(localStorage.getItem('v3.railCollapsed')).toBe('0');
});
