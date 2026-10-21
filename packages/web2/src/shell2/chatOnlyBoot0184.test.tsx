import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seqdFromGraph } from '../canvas';
import { readShellPersisted, readShellTokens } from '../shell';
import { createStore, type Store } from '../state';
import { isVisible, type ChromeTabId } from '../app/chromeTabModel';
import { V3App } from '../v3/V3App';
import { SHELL2_INITIAL_TABS } from './Shell2';

/*
 * 0.1.8.4 (owner: "provide a more default chat-only working space"): a profile that has never stored a layout boots
 * to the chat alone. No surface is on the stage until the person opens one, and a stored layout still wins.
 */

function freshStore(): Store {
  return createStore({
    project: (graph) => seqdFromGraph(graph, graph.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
});

const panes = () => Number(document.querySelector('.s2-stage')?.getAttribute('data-panes') ?? '0');
const SURFACES: ChromeTabId[] = ['architecture', 'files', 'whiteboard', 'terminal', 'agents'];

describe('a fresh profile boots chat-only (0.1.8.4)', () => {
  it('the default tab state has the chat active and no surface visible', () => {
    expect(SHELL2_INITIAL_TABS.active).toBe('chat');
    for (const id of SURFACES) expect(isVisible(SHELL2_INITIAL_TABS, id)).toBe(false);
  });

  it('mounted with empty storage, the stage holds no pane and no surface tab is current', () => {
    render(<V3App appStore={freshStore()} />);
    expect(panes()).toBe(0);
    for (const id of SURFACES) {
      const tab = screen.queryByTestId(`s2-tab-${id}`);
      if (tab) expect(tab.getAttribute('aria-current')).not.toBe('true');
    }
  });

  it('a surface opens only when the person opens it', () => {
    render(<V3App appStore={freshStore()} />);
    act(() => {
      fireEvent.click(screen.getByTestId('s2-tab-files'));
    });
    expect(panes()).toBe(1);
  });

  it('a stored layout still wins over the default', () => {
    localStorage.setItem('v3.chromeTabs', JSON.stringify({ tabs: [{ id: 'chat', minimized: false }, { id: 'files', minimized: false }], active: 'files' }));
    render(<V3App appStore={freshStore()} />);
    expect(panes()).toBe(1);
  });
});
