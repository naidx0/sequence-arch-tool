import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRuns } from '../agents/agentRuns';
import { seqdFromGraph } from '../canvas';
import { BoardMenu } from '../canvas/BoardMenu';
import { readShellPersisted, readShellTokens } from '../shell';
import { createStore, type Store } from '../state';
import { V3App } from './V3App';

/* STREAM 3b, the agent mounts: stream 2's Agents panel docked in the shell
   (360px, opened from the toolbar, remembered) and "Ask an agent about this"
   in the board's node menu. The overlay's own mount is locked where the board
   renders (canvas/agentOverlayMount.test.tsx). */

function freshStore(): Store {
  return createStore({
    project: (graph) => seqdFromGraph(graph, graph.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
}

beforeEach(() => {
  document.documentElement.setAttribute('data-theme', 'dark');
  document.documentElement.setAttribute('data-platform', 'win');
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
});

describe('the Agents panel in the shell', () => {
  it('is closed by default, opens from the chat header menu, and the choice is remembered', async () => {
    /* Decision 49: uiarc.dev's chat header has one "More" button; Agents is its menu's row. */
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    const toggle = () => {
      fireEvent.click(screen.getByTestId('s2-chat-more'));
      return screen.getByTestId('v3-agents-toggle');
    };
    const first = render(<V3App appStore={freshStore()} />);
    expect(screen.queryByTestId('v3-agents-dock')).toBeNull();
    const row = toggle();
    expect(row.textContent).toContain('Agents');
    expect(row.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(row);
    const dock = screen.getByTestId('v3-agents-dock');
    /* The dock's chunk loads when it opens (round 7 perf). */
    await waitFor(() => expect(dock.querySelector('[data-testid="agents-panel"]')).not.toBeNull());
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    first.unmount();

    render(<V3App appStore={freshStore()} />);
    expect(screen.getByTestId('v3-agents-dock')).not.toBeNull();
    fireEvent.click(toggle());
    expect(screen.queryByTestId('v3-agents-dock')).toBeNull();
  });
});

describe('Ask an agent about this, in the node menu', () => {
  const target = { nodeId: 'svc:orders', label: 'orders', x: 10, y: 10, openable: false, generatable: false };

  it('hands the run to chat with the composer access and the node, and closes the menu at once', () => {
    const fetchStub = vi.fn(async () => new Response(JSON.stringify({ agents: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchStub);
    const onAskResult = vi.fn();
    const onClose = vi.fn();
    render(
      <BoardMenu
        target={target as never}
        onRename={() => {}}
        onDelete={() => {}}
        onClose={onClose}
        onAskResult={onAskResult}
        access="ask"
      />,
    );
    fireEvent.click(screen.getByTestId('board-menu-ask-agent'));
    expect(onAskResult).toHaveBeenCalledWith(expect.objectContaining({ ok: true, handedOff: true }));
    expect(onClose).toHaveBeenCalled();
  });

  it('names the inside view in plain words', () => {
    render(
      <BoardMenu target={target as never} onRename={() => {}} onDelete={() => {}} onClose={() => {}} onAnatomy={() => {}} />,
    );
    expect(screen.getByTestId('board-menu-anatomy').textContent).toBe('Show inside');
  });
});

describe('the node menu stays on screen', () => {
  it('shifts left and up by what would leave the window', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 });
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 200, width: 300, height: 200, toJSON: () => ({}) } as DOMRect);
    render(<BoardMenu target={{ nodeId: 'svc:orders', label: 'orders', x: 1000, y: 650, openable: false, generatable: false } as never} onRename={() => {}} onDelete={() => {}} onClose={() => {}} />);
    const menu = screen.getByTestId('board-menu');
    expect(menu.style.left).toBe('716px');
    expect(menu.style.top).toBe('492px');
    spy.mockRestore();
  });
});
