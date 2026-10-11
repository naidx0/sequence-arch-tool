import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceRoot } from './LiveSurface';

/*
 * THE DEFAULT WORKSPACE IS A PROJECT (round 7, B6; Jaden: "Terminal: start a
 * project... The default workspace should be a project"). With nothing
 * attached, the Terminal surface is handed the home workspace's folder (what
 * GET /api/workspace names), so it connects instead of asking for a project.
 * The server half (the shell's cwd falls back to the same folder) is locked
 * in packages/analyzer/src/test/terminal.test.ts.
 */

afterEach(() => vi.unstubAllGlobals());

describe('the terminal in the default workspace', () => {
  it('is given the workspace folder the server names', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ root: 'C:/Users/dev/.sequence/workspace', exists: true, entries: [] })));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useWorkspaceRoot(true));
    await waitFor(() => expect(result.current).toBe('C:/Users/dev/.sequence/workspace'));
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe('/api/workspace');
  });

  it('asks nothing when a project is attached (the repo is the place)', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useWorkspaceRoot(false));
    expect(result.current).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stays without a folder when the server names none (no workspace on a read-only home)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ root: '', exists: false })));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useWorkspaceRoot(true));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});
