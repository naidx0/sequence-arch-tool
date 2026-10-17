import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { requestHostCommand } from '../app/hostCommands';
import { createStore } from '../state';
import { paneIsOpen, openPanes } from '../../test/support/v3';
import { V3App } from '../v3/V3App';

/* B7, the shell half: the Spaces surface closes when the surface asks (the last Space was deleted), and chat stays. */
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
});
afterEach(() => vi.unstubAllGlobals());

it('whiteboard.close takes the Spaces pane off the stage and leaves chat', async () => {
  render(<V3App appStore={createStore({})} />);
  act(() => requestHostCommand('canvas.whiteboard'));
  expect(paneIsOpen('whiteboard')).toBe(true);
  act(() => requestHostCommand('whiteboard.close'));
  expect(paneIsOpen('whiteboard')).toBe(false);
  expect(openPanes()).not.toContain('whiteboard');
  expect(paneIsOpen('chat')).toBe(true);
});
