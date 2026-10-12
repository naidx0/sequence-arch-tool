import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

import type { GetArchGraphResponse } from '@sequence/api-types';

import { registerBoardAskSender } from '../askInPlace/boardAskBus';
import { summarizeGraph } from '../boot';
import { readShellPersisted, readShellTokens } from '../shell';
import { StoreProvider, createStore, type Store } from '../state';
import { CanvasProvider } from './canvasChannel';
import { ConnectedBoard } from './ConnectedBoard';
import { DocProvider } from './docChannel';
import { displayLabel } from './displayLabel.js';
import { seqdFromGraph } from './seqdFromGraph';
import { installResizeObserver } from './testResizeObserver';

installResizeObserver();

/* The crop cannot be drawn without a browser; what it is asked to crop is asserted instead. */
vi.mock('../askInPlace/snapshot', async (orig) => ({
  ...(await orig<typeof import('../askInPlace/snapshot')>()),
  snapshotHtmlRegion: vi.fn(async () => null),
}));

/**
 * ASK IN PLACE ON THE ARCHITECTURE BOARD, from the user's seat: right-click a
 * node, take "Ask about this", type, Enter. The chat is not mounted here, so
 * the words land in the composer with the chip beside them; that is the same
 * chip, with the same structured block, a mounted chat sends.
 */

const GRAPH = {
  repoName: 'ask',
  scannedAt: '2026-10-09T00:00:00.000Z',
  nodes: [
    { id: 'svc:gateway', label: 'gateway', kind: 'service', path: 'src/gateway.ts', line: 12 },
    { id: 'svc:checkout', label: 'checkout', kind: 'service', path: 'src/checkout.ts', line: 41 },
  ],
  edges: [{ id: 'e1', srcId: 'svc:gateway', dstId: 'svc:checkout', kind: 'call', confidence: 0.95, origin: 'deterministic' }],
  nodeDetail: {},
} as unknown as GetArchGraphResponse;

function mount(): Store {
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({
    type: 'repo/loaded',
    draft: { root: '/tmp/ask', repoName: 'ask', graph: GRAPH, summary: summarizeGraph(GRAPH), scannedAt: '2026-10-09T00:00:00.000Z' },
    at: 0,
  });
  render(
    <StoreProvider store={store}>
      <CanvasProvider>
        <DocProvider>
          <ConnectedBoard />
        </DocProvider>
      </CanvasProvider>
    </StoreProvider>,
  );
  return store;
}

function card(label: string): HTMLElement {
  const shown = displayLabel(label);
  const found = screen.queryAllByTestId('board-node').find((el) => el.textContent?.includes(shown));
  if (!found) throw new Error(`no card labelled ${shown}`);
  return found;
}

afterEach(() => {
  registerBoardAskSender(null);
  vi.restoreAllMocks();
});

describe('ask in place on the architecture board', () => {
  it('the node menu carries Ask about this, with the menu items it already had', () => {
    mount();
    fireEvent.contextMenu(card('gateway'));
    expect(screen.getByTestId('board-menu-ask-here').textContent).toBe('Ask about this');
    expect(screen.getByTestId('board-menu-rename')).toBeTruthy();
    expect(screen.getByTestId('board-menu-delete')).toBeTruthy();
  });

  it('right-click, Ask about this, type, Enter: the node rides on the message by id, name, kind and path', async () => {
    const store = mount();
    const sent = vi.fn();
    registerBoardAskSender(sent);
    fireEvent.contextMenu(card('gateway'));
    fireEvent.click(screen.getByTestId('board-menu-ask-here'));
    expect(screen.queryByTestId('board-menu')).toBeNull();
    expect(screen.getByTestId('ask-pop-chip').textContent).toBe('gateway');
    fireEvent.change(screen.getByTestId('ask-pop-input'), { target: { value: 'what calls this?' } });
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('ask-pop-input'), { key: 'Enter' });
    });
    expect(screen.queryByTestId('ask-pop')).toBeNull();
    /* The sender loads when a question is sent (perf ratchet), so the send lands a tick after Enter. */
    await vi.waitFor(() => expect(sent).toHaveBeenCalledWith('what calls this?'));
    const chip = await vi.waitFor(() => {
      const found = store.getState().composer.chips.find((c) => c.kind === 'board-ref');
      expect(found).toBeTruthy();
      return found!;
    });
    expect(chip.label).toBe('gateway');
    expect(chip.detail).toContain('[architecture selection: 1 item');
    expect(chip.detail).toContain('svc:gateway | service | "gateway" | src/gateway.ts');
  });

  it('a multi-selection is asked about as one: the node menu takes the selection with it', async () => {
    const store = mount();
    registerBoardAskSender(() => undefined);
    fireEvent.click(card('gateway'));
    fireEvent.click(card('checkout'), { shiftKey: true });
    fireEvent.contextMenu(card('checkout'));
    fireEvent.click(screen.getByTestId('board-menu-ask-here'));
    expect(screen.getByTestId('ask-pop-chip').textContent).toBe('2 items: gateway, checkout');
    fireEvent.change(screen.getByTestId('ask-pop-input'), { target: { value: 'compare these' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('ask-pop-send'));
    });
    const chip = await vi.waitFor(() => {
      const found = store.getState().composer.chips.find((c) => c.kind === 'board-ref');
      expect(found).toBeTruthy();
      return found!;
    });
    expect(chip.ref).toBe('board-ref:architecture:svc:gateway,svc:checkout');
    expect(chip.detail).toContain('svc:checkout | service | "checkout" | src/checkout.ts');
  });

  it('with a node selected, / opens the popover and Escape closes it', () => {
    mount();
    fireEvent.click(card('gateway'));
    fireEvent.keyDown(screen.getByTestId('board-stack'), { key: '/' });
    expect(screen.getByTestId('ask-pop-chip').textContent).toBe('gateway');
    fireEvent.keyDown(screen.getByTestId('ask-pop-input'), { key: 'Escape' });
    expect(screen.queryByTestId('ask-pop')).toBeNull();
  });

  it('hovering the selected node shows the Ask button; a node that is not selected shows none', () => {
    mount();
    fireEvent.click(card('gateway'));
    fireEvent(card('checkout'), new MouseEvent('pointermove', { bubbles: true, buttons: 0 }));
    expect(screen.queryByTestId('ask-affordance')).toBeNull();
    fireEvent(card('gateway'), new MouseEvent('pointermove', { bubbles: true, buttons: 0 }));
    expect(screen.getByTestId('ask-affordance').getAttribute('aria-label')).toBe('Ask about gateway');
  });
});
