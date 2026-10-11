import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../../tokens/graphite.css';

import { StoreProvider, createStore } from '../../state';
import { readShellPersisted, readShellTokens } from '../../shell';
import { ConnectedWhiteboard } from '../../whiteboard/ConnectedWhiteboard';
import { ArchMarks } from './ArchDraw';
import { BoardTabs } from './BoardTabs';
import { resetBoardsStreamForTests } from './boardsClient';
import type { BoardsIndex } from './boardsModel';
import { FakeEventSource, fakeBoardsServer } from './fakeBoardsServer';
import { installResizeObserver } from '../testResizeObserver';

/*
 * ROUND 8 — the boards on screen: the tag strip, the whiteboard on the store,
 * an agent's drawing arriving without a reload, a drawing surviving a reload,
 * and an anchored annotation following its card.
 */

installResizeObserver();

let server: ReturnType<typeof fakeBoardsServer>;

beforeEach(() => {
  server = fakeBoardsServer();
  vi.stubGlobal('fetch', server.fetch);
  vi.stubGlobal('EventSource', FakeEventSource);
  resetBoardsStreamForTests();
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetBoardsStreamForTests();
});

function mountWhiteboard() {
  const store = createStore({
    project: () => ({ nodes: [], edges: [] }) as never,
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  return render(
    <StoreProvider store={store}>
      <ConnectedWhiteboard />
    </StoreProvider>,
  );
}

const INDEX: BoardsIndex = {
  version: 1,
  boards: [
    { id: 'architecture', name: 'Architecture', kind: 'architecture', rev: 0, createdAt: '', updatedAt: '' },
    { id: 'plan', name: 'Plan', kind: 'whiteboard', rev: 0, createdAt: '', updatedAt: '' },
  ],
};

describe('the board tags', () => {
  it('shows each board as a pill with its kind, opens on click, and creates with +', () => {
    const onOpen = vi.fn();
    const onCreate = vi.fn();
    render(<BoardTabs index={INDEX} current="architecture" onOpen={onOpen} onCreate={onCreate} onRename={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByTestId('board-tab-architecture').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('board-tab-architecture').getAttribute('data-board-kind')).toBe('architecture');
    expect(screen.getByTestId('board-tab-plan').getAttribute('data-board-kind')).toBe('whiteboard');
    /* The architecture board is never deleted from here. */
    expect(screen.queryByTestId('board-tab-delete-architecture')).toBeNull();
    fireEvent.click(screen.getByTestId('board-tab-plan'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'plan' }));
    fireEvent.click(screen.getByTestId('board-tab-new'));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('before the index arrives it draws the Architecture pill alone, and + waits', () => {
    render(<BoardTabs index={null} current="architecture" onOpen={vi.fn()} onCreate={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Architecture']);
    expect((screen.getByTestId('board-tab-new') as HTMLButtonElement).disabled).toBe(true);
  });

  it('renames a whiteboard on double-click (Enter keeps, Escape leaves it), never the architecture board', () => {
    const onRename = vi.fn();
    render(<BoardTabs index={INDEX} current="plan" onOpen={vi.fn()} onCreate={vi.fn()} onRename={onRename} onDelete={vi.fn()} />);
    fireEvent.doubleClick(screen.getByTestId('board-tab-architecture'));
    expect(screen.queryByTestId('board-tab-rename')).toBeNull();
    fireEvent.doubleClick(screen.getByTestId('board-tab-plan'));
    fireEvent.change(screen.getByTestId('board-tab-rename'), { target: { value: 'Ignored' } });
    fireEvent.keyDown(screen.getByTestId('board-tab-rename'), { key: 'Escape' });
    expect(onRename).not.toHaveBeenCalled();
    fireEvent.doubleClick(screen.getByTestId('board-tab-plan'));
    fireEvent.change(screen.getByTestId('board-tab-rename'), { target: { value: 'Checkout plan' } });
    fireEvent.keyDown(screen.getByTestId('board-tab-rename'), { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('plan', 'Checkout plan');
  });

  it('deletes only after B\'s confirm dialog says yes', () => {
    const onDelete = vi.fn();
    render(<BoardTabs index={INDEX} current="plan" onOpen={vi.fn()} onCreate={vi.fn()} onRename={vi.fn()} onDelete={onDelete} itemCount={() => 3} />);
    fireEvent.click(screen.getByTestId('board-tab-delete-plan'));
    const dlg = screen.getByTestId('board-delete-confirm');
    expect(dlg.textContent).toContain('Delete "Plan"?');
    expect(dlg.textContent).toContain('3 marks');
    fireEvent.click(screen.getByTestId('board-delete-cancel'));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByTestId('board-delete-confirm')).toBeNull();
    fireEvent.click(screen.getByTestId('board-tab-delete-plan'));
    fireEvent.click(screen.getByTestId('board-delete-ok'));
    expect(onDelete).toHaveBeenCalledWith('plan');
  });
});

describe('the whiteboard on the boards store', () => {
  it('an agent\'s sticky appears without a reload, tinted as the agent\'s', async () => {
    mountWhiteboard();
    await waitFor(() => expect(screen.getByTestId('wb-boards').getAttribute('data-board')).toBe('whiteboard'));
    await waitFor(() => expect(FakeEventSource.open.length).toBeGreaterThan(0));
    const before = screen.getByTestId('whiteboard');
    expect(screen.queryAllByTestId('wb-item')).toHaveLength(0);
    act(() => {
      server.agentDraw('whiteboard', [
        { op: 'put', item: { kind: 'text', sticky: true, id: 'n1', by: 'agent', at: { x: 10, y: 10 }, text: 'Retry on 502?' } },
      ]);
    });
    const mark = await screen.findByText('Retry on 502?');
    expect(mark.closest('[data-kind="sticky"]')?.getAttribute('data-by')).toBe('agent');
    /* The same surface, not a remount. */
    expect(screen.getByTestId('whiteboard')).toBe(before);
    /* Adopting the store's copy writes nothing back. */
    expect(server.calls.filter((c) => c.startsWith('POST /api/boards/whiteboard/ops'))).toEqual([]);
  });

  it('what a person draws is written as ops and is there after a reload', async () => {
    const first = mountWhiteboard();
    await waitFor(() => expect(screen.getByTestId('wb-boards').getAttribute('data-board')).toBe('whiteboard'));
    await waitFor(() => expect(server.calls).toContain('GET /api/boards/whiteboard'));
    fireEvent.click(screen.getByTestId('wb-annotate-trigger'));
    fireEvent.click(screen.getByTestId('wb-tool-text'));
    const canvas = screen.getByTestId('wb-canvas');
    fireEvent.pointerDown(canvas, { clientX: 40, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 40, clientY: 40, pointerId: 1 });
    await waitFor(() => expect(server.items('whiteboard').map((i) => i.kind)).toEqual(['text']));
    first.unmount();
    resetBoardsStreamForTests();
    mountWhiteboard();
    await waitFor(() => expect(screen.getAllByTestId('wb-item')).toHaveLength(1));
  });

  it('the strip creates, switches, renames and deletes boards on the store', async () => {
    mountWhiteboard();
    await waitFor(() => expect(screen.getByTestId('board-tab-whiteboard')).toBeTruthy());
    fireEvent.click(screen.getByTestId('board-tab-new'));
    await waitFor(() => expect(screen.getByTestId('wb-boards').getAttribute('data-board')).toBe('whiteboard-2'));
    expect(screen.getByTestId('board-tab-whiteboard-2').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByTestId('board-tab-whiteboard'));
    await waitFor(() => expect(screen.getByTestId('wb-boards').getAttribute('data-board')).toBe('whiteboard'));
    fireEvent.doubleClick(screen.getByTestId('board-tab-whiteboard-2'));
    fireEvent.change(screen.getByTestId('board-tab-rename'), { target: { value: 'Sketches' } });
    fireEvent.keyDown(screen.getByTestId('board-tab-rename'), { key: 'Enter' });
    await waitFor(() => expect(within(screen.getByTestId('board-tabs')).getByText('Sketches')).toBeTruthy());
    fireEvent.click(screen.getByTestId('board-tab-delete-whiteboard-2'));
    fireEvent.click(screen.getByTestId('board-delete-ok'));
    await waitFor(() => expect(screen.queryByTestId('board-tab-whiteboard-2')).toBeNull());
    expect(server.boards().map((b) => b.id)).toEqual(['architecture', 'whiteboard']);
  });

  it('with no boards server it is the session pad it always was', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    mountWhiteboard();
    expect(screen.getByTestId('whiteboard')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('wb-boards').getAttribute('data-board')).toBe(''));
  });
});

describe('an annotation on the architecture board', () => {
  it('follows its card: the same mark, drawn beside the node wherever the node is', () => {
    const items = [{ kind: 'text' as const, sticky: true, id: 'n', anchor: 'svc:payments', at: { x: 184, y: 0 }, text: 'Calls Stripe', by: 'agent' as const }];
    let box = { x: 100, y: 40, w: 160, h: 64 };
    const view = render(<ArchMarks items={items} boxOf={(id) => (id === 'svc:payments' ? box : undefined)} />);
    const at = () => {
      const el = screen.getByText('Calls Stripe').closest('[data-annot-id]') as HTMLElement;
      return [el.style.left, el.style.top];
    };
    expect(at()).toEqual(['284px', '40px']);
    box = { x: 500, y: 300, w: 160, h: 64 };
    view.rerender(<ArchMarks items={items} boxOf={(id) => (id === 'svc:payments' ? box : undefined)} />);
    expect(at()).toEqual(['684px', '300px']);
    view.rerender(<ArchMarks items={items} boxOf={() => undefined} />);
    expect(screen.queryByText('Calls Stripe')).toBeNull();
    expect(screen.getByTestId('annot-layer').getAttribute('data-hidden')).toBe('1');
  });

  it('draws a text mark clear of a connector that runs through where it was put', () => {
    const items = [{ kind: 'text' as const, id: 't', at: { x: 100, y: 100 }, text: 'Checkout core' }];
    const view = render(<ArchMarks items={items} boxOf={() => undefined} paths={['M0 300 L400 300']} cards={[]} />);
    const el = () => screen.getByText('Checkout core') as HTMLElement;
    expect(el().getAttribute('data-nudged')).toBeNull();
    view.rerender(<ArchMarks items={items} boxOf={() => undefined} paths={['M0 90 L400 90']} cards={[]} />);
    expect(el().getAttribute('data-nudged')).toBe('true');
    const dx = parseFloat(el().style.left) - 100;
    const dy = parseFloat(el().style.top) - 100;
    expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(24);
    /* A comb of connectors: no clear spot within reach, so it stays and gets a plate. */
    const comb = Array.from({ length: 40 }, (_, i) => `M${i * 10} 0 L${i * 10} 400`);
    view.rerender(<ArchMarks items={items} boxOf={() => undefined} paths={comb} cards={[]} />);
    expect(el().getAttribute('data-plate')).toBe('true');
    expect([el().style.left, el().style.top]).toEqual(['100px', '100px']);
  });
});
