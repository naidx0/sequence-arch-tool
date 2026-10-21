import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BoardTabs } from './BoardTabs';
import { ARCH_BOARD_ID, type BoardsIndex } from './boardsModel';

afterEach(cleanup);

const arch = { id: ARCH_BOARD_ID, name: 'Architecture', kind: 'architecture', rev: 1, createdAt: '', updatedAt: '' } as const;
const linked = { id: 'wb1', name: 'Sketch', kind: 'whiteboard', rev: 1, createdAt: '', updatedAt: '', chats: ['c1', 'c2', 'c3'] } as const;
const solo = { id: 'wb2', name: 'Mine', kind: 'whiteboard', rev: 1, createdAt: '', updatedAt: '', chats: ['c1'] } as const;
const noop = () => undefined;

/* Review: with no chat open, removing a Space deleted it from every chat, and the question did not say so. */
describe('deleting a Space with no chat open', () => {
  const mount = (onDelete: (id: string) => void) =>
    render(<BoardTabs index={{ version: 1, boards: [arch, linked, solo] } as unknown as BoardsIndex} current={ARCH_BOARD_ID} onOpen={noop} onCreate={noop} onRename={noop} onDelete={onDelete} />);

  it('names how many chats lose a Space that several chats hold, and does nothing until confirmed', () => {
    const onDelete = vi.fn();
    mount(onDelete);
    fireEvent.click(screen.getByTestId('board-tab-delete-wb1'));
    const dialog = screen.getByTestId('board-delete-confirm');
    expect(dialog.textContent).toMatch(/3 chats/);
    expect(dialog.textContent).toMatch(/all of them/);
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('board-delete-ok'));
    expect(onDelete).toHaveBeenCalledWith('wb1');
  });

  it('a Space held by one chat keeps the plain delete question', () => {
    mount(vi.fn());
    fireEvent.click(screen.getByTestId('board-tab-delete-wb2'));
    expect(screen.getByTestId('board-delete-confirm').textContent).not.toMatch(/all of them/);
  });
});
