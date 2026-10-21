import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

import { agentRuns } from '../agents/agentRuns';
import { BoardMenu } from './BoardMenu';

/* ══════════════════════════════════════════════════════════════════════════
   019-16: RIGHT-CLICK AGENT ACTIONS ON A NODE
   Explain, Find callers, Write a test, Refactor: one row component, one run
   path. Each row starts the run Explain starts (nothing new auto-sends that
   Explain does not), with a question that names the node and its file.
   ══════════════════════════════════════════════════════════════════════════ */

afterEach(() => vi.restoreAllMocks());

const labels = (menu: HTMLElement) => Array.from(menu.querySelectorAll('[role="menuitem"]')).map((e) => e.textContent?.trim());

function mount(path?: string) {
  const start = vi.spyOn(agentRuns, 'start').mockResolvedValue({} as never);
  const onClose = vi.fn();
  render(
    <BoardMenu
      target={{ nodeId: 'svc:orders', label: 'orders', ...(path ? { path } : {}), x: 0, y: 0 }}
      onRename={() => {}}
      onDelete={() => {}}
      onClose={onClose}
      onAskHere={() => {}}
    />,
  );
  return { start, onClose };
}

describe('node menu agent actions (019-16)', () => {
  it('lists Explain, Find callers, Write a test, Refactor, each once', () => {
    mount('src/orders.ts');
    const l = labels(screen.getByTestId('board-menu'));
    for (const w of ['Explain', 'Find callers', 'Write a test', 'Refactor']) expect(l.filter((x) => x === w)).toHaveLength(1);
  });

  it('Find callers starts the same run path as Explain, naming the node and its file', () => {
    const { start, onClose } = mount('src/orders.ts');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Find callers' }));
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]![0]).toEqual({
      nodeId: 'svc:orders',
      nodeLabel: 'orders',
      question: 'Find callers of orders (svc:orders, src/orders.ts): list every place that calls or imports it, with file:line, and say which are tests.',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('Write a test and Refactor carry their own grounded question', () => {
    const { start } = mount('src/orders.ts');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Write a test' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Refactor' }));
    expect(start.mock.calls.map((c) => (c[0] as { question?: string }).question)).toEqual([
      'Write a test for orders (svc:orders, src/orders.ts). Cover its normal behaviour and its edge cases, follow the test style already in this repo, and run it.',
      'Refactor orders (svc:orders, src/orders.ts) to make it simpler without changing what it does. Say what you would change first, and keep the diff small.',
    ]);
  });

  it('a node the scan gave no file names only its id', () => {
    const { start } = mount();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Find callers' }));
    expect((start.mock.calls[0]![0] as { question?: string }).question).toBe(
      'Find callers of orders (svc:orders): list every place that calls or imports it, with file:line, and say which are tests.',
    );
  });

  it('Explain still starts its run with the default question (no question override)', () => {
    const { start } = mount('src/orders.ts');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Explain' }));
    expect(start.mock.calls[0]![0]).toEqual({ nodeId: 'svc:orders', nodeLabel: 'orders' });
  });
});
