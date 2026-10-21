import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { boardsApi, resetBoardsStreamForTests, useBoardsIndex } from './boardsClient';
import { FakeEventSource } from './fakeBoardsServer';

afterEach(() => { cleanup(); resetBoardsStreamForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('host and later surfaces share one scoped read and one refresh per event, until the last leaves', async () => {
  vi.stubGlobal('EventSource', FakeEventSource);
  const list = vi.spyOn(boardsApi, 'list').mockResolvedValue({ version: 1, boards: [] });
  const host = renderHook(() => useBoardsIndex(true, 'A'));
  await waitFor(() => expect(host.result.current.index).not.toBeNull());
  const pane = renderHook(() => useBoardsIndex(true, 'A'));
  await waitFor(() => expect(pane.result.current.index).toBe(host.result.current.index));
  expect(list).toHaveBeenCalledTimes(1);
  act(() => FakeEventSource.fire({ type: 'boards' }));
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  host.unmount();
  act(() => FakeEventSource.fire({ type: 'boards' }));
  await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
  pane.unmount();
  expect(FakeEventSource.open).toHaveLength(0);
});
it('never shares a project response with another project', async () => {
  vi.stubGlobal('EventSource', FakeEventSource);
  const list = vi.spyOn(boardsApi, 'list').mockResolvedValue({ version: 1, boards: [] });
  renderHook(() => useBoardsIndex(true, 'A'));
  renderHook(() => useBoardsIndex(true, 'B'));
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
});
