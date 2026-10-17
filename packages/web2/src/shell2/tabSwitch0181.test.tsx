import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seqdFromGraph } from '../canvas';
import { readShellPersisted, readShellTokens } from '../shell';
import { createStore, type Store } from '../state';
import { requestHostCommand } from '../app/hostCommands';
import { V3App } from '../v3/V3App';
import { switchOnStage, SHELL2_INITIAL_TABS } from './Shell2';

/*
 * 0.1.8.1 C1 (audit P1-5): "Tabs add panes instead of switching". A plain click on a surface's name switches the
 * stage to it; a split is opened only on purpose (Ctrl/Cmd+click, the Split button, or a drag).
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

describe('a tab click switches the pane (0.1.8.1 C1)', () => {
  it('clicking Files, Spaces, Terminal and Agents in turn leaves exactly one pane', () => {
    render(<V3App appStore={freshStore()} />);
    for (const id of ['files', 'whiteboard', 'terminal', 'agents']) {
      act(() => {
        fireEvent.click(screen.getByTestId(`s2-tab-${id}`));
      });
      expect(panes()).toBe(1);
      expect(screen.getByTestId(`s2-tab-${id}`).getAttribute('aria-current')).toBe('true');
    }
  });

  it('Ctrl+click opens the surface beside the one showing', () => {
    render(<V3App appStore={freshStore()} />);
    act(() => {
      fireEvent.click(screen.getByTestId('s2-tab-files'));
    });
    expect(panes()).toBe(1);
    act(() => {
      fireEvent.click(screen.getByTestId('s2-tab-terminal'), { ctrlKey: true });
    });
    expect(panes()).toBe(2);
  });

  it('switchOnStage: a closed surface takes the stage alone; an open one only comes forward', () => {
    const one = switchOnStage(SHELL2_INITIAL_TABS, 'files');
    expect(one.active).toBe('files');
    expect(one.tabs.filter((t) => t.id !== 'chat' && !t.minimized).map((t) => t.id)).toEqual(['files']);
    const two = { ...one, tabs: [...one.tabs, { id: 'terminal' as const, minimized: false }] };
    /* An unshipped surface is refused: the stage is left as it was. */
    expect(switchOnStage(one, 'ai-canvas')).toBe(one);
    const back = switchOnStage(two, 'files');
    expect(back.tabs.filter((t) => t.id !== 'chat' && !t.minimized).map((t) => t.id).sort()).toEqual(['files', 'terminal']);
  });
});

describe('commands open a surface the way a plain click does (review S8)', () => {
  it('a host command (Open Terminal from anywhere) switches the stage: still one pane', () => {
    render(<V3App appStore={freshStore()} />);
    act(() => {
      fireEvent.click(screen.getByTestId('s2-tab-files'));
    });
    expect(panes()).toBe(1);
    act(() => requestHostCommand('terminal.open'));
    expect(panes()).toBe(1);
    expect(screen.getByTestId('s2-tab-terminal').getAttribute('aria-current')).toBe('true');
  });

  it('the command palette switches too', () => {
    render(<V3App appStore={freshStore()} />);
    act(() => {
      fireEvent.click(screen.getByTestId('s2-tab-files'));
    });
    act(() => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    });
    fireEvent.change(screen.getByTestId('command-field'), { target: { value: 'Open Terminal' } });
    act(() => {
      fireEvent.click(screen.getAllByTestId('command-row').find((r) => r.getAttribute('data-command') === 'surface.terminal')!);
    });
    expect(panes()).toBe(1);
    expect(screen.getByTestId('s2-tab-terminal').getAttribute('aria-current')).toBe('true');
  });
});
