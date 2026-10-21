import { renderHook, cleanup, act, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { BoardsIndex } from './boardsModel';
import { useBoardDelivery } from './useBoardDelivery';
import { boardsApi, useBoardDoc } from './boardsClient';
import type { BoardDoc } from './boardsModel';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const list = (rev: number, delivery?: { chat: string; rev: number }): BoardsIndex => ({ version: 1, boards: [{ id: 'target', name: 'Target', kind: 'whiteboard', rev, createdAt: '', updatedAt: '', chats: ['chat'], ...(delivery ? { delivery } : {}) }] });

it('follows delivery after the content revision has already arrived, only once', () => {
  const deliver = vi.fn();
  const view = renderHook(({ index }) => useBoardDelivery(index, 'project', 'chat', deliver), { initialProps: { index: list(0) } });
  view.rerender({ index: list(1) });
  expect(deliver).not.toHaveBeenCalled();
  view.rerender({ index: list(1, { chat: 'chat', rev: 1 }) });
  expect(deliver.mock.calls).toEqual([['target']]);
  view.rerender({ index: list(2, { chat: 'chat', rev: 1 }) });
  expect(deliver).toHaveBeenCalledTimes(1);
});

it('the same board id in another project cannot render or adopt the old project response', async () => {
  const pending: ((doc: BoardDoc) => void)[] = [];
  vi.spyOn(boardsApi, 'get').mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  const view = renderHook(({ project }) => useBoardDoc('target', true, project), { initialProps: { project: 'A' } });
  await act(async () => pending[0]!({ version: 1, id: 'target', rev: 9, items: [] }));
  await waitFor(() => expect(view.result.current.doc?.rev).toBe(9));
  view.rerender({ project: 'B' });
  expect(view.result.current.doc).toBeNull();
  expect(pending).toHaveLength(2);
  await act(async () => pending[1]!({ version: 1, id: 'target', rev: 1, items: [] }));
  await waitFor(() => expect(view.result.current.doc?.rev).toBe(1));
});

it('does not replay history on first load, chat/project switches, or another chat delivery', () => {
  const deliver = vi.fn();
  const view = renderHook(({ index, project, chat }) => useBoardDelivery(index, project, chat, deliver), { initialProps: { index: list(1, { chat: 'chat', rev: 1 }), project: 'A', chat: 'chat' } });
  view.rerender({ index: list(2, { chat: 'other', rev: 2 }), project: 'A', chat: 'chat' });
  view.rerender({ index: list(3, { chat: 'chat', rev: 3 }), project: 'B', chat: 'chat' });
  view.rerender({ index: list(4, { chat: 'other', rev: 4 }), project: 'B', chat: 'other' });
  expect(deliver).not.toHaveBeenCalled();
  view.rerender({ index: list(5, { chat: 'other', rev: 5 }), project: 'B', chat: 'other' });
  expect(deliver.mock.calls).toEqual([['target']]);
});
